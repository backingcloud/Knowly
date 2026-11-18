import { test as base, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';
import path from 'node:path';

export const test = base.extend<{ extensionContext: BrowserContext; background: Worker }>({
  extensionContext: async ({}, use) => {
    const extension = path.resolve('.output/chrome-mv3');
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium', headless: true,
      viewport: { width: 1100, height: 800 }, acceptDownloads: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    try { await use(context); } finally { await context.close(); }
  },
  background: async ({ extensionContext }, use) => {
    const worker = extensionContext.serviceWorkers()[0]
      ?? await extensionContext.waitForEvent('serviceworker', { timeout: 10000 });
    expect(worker.url()).toMatch(/^chrome-extension:\/\/.+\/background.js$/);
    // Mock only the external model HTTP boundary. Content scripts, runtime
    // messages, SSE parsing, storage and downloads all run in the real extension.
    await worker.evaluate(async () => {
      const api = (globalThis as any).chrome;
      await api.storage.local.set({ knowlySettings: {
        provider: 'deepseek', credentials: { deepseek: { apiKey: 'test-only', model: 'test-model' } },
      } });
      (globalThis as any).__requests = [];
      globalThis.fetch = async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        (globalThis as any).__requests.push(body);
        const held = (globalThis as any).__holdNext;
        if (held) { (globalThis as any).__holdNext = false; await new Promise<void>(resolve => { (globalThis as any).__releaseRequest = resolve; }); }
        if ((globalThis as any).__failNext) {
          (globalThis as any).__failNext = false;
          return new Response(JSON.stringify({error:{message:'test failure'}}), {status: 429});
        }
        if (body.stream) {
          const chunks = ['**这是什么**\n', held ? '旧请求的回答不应覆盖新卡片。' : (globalThis as any).__long ? '初始解释用于检查超长内容的滚动与折叠。'.repeat(200) : 'Harness 原意是挽具，也表示利用工具。'];
          return new Response(chunks.map(content => `data: ${JSON.stringify({choices:[{delta:{content}}]})}\n\n`).join('') + 'data: [DONE]\n\n',
            { headers: { 'Content-Type': 'text/event-stream' } });
        }
        return new Response(JSON.stringify({ choices: [{ message: { content: (globalThis as any).__answer ?? ((globalThis as any).__long ? '追问回答用于验证阅读区独立滚动，笔记和操作栏不被压缩。'.repeat(200) : '例如，用测试工具组织并运行自动化测试。') } }] }),
          { headers: { 'Content-Type': 'application/json' } });
      };
    });
    await use(worker);
  },
  page: async ({ extensionContext, background }, use) => {
    const page = await extensionContext.newPage();
    await page.goto('http://127.0.0.1:4174');
    await expect(page.locator('knowly-ui')).toBeAttached();
    await use(page);
    await page.close();
  },
});
export { expect };
