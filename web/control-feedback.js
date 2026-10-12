/* SPDX-License-Identifier: GPL-3.0-only */
export function setupControlFeedback(select, {knobs,keys} = {}) {
  const storage='foxxy-control-sounds-v1',preferences='foxxy-control-feedback-v2';
  try {
    const saved=localStorage.getItem(storage) ?? localStorage.getItem('sloop-control-sounds-v1');if(['off','rubber','click'].includes(saved))select.value=saved;
    const flags=JSON.parse(localStorage.getItem(preferences) ?? localStorage.getItem('sloop-control-feedback-v2'));
    if(flags){if(knobs&&typeof flags.knobs==='boolean')knobs.checked=flags.knobs;if(keys&&typeof flags.keys==='boolean')keys.checked=flags.keys;}
  }catch{}
  let context,bus;
  const buffers=new Map(),last={knob:-Infinity,key:-Infinity};
  const enabled=kind=>select.value!=='off'&&(kind==='knob'?knobs?.checked!==false:keys?.checked!==false);
  function buffer(style,kind) {
    const cacheKey=style+kind;if(buffers.has(cacheKey))return buffers.get(cacheKey);
    const knob=kind==='knob',rubber=style==='rubber';
    const duration=knob ? (rubber ? .025:.016):(rubber ? .065:.035);
    const b=context.createBuffer(1,Math.ceil(context.sampleRate*duration),context.sampleRate),samples=b.getChannelData(0);
    let seed=0x193af31,low=0,phase=0;
    for(let i=0;i<samples.length;i++) {
      const t=i/context.sampleRate,u=i/(samples.length-1);
      seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;
      low+=((seed>>>0)/2147483648-1-low)*(rubber ? .075:.18);
      const frequency=knob ? (rubber ? 380:650):(rubber ? 155-75*u:420);
      phase+=2*Math.PI*frequency/context.sampleRate;
      const attack=Math.min(1,t/.003),release=Math.min(1,(duration-t)/.008);
      const envelope=attack*release*Math.exp(-u*(rubber ? 4:7));
      samples[i]=(Math.sin(phase)*(rubber ? .6:.25)+low*.4)*envelope*(knob ? .035:.065);
    }
    samples[0]=samples[samples.length-1]=0;
    buffers.set(cacheKey,b);return b;
  }
  function unlock() {
    if(!enabled('knob')&&!enabled('key'))return;
    try {
      if(!context){context=new(window.AudioContext||window.webkitAudioContext)();bus=context.createGain();bus.connect(context.destination);for(const style of ['rubber','click'])for(const kind of ['knob','key'])buffer(style,kind);}
      if(context.state==='suspended')context.resume().catch(()=>{});
    }catch{}
  }
  function save() {
    try{localStorage.setItem(storage,select.value);localStorage.setItem(preferences,JSON.stringify({knobs:knobs?.checked!==false,keys:keys?.checked!==false}));}catch{}
    unlock();
  }
  document.addEventListener('pointerdown',unlock,{capture:true});
  document.addEventListener('keydown',unlock,{capture:true});
  select.addEventListener('change',save);knobs?.addEventListener('change',save);keys?.addEventListener('change',save);
  function play(kind) {
    kind=kind==='knob'?'knob':'key';
    if(!enabled(kind)||context?.state!=='running')return;
    const now=context.currentTime;
    // Each short voice finishes before the next one; fast movement cannot pile up noise.
    if(now-last[kind]<(kind==='knob' ? .07:.075))return;
    last[kind]=now;
    const source=context.createBufferSource();source.buffer=buffer(select.value,kind);
    source.connect(bus);source.start(now);source.onended=()=>source.disconnect();
  }
  window.addEventListener('controlfeedback',event=>play(event.detail.kind));
  window.addEventListener('synthnote',()=>play('key'));
  return {play};
}
