import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import fs from 'node:fs/promises';

async function open(page: Page) {
  await page.locator('#term').evaluate(el => { const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,composed:true})); });
  await page.getByRole('button',{name:'解释选中文字'}).click();
  await expect(page.getByRole('button',{name:'复制初始解释'})).toBeEnabled();
}
async function ask(page: Page, question: string) {
  const count=await page.locator('.assistant-bubble').count();
  await page.getByRole('textbox',{name:'输入追问内容'}).fill(question);
  await page.getByRole('button',{name:'追问',exact:true}).click();
  await expect(page.locator('.assistant-bubble')).toHaveCount(count+1);
  await expect(page.getByRole('button',{name:'加入待保存',exact:true})).toBeEnabled();
}

test('context checkbox never regenerates; only opted-in follow-up sends original sentence',async({page,background})=>{
  await open(page);await page.getByRole('textbox',{name:'我的笔记'}).fill('保留我的笔记');
  await ask(page,'第一次追问');
  const requests=()=>background.evaluate(()=>(globalThis as any).__requests);
  expect((await requests())[1].messages[1].content).not.toContain('上下文：');
  await page.getByRole('checkbox',{name:'下次追问附带原句'}).check();
  await expect(page.locator('.context-send-hint')).toContainText('将附带上方原句');
  expect(await requests()).toHaveLength(2);
  await expect(page.locator('.assistant-bubble')).toHaveCount(1);
  await expect(page.getByRole('textbox',{name:'我的笔记'})).toHaveValue('保留我的笔记');
  await ask(page,'带原句的追问');
  const sentence=await page.locator('.topic-context p').textContent();
  expect((await requests())[2].messages[1].content).toContain('上下文：'+sentence);
  const attachment=page.locator('.turn').last().locator('.sent-context');
  await expect(attachment.locator('summary')).toHaveText('已附带原句 · 查看');
  await attachment.locator('summary').click();await expect(attachment.locator('p')).toHaveText(sentence!);
  await page.getByRole('checkbox',{name:'下次追问附带原句'}).uncheck();
  expect(await requests()).toHaveLength(3);
  await ask(page,'不带原句的追问');
  expect((await requests())[3].messages[1].content).not.toContain('上下文：');
  await expect(page.locator('.turn').last().locator('.sent-context')).toHaveCount(0);
  await page.getByRole('button',{name:'加入待保存',exact:true}).click();
  const stored=await background.evaluate(async()=> (await (globalThis as any).chrome.storage.local.get('knowlyPendingCards')).knowlyPendingCards[0].followUps);
  expect(stored[1].contextSent).toBe(sentence);expect(stored[2].contextSent).toBeUndefined();
  expect((await requests())[3].messages).toContainEqual({role:'user',content:'带原句的追问'});
});

test('model badge tracks actual selected provider and model without another explanation request',async({page,background})=>{
  await open(page);await expect(page.locator('.badge')).toHaveText('DeepSeek');
  for(const [provider,label] of [['zhipu','智谱 GLM'],['doubao','豆包（火山方舟）'],['deepseek','DeepSeek']]){
    await background.evaluate(async p=>{await (globalThis as any).chrome.storage.local.set({knowlySettings:{provider:p,credentials:{[p!]:{apiKey:'test-only',model:'selected-'+p}}}});},provider);
    await expect(page.locator('.badge')).toHaveText(label!);
    await expect(page.locator('.badge')).toHaveAttribute('title',new RegExp('selected-'+provider));
    await ask(page,'模型切换测试 '+provider);
    expect(await background.evaluate(()=>(globalThis as any).__requests.at(-1).model)).toBe('selected-'+provider);
  }
});

