const { chromium } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const assert = require('node:assert/strict');

const styles = ['editorial', 'cat', 'colorcard'];
const url = pathToFileURL(resolve(__dirname, 'ui-concepts.html')).href;
const longText = '这是一段用于检查超长内容的学习笔记，内容增加不能压缩输入和底部操作区。'.repeat(200);
async function layout(page) {
  return page.evaluate(() => {
    const rect = s => { const r = document.querySelector(s).getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height,b:r.bottom}; };
    const buttons = [...document.querySelectorAll('.main-actions button')].map(e => {
      const r=e.getBoundingClientRect();const range=document.createRange();range.selectNodeContents(e);const text=range.getBoundingClientRect();
      return {x:r.x,y:r.y,w:r.width,h:r.height,b:r.bottom,fits:text.width<=r.width+1,label:e.textContent,textWidth:text.width};
    });
    return {card:rect('.floating-preview'),reading:rect('.content'),note:rect('#note'),form:rect('.composer'),actions:rect('.actions'),buttons,view:innerHeight};
  });
}
function checkLayout(x, label) {
  assert(x.note.h>=60,label+' note too small');
  assert(x.reading.h>=70,label+' reading area too small');
  assert(x.actions.b<=x.card.b+1,label+' actions clipped by popup');
  assert(x.actions.b<=x.view+1,label+' actions below viewport');
  assert.equal(x.buttons.length,4);
  for(const b of x.buttons){assert(b.h>=40,label+' button height');assert(b.fits,label+' button text clipped');assert(b.x>=x.card.x&&b.x+b.w<=x.card.x+x.card.w,label+' button width');assert(Math.abs(b.y-x.buttons[0].y)<1,label+' buttons wrap');}
}
async function settle(page) { await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))); }

