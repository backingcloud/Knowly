import {test, expect, chromium, type BrowserContext, type Page} from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
let context: BrowserContext;
let profile: string;
let page: Page;
test.beforeAll(async () => {
  profile = await fs.mkdtemp(path.join(os.tmpdir(),'knowly-test-'));
  const extension = path.resolve('.output/chrome-mv3');
  context = await chromium.launchPersistentContext(profile,{channel:'chromium',executablePath:process.env.KNOWLY_BROWSER_EXECUTABLE || undefined,headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
});
test.afterAll(async () => {await context?.close(); if(profile) await fs.rm(profile,{recursive:true,force:true});});
test.beforeEach(async () => {page = await context.newPage(); await page.goto('http://127.0.0.1:4173'); await page.locator('knowly-ui').waitFor({state:'attached'});});
test.afterEach(async () => {await page.close();});
async function select(selector: string) {
  await page.locator(selector).evaluate(el => {
    const range = document.createRange(); range.selectNodeContents(el);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,composed:true}));
  });
}
test('selection → explanation → copy → close, with style isolation',async () => {
  await page.addStyleTag({content:'button{background:rgb(255,0,0)!important;font-size:60px!important}html{font-size:40px}'});
  await page.locator('#term').dblclick();
  const button=page.getByRole('button',{name:'解释所选内容'});
  await expect(button).toBeVisible();
  await expect(button).toHaveCSS('font-size','14px');
  await button.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Harness 原意是挽具。',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'复制解释'}).click();
  await expect(page.getByRole('status')).toHaveText('已复制');
  await page.screenshot({path:'../../work/knowly-card.png'});
  await page.getByRole('button',{name:'关闭解释'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('unknown terms are marked as placeholder; escape and reselect work', async () => {
  await select('#unknown'); await page.getByRole('button',{name:'解释所选内容'}).click();
  await expect(page.getByText('尚未生成该词的真实解释。',{exact:false})).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await select('#term'); await expect(page.getByRole('button',{name:'解释所选内容'})).toBeVisible();
});
test('scroll follows selection, hides offscreen, restores on return', async () => {
  await select('#term');
  const trigger = page.getByRole('button',{name:'解释所选内容'});
  await expect(trigger).toBeVisible();
  const before = await trigger.boundingBox();
  await page.evaluate(()=>window.scrollBy(0,60));
  await expect.poll(async () => (await trigger.boundingBox())?.y).toBeLessThan(before!.y);
  await trigger.click();
  await page.evaluate(()=>window.scrollTo(0,1200)); await expect(page.getByRole('dialog')).toBeHidden();
  await page.evaluate(()=>window.scrollTo(0,0)); await expect(page.getByRole('dialog')).toBeVisible();
});
test('editable areas and oversized selections are ignored', async () => {
  await select('[contenteditable]'); await expect(page.getByRole('button',{name:'解释所选内容'})).toHaveCount(0);
  await page.locator('#unknown').evaluate(el=>el.textContent='a'.repeat(201));
  await select('#unknown'); await expect(page.getByRole('button',{name:'解释所选内容'})).toHaveCount(0);
});
test('nested scroll and small viewport stay usable', async () => {
  await select('#nested-term'); const button=page.getByRole('button',{name:'解释所选内容'});
  await expect(button).toBeVisible();
  await page.locator('#nested').evaluate(el=>el.scrollTop=160);
  await expect(button).toBeHidden();
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.setViewportSize({width:320,height:480}); await select('#term');
  await button.click(); await expect(page.getByRole('dialog')).toBeVisible();
  const box=await page.getByRole('dialog').boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x+box!.width).toBeLessThanOrEqual(320);
});


