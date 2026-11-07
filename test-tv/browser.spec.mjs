import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
test('performance: cached raster matches every pixel, audio sample and RAM byte',async({page})=>{
  await page.goto('http://127.0.0.1:8093');await page.keyboard.press('ArrowDown');
  await page.evaluate(()=>{window.cachedDisplay=JSSpeccy.Display;});
  await page.route('**/reference-display.js',route=>route.fulfill({contentType:'text/javascript',body:readFileSync(new URL('../third-party/jsspeccy2/core/display.js',import.meta.url),'utf8')}));
  await page.addScriptTag({url:'http://127.0.0.1:8093/reference-display.js'});
  await page.evaluate(()=>{window.referenceDisplay=JSSpeccy.Display;});
  const result=await page.evaluate(()=>{
    function make(cachePixels) {
      JSSpeccy.Display=cachePixels?window.cachedDisplay:window.referenceDisplay;
      const canvas=document.createElement('canvas');let audio;
      const machine=ManicMachine(canvas,s=>{audio=Array.from(s);},{cachePixels});
      return {canvas,machine,audio:()=>audio};
    }
    const a=make(false),b=make(true);
    for(let frame=0;frame<240;frame++) {
      for(const c of [a,b]) {
        if(frame===5)c.machine.key('start',true);
        if(frame===25)c.machine.key('start',false);
        if(frame===95)c.machine.key('right',true);
        if(frame===115)c.machine.key('jump',true);
        if(frame===130){c.machine.key('jump',false);c.machine.key('right',false);}
        // Also exercise FLASH and writes to screen memory with unchanged cells.
        if(frame===160)c.machine.poke(0x5800,0xc7);
        c.machine.frame();
      }
      const pa=a.canvas.getContext('2d').getImageData(0,0,256,192).data;
      const pb=b.canvas.getContext('2d').getImageData(0,0,256,192).data;
      for(let i=0;i<pa.length;i++)if(pa[i]!==pb[i])throw Error('pixel mismatch '+frame+':'+i);
      const sa=a.audio(),sb=b.audio();
      for(let i=0;i<sa.length;i++)if(sa[i]!==sb[i])throw Error('audio mismatch');
      if(frame%20===0)for(let addr=0x4000;addr<65536;addr++)if(a.machine.peek(addr)!==b.machine.peek(addr))throw Error('RAM mismatch');
    }
    function bench(cachePixels) {
      const c=make(cachePixels);for(let i=0;i<80;i++)c.machine.frame();
      c.machine.key('start',true);for(let i=0;i<20;i++)c.machine.frame();c.machine.key('start',false);
      const times=[];
      for(let trial=0;trial<5;trial++) {const t=performance.now();for(let i=0;i<200;i++)c.machine.frame();times.push((performance.now()-t)/200);}
      return times.sort((x,y)=>x-y)[2];
    }
    return {referenceMs:bench(false),cachedMs:bench(true),framesCompared:240};
  });
  console.log('Raster benchmark (desktop Chrome):',JSON.stringify(result));
  expect(result.framesCompared).toBe(240);
});
for(const jumpKey of ['2','8'])test('4 and 6 walk; '+jumpKey+' jumps straight after releasing movement',async({page})=>{
  await page.goto('http://127.0.0.1:8093');await page.keyboard.press('Enter');
  await expect.poll(()=>page.evaluate(()=>String.fromCharCode.apply(null,Array.from({length:32},(_,i)=>ManicTV.peek(0x8000+i))).trim())).toBe('Central Cavern');
  const initial=await page.evaluate(()=>ManicTV.peek(0x806c)&31);
  await page.keyboard.down('6');
  await expect.poll(()=>page.evaluate(()=>ManicTV.peek(0x806c)&31),{intervals:[20]}).toBeGreaterThan(initial+1);
  await page.keyboard.up('6');await page.waitForTimeout(120);
  const right=await page.evaluate(()=>ManicTV.peek(0x806c)&31);
  await page.keyboard.down('4');
  await expect.poll(()=>page.evaluate(()=>ManicTV.peek(0x806c)&31),{intervals:[20]}).toBeLessThan(right);
  await page.keyboard.up('4');await page.waitForTimeout(120);
  const before=await page.evaluate(()=>ManicTV.peek(0x806c)&31);
  await page.keyboard.down(jumpKey);
  await expect.poll(()=>page.evaluate(()=>ManicTV.peek(0x8068)),{intervals:[20]}).toBeLessThan(0xd0);
  await page.waitForTimeout(160);
  expect(await page.evaluate(()=>ManicTV.peek(0x806c)&31)).toBe(before);
  await page.keyboard.up(jumpKey);
});
for(const key of ['1','3','7','9'])test('single remote key '+key+' jumps while moving',async({page})=>{
  await page.goto('http://127.0.0.1:8093');
  await page.keyboard.press('Enter');
  await expect.poll(()=>page.evaluate(()=>ManicTV.peek(0x8068))).toBe(0xd0);
  await expect.poll(()=>page.evaluate(()=>String.fromCharCode.apply(null,Array.from({length:32},(_,i)=>ManicTV.peek(0x8000+i))).trim())).toBe('Central Cavern');
  // Make room for a left jump before testing either direction.
  await page.keyboard.down('6');await page.waitForTimeout(400);await page.keyboard.up('6');
  const x=await page.evaluate(()=>ManicTV.peek(0x806c)&31);
  expect(x).toBeGreaterThan(2);
  await page.keyboard.down(key);
  await expect.poll(()=>page.evaluate(()=>ManicTV.peek(0x8068)),{intervals:[20]}).toBeLessThan(0xd0);
  await expect.poll(()=>page.evaluate(()=>ManicTV.peek(0x806c)&31),{intervals:[20]}).not.toBe(x);
  const next=await page.evaluate(()=>ManicTV.peek(0x806c)&31);
  expect(key==='7'||key==='1'?next<x:next>x).toBe(true);
  await page.keyboard.up(key);
  await page.keyboard.press('ArrowDown');expect(await page.evaluate(()=>ManicTV.stats().paused)).toBe(true);
});
test('offline TV boot, remote input, pause, lifecycle and scaling',async({page})=>{
  const errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:8093/'))external.push(r.url());});
  await page.addInitScript(()=>{window.WebAssembly=undefined;window.fetch=undefined;window.tvKeys=[];window.tvExit=false;window.tizen={tvinputdevice:{registerKey:key=>window.tvKeys.push(key)},application:{getCurrentApplication:()=>({exit:()=>{window.tvExit=true;}})}};});
  await page.goto('http://127.0.0.1:8093');
  await expect(page.locator('#panel,button')).toHaveCount(0);
  expect(await page.evaluate(()=>ManicTV.stats().paused)).toBe(false);
  expect(await page.evaluate(()=>window.tvKeys)).toEqual(['MediaPlayPause','1','2','3','4','6','7','8','9']);
  await page.screenshot({path:'test-results/tv-title.png'});
  await page.keyboard.press('Enter');
  await expect.poll(()=>page.evaluate(()=>String.fromCharCode.apply(null,Array.from({length:32},(_,i)=>ManicTV.peek(0x8000+i))).trim())).toBe('Central Cavern');
  await page.keyboard.down('ArrowRight');await page.waitForTimeout(400);await page.keyboard.up('ArrowRight');
  await page.keyboard.press('ArrowUp');await page.waitForTimeout(60);
  await page.keyboard.press('ArrowDown');expect(await page.evaluate(()=>ManicTV.stats().paused)).toBe(true);
  const before=await page.evaluate(()=>ManicTV.peek(0x806c));await page.waitForTimeout(200);
  expect(await page.evaluate(()=>ManicTV.peek(0x806c))).toBe(before);
  await page.keyboard.press('ArrowDown');expect(await page.evaluate(()=>ManicTV.stats().paused)).toBe(false);
  await page.evaluate(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{keyCode:10009,bubbles:true}));document.dispatchEvent(new KeyboardEvent('keyup',{keyCode:10009,bubbles:true}));});
  expect(await page.evaluate(()=>window.tvExit)).toBe(true);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));expect(await page.evaluate(()=>ManicTV.stats().paused)).toBe(true);
  await page.setViewportSize({width:1280,height:720});
  const box=await page.locator('canvas').boundingBox();expect(Math.abs(box.width/box.height-4/3)).toBeLessThan(.01);expect(box.height).toBeLessThan(720);
  await page.keyboard.press('Enter');await page.waitForTimeout(1000);
  await expect.poll(()=>page.evaluate(()=>String.fromCharCode.apply(null,Array.from({length:32},(_,i)=>ManicTV.peek(0x8000+i))).trim())).toBe('Central Cavern');
  await page.screenshot({path:'test-results/tv-game.png'});
  expect(errors).toEqual([]);expect(external).toEqual([]);
});
