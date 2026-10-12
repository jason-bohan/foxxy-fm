import assert from 'node:assert/strict';
import {setupControlFeedback} from './control-feedback.js';
const values=new Map();globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
globalThis.document=new EventTarget();globalThis.window=new EventTarget();
let buffers=0,started=0,gains=0,context;
class AudioContext {
  constructor(){context=this;this.state='running';this.currentTime=0;this.sampleRate=44100;this.destination={};}
  createGain(){gains++;return {connect(){}};}
  createBuffer(_,n){buffers++;const data=new Float32Array(n);return {getChannelData:()=>data};}
  createBufferSource(){return {connect(){},disconnect(){},start(){started++;}};}
}
window.AudioContext=AudioContext;
const select=Object.assign(new EventTarget(),{value:'rubber'}),knobs=Object.assign(new EventTarget(),{checked:true}),keys=Object.assign(new EventTarget(),{checked:true});
const feedback=setupControlFeedback(select,{knobs,keys});document.dispatchEvent(new Event('pointerdown'));
assert.equal(buffers,4);assert.equal(gains,1);
for(let i=0;i<100;i++){context.currentTime+=.08;feedback.play('knob');}
assert.equal(started,100);assert.equal(buffers,4);
feedback.play('knob');assert.equal(started,100);
knobs.checked=false;knobs.dispatchEvent(new Event('change'));context.currentTime+=.1;feedback.play('knob');assert.equal(started,100);
feedback.play('key');assert.equal(started,101);
keys.checked=false;keys.dispatchEvent(new Event('change'));context.currentTime+=.1;feedback.play('button');assert.equal(started,101);
assert.deepEqual(JSON.parse(values.get('foxxy-control-feedback-v2')),{knobs:false,keys:false});
knobs.checked=true;select.value='off';select.dispatchEvent(new Event('change'));feedback.play('knob');assert.equal(started,101);
console.log('Tactile audio: cached buffers, bounded knob voices, independent switches and saved preferences PASS');
