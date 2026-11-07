/* GPL-3.0-or-later */
(function () {
  'use strict';
  var canvas=document.getElementById('screen'), status=document.getElementById('status');
  var paused=false, hidden=false, failed=false;
  var held={}, released={}, minHold=100, startFrames=0, machine, audio=null, nextAudio=0, sources=[];
  var frameMs=69888/3500, previous=0, accumulated=0, count=0, measured=0, fps=0;
  function clearAudio() {
    for (var i=0;i<sources.length;i++) {try {sources[i].stop();} catch (ignore) {}}
    sources=[]; nextAudio=0;
  }
  function enableAudio() {
    try {
      var Context=window.AudioContext || window.webkitAudioContext;
      if (!audio && Context) audio=new Context();
      if (audio && audio.resume) {var result=audio.resume(); if (result && result.catch) result.catch(function () {});}
    } catch (e) {status.textContent='Sonido no disponible: '+e.message;}
  }
  function sendAudio(samples) {
    if (!audio || paused || audio.state==='suspended') return;
    if (nextAudio > audio.currentTime+.12) return;
    var buffer=audio.createBuffer(1,samples.length,frameMs ? samples.length*1000/frameMs : 44100);
    buffer.getChannelData(0).set(samples);
    var node=audio.createBufferSource(); node.buffer=buffer; node.connect(audio.destination);
    nextAudio=Math.max(nextAudio,audio.currentTime+.025); sources.push(node);
    node.onended=function () {var at=sources.indexOf(node);if(at>=0)sources.splice(at,1);node.disconnect();};
    node.start(nextAudio); nextAudio+=buffer.duration;
  }
  function releaseAll() {held={};released={};startFrames=0;if(machine)machine.release();}
  function pause() {
    paused=true;releaseAll();clearAudio();status.textContent='Pausa';
  }
  function play() {
    if(failed)return;
    enableAudio();releaseAll();paused=false;
    previous=performance.now();measured=previous;count=0;accumulated=0;status.textContent='';
  }
  function exit() {
      try {if(window.tizen) {tizen.application.getCurrentApplication().exit();return;}}
      catch(e) {status.textContent='No se pudo salir: '+e.message;return;}
      status.textContent='Podés cerrar esta pestaña para salir.';
  }
  function mapping(code) {return {37:['left'],81:['left'],39:['right'],80:['right'],38:['jump'],32:['jump'],13:['jump'],
    52:['left'],100:['left'],54:['right'],102:['right'],56:['jump'],104:['jump'],
    49:['left','jump'],97:['left','jump'],50:['jump'],98:['jump'],51:['right','jump'],99:['right','jump'],
    55:['left','jump'],103:['left','jump'],57:['right','jump'],105:['right','jump']}[code];}
  function refresh(name) {
    var active=false;
    for(var code in held) if(held[code].names && held[code].names.indexOf(name)>=0)active=true;
    if(!active && !released[name])machine.key(name,false);
  }
  function down(event) {
    var code=event.keyCode, names=mapping(code), now=performance.now();
    if(!names && code!==40 && code!==10009 && code!==27 && code!==19 && code!==415 && code!==10252)return;
    event.preventDefault();
    if(held[code])return;
    enableAudio();
    if(code===10009 || code===27) {exit();return;}
    if(code===40 || code===19 || code===415 || code===10252) {
      if(paused)play();else pause();held[code]={names:null,time:now};return;
    }
    if(paused)play();
    held[code]={names:names,time:now};
    // Let OK start the original title screen; held for 20 emulated frames.
    if(code===13) {machine.key('start',true);startFrames=20;}
    if(names) for(var i=0;i<names.length;i++) {delete released[names[i]];machine.key(names[i],true);}
  }
  function up(event) {
    var entry=held[event.keyCode];
    if(!entry)return;
    event.preventDefault();delete held[event.keyCode];
    if(paused || !entry.names)return;
    var until=entry.time+minHold;
    for(var i=0;i<entry.names.length;i++) {
      var name=entry.names[i];
      if(until>performance.now())released[name]=Math.max(released[name] || 0,until); else refresh(name);
    }
  }
  function resize() {
    var width=Math.floor(Math.min(window.innerWidth*.94,window.innerHeight*.94*4/3));
    canvas.style.width=width+'px';canvas.style.height=Math.floor(width*3/4)+'px';
  }
  function tick(now) {
    window.requestAnimationFrame(tick);
    if(paused || hidden || failed) {previous=now;return;}
    try {
      accumulated+=Math.min(100,Math.max(0,now-previous));previous=now;
      var frames=0;
      while(accumulated>=frameMs && frames<3) {
        machine.frame();count++;frames++;accumulated-=frameMs;
        if(startFrames>0 && --startFrames===0)machine.key('start',false);
        for(var name in released)if(now>=released[name]) {delete released[name];refresh(name);}
      }
      if(frames===3)accumulated=0;
      if(now-measured>=2000) {
        fps=count*1000/(now-measured);count=0;measured=now;
      }
    } catch(e) {failed=true;pause();status.textContent='Error al ejecutar el juego: '+e.message;}
  }
  try {
    machine=ManicMachine(canvas,sendAudio);
    enableAudio();
    for(var frame=0;frame<5;frame++)machine.frame();
    document.addEventListener('keydown',down,false);document.addEventListener('keyup',up,false);
    window.addEventListener('blur',pause);
    document.addEventListener('visibilitychange',function () {hidden=document.hidden;if(hidden)pause();});
    window.addEventListener('resize',resize);
    if(window.tizen && tizen.tvinputdevice) {
      var extraKeys=['MediaPlayPause','1','2','3','4','6','7','8','9'];
      for(var k=0;k<extraKeys.length;k++)try {tizen.tvinputdevice.registerKey(extraKeys[k]);}catch(ignore){}
    }
    resize();previous=performance.now();measured=previous;window.requestAnimationFrame(tick);
    // Read-only diagnostics used by tests and the TV inspector.
    window.ManicTV={peek:machine.peek, stats:function(){return {paused:paused,fps:fps,failed:failed};}};
  } catch(e) {failed=true;status.textContent='No se pudo cargar el emulador: '+e.message;}
}());
