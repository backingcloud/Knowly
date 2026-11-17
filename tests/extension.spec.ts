import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import fs from 'node:fs/promises';

async function select(page: Page, selector: string) {
  await page.locator(selector).evaluate(el => {
    const range = document.createRange(); range.selectNodeContents(el);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
  });
}
async function explain(page: Page, selector = '#term') {
  await select(page, selector);
  await page.getByRole('button', { name: '解释选中文字' }).click();
  await expect(page.getByRole('button', { name: '复制解释' })).toBeEnabled();
}

test('real extension injection, selection, bold original sentence, action order and copy', async ({ page }, info) => {
  await page.addStyleTag({ content: 'button{background:rgb(255,0,0)!important;font-size:60px!important}html{font-size:40px}' });
  await page.locator('#term').dblclick();
  const trigger = page.getByRole('button', { name: '解释选中文字' });
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveCSS('font-size', '14px');
  await trigger.click();
  await expect(page.getByText('Harness 原意是挽具，也表示利用工具。', { exact: true })).toBeVisible();
  await expect(page.locator('.topic-context strong')).toHaveText('harness');
  await expect(page.locator('.topic-context strong')).toHaveCSS('font-weight', '700');
  await expect(page.locator('.action-row-utility button')).toHaveText(['复制解释', '保存 Markdown']);
  await expect(page.locator('.action-row-main button')).toHaveText(['加入待保存', '加入并继续选词']);
  await expect(page.locator('.queue-empty-toggle')).toHaveText('待保存清单 0');
  await page.getByRole('button', { name: '复制解释' }).click();
  await expect(page.locator('.action-status')).toHaveText('解释已复制。');
  await page.screenshot({ path: info.outputPath('knowly-card.png') });
  await page.getByRole('button', { name: '关闭解释' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('context opt-in, follow-up history, note, single save and persisted queue export', async ({ page, background }) => {
  await explain(page);
  const requests = () => background.evaluate(() => (globalThis as any).__requests);
  expect((await requests())[0].messages[1].content).toBe('选中的文字：harness');
  await page.getByRole('checkbox', { name: '发送原句给 AI' }).check();
  await expect(page.getByRole('button', { name: '复制解释' })).toBeEnabled();
  expect((await requests())[1].messages[1].content).toContain('所在句子（仅供理解）');
  await page.getByRole('textbox', { name: '输入追问内容' }).fill('举个工作中的例子');
  await page.getByRole('button', { name: '追问', exact: true }).click();
  await expect(page.locator('.assistant-bubble')).toContainText('例如，用测试工具组织并运行自动化测试。');
  await expect(page.locator('.initial-explanation')).toHaveJSProperty('open', false);
  await expect(page.locator('.initial-explanation summary')).toHaveText('查看初始解释');
  await page.getByRole('textbox', { name: '输入追问内容' }).fill('再解释一步');
  await page.getByRole('textbox', { name: '输入追问内容' }).press('Enter');
  await expect(page.locator('.assistant-bubble')).toHaveCount(2);
  await expect(page.locator('.topic-header')).toBeInViewport();
  await expect(page.locator('.topic-context strong')).toHaveText('harness');
  await expect(page.locator('.turn').last()).toContainText('再解释一步');
  await expect(page.getByRole('textbox', { name: '输入追问内容' })).toBeInViewport();
  expect((await requests())[3].messages).toContainEqual({role:'user', content:'举个工作中的例子'});
  await page.getByRole('textbox', { name: '我的笔记' }).fill('我的理解：组织工具。');
  const singlePromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存 Markdown', exact: true }).click();
  const single = await singlePromise;
  const markdown = await fs.readFile((await single.path())!, 'utf8');
  expect(markdown).toContain('**harness**');
  expect(markdown).toContain('举个工作中的例子');
  expect(markdown).toContain('我的理解：组织工具。');
  expect(markdown).toContain('http://127.0.0.1:4174');
  await page.getByRole('button', { name: '加入待保存', exact: true }).click();
  await page.getByRole('textbox', { name: '我的笔记' }).fill('更新后的笔记');
  await page.getByRole('button', { name: '更新待保存', exact: true }).click();
  await expect(page.locator('.queue-item')).toHaveCount(0);
  await expect.poll(() => background.evaluate(async () => (await (globalThis as any).chrome.storage.local.get('knowlyPendingCards')).knowlyPendingCards?.[0]?.personalNote)).toBe('更新后的笔记');
  await page.reload();
  await explain(page);
  await page.locator('.queue-toggle').click();
  await expect(page.locator('.queue-item')).toHaveCount(1);
  const mergedPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '合并导出' }).click();
  const merged = await mergedPromise;
  expect(await fs.readFile((await merged.path())!, 'utf8')).toContain('更新后的笔记');
  await expect(page.locator('.queue-item')).toHaveCount(1);
  await page.getByRole('button', { name: '移除 harness' }).click();
  await expect(page.locator('.queue-item')).toHaveCount(0);
});

test('add and continue selection, merge two cards, clear queue', async ({ page }) => {
  await explain(page);
  await page.getByRole('button', { name: '加入并继续选词', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await explain(page, '#unknown');
  await page.getByRole('button', { name: '加入待保存', exact: true }).click();
  await page.locator('.queue-toggle').click();
  await expect(page.locator('.queue-item')).toHaveCount(2);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '合并导出' }).click();
  const download = await pending;
  const text = await fs.readFile((await download.path())!, 'utf8');
  expect(text).toContain('共 2 张'); expect(text).toContain('## 二、unfamiliar concept');
  await page.getByRole('button', { name: '清空', exact: true }).click();
  await expect(page.locator('.queue-item')).toHaveCount(0);
});

test('model failure can retry; escape and reselect work', async ({ page, background }) => {
  await background.evaluate(() => { (globalThis as any).__failNext = true; });
  await select(page, '#unknown'); await page.getByRole('button', { name: '解释选中文字' }).click();
  await expect(page.getByRole('alert')).toContainText('请求过于频繁');
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByRole('button', { name: '复制解释' })).toBeEnabled();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await select(page, '#term'); await expect(page.getByRole('button', { name: '解释选中文字' })).toBeVisible();
});

test('scroll follows trigger, hides offscreen and keeps an open card usable', async ({ page }) => {
  await select(page, '#term'); const trigger = page.getByRole('button', { name: '解释选中文字' });
  await expect(trigger).toBeVisible(); const before = await trigger.boundingBox();
  await page.evaluate(() => window.scrollBy(0, 60));
  await expect.poll(async () => (await trigger.boundingBox())?.y).toBeLessThan(before!.y);
  await page.evaluate(() => window.scrollTo(0, 1200)); await expect(trigger).toBeHidden();
  await page.evaluate(() => window.scrollTo(0, 0)); await trigger.click();
  await page.evaluate(() => window.scrollTo(0, 1200)); await expect(page.getByRole('dialog')).toBeVisible();
});

test('editable areas and oversized selections are ignored', async ({ page }) => {
  await select(page, '[contenteditable]'); await expect(page.getByRole('button', { name: '解释选中文字' })).toHaveCount(0);
  await page.locator('#unknown').evaluate(el => el.textContent = 'a'.repeat(201));
  await select(page, '#unknown'); await expect(page.getByRole('button', { name: '解释选中文字' })).toHaveCount(0);
});

test('nested scroll and small viewport stay usable', async ({ page }) => {
  await select(page, '#nested-term'); const trigger = page.getByRole('button', { name: '解释选中文字' });
  await expect(trigger).toBeVisible(); await page.locator('#nested').evaluate(el => el.scrollTop = 160);
  await expect(trigger).toBeHidden();
  await page.evaluate(() => window.scrollTo(0, 0)); await page.setViewportSize({ width: 320, height: 480 });
  await explain(page);
  const box = await page.getByRole('dialog').boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  await expect(page.getByRole('button', { name: '保存 Markdown', exact: true })).toBeInViewport();
});

test('expanded queue grows naturally and the whole card scrolls on a small viewport', async ({ page, background }) => {
  await background.evaluate(async () => {
    const cards = Array.from({ length: 5 }, (_, index) => ({
      id: `layout-${index}`, term: `term ${index + 1}`,
      explanation: { definition: '测试解释', usage: '', example: '' },
      context: `原句包含 term ${index + 1}`, sourceTitle: 'Test', sourceUrl: 'http://127.0.0.1:4174/',
      createdAt: '2026-11-17', personalNote: '', followUps: [],
    }));
    await (globalThis as any).chrome.storage.local.set({ knowlyPendingCards: cards });
  });
  await page.reload();
  await page.setViewportSize({ width: 360, height: 520 });
  await select(page, '#term');
  await page.getByRole('button', { name: '解释选中文字' }).click();
  await page.locator('.queue-toggle').click();
  await expect(page.locator('.queue-item')).toHaveCount(5);

  const card = page.getByRole('dialog');
  const dimensions = await card.evaluate(el => ({ client: el.clientHeight, scroll: el.scrollHeight }));
  expect(dimensions.client).toBeLessThanOrEqual(504);
  expect(dimensions.scroll).toBeGreaterThan(dimensions.client);
  await expect(page.locator('.queue-return')).toContainText('返回「harness」学习卡');

  await card.evaluate(el => el.scrollTo(0, el.scrollHeight));
  await expect(page.locator('.queue-item').last()).toBeInViewport();
  await expect(page.getByRole('button', { name: '合并导出' })).toBeInViewport();
  await page.locator('.queue-return').click();
  await expect(page.getByRole('textbox', { name: '输入追问内容' })).toBeAttached();
});

test('queue summary opens a dedicated view, returns to the same card and has clear row actions', async ({ page }) => {
  await explain(page);
  await page.getByRole('button', { name: '加入待保存', exact: true }).click();
  const preview = page.getByRole('button', { name: '展开待保存清单，共 1 张' });
  await expect(preview).toContainText('待保存清单');
  await expect(preview).toContainText('harness');
  const originalScroll = await page.getByRole('dialog').evaluate(el => el.scrollTop);
  await preview.click();
  await expect(page.getByRole('heading', { name: '待保存清单' })).toBeVisible();
  await expect(page.locator('.queue-item')).toHaveCount(1);
  const rowBox = await page.locator('.queue-item').first().boundingBox();
  const updateBox = await page.getByRole('button', { name: '更新 harness' }).boundingBox();
  const removeBox = await page.getByRole('button', { name: '移除 harness' }).boundingBox();
  expect(updateBox!.x).toBeGreaterThan(rowBox!.x + rowBox!.width / 2);
  expect(removeBox!.x).toBeGreaterThan(updateBox!.x);
  expect(removeBox!.x - (updateBox!.x + updateBox!.width)).toBeLessThan(16);
  await page.locator('.queue-return').click();
  await expect(page.getByRole('heading', { name: 'harness' })).toBeVisible();
  expect(await page.getByRole('dialog').evaluate(el => el.scrollTop)).toBe(originalScroll);
});

test('edit a pending card and restore the unsaved active keyword with its draft intact', async ({ page, background }) => {
  const original = {
    id: 'saved-harness', term: 'harness',
    explanation: { definition: '已保存的解释。', usage: '既有用途。', example: '原有例子。', provider: 'deepseek' },
    context: '加载插件后，用鼠标选中 harness，再点击「AI 解释」。',
    sourceTitle: 'Original page', sourceUrl: 'https://example.test/reading#section',
    createdAt: '2026-01-02', personalNote: '原有笔记。',
    followUps: [{ question: '已有问题？', answer: '已有回答。' }],
  };
  await background.evaluate(async card => {
    await (globalThis as any).chrome.storage.local.set({ knowlyPendingCards: [card] });
  }, original);
  await page.reload();
  await explain(page, '#unknown');
  await page.getByRole('textbox', { name: '我的笔记' }).fill('新关键词笔记草稿');
  await page.locator('.queue-toggle').click();
  await page.getByRole('button', { name: '更新 harness' }).click();

  await expect(page.getByRole('heading', { name: 'harness' })).toBeVisible();
  await page.locator('.initial-explanation summary').click();
  await expect(page.getByText('已保存的解释。')).toBeVisible();
  await expect(page.locator('.assistant-bubble')).toContainText('已有回答。');
  await expect(page.getByRole('textbox', { name: '我的笔记' })).toHaveValue('原有笔记。');
  await expect(page.getByRole('button', { name: '更新待保存', exact: true })).toBeEnabled();

  await page.getByRole('textbox', { name: '我的笔记' }).fill('更新后的笔记。');
  await page.getByRole('textbox', { name: '输入追问内容' }).fill('再补充一个例子');
  await page.getByRole('button', { name: '追问', exact: true }).click();
  await expect(page.locator('.assistant-bubble')).toHaveCount(2);
  await page.getByRole('button', { name: '更新待保存', exact: true }).click();

  await expect.poll(() => background.evaluate(async () => (await (globalThis as any).chrome.storage.local.get('knowlyPendingCards')).knowlyPendingCards?.[0])).toMatchObject({
    id: 'saved-harness', sourceTitle: 'Original page', sourceUrl: 'https://example.test/reading#section',
    createdAt: '2026-01-02', personalNote: '更新后的笔记。',
    followUps: [
      { question: '已有问题？', answer: '已有回答。' },
      { question: '再补充一个例子', answer: '例如，用测试工具组织并运行自动化测试。' },
    ],
  });
  await expect(page.getByRole('heading', { name: 'harness' })).toBeVisible();
  const returnOriginal = page.getByRole('button', { name: '返回原学习卡「unfamiliar concept」' });
  await expect(returnOriginal).toBeVisible();
  await returnOriginal.click();
  await expect(page.getByRole('heading', { name: 'unfamiliar concept' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '我的笔记' })).toHaveValue('新关键词笔记草稿');
  await expect(page.getByRole('button', { name: '加入待保存', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '加入待保存', exact: true }).click();
  await expect.poll(() => background.evaluate(async () => (await (globalThis as any).chrome.storage.local.get('knowlyPendingCards')).knowlyPendingCards)).toHaveLength(2);
  await expect.poll(() => background.evaluate(async () => (await (globalThis as any).chrome.storage.local.get('knowlyPendingCards')).knowlyPendingCards?.find((card: any) => card.term === 'unfamiliar concept')?.personalNote)).toBe('新关键词笔记草稿');
});