(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let cases=0;
    for(const standalone of [false,true])for(const [width,height] of [[1440,980],[390,844],[320,740]])for(const style of styles){
      const label=style+'/'+width+'/'+standalone;
      await page.setViewportSize({width,height});await page.goto(url+'?style='+style+(standalone?'&popup=1':''));await settle(page);
      assert.equal(await page.locator('[data-style-choice]').count(),3);
      assert.equal(await page.locator('.topic-title-row .tag').count(),0);
      assert.equal(await page.locator('.main-actions svg').count(),4);
      assert.equal((await page.locator('#copy').textContent()).trim(),'复制初始解释');
      assert((await page.locator('#copy').getAttribute('title')).includes('不包含追问和笔记'));
      assert((await page.locator('#download').getAttribute('title')).includes('全部追问和我的笔记'));
      assert((await page.locator('.context').textContent()).includes('下次追问'));
      const before=await layout(page);checkLayout(before,label+JSON.stringify(before.buttons));
      await page.locator('#note').fill(longText);await page.locator('.answer-block>.fold-body').evaluate((e,t)=>{const p=document.createElement('p');p.textContent=t;e.append(p)},longText);
      await settle(page);assert(await page.locator('.answer-block').evaluate(e=>e.classList.contains('has-fold')));
      await page.locator('.answer-block .fold-toggle').click();await settle(page);
      const expanded=await layout(page);checkLayout(expanded,label);assert(Math.abs(expanded.actions.y-before.actions.y)<1,label+' footer moved');assert.equal(expanded.note.h,before.note.h);
      for(let i=0;i<3;i++){
        await page.locator('#follow-input').fill('第 '+i+' 次追问：'+longText.slice(0,500));await page.locator('#follow-form button').click();await settle(page);
        assert.equal(await page.locator('.answer-block .fold-toggle').getAttribute('aria-expanded'),'false');
        const latest=await page.locator('.turn').last().boundingBox(),area=await page.locator('.content').boundingBox();assert(latest.y>=area.y-1&&latest.y<area.y+area.height,label+' latest question not in view');
        await page.locator('.assistant>.fold-body').last().evaluate((e,t)=>{e.textContent=t},longText);await settle(page);
        assert(await page.locator('.assistant').last().evaluate(e=>e.classList.contains('has-fold')));
        checkLayout(await layout(page),label);assert.equal(await page.locator('#note').inputValue(),longText);
      }
      // Reading history must not be pulled to the bottom when a later answer grows.
      await page.locator('.content').evaluate(e=>e.scrollTop=15);
      await page.locator('.assistant>.fold-body').last().evaluate(e=>e.append('更多后续内容。'.repeat(100)));await settle(page);
      assert(Math.abs(await page.locator('.content').evaluate(e=>e.scrollTop)-15)<2,label+' reader was pulled away');
      await page.locator('#follow-input').fill('尚未发送的追问');
      await page.locator('#queue-tab').click();assert(Math.abs((await page.locator('.floating-preview').boundingBox()).height-before.card.h)<1,label+' queue height changed');
      await page.locator('.qactions button:first-child').first().click();await settle(page);assert.equal(await page.locator('#term').textContent(),'RAG');
      assert.equal(await page.locator('.continue-label').textContent(),'更新并继续选词');
      await page.locator('#note').fill('RAG 独立笔记');await page.locator('#save').click();await page.locator('#queue-return').click();await settle(page);
      assert.equal(await page.locator('#term').textContent(),'混淆矩阵');assert.equal(await page.locator('#note').inputValue(),longText);assert.equal(await page.locator('#follow-input').inputValue(),'尚未发送的追问');
      assert(Math.abs(await page.locator('.content').evaluate(e=>e.scrollTop)-15)<2,label+' origin scroll lost');
      await page.locator('#queue-tab').click();await page.locator('.qactions button:first-child').first().click();await settle(page);assert.equal(await page.locator('#note').inputValue(),'RAG 独立笔记');await page.locator('#queue-return').click();
      cases++;
    }
    // Verify export-label contrast and list geometry after every palette switch.
    for(const style of styles){
      await page.setViewportSize({width:1440,height:980});await page.goto(url+'?style='+style);await page.locator('#queue-tab').click();
      for(const tint of ['white','blue','yellow','red','green','purple']){
        await page.locator('[data-tint-choice="'+tint+'"]').evaluate(e=>e.click());await settle(page);
        const result=await page.locator('#queue-export').evaluate(e=>{
          const s=getComputedStyle(e),l=c=>{const a=c.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return .2126*a[0]+.7152*a[1]+.0722*a[2]};
          const a=l(s.color),b=l(s.backgroundColor),r=e.getBoundingClientRect(),p=document.querySelector('.queue-page').getBoundingClientRect();
          return {contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),visible:r.top>=p.top&&r.bottom<=p.bottom};
        });
        assert(result.contrast>=4.5,style+'/'+tint+' export contrast');assert(result.visible,style+'/'+tint+' export hidden');
      }
    }
    await page.goto(url+'?style=cat');await page.locator('[data-tint-choice="white"]').evaluate(e=>e.click());await settle(page);
    const cafe=await page.locator('.cat-buddy').evaluate(e=>({shadow:getComputedStyle(e).boxShadow,border:getComputedStyle(e).borderTopWidth,font:getComputedStyle(document.querySelector('.answer-block p')).fontFamily}));
    assert.equal(cafe.shadow,'none');assert.equal(cafe.border,'0px');assert(!cafe.font.includes('KaiTi')&&!cafe.font.includes('YouYuan'));
    await page.locator('.floating-preview').screenshot({path:resolve(__dirname,'previews','cafe-white.png')});
    await page.evaluate(()=>localStorage.removeItem('knowly-preview-surface-tint'));
    // Capture the actual initial examples, without stress-test text.
    await page.setViewportSize({width:1440,height:980});
    for(const style of styles){await page.goto(url+'?style='+style);await settle(page);await page.locator('.floating-preview').screenshot({path:resolve(__dirname,'previews','three-'+style+'.png')});}
    assert.deepEqual(errors,[]);console.log('PASS '+cases+' long-content scenarios and 18 style/palette export checks; no page errors. Footer, note size, independent folds, latest question alignment, history reading, separate card drafts and return state verified.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
