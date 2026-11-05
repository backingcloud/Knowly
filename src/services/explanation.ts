import { browser } from 'wxt/browser';

export interface Explanation {
  definition: string;
  usage: string;
  example: string;
  provider?: ProviderId;
}

export interface FollowUp {
  question: string;
  answer: string;
}

export type ProviderId = 'deepseek' | 'zhipu' | 'doubao';

export interface ProviderCredentials {
  apiKey: string;
  model: string;
}

export interface KnowlySettings {
  provider: ProviderId;
  credentials: Partial<Record<ProviderId, ProviderCredentials>>;
  deepseekApiKey?: string;
  deepseekModel?: string;
}

export interface ExplanationProvider {
  explain(term: string, context?: string, onDelta?: (text: string) => void): Promise<Explanation>;
  followUp(term: string, context: string | undefined, initial: Explanation, history: FollowUp[], question: string): Promise<string>;
  testProvider(provider: ProviderId, apiKey: string, model: string): Promise<void>;
}

export const SETTINGS_KEY = 'knowlySettings';
export const PENDING_CARDS_KEY = 'knowlyPendingCards';
export const DEFAULT_MODEL = 'deepseek-flash';
export const EXPLAIN_MESSAGE = 'KNOWLY_EXPLAIN';
export const FOLLOW_UP_MESSAGE = 'KNOWLY_FOLLOW_UP';
export const TEST_PROVIDER_MESSAGE = 'KNOWLY_TEST_PROVIDER';
export const EXPLAIN_STREAM_MESSAGE = 'KNOWLY_EXPLAIN_STREAM';

export const PROVIDERS: Record<ProviderId, { label: string; endpoint: string; defaultModel: string; modelHint: string }> = {
  deepseek: {
    label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/chat/completions',
    defaultModel: DEFAULT_MODEL,
    modelHint: '例如 deepseek-flash',
  },
  zhipu: {
    label: '智谱 GLM',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    defaultModel: '',
    modelHint: '填写智谱平台中可用的模型 ID',
  },
  doubao: {
    label: '豆包（火山方舟）',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    defaultModel: '',
    modelHint: '填写火山方舟的 Model ID 或 Endpoint ID',
  },
};

type RuntimeResponse<T> = { data: T } | { error: string };

async function send<T>(message: Record<string, unknown>): Promise<T> {
  try {
    const response = await browser.runtime.sendMessage(message) as RuntimeResponse<T>;
    if ('error' in response) throw new Error(response.error);
    return response.data;
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    if (/context invalidated|receiving end does not exist|message port closed/i.test(messageText)) {
      throw new Error('Knowly 扩展刚更新或重新加载了，请刷新当前网页后重试。');
    }
    throw error;
  }
}

export const remoteExplanationProvider: ExplanationProvider = {
  explain(term, context, onDelta) {
    if (!onDelta) return send<Explanation>({ type: EXPLAIN_MESSAGE, term, context });
    return new Promise((resolve, reject) => {
      let port: ReturnType<typeof browser.runtime.connect>;
      try { port = browser.runtime.connect({ name: EXPLAIN_STREAM_MESSAGE }); }
      catch (error) { reject(error); return; }
      let fullText = '';
      port.onMessage.addListener((message: { type: string; text?: string; explanation?: Explanation; error?: string }) => {
        if (message.type === 'delta' && message.text) { fullText += message.text; onDelta(message.text); }
        if (message.type === 'done' && message.explanation) { port.disconnect(); resolve(message.explanation); }
        if (message.type === 'error') { port.disconnect(); reject(new Error(message.error || '模型请求失败，请重试。')); }
      });
      port.onDisconnect.addListener(() => {
        const lastError = browser.runtime.lastError;
        if (fullText && !lastError) return;
        reject(new Error(lastError?.message?.includes('context') ? 'Knowly 扩展刚更新或重新加载了，请刷新当前网页后重试。' : '模型连接中断，请重试。'));
      });
      port.postMessage({ type: 'start', term, context });
    });
  },
  followUp: (term, context, initial, history, question) => send<string>({
    type: FOLLOW_UP_MESSAGE, term, context, initial, history, question,
  }),
  async testProvider(provider, apiKey, model) {
    await send<void>({ type: TEST_PROVIDER_MESSAGE, provider, apiKey, model });
  },
};
