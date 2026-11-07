import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function core() {
  const ctx={window:{}, console};ctx.window=ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../tizen/vendor/emulator.js',import.meta.url),'utf8'),ctx);
  vm.runInContext(readFileSync(new URL('../tizen/machine.js',import.meta.url),'utf8'),ctx);
  let nonzero=0,audio=0;
  const context={getImageData:()=>({data:new Uint8ClampedArray(256*192*4)}),
    createImageData:()=>({data:new Uint8ClampedArray(256*192*4)}),
    putImageData:image=>{nonzero=image.data.filter((v,i)=>i%4!==3&&v>0).length;}};
  const value=ctx.ManicMachine({getContext:()=>context},samples=>{if(samples.some(v=>v!==0))audio++;});
  return {value,screen:()=>nonzero,audio:()=>audio};
}
function frames(c,n){for(let i=0;i<n;i++)c.frame();}
function name(c){return String.fromCharCode(...Array.from({length:32},(_,i)=>c.peek(0x8000+i))).trim();}
function start(c){frames(c,5);c.key('start',true);frames(c,20);c.key('start',false);frames(c,70);}
test('original binary generates the exact upstream SNA RAM image',()=>{
  const bin=readFileSync(new URL('../ManicMiner.bin',import.meta.url));
  const sna=readFileSync(new URL('../generated/ManicMiner.sna',import.meta.url));
  const ram=Buffer.from(bin.subarray(0x4000));ram.writeUInt16LE(0x8400,0x9cfc-0x4000);
  assert.deepEqual(sna.subarray(27),ram);
});
test('JavaScript CPU boots the original title, generates screen pixels and beeper samples',()=>{
  const c=core();frames(c.value,10);assert.ok(c.screen()>30000);assert.ok(c.audio()>0);
});
test('Enter starts Central Cavern and original keyboard moves and jumps',()=>{
  const {value:c}=core();start(c);
  assert.equal(name(c),'Central Cavern');assert.equal(c.peek(0x8068),0xd0);
  c.key('right',true);frames(c,20);c.key('right',false);assert.equal(c.peek(0x806c),0xa3);
  c.key('jump',true);frames(c,8);c.key('jump',false);
  assert.equal(c.peek(0x806b),1);assert.ok(c.peek(0x8068)<0xd0);
});
test('life loss and restart preserve original game state',()=>{
  const {value:c}=core();start(c);const lives=c.peek(0x8457);
  let i=0;while(c.peek(0x8457)===lives&&i++<9000)c.frame();
  assert.equal(c.peek(0x8457),lives-1);assert.equal(name(c),'Central Cavern');
  c.reset();start(c);assert.equal(c.peek(0x8457),lives);
});
test('opened portal advances to the next original cavern',()=>{
  const {value:c}=core();start(c);const portal=c.peek(0x80b0)|(c.peek(0x80b1)<<8);
  c.poke(0x808f,c.peek(0x808f)|0x80);c.poke(0x806c,portal&255);c.poke(0x806d,portal>>8);
  let i=0;while(name(c)!=='The Cold Room'&&i++<1000)c.frame();
  assert.equal(c.peek(0x8407),1);assert.equal(name(c),'The Cold Room');
});
