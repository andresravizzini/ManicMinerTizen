/* TV adapter: GPL-3.0-or-later. The original game remains separately copyrighted. */
(function (global) {
  'use strict';
  global.ManicMachine = function (canvas, audioSink, options) {
    var model = JSSpeccy.Spectrum.MODEL_48K;
    var rows = new Uint8Array(8);
    var memory = JSSpeccy.Memory({model:model});
    var display = JSSpeccy.Display({
      viewport:{canvas:canvas, setResolution:function (w,h) {canvas.width=w;canvas.height=h;}},
      memory:memory, model:model, borderEnabled:false,
      cachePixels:!options || options.cachePixels!==false,
      settings:{checkerboardFilter:{get:function () {return false;}, onChange:{bind:function () {}}}}
    });
    var frameSamples = 882, samples = new Float32Array(frameSamples), position = 0, buzzer = 0;
    function fill(to) {
      to = Math.min(frameSamples, Math.max(position, to));
      while (position < to) samples[position++] = buzzer * 0.18;
    }
    var sound = {
      updateBuzzer:function (value, tstates) {
        fill(Math.floor(tstates * frameSamples / model.frameLength));
        buzzer = value ? 1 : -1;
      },
      selectSoundRegister:function () {}, writeSoundRegister:function () {},
      readSoundRegister:function () {return 255;}
    };
    var keyboard = {poll:function (addr) {
      var result = 255, row;
      for (row=0;row<8;row++) if (!(addr & (1 << (row+8)))) {
        result &= rows[row];
      }
      return result;
    }};
    var bus = JSSpeccy.IOBus({keyboard:keyboard, display:display, memory:memory,
      sound:sound, contentionTable:model.contentionTable});
    var cpu = JSSpeccy.Z80({memory:memory, ioBus:bus, display:display});
    function release() {for (var i=0;i<8;i++) rows[i]=255;}
    function reset() {
      var snapshot = JSSpeccy.SnaFile(MANIC_SNAPSHOT.buffer);
      release(); memory.reset(); cpu.reset();
      memory.loadFromSnapshot(snapshot.memoryPages); cpu.loadFromSnapshot(snapshot.registers);
      display.setBorder(0); display.drawFullScreen(); position=0; buzzer=0;
    }
    reset();
    return {
      reset:reset, release:release,
      key:function (name, down) {
        var map = {left:[2,1],right:[5,1],jump:[7,1],start:[6,1]}, key=map[name];
        if (!key) return;
        if (down) rows[key[0]] &= ~key[1]; else rows[key[0]] |= key[1];
      },
      frame:function () {
        display.startFrame(); cpu.requestInterrupt(); cpu.runFrame(model.frameLength);
        display.endFrame(); fill(frameSamples);
        if (audioSink) audioSink(samples);
        position=0; cpu.setTstates(cpu.getTstates()-model.frameLength);
      },
      peek:function (address) {return memory.read(address);},
      poke:function (address, value) {memory.write(address,value);}
    };
  };
}(window));