for(const viewport of [{width:1100,height:900},{width:390,height:740},{width:320,height:480}]){
  test(`cafe long content, fixed actions, readable palettes and restored state ${viewport.width}`,async({page,background},info)=>{
    await page.setViewportSize(viewport);
    await background.evaluate(()=>{(globalThis as any).__long=true;});
    await open(page);
    await expect(page.locator('.cat-buddy img')).toHaveJSProperty('complete',true);
    expect(await page.locator('.cat-buddy img').evaluate((e:HTMLImageElement)=>e.naturalWidth)).toBeGreaterThan(0);
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    const note=page.getByRole('textbox',{name:'我的笔记'});await note.fill('很长的笔记。'.repeat(600));
    const check=async()=>{
      const r=await page.locator('.card').evaluate(el=>{
        const box=el.getBoundingClientRect();const reading=el.querySelector('.content')!.getBoundingClientRect();const note=el.querySelector('textarea')!.getBoundingClientRect();
        return {bottom:box.bottom,height:box.height,reading:reading.height,note:note.height,buttons:[...el.querySelectorAll('.action-row button')].map(button=>{const b=button.getBoundingClientRect();const t=button.querySelector('span')!.getBoundingClientRect();return {y:b.y,bottom:b.bottom,left:b.left,right:b.right,textFits:t.width<=b.width};})};
      });
      expect(r.note).toBe(60);expect(r.reading).toBeGreaterThan(45);expect(r.bottom).toBeLessThanOrEqual(viewport.height);
      for(const b of r.buttons){expect(b.bottom).toBeLessThanOrEqual(r.bottom);expect(b.y).toBe(r.buttons[0]!.y);expect(b.left).toBeGreaterThanOrEqual(0);expect(b.right).toBeLessThanOrEqual(viewport.width);expect(b.textFits).toBe(true);}
      return r;
    };
    const before=await check();
    const expand=page.locator('.answer-toggle').first();
    await expect(expand).toHaveText('展开全文⌄');
    expect(await expand.evaluate(el=>el.previousElementSibling?.classList.contains('formatted-answer'))).toBe(true);
    await expand.scrollIntoViewIfNeeded();
    await expand.hover();await expect(expand).toHaveAttribute('aria-expanded','false');
    await page.getByRole('checkbox',{name:'下次追问附带原句'}).check();await check();
    await page.getByRole('checkbox',{name:'下次追问附带原句'}).uncheck();
    await expand.scrollIntoViewIfNeeded();const scrollBeforeExpand=await page.locator('.content').evaluate(el=>el.scrollTop);
    await expand.click();await expect(expand).toHaveText('收起回答⌃');
    expect(await page.locator('.content').evaluate(el=>el.scrollTop)).toBe(scrollBeforeExpand);await check();
    for(let i=0;i<3;i++){await ask(page,'长问题 '+i+' 请解释。'.repeat(60));expect((await check()).height).toBe(before.height);}
    await page.locator('.assistant-bubble .answer-toggle').last().click();await check();
    await page.locator('.content').evaluate(el=>el.scrollTop=35);
    await page.getByRole('textbox',{name:'输入追问内容'}).fill('未发送的草稿');
    await page.locator('.queue-toggle').click();await expect(page.locator('.queue-screen')).toBeVisible();
    await page.locator('.queue-return').click();
    await expect(note).toHaveValue('很长的笔记。'.repeat(600));await expect(page.getByRole('textbox',{name:'输入追问内容'})).toHaveValue('未发送的草稿');
    expect(await page.locator('.content').evaluate(el=>el.scrollTop)).toBe(35);
    await page.getByRole('button',{name:'更换弹窗配色'}).click();
    for(const name of ['珍珠白','晴空蓝','奶油黄','珊瑚红','鼠尾草绿','雾紫']){
      await page.getByRole('button',{name,exact:true}).click();
      const contrast=await page.locator('.action-primary').evaluate(el=>{const c=getComputedStyle(el);const lum=(v:string)=>{const x=v.match(/[\d.]+/g)!.slice(0,3).map(Number).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4});return x[0]!*.2126+x[1]!*.7152+x[2]!*.0722};const a=lum(c.color),b=lum(c.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)});
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    }
    await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toBeVisible();
    await page.screenshot({path:info.outputPath('cafe-long.png')});expect(errors).toEqual([]);
    await page.reload();await open(page);await expect(page.locator('.card')).toHaveAttribute('data-palette','purple');
  });
}

test('real clipboard contains initial explanation only',async({page,extensionContext})=>{
  await extensionContext.grantPermissions(['clipboard-read','clipboard-write'],{origin:'http://127.0.0.1:4174'});
  await open(page);await ask(page,'追问内容不应被复制');await page.getByRole('textbox',{name:'我的笔记'}).fill('笔记不应被复制');
  await page.getByRole('button',{name:'复制初始解释'}).click();
  const copied=await page.evaluate(()=>navigator.clipboard.readText());
  expect(copied).toContain('Harness 原意是挽具');expect(copied).not.toContain('追问内容不应被复制');expect(copied).not.toContain('笔记不应被复制');
});

test('closing a generating card ignores its late response after opening a new card',async({page,background})=>{
  await background.evaluate(()=>{(globalThis as any).__holdNext=true;});
  await page.locator('#term').evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(r);el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,composed:true}));});
  await page.getByRole('button',{name:'解释选中文字'}).click();
  await expect.poll(()=>background.evaluate(()=>typeof (globalThis as any).__releaseRequest)).toBe('function');
  await page.getByRole('button',{name:'关闭解释'}).click();
  await open(page);
  await background.evaluate(()=>{(globalThis as any).__releaseRequest();});
  await expect(page.locator('.formatted-answer')).toContainText('Harness 原意是挽具');
  await page.getByRole('textbox',{name:'我的笔记'}).fill('新卡片的笔记');
  await ask(page,'新卡片的追问');
  await expect(page.locator('.content')).not.toContainText('旧请求的回答');
});

test('downloaded headings are nested and viewing a saved card does not overwrite it',async({page,background},info)=>{
  await open(page);
  await background.evaluate(()=>{(globalThis as any).__answer='# 1. 故障影响面小\n正文\n## 1. 自动恢复\n细节\n### 1. 重试\n内容\n# 2. 运维压力小\n正文';});
  await page.getByRole('checkbox',{name:'下次追问附带原句'}).check();await ask(page,'一般表现怎么样？');
  await page.getByRole('textbox',{name:'我的笔记'}).fill('保留的笔记');
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'保存 Markdown',exact:true}).click();
  const download=await downloadPromise;const markdown=await fs.readFile((await download.path())!,'utf8');
  expect(markdown).toContain('#### (1) 一般表现怎么样？');expect(markdown).toContain('##### ① 故障影响面小');expect(markdown).toContain('###### a. 自动恢复');expect(markdown).toContain('- **(a) 重试**');expect(markdown).toContain('本次追问附带原句：');expect(markdown).toContain('保留的笔记');
  await page.getByRole('button',{name:'加入待保存',exact:true}).click();
  const getCards=()=>background.evaluate(async()=> (await (globalThis as any).chrome.storage.local.get('knowlyPendingCards')).knowlyPendingCards);
  const before=await getCards();await page.locator('.queue-toggle').click();await page.getByRole('button',{name:'查看并更新 harness'}).click();
  await expect(page.locator('.sent-context summary')).toHaveText('已附带原句 · 查看');
  expect(await getCards()).toEqual(before);
  await page.locator('.sent-context summary').click();await page.screenshot({path:info.outputPath('context-attached.png')});
});
