import {readFileSync, writeFileSync, mkdirSync, copyFileSync} from 'node:fs';
import vm from 'node:vm';
import CoffeeScript from 'coffeescript';
import {parse} from 'acorn';
import {optimizeDisplay} from './optimize-display.mjs';
import './make-snapshot.mjs';
import './icon-tv.mjs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const write = (path, text) => writeFileSync(new URL(path, root), text);
const source = 'third-party/jsspeccy2/';
let cpu;
const context = {window: {JSSpeccy: {}}, ArrayBuffer, Uint8Array, Uint16Array,
  eval: text => {cpu = text;}};
vm.runInNewContext(CoffeeScript.compile(read(source + 'core/z80.coffee')), context);
context.window.JSSpeccy.buildZ80({applyContention: true});
if (!cpu) throw new Error('CPU generation failed');
let bundle = '/* JSSpeccy 2.2.1, Matt Westcott and contributors; GPL-3.0-or-later. See COPYING. */\nvar JSSpeccy = {traps:{}};\n';
for (const name of ['display', 'io_bus', 'memory', 'sna_file', 'spectrum']) {
  const code=read(source + 'core/' + name + '.js');
  bundle += (name==='display' ? optimizeDisplay(code) : code) + '\n';
}
bundle += cpu;
const rom = readFileSync(new URL(source + '48.rom', root));
const sna = readFileSync(new URL('generated/ManicMiner.sna', root));
bundle += '\nJSSpeccy.roms = {"48.rom":new Uint8Array(' + JSON.stringify([...rom]) + ')};\n';
bundle += 'var MANIC_SNAPSHOT = new Uint8Array(' + JSON.stringify([...sna]) + ');\n';
mkdirSync(new URL('tizen/vendor/', root), {recursive:true});
write('tizen/vendor/emulator.js', bundle);
for (const name of ['COPYING', 'README']) copyFileSync(new URL(source + name, root), new URL('tizen/vendor/' + name, root));
copyFileSync(new URL('UPSTREAM-NOTICE.txt', root), new URL('tizen/UPSTREAM-NOTICE.txt', root));
copyFileSync(new URL('THIRD-PARTY.md', root), new URL('tizen/THIRD-PARTY.md', root));
for (const name of ['vendor/emulator.js', 'machine.js', 'app.js']) {
  parse(read('tizen/' + name), {ecmaVersion:5});
}
console.log('TV build ready: tizen/ (ES5 parsed, offline, no WASM or runtime eval)');
