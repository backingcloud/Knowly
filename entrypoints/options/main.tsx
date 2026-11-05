import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import { DEFAULT_MODEL, PROVIDERS, SETTINGS_KEY, TEST_PROVIDER_MESSAGE, type KnowlySettings, type ProviderCredentials, type ProviderId } from '../../src/services/explanation';
import './style.css';

function Options() {
  const [provider, setProvider] = useState<ProviderId>('deepseek');
  const [credentials, setCredentials] = useState<Partial<Record<ProviderId, ProviderCredentials>>>({});
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [status, setStatus] = useState('');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    browser.storage.local.get(SETTINGS_KEY).then((stored) => {
      const settings = (stored as Record<string, KnowlySettings | undefined>)[SETTINGS_KEY];
      const values = { ...(settings?.credentials ?? {}) };
      if (!values.deepseek && settings?.deepseekApiKey) values.deepseek = { apiKey: settings.deepseekApiKey, model: settings.deepseekModel || DEFAULT_MODEL };
      const selected = settings?.provider ?? 'deepseek';
      setCredentials(values); setProvider(selected); setModel(values[selected]?.model || PROVIDERS[selected].defaultModel);
    });
  }, []);

  const selectProvider = (next: ProviderId) => { setProvider(next); setApiKey(''); setModel(credentials[next]?.model || PROVIDERS[next].defaultModel); setStatus(''); };
  const currentKey = () => apiKey.trim() || credentials[provider]?.apiKey || '';

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const key = currentKey();
    if (!key) { setStatus(`请填写${PROVIDERS[provider].label} API Key。`); return; }
    if (!model.trim()) { setStatus(`请填写${PROVIDERS[provider].label}的模型 ID。`); return; }
    const next = { ...credentials, [provider]: { apiKey: key, model: model.trim() } };
    await browser.storage.local.set({ [SETTINGS_KEY]: { provider, credentials: next } satisfies KnowlySettings });
    setCredentials(next); setApiKey(''); setStatus(`已保存并切换到${PROVIDERS[provider].label}。`);
  };

  const testConnection = async () => {
    if (!currentKey()) { setStatus(`请先填写${PROVIDERS[provider].label} API Key。`); return; }
    if (!model.trim()) { setStatus(`请填写${PROVIDERS[provider].label}的模型 ID。`); return; }
    setTesting(true); setStatus('正在发送一条简短请求测试连接，平台可能会收取少量调用费用……');
    try {
      const result = await browser.runtime.sendMessage({ type: TEST_PROVIDER_MESSAGE, provider, apiKey: currentKey(), model: model.trim() }) as { error?: string };
      if (result?.error) throw new Error(result.error);
      setStatus('连接成功。点击“保存并使用此模型”后即可生效。');
    } catch (error) { setStatus(error instanceof Error ? error.message : '连接测试失败，请检查网络、API Key 和模型 ID。'); }
    finally { setTesting(false); }
  };

  const clear = async () => {
    const next = { ...credentials }; delete next[provider];
    await browser.storage.local.set({ [SETTINGS_KEY]: { provider, credentials: next } satisfies KnowlySettings });
    setCredentials(next); setApiKey(''); setModel(PROVIDERS[provider].defaultModel); setStatus(`已删除${PROVIDERS[provider].label}的本地配置。`);
  };
  const saved = credentials[provider];

  return <main className="settings">
    <div className="brand">KNOWLY <span>AI 伴学</span></div>
    <h1>选择模型</h1>
    <p className="intro">选择模型平台，填写对应平台的 API Key 和模型 ID。保存后，新解释和追问会使用当前选中的模型。</p>
    <form onSubmit={save}>
      <label htmlFor="provider">模型平台</label>
      <select id="provider" value={provider} onChange={event => selectProvider(event.target.value as ProviderId)}>
        {(Object.keys(PROVIDERS) as ProviderId[]).map(id => <option value={id} key={id}>{PROVIDERS[id].label}</option>)}
      </select>
      <label htmlFor="api-key">{PROVIDERS[provider].label} API Key</label>
      <input id="api-key" type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={saved?.apiKey ? '当前模型已有保存的 Key；输入新 Key 可替换' : '粘贴平台提供的 API Key'} />
      <label htmlFor="model">模型 ID</label>
      <input id="model" type="text" autoComplete="off" spellCheck={false} value={model} onChange={event => setModel(event.target.value)} placeholder={PROVIDERS[provider].modelHint} />
      {provider === 'doubao' && <p className="hint">请填写火山引擎控制台提供的 Model ID 或 Endpoint ID。</p>}
      <div className="actions">
        <button className="primary" type="submit">保存并使用此模型</button>
        <button className="secondary" type="button" onClick={testConnection} disabled={testing}>{testing ? '正在测试…' : '测试连接'}</button>
        {saved && <button className="secondary" type="button" onClick={clear}>删除此模型的配置</button>}
      </div>
    </form>
    {status && <p className="status" role="status">{status}</p>}
    <aside><strong>API Key 和隐私</strong><p>API Key 和模型 ID 保存在当前 Chrome 浏览器的扩展存储中。解释请求只发送选中的文字；打开“同时发送所在句子”后，才会附带那一句上下文。</p><p>连接测试会发送一条简短请求，平台可能会产生少量费用。这里不会上传 API Key 到 Knowly 服务器。</p></aside>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Options />);
