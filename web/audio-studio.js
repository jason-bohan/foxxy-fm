/* SPDX-License-Identifier: GPL-3.0-only */
import {buildSlot, normalize, resample, chopNovelty, chopHits, chopEqual, chopList} from './sampler-tools.js';

export function createAudioStudio(M, {enableSound, audioContext}) {
  const section=document.createElement('section');section.id='browser-tape-studio';section.className='audio-studio';section.hidden=true;
  section.innerHTML=`<div class="studio-tape" hidden>
    <div class="studio-title"><strong id="tape-mode-title">Devtool tape studio</strong><button id="tape-firmware">FIRMWARE CONTROLS · 15 S</button><button id="tape-exit">BACK TO INSTRUMENT</button><output id="tape-position"></output><button data-tape="0">RECORD</button><button data-tape="1">PLAY / STOP</button><button data-tape="4">BRAKE</button></div>
    <div class="studio-reels" aria-label="Tape reels">${[0,1].map(i=>`<button class="studio-reel" type="button" aria-label="Drag ${i?'right':'left'} tape reel to scrub audio"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="5"/><g class="reel-spokes"><circle cx="50" cy="50" r="35" fill="none" stroke="currentColor" stroke-width="2"/>${[0,120,240].map(a=>`<path d="M50 42L44 20L56 20Z" fill="currentColor" transform="rotate(${a} 50 50)"/>`).join('')}</g><circle cx="50" cy="50" r="6" fill="currentColor"/></svg></button>`).join('')}</div>
    <canvas id="tape-wave" width="800" height="180" aria-label="Tape waveform. Click to seek, Shift-drag to select a loop region." tabindex="0"></canvas>
    <div class="studio-help">Click to seek · Shift-drag to select a region · Drag either on-screen reel to scrub · Tape playback continues when you leave this screen</div>
    <div class="studio-help" id="tape-mode-info"></div>
    <div class="studio-tracks"></div>
    <div class="studio-parameters">
      <label>Speed <input data-at="0" type="range" min="-400" max="400" value="100"><output></output></label>
      <label>Drive <input data-at="1" type="range" min="0" max="100" value="0"><output></output></label>
      <label>Wow / flutter <input data-at="2" type="range" min="0" max="100" value="0"><output></output></label>
      <label>Hiss <input data-at="3" type="range" min="0" max="100" value="0"><output></output></label>
      <label>Bit reduction <input data-at="4" type="range" min="0" max="8" value="0"><output></output></label>
      <label>Low EQ <input data-at="15" type="range" min="-12" max="12" value="0"><output></output></label>
      <label>Mid EQ <input data-at="16" type="range" min="-12" max="12" value="0"><output></output></label>
      <label>High EQ <input data-at="17" type="range" min="-12" max="12" value="0"><output></output></label>
    </div>
    <div class="studio-actions"><button data-tape="2">LOOP</button><button data-tape="3">REVERSE</button><button data-tape="10">OVERDUB</button><button data-tape="8">SPLIT AT HEAD</button><button data-tape="6">LIFT REGION</button><button data-tape="9">COPY REGION</button><button data-tape="7">DROP AT HEAD</button><button id="tape-to-sampler">REGION → SAMPLER</button><button id="tape-export">EXPORT TRACK WAV</button><button id="tape-import">IMPORT AUDIO</button><input id="tape-file" type="file" accept="audio/*,.wav" hidden><button data-tape="15">CLEAR TRACK…</button></div>
    <div class="studio-actions"><button data-memo="0:1">STORE MEMO 1</button><button data-memo="0:0">RECALL 1</button><button data-memo="1:1">STORE MEMO 2</button><button data-memo="1:0">RECALL 2</button><button id="tape-rewind">REWIND</button><button id="tape-half">½ SPEED</button><button id="tape-normal">NORMAL SPEED</button></div>
  </div>
  <div class="studio-effects" hidden>
    <div class="studio-title"><strong>Master effects</strong><select id="studio-effect"><option value="0">Meow · frequency-shifting delay</option><option value="1">Delay</option><option value="2">Phone</option><option value="3">Punch · compressor</option><option value="4">Grid · tempo echo</option><option value="5">Spring · dispersive reverb</option><option value="6">Nitro · envelope filter</option></select><button id="effect-enable">ENABLE</button></div>
    <div class="studio-parameters"><label>Frequency shift (Hz)<input data-fx="0" type="range" min="-1000" max="1000" value="180"><output></output></label><label>Delay / rate<input data-fx="1" type="range" min="1" max="100" value="60"><output></output></label><label>Feedback / amount<input data-fx="2" type="range" min="0" max="95" value="45"><output></output></label><label>Sideband<select data-fx="3"><option value="0">Upper</option><option value="1">Lower</option><option value="2">Both</option></select></label><label>Wet / dry<input data-fx="4" type="range" min="0" max="100" value="50"><output></output></label></div>
    <div class="studio-help">Meow transforms your synth, drums and tape audio. Play notes or start tape to hear it. SELECT chooses an effect; PRESETS sets wet/dry; OCT+ toggles it on the hardware.</div>
  </div><p id="studio-status" role="status"></p>`;
  document.querySelector('main').prepend(section);
  const sampler=document.createElement('dialog');sampler.id='sampler-dialog';sampler.className='audio-sampler';
  sampler.innerHTML=`<h3>Instant sampler</h3><div class="studio-parameters"><label>Instrument<select id="sampler-kind"><option value="synth">Synth · up to 6 seconds</option><option value="drum">Drum kit · up to 12 seconds</option></select></label><label>Slot<select id="sampler-slot"><option value="0">USR1</option><option value="1">USR2</option><option value="2">USR3</option><option value="3">USR4</option></select></label><label>Root note<input id="sampler-root" type="number" min="0" max="127" value="60"></label><label>Drum layout<select id="sampler-layout"><option value="hits">Detect hits automatically</option><option value="equal">16 equal slices</option></select></label></div><p id="sampler-status" role="status">Record your microphone or audio interface, load an audio file, or lift a tape region.</p><div class="studio-actions"><button id="sampler-mic">RECORD INPUT</button><button id="sampler-stop" disabled>STOP</button><button id="sampler-file-button">LOAD AUDIO FILE</button><input id="sampler-file" type="file" accept="audio/*,.wav" hidden><button id="sampler-use" disabled>LOAD INTO INSTRUMENT</button><button id="sampler-download" disabled>DOWNLOAD HARDWARE SLOT</button><button id="sampler-close">CLOSE</button></div>`;
  document.body.append(sampler);
  const $=id=>document.getElementById(id),status=$('studio-status');
  const on=(el,event,fn)=>el.addEventListener(event,async e=>{try{await fn(e);}catch(error){status.textContent=error.message;$('sampler-status').textContent=error.message;}});
  on($('tape-exit'),'click',()=>M._ds_home());
  const clearDialog=document.createElement('dialog');clearDialog.className='audio-sampler';clearDialog.id='tape-clear-dialog';
  clearDialog.innerHTML='<h3>Clear tape track?</h3><p id="tape-clear-message"></p><div class="studio-actions"><button id="tape-clear-cancel">CANCEL</button><button id="tape-clear-confirm">CLEAR TRACK</button></div>';
  document.body.append(clearDialog);let clearTrack=0;
  on($('tape-clear-cancel'),'click',()=>clearDialog.close());
  on($('tape-clear-confirm'),'click',()=>{M._ds_tape_clear(clearTrack);clearDialog.close();status.textContent=`Tape track ${clearTrack+1} cleared`;refresh();});
  const setTapeMode=value=>{M._ds_tape_mode(+value);$('tape-view').value=String(value);try{localStorage.setItem('fm1-tape-mode',String(value));}catch{}refresh();};
  on($('tape-view'),'change',()=>setTapeMode($('tape-view').value));
  on($('tape-firmware'),'click',()=>setTapeMode(0));
  try{if(localStorage.getItem('fm1-tape-mode')==='0'){M._ds_tape_mode(0);$('tape-view').value='0';}}catch{}
  const colors=['#287cff','#1ecc70','#ffc618','#ff621a'];
  for(let track=0;track<4;track++) {
    const row=document.createElement('div');row.className='studio-track';row.style.setProperty('--track-color',colors[track]);row.dataset.track=track;
    row.innerHTML=`<button data-select="${track}">TRACK ${track+1}</button><label>Level<input type="range" min="0" max="100" data-tmix="0"></label><label>Pan<input type="range" min="0" max="127" data-tmix="3"></label><button data-tmix="1">MUTE</button><button data-tmix="2">SOLO</button>`;
    on(row.querySelector('[data-select]'),'click',()=>{M._ds_select_track(track);M._ds_tape_set(5,track);refresh();});
    for(const el of row.querySelectorAll('[data-tmix]'))on(el,el.tagName==='INPUT'?'input':'click',()=>{const field=+el.dataset.tmix;M._ds_tape_mix(track,field,el.tagName==='INPUT'?+el.value:!M._ds_tape_mix(track,field,-1));refresh();});
    section.querySelector('.studio-tracks').append(row);
  }
  for(const input of section.querySelectorAll('[data-at]'))on(input,'input',()=>{M._ds_tape_set(+input.dataset.at,+input.value);refresh();});
  for(const input of section.querySelectorAll('[data-fx]'))on(input,input.tagName==='INPUT'?'input':'change',()=>{M._ds_meow_set(+input.dataset.fx,+input.value);refresh();});
  for(const button of section.querySelectorAll('[data-tape]'))on(button,'click',async()=>{if(+button.dataset.tape===15){clearTrack=M._ds_tape_read(5);$('tape-clear-message').textContent=`Erase all recorded audio on track ${clearTrack+1}?`;clearDialog.showModal();return;}await enableSound();M._ds_tape_action(+button.dataset.tape);refresh();});
  for(const button of section.querySelectorAll('[data-memo]'))on(button,'click',()=>{const [slot,save]=button.dataset.memo.split(':').map(Number);M._ds_tape_memo(slot,save);status.textContent=save?`Memo ${slot+1} saved`:`Memo ${slot+1} recalled`;refresh();});
  on($('effect-enable'),'click',async()=>{await enableSound();M._ds_meow_set(5,!M._ds_meow_read(5));refresh();});
  on($('studio-effect'),'change',()=>{M._ds_meow_set(6,+$('studio-effect').value);refresh();});
  on($('tape-rewind'),'click',()=>M._ds_tape_seek(0));
  on($('tape-half'),'click',()=>M._ds_tape_set(0,50));on($('tape-normal'),'click',()=>M._ds_tape_set(0,100));
  for(const reel of section.querySelectorAll('.studio-reel')) {
    let angle=null;
    const angleAt=e=>{const r=reel.getBoundingClientRect();return Math.atan2(e.clientY-r.top-r.height/2,e.clientX-r.left-r.width/2);};
    reel.style.touchAction='none';
    on(reel,'pointerdown',async e=>{if(e.button!==0)return;reel.setPointerCapture(e.pointerId);angle=angleAt(e);await enableSound();});
    on(reel,'pointermove',e=>{if(angle===null)return;const next=angleAt(e);let delta=next-angle;if(delta>Math.PI)delta-=2*Math.PI;if(delta<-Math.PI)delta+=2*Math.PI;angle=next;M._ds_tape_reel(Math.round(delta*80));});
    const release=()=>{if(angle!==null)M._ds_tape_reel(0);angle=null;};
    on(reel,'pointerup',release);on(reel,'pointercancel',release);on(reel,'lostpointercapture',release);
  }
  const clock=ms=>`${Math.floor(ms/60000)}:${(ms/1000%60).toFixed(1).padStart(4,'0')}`;
  const wave=$('tape-wave'),ctx=wave.getContext('2d');let lastWave=0,regionStart=null;
  function drawWave(force=false) {
    if(!force && performance.now()-lastWave<160)return;lastWave=performance.now();
    const length=M._ds_tape_length(),rate=M._ds_tape_rate(),w=wave.width,h=wave.height;
    ctx.fillStyle='#0b0d11';ctx.fillRect(0,0,w,h);
    if(!length){ctx.fillStyle='#b0b5bd';ctx.font='16px system-ui';ctx.fillText('Press RECORD, then play your instrument. Each tape track records audio.',16,40);return;}
    const lo=M._ds_tape_read(8)/1000*w,hi=M._ds_tape_read(9)/1000*w;
    ctx.fillStyle='#ffffff10';ctx.fillRect(lo,0,hi-lo,h);
    for(let track=0;track<4;track++) {
      ctx.strokeStyle=colors[track];ctx.beginPath();let base=track*45+23;
      for(let x=0;x<w;x+=2) {
        const p=Math.floor(x/w*length);let peak=0;
        for(let j=0;j<8;j++){const at=Math.min(length-1,p+Math.floor(j*length/w/8));peak=Math.max(peak,Math.abs(M._ds_tape_sample(track,at))/32768);}
        ctx.moveTo(x,base-peak*20);ctx.lineTo(x,base+peak*20);
      }
      ctx.stroke();
    }
    ctx.strokeStyle='#fff';ctx.beginPath();const x=M._ds_tape_read(12)*rate/1000/length*w;ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();
  }
  const waveRatio=e=>{const r=wave.getBoundingClientRect();return Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));};
  wave.style.touchAction='none';
  on(wave,'pointerdown',e=>{if(!M._ds_tape_length()){status.textContent='Record or import audio before selecting a region.';return;}wave.setPointerCapture(e.pointerId);if(e.shiftKey)regionStart=waveRatio(e);else{M._ds_tape_set(5,Math.max(0,Math.min(3,Math.floor((e.clientY-wave.getBoundingClientRect().top)/wave.getBoundingClientRect().height*4))));M._ds_select_track(M._ds_tape_read(5));M._ds_tape_seek(Math.floor(waveRatio(e)*M._ds_tape_read(13)));}drawWave(true);});
  on(wave,'pointermove',e=>{if(regionStart===null)return;const end=waveRatio(e);M._ds_tape_set(8,Math.floor(Math.min(end,regionStart)*1000));M._ds_tape_set(9,Math.ceil(Math.max(end,regionStart)*1000));drawWave(true);});
  on(wave,'pointerup',()=>{if(regionStart!==null)M._ds_tape_set(7,1);regionStart=null;refresh();});on(wave,'pointercancel',()=>{regionStart=null;});
  on(wave,'keydown',async e=>{if(e.code==='Space'){e.preventDefault();await enableSound();M._ds_tape_action(1);}else if(e.code==='ArrowLeft'||e.code==='ArrowRight'){e.preventDefault();M._ds_tape_seek(M._ds_tape_read(12)+(e.code==='ArrowLeft'?-100:100));}});
  function download(bytes,name,type) {const url=URL.createObjectURL(new Blob([bytes],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function wav(samples,rate) {const b=new ArrayBuffer(44+samples.length*2),v=new DataView(b),u=new Uint8Array(b);const str=(p,s)=>[...s].forEach((c,i)=>u[p+i]=c.charCodeAt());str(0,'RIFF');v.setUint32(4,b.byteLength-8,true);str(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,samples.length*2,true);for(let i=0;i<samples.length;i++)v.setInt16(44+i*2,samples[i],true);return b;}
  on($('tape-export'),'click',()=>{const n=M._ds_tape_length();if(!n)throw new Error('Record audio first.');const samples=new Int16Array(n),track=M._ds_tape_read(5);for(let i=0;i<n;i++)samples[i]=M._ds_tape_sample(track,i);download(wav(samples,M._ds_tape_rate()),`fm1-tape-track-${track+1}.wav`,'audio/wav');status.textContent='Track exported. Tape audio is kept in this tab; export before reloading.';});
  const decode=async file=>{await enableSound();const b=await audioContext().decodeAudioData(await file.arrayBuffer()),x=new Float32Array(b.length);for(let c=0;c<b.numberOfChannels;c++){const y=b.getChannelData(c);for(let i=0;i<x.length;i++)x[i]+=y[i]/b.numberOfChannels;}return {x,rate:b.sampleRate};};
  on($('tape-import'),'click',()=>$('tape-file').click());
  on($('tape-file'),'change',async()=>{const file=$('tape-file').files[0];if(!file)return;const {x,rate}=await decode(file),ptr=M._malloc(x.byteLength);try{new Float32Array(M.HEAPU8.buffer,ptr,x.length).set(x);const result=M._ds_tape_import(M._ds_tape_read(5),ptr,x.length,rate);if(result<1)throw new Error('Audio is longer than the tape capacity.');}finally{M._free(ptr);$('tape-file').value='';}drawWave(true);});
  let sample=null,slotBytes=null,stream=null,mic=null,recorder=null,frames=[],frameCount=0,recordTimer=null;
  const sampleStatus=text=>$('sampler-status').textContent=text;
  function setSample(x,rate,name) {sample={x,rate,name};slotBytes=null;$('sampler-use').disabled=$('sampler-download').disabled=false;sampleStatus(`${name} · ${(x.length/rate).toFixed(2)} seconds. Choose Synth or Drum kit, then load.`);}
  function stopCapture() {
    if(!recorder)return;clearTimeout(recordTimer);recorder.disconnect();mic.disconnect();stream.getTracks().forEach(t=>t.stop());recorder.onaudioprocess=null;recorder=mic=stream=null;
    const x=new Float32Array(frameCount);let p=0;for(const block of frames){x.set(block,p);p+=block.length;}frames=[];setSample(x,audioContext().sampleRate,'LIVE');$('sampler-stop').disabled=true;$('sampler-mic').disabled=false;
  }
  on($('sampler-mic'),'click',async()=>{await enableSound();if(!navigator.mediaDevices?.getUserMedia)throw new Error('Audio input requires localhost or HTTPS.');stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});mic=audioContext().createMediaStreamSource(stream);recorder=audioContext().createScriptProcessor(2048,1,1);frames=[];frameCount=0;const max=($('sampler-kind').value==='drum'?12:6)*audioContext().sampleRate;recorder.onaudioprocess=e=>{const input=e.inputBuffer.getChannelData(0),n=Math.min(input.length,max-frameCount);if(n>0){frames.push(input.slice(0,n));frameCount+=n;}e.outputBuffer.getChannelData(0).fill(0);sampleStatus(`Recording · ${(frameCount/audioContext().sampleRate).toFixed(1)} s`);if(frameCount>=max)stopCapture();};mic.connect(recorder);recorder.connect(audioContext().destination);recordTimer=setTimeout(stopCapture,max/audioContext().sampleRate*1000+500);$('sampler-mic').disabled=true;$('sampler-stop').disabled=false;});
  on($('sampler-stop'),'click',stopCapture);on($('sampler-close'),'click',()=>{stopCapture();sampler.close();});sampler.addEventListener('cancel',stopCapture);
  on($('sampler-file-button'),'click',()=>$('sampler-file').click());on($('sampler-file'),'change',async()=>{const file=$('sampler-file').files[0];if(!file)return;const {x,rate}=await decode(file);setSample(x,rate,file.name);$('sampler-file').value='';});
  function makeSlot() {
    if(!sample)throw new Error('Record or load a sample first.');
    const drum=$('sampler-kind').value==='drum',limit=drum?12:6,rate=drum?11025:22050;
    if(sample.x.length/sample.rate>limit+.002)throw new Error(`Select a region of ${limit} seconds or less.`);
    const x=resample(sample.x,sample.rate,rate);if(x.length<2)throw new Error('Sample is empty.');
    let zones;
    if(drum){let marks=$('sampler-layout').value==='equal'?chopEqual(0,x.length,16):chopHits(x,chopNovelty(x),5);marks=[...new Set([0,...marks])].filter(p=>p>=0&&p<x.length).sort((a,b)=>a-b).slice(0,16);zones=chopList(marks,x.length).map((c,i)=>({s:normalize(x.slice(c.start,c.end)),root:M._ds_sampler_note(i),lo:M._ds_sampler_note(i),hi:M._ds_sampler_note(i)}));}
    else zones=[{s:normalize(x),root:+$('sampler-root').value,lo:0,hi:127}];
    const slot=buildSlot(sample.name,zones,rate),bytes=new Uint8Array(512+slot.data.length);bytes.set(slot.hdr);bytes.set(slot.data,512);slotBytes=bytes;return {bytes,drum,zones:zones.length};
  }
  on($('sampler-use'),'click',async()=>{await enableSound();const {bytes,drum,zones}=makeSlot(),ptr=M._malloc(bytes.length);try{M.HEAPU8.set(bytes,ptr);if(!M._ds_sampler_load(+$('sampler-slot').value,ptr,bytes.length,M._ds_selected_track()===3?0:M._ds_selected_track(),drum?1:0))throw new Error('Sample slot rejected.');}finally{M._free(ptr);}sampleStatus(`Loaded ${zones} ${drum?'drum slices':'sample'} into USR${+$('sampler-slot').value+1}. Play the keys. Download the slot to use it in the hardware editor.`);});
  on($('sampler-download'),'click',()=>{const {bytes}=makeSlot();download(bytes,`fm1-usr${+$('sampler-slot').value+1}.fsmp`,'application/octet-stream');});
  on($('tape-to-sampler'),'click',()=>{const n=M._ds_tape_length();if(!n)throw new Error('Record audio first.');const lo=Math.floor(M._ds_tape_read(8)*n/1000),hi=Math.floor(M._ds_tape_read(9)*n/1000),rate=M._ds_tape_rate();if(hi-lo>rate*12)throw new Error('Select a tape region of 12 seconds or less.');const x=new Float32Array(hi-lo),track=M._ds_tape_read(5);for(let i=0;i<x.length;i++)x[i]=M._ds_tape_sample(track,lo+i)/32768;setSample(x,rate,'TAPE');sampler.showModal();});
  on($('open-sampler'),'click',()=>sampler.showModal());
  function refresh() {
    const tape=!!M._ds_tape_active(),studio=tape&&!!M._ds_tape_read(18),fx=!!M._ds_meow_active();document.body.classList.toggle('tape-active',studio);section.hidden=!studio&&!fx;section.querySelector('.studio-tape').hidden=!studio;section.querySelector('.studio-effects').hidden=!fx;
    $('play-meow').setAttribute('aria-pressed',String(fx));
    if(studio){for(const spokes of section.querySelectorAll('.reel-spokes'))spokes.setAttribute('transform',`rotate(${M._ds_tape_read(12)*.36%360} 50 50)`);$('tape-mode-title').textContent=M._ds_tape_read(18)?'Devtool tape studio':'Firmware loop tape';$('tape-mode-info').textContent=M._ds_tape_read(18)?'Four audio tracks · 6 minutes per track at normal speed · 12-second editing clipboard · Export audio before reloading.':'Four short audio loops · approximately 1.49 seconds per track · 185 ms editing clipboard.';$('tape-position').textContent=`${clock(M._ds_tape_read(12))} / ${clock(M._ds_tape_read(13))} · capacity ${clock(M._ds_tape_read(14))}`;for(const input of section.querySelectorAll('[data-at]')){const value=M._ds_tape_read(+input.dataset.at);input.value=value;input.nextElementSibling.textContent=+input.dataset.at>=15?`${value} dB`:+input.dataset.at===0?`${value}%`:value;}for(const row of section.querySelectorAll('.studio-track')){const track=+row.dataset.track;row.querySelector('[data-select]').setAttribute('aria-pressed',String(track===M._ds_tape_read(5)));for(const el of row.querySelectorAll('[data-tmix]')){const value=M._ds_tape_mix(track,+el.dataset.tmix,-1);if(el.tagName==='INPUT')el.value=value;else el.setAttribute('aria-pressed',String(!!value));}}for(const [action,slot] of [[0,11],[1,10],[2,7],[10,6]])section.querySelector(`[data-tape="${action}"]`).setAttribute('aria-pressed',String(!!M._ds_tape_read(slot)));drawWave();}
    if(fx){$('studio-effect').value=M._ds_meow_read(6);$('effect-enable').textContent=M._ds_meow_read(5)?'BYPASS':'ENABLE';$('effect-enable').setAttribute('aria-pressed',String(!!M._ds_meow_read(5)));for(const input of section.querySelectorAll('[data-fx]')){input.value=M._ds_meow_read(+input.dataset.fx);if(input.nextElementSibling)input.nextElementSibling.textContent=input.value;}}
  }
  return {refresh,close:stopCapture};
}
