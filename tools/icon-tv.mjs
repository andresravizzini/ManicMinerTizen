import {readFileSync,writeFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
function crc32(b) {let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(name,data) {const type=Buffer.from(name),n=Buffer.alloc(4),crc=Buffer.alloc(4);n.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([type,data])));return Buffer.concat([n,type,data,crc]);}
const size=117,raw=Buffer.alloc(size*(1+size*4));
// Exact DG bits from the first original 16x16 Willy frame, no redrawing.
const asm=readFileSync(new URL('../ManicMiner.asm',import.meta.url),'utf8');
const sprite=Array.from(asm.slice(asm.indexOf('WillySpriteData                   DG')).matchAll(/\bDG\s+([#-]{16})/g),m=>m[1]).slice(0,16);
if(sprite.length!==16)throw new Error('Original Willy sprite not found');
const lit=[];sprite.forEach(row=>{for(let x=0;x<16;x++)if(row[x]==='#')lit.push(x);});
const left=Math.min(...lit),width=Math.max(...lit)-left+1,scale=6;
const offsetX=Math.floor((size-width*scale)/2),offsetY=9;
const rainbow=[[255,32,32],[255,224,0],[0,216,64],[0,216,255]];
for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const i=y*(1+size*4)+1+x*4;
  const sx=Math.floor((x-offsetX)/scale)+left,sy=Math.floor((y-offsetY)/scale);
  const miner=x>=offsetX&&sx>=left&&sx<left+width&&sy>=0&&sy<16&&sprite[sy][sx]==='#';
  raw.set(miner?[255,255,255]:y>=110?rainbow[Math.min(3,Math.floor(x*4/size))]:[8,15,28],i);
  raw[i+3]=255;
}
const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
writeFileSync(new URL('../tizen/icon.png',import.meta.url),png);
writeFileSync(new URL('../tizen/icon-willy.png',import.meta.url),png);
