/* SPDX-License-Identifier: GPL-3.0-only */
import assert from "node:assert/strict";
import {encodeBindings, decodeBindings, mapRequest, mappingFile, readMappingFile, requestMap} from "./midi-map.js";
import createDevScreen from "./devscreen.core.mjs";
import {setupMidiLearn} from "./devscreen-midi.js";
import {keyLayout, keyName} from "./key-layout.js";

assert.equal(keyLayout('auto', 'Circuit Rhythm').count, 13);
assert.equal(keyLayout('auto', 'Other controller').count, 27);
assert.equal(keyLayout('full', 'Circuit Rhythm').count, 27);
assert.deepEqual(keyLayout('custom', '', 7, 8).whites, [7,9,11,12,14,16,18,19]);
assert.equal(keyLayout('custom', '', 26, 16).count, 1);
assert.equal(keyLayout('custom', '', 0, 0).count, 1);
assert.equal(keyName(0), 'F3');
assert.equal(keyName(7), 'C4');
assert.equal(keyName(26), 'G5');

const bindings = [
  {source: 0, channel: 0, number: 60, kind: 0, target: 2, mode: 0},
  {source: 1, channel: 1, number: 20, kind: 1, target: 3, mode: 1},
  {source: 0, channel: 2, number: 62, kind: 2, target: 26, mode: 0},
];
const shiftedBindings = [bindings[0], {...bindings[0], bank: 1, target: 1},
  {source: 0, channel: 0, number: 59, kind: 4, target: 0, mode: 0}];
assert.deepEqual(decodeBindings(encodeBindings(shiftedBindings)), shiftedBindings);
assert.deepEqual(readMappingFile(mapRequest(shiftedBindings)), shiftedBindings);
assert.deepEqual(readMappingFile(JSON.stringify(mappingFile(shiftedBindings))), shiftedBindings);
assert.throws(() => encodeBindings([...shiftedBindings, {...shiftedBindings[2], number: 58}]));
assert.throws(() => encodeBindings([{...shiftedBindings[2], bank: 1}]));
assert.throws(() => encodeBindings([shiftedBindings[2], {...bindings[0], number: 59, bank: 1}]));
assert.deepEqual(decodeBindings(encodeBindings(bindings)), bindings);
assert.deepEqual(readMappingFile(JSON.stringify(mappingFile(bindings))), bindings);
assert.deepEqual(readMappingFile(mapRequest(bindings)), bindings);
assert.deepEqual(readMappingFile(mapRequest([])), []);
assert.throws(() => readMappingFile('{"format":"foxxy-midi-map","version":2,"bindings":[]}'));
assert.throws(() => encodeBindings([...bindings, bindings[0]]));
assert.throws(() => encodeBindings([{...bindings[0], channel: 16}]));
assert.throws(() => encodeBindings([{...bindings[0], mode: 1}]));
assert.throws(() => encodeBindings([{...bindings[1], source: 0}]));
assert.throws(() => decodeBindings(Uint8Array.of(1, 0)));
assert.throws(() => readMappingFile(Uint8Array.of(0xf0, 0x7d, 0x46, 0x4c, 76, 1, 0, 0xf7)));
const maximum = Array.from({length: 48}, (_, number) => ({...bindings[1], number}));
assert.deepEqual(readMappingFile(mapRequest(maximum)), maximum);
assert.throws(() => encodeBindings([...maximum, {...bindings[1], number: 48}]));

class Input extends EventTarget {
  opened = false;
  async open() { this.opened = true; return this; }
  reply(bytes, time) { const e = new Event("midimessage"); e.data = Uint8Array.from(bytes); if (time !== undefined) Object.defineProperty(e, "timeStamp", {value: time}); this.dispatchEvent(e); }
}
const input = new Input();
const reply = (rc, b) => [0xf0, 0x7d, 0x46, 0x4c, 77, rc, ...encodeBindings(b), 0xf7];
let sent;
const output = {send: bytes => { sent = bytes; queueMicrotask(() => input.reply(reply(0, bindings))); }};
assert.deepEqual(await requestMap(input, output), bindings);
assert.deepEqual([...sent], [0xf0, 0x7d, 0x46, 0x4c, 77, 0, 0xf7]);
assert.deepEqual(await requestMap(input, output, bindings), bindings);
assert.deepEqual([...sent], [...mapRequest(bindings)]);
await assert.rejects(requestMap(input, {send: () => queueMicrotask(() => input.reply(reply(3, bindings)))}, bindings), /Stop playback/);
await assert.rejects(requestMap(input, {send: () => queueMicrotask(() => input.reply(reply(4, bindings)))}, bindings), /flash/);
await assert.rejects(requestMap(input, output, []), /different mappings/);
await assert.rejects(requestMap(input, {send: () => {}}, undefined, 10), /matching Foxxy FM firmware/);
await assert.rejects(requestMap(input, {send: () => {throw new Error("Port disconnected");}}, bindings), /disconnected/);

/* Verify that exported bytes run in the rebuilt browser core, with the same
 * C code tested natively in midi_learn_ui_test. */
const M = await createDevScreen(); M._ds_init();
// Circuit-style absolute CC increments must reach every Algorithm track.
const algorithm = await createDevScreen(); algorithm._ds_init();
const ar = encodeBindings([{source:1, channel:0, number:21, kind:1, target:1, mode:0}]);
const ap = algorithm._malloc(ar.length); algorithm.HEAPU8.set(ar, ap);
assert.equal(algorithm._ds_midi_map(ap, ar.length), 1);
algorithm._ds_midi(0xb0,21,30); algorithm._ds_frame();
for (let track = 1; track < 4; track++) {
  algorithm._ds_midi(0xb0,21,30 + track); algorithm._ds_frame();
  assert.equal(algorithm._ds_selected_track(), track);
}
algorithm._free(ap);
// LED outputs follow firmware state, including blinking and released keys.
const lights = await createDevScreen(); lights._ds_init();
assert.equal(lights._ds_led(6), 3); // HOME page indicator
assert.equal(lights._ds_led(-1), 0);
assert.equal(lights._ds_led(41), 0);
lights._ds_tap(10);
const playLights = new Set();
for (let i = 0; i < 50; i++) { lights._ds_frame(); playLights.add(lights._ds_led(10)); }
assert.deepEqual([...playLights].sort(), [0, 3]);
lights._ds_tap(10); lights._ds_tap(11);
const recordLights = new Set();
for (let i = 0; i < 30; i++) { lights._ds_frame(); recordLights.add(lights._ds_led(11)); }
assert.deepEqual([...recordLights].sort(), [0, 3]);
lights._ds_tap(11); lights._ds_key(0, 1);
assert.equal(lights._ds_led(14), 3);
lights._ds_key(0, 0);
assert.equal(lights._ds_led(14), 0);
const raw = encodeBindings(bindings), ptr = M._malloc(raw.length);
M.HEAPU8.set(raw, ptr); assert.equal(M._ds_midi_map(ptr, raw.length), 1);
M._ds_tap(2); const expected = M._ds_cur_page(); M._ds_home();
M._ds_midi(0x90, 60, 100); M._ds_frame(); M._ds_midi(0x80, 60, 0); M._ds_frame();
assert.equal(M._ds_cur_page(), expected);
M.HEAPU8[ptr] = 49; assert.equal(M._ds_midi_map(ptr, raw.length), 0);
M._ds_midi_release(); M._free(ptr);
const master = [{source:1, channel:0, number:7, kind:3, target:0, mode:0}];
assert.deepEqual(readMappingFile(mapRequest(master)), master);
const mr = encodeBindings(master), mp = M._malloc(mr.length);
M.HEAPU8.set(mr, mp); assert.equal(M._ds_midi_map(mp, mr.length), 1);
M._ds_midi(0xb0,7,127); M._ds_frame(); assert.equal(M._ds_master_value(),4096);
M._ds_midi(0xb0,7,64); M._ds_frame(); assert.equal(M._ds_master_value(),1040);
M._ds_midi(0xb0,7,32); M._ds_frame(); assert.equal(M._ds_master_value(),260);
M._ds_midi(0xb0,7,0); M._ds_frame(); assert.equal(M._ds_master_value(),0);
M._free(mp);

/* Exercise the controller UI wiring with fake ports and the real WASM core.
 * Browser rendering is checked separately with Chrome's headless DOM output. */
class Element extends EventTarget {
  value = ""; textContent = ""; children = []; disabled = false;
  dataset = {};
  classes = new Set();
  classList = {toggle: (name, on) => { if (on) this.classes.add(name); else this.classes.delete(name); }};
  get options() { return this.children; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  click() { this.dispatchEvent(new Event("click")); }
}
const elements = new Map();
const overlayTarget = new Element(); overlayTarget.dataset.midiTarget = "0:2";
globalThis.document = {body: new Element(), querySelectorAll: () => [overlayTarget], getElementById: id => {
  if (!elements.has(id)) elements.set(id, new Element());
  return elements.get(id);
}, createElement: () => new Element()};
const $ = id => document.getElementById(id);
const stored = new Map();
globalThis.localStorage = {getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value)};
globalThis.window = new EventTarget();
window.confirm = () => true;
const feedbackEvents = [];
window.addEventListener('controlfeedback', event => feedbackEvents.push(event.detail.kind));
const controller = new Input(); Object.assign(controller, {id: "controller", name: "Test controller", state: "connected"});
const hardwareInput = new Input(); Object.assign(hardwareInput, {id: "hardware-in", name: "FM-1", state: "connected"});
let hardwareMap = [];
const hardwareOutput = {id: "hardware-out", name: "FM-1", state: "connected", send: bytes => {
  if (bytes[5] === 1) hardwareMap = readMappingFile(Uint8Array.from(bytes));
  queueMicrotask(() => hardwareInput.reply(reply(0, hardwareMap)));
}};
const access = new EventTarget(); Object.assign(access, {sysexEnabled: false,
  inputs: new Map([[controller.id, controller], [hardwareInput.id, hardwareInput]]),
  outputs: new Map([[hardwareOutput.id, hardwareOutput]])});
const permissions = [];
Object.defineProperty(globalThis.navigator, "requestMIDIAccess", {configurable: true, value: async options => {
  permissions.push(options.sysex); if (options.sysex) access.sysexEnabled = true; return access;
}});
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
$("mmode").value = "1";
const learn = setupMidiLearn(M);
$("menable").click(); await tick();
$("mi").value = controller.id; $("mi").dispatchEvent(new Event("change"));
assert.equal(controller.opened, true);
controller.reply([0xf8]); assert.match($("mlactivity").textContent, /Receiving clock/);
$("msync").value = "1"; $("msync").dispatchEvent(new Event("change"));
controller.reply([0xfa], 10000); controller.reply([0xf8], 10000); M._ds_frame();
assert.equal(M._ds_playing(), 1);
for (let i = 1; i <= 48; i++) { controller.reply([0xf8], 10000 + i * 500 / 24); M._ds_frame(); }
assert.equal(M._ds_bpm(), 120); assert.equal(M._ds_clock_alive(), 1);
learn.refreshSync(true); assert.match($("msyncstatus").textContent, /Clock received.*120 BPM/);
controller.reply([0xfc], 11001); M._ds_frame(); assert.equal(M._ds_playing(), 0);
controller.reply([0xfb], 11002); M._ds_frame(); assert.equal(M._ds_playing(), 1);
controller.reply([0xfc], 11003); M._ds_frame();
$("mlearn").click(); assert.equal($("mlearn-overlay").hidden, false);
overlayTarget.dispatchEvent(new Event("pointerdown", {cancelable: true}));
controller.reply([0x90, 60, 100]);
assert.match($("mist").textContent, /Mapped ENV/);
assert.match($("mlsignal").textContent, /NOTE ON 60/);
assert.match($("mlcounts").textContent, /Notes: 1 · CC: 0/);
assert.equal(readMappingFile(stored.get("foxxy-devscreen-midi-v1"))[0].target, 2);
$("mldone").click(); assert.equal($("mlearn-overlay").hidden, true); M._ds_home();
controller.reply([0x90, 60, 100]); M._ds_frame(); controller.reply([0x80, 60, 0]); M._ds_frame();
assert.equal(overlayTarget.classes.has("midi-held"), false);
controller.reply([0x90, 60, 100]);
assert.equal(overlayTarget.classes.has("midi-held"), true);
assert.equal(feedbackEvents.at(-1), 'button');
controller.reply([0x90, 60, 0]);
assert.equal(overlayTarget.classes.has("midi-held"), false);
assert.equal(M._ds_cur_page(), expected);
// Learn and play controls while external clock remains selected.
$("mmode").value = "0"; $("mlearn").click(); assert.equal(learn.arm(1, 3), true);
controller.reply([0xb0, 20, 30]); assert.match($("mist").textContent, /Mapped K1/);
assert.match($("mlsignal").textContent, /CC 20/);
assert.match($("mlsignalcounts").textContent, /CC: 1/);
$("mldone").click(); controller.reply([0xb0, 20, 30]); M._ds_frame();
controller.reply([0xb0, 20, 34]); M._ds_frame();
assert.equal(feedbackEvents.at(-1), 'knob');
const savedMode = $("mlist").children[1].children[1];
savedMode.value = "1"; savedMode.dispatchEvent(new Event("change"));
assert.equal(readMappingFile(stored.get("foxxy-devscreen-midi-v1"))[1].mode, 1);
const correctedMode = $("mlist").children[1].children[1];
correctedMode.value = "0"; correctedMode.dispatchEvent(new Event("change"));
assert.equal(readMappingFile(stored.get("foxxy-devscreen-midi-v1"))[1].mode, 0);
$("mlearn").click(); learn.arm(3, 0); controller.reply([0xb0, 7, 64]);
assert.match($("mist").textContent, /Mapped MASTER VOLUME/);
$("mldone").click(); controller.reply([0xb0, 7, 127]); M._ds_frame();
assert.equal(M._ds_master_value(), 4096);
controller.reply([0xb0, 7, 0]); M._ds_frame(); assert.equal(M._ds_master_value(), 0);
$("mlearn").click(); learn.arm(2, 0); controller.reply([0x93, 48, 100]);
assert.match($("mist").textContent, /Mapped KEY 0/);
$("mldone").click();
const feedbackBeforeKeyRelease = feedbackEvents.length;
controller.reply([0x93, 48, 100]); M._ds_frame();
controller.reply([0x83, 48, 0]); M._ds_frame();
assert.equal(feedbackEvents.length, feedbackBeforeKeyRelease);
const learned = readMappingFile(stored.get("foxxy-devscreen-midi-v1"));
assert.equal(learned.length, 4);
assert.deepEqual(learned.map(b => [b.kind,b.target]), [[0,2],[1,3],[3,0],[2,0]]);
$("mhwinput").value = hardwareInput.id; $("mhwinput").dispatchEvent(new Event("change"));
$("mhwoutput").value = hardwareOutput.id; $("mhwoutput").dispatchEvent(new Event("change"));
assert.equal($("msend").disabled, false);
$("msend").click(); await tick();
assert.match($("mhwstatus").textContent, /saved and verified/);
assert.deepEqual(permissions, [false, true]);
assert.deepEqual(hardwareMap, readMappingFile(stored.get("foxxy-devscreen-midi-v1")));
// Assign Shift, then reuse the existing ENV pad for a keyboard key in bank 2.
$("mshift").click(); controller.reply([0x90, 59, 100]);
assert.match($("mist").textContent, /Mapped SHIFT/);
assert.match($("mshiftassignment").textContent, /Shift pad: CH 1 · NOTE B3 \(59\)/);
assert.equal($("mlshiftassignment").textContent, $("mshiftassignment").textContent);
$("mlbank").value = "1"; $("mlbank").dispatchEvent(new Event("change"));
learn.arm(2, 0); controller.reply([0x90, 60, 100]);
assert.match($("mist").textContent, /KEY 0 \(F3\).*NOTE C4 \(60\).*Shift bank/);
assert.equal($("mlbanksummary").textContent, 'Shift mappings (1)');
assert.match($("mlbanklist").children[0].textContent, /NOTE C4 \(60\) → KEY 0 \(F3\)/);
const twoBanks = readMappingFile(stored.get("foxxy-devscreen-midi-v1"));
assert.equal(twoBanks.filter(b => b.number === 60).length, 2);
assert.equal(twoBanks.find(b => b.number === 60 && b.bank === 1).kind, 2);
$("mldone").click(); M._ds_home();
controller.reply([0x90, 59, 100]);
assert.match($("mshiftstatus").textContent, /SHIFT HELD/);
assert.equal($("shift-light").classes.has("active"), true);
assert.equal($("shift-light").textContent, 'SHIFT ON');
controller.reply([0x90, 60, 100]); M._ds_frame();
assert.equal(M._ds_led(14), 3);
assert.equal(overlayTarget.classes.has("midi-held"), false);
controller.reply([0x80, 59, 0]); M._ds_frame();
assert.equal($("shift-light").classes.has("active"), false);
assert.equal($("shift-light").textContent, 'SHIFT OFF');
assert.equal(M._ds_led(14), 0); // releasing Shift also releases the shifted key
controller.reply([0x80, 60, 0]); M._ds_frame();
controller.reply([0x90, 60, 100]);
assert.equal(overlayTarget.classes.has("midi-held"), true);
controller.reply([0x90, 60, 0]);
$("msend").click(); await tick();
assert.deepEqual(hardwareMap, twoBanks);
$("mlearn").click();
window.confirm = () => false;
$("mlclear").click();
assert.deepEqual(readMappingFile(stored.get("foxxy-devscreen-midi-v1")), twoBanks);
$("mclear").click();
assert.deepEqual(readMappingFile(stored.get("foxxy-devscreen-midi-v1")), twoBanks);
window.confirm = prompt => { assert.match(prompt, /Are you sure.*both mapping banks.*Shift/); return true; };
$("mlclear").click();
assert.equal(readMappingFile(stored.get("foxxy-devscreen-midi-v1")).length, 0);
assert.equal($("mlbank").value, "0");
assert.equal($("mshift").textContent, "ASSIGN SHIFT");
assert.equal($("mlshiftassignment").textContent, "Shift pad: not assigned");
assert.equal($("mlearn-overlay").hidden, false);
assert.match($("mist").textContent, /both banks and Shift/);
$("mclear").click(); assert.equal(readMappingFile(stored.get("foxxy-devscreen-midi-v1")).length, 0);
access.inputs.delete(controller.id); access.dispatchEvent(new Event("statechange"));
// Reload restores the selected input using already-granted permission.
access.inputs.set(controller.id, controller);
elements.clear();
Object.defineProperty(globalThis.navigator, "permissions", {configurable:true, value:{query:async () => ({state:"granted"})}});
const reloaded = await createDevScreen(); reloaded._ds_init();
const reloadLearn = setupMidiLearn(reloaded); await tick(); await tick();
assert.equal($("mi").value, controller.id);
assert.equal($("menable").textContent, "MIDI ENABLED");
assert.match($("mist").textContent, /Connected: Test controller/);
$("mi").value = 'computer-keyboard'; $("mi").dispatchEvent(new Event('change'));
assert.match($("mist").textContent, /Computer Keyboard ready/);
$("mlearn").click(); assert(reloadLearn.arm(2,7));
const typing = (type, code, repeat=false) => {
  const event = new Event(type, {cancelable:true}); Object.assign(event,{code,repeat}); window.dispatchEvent(event);
};
typing('keydown','KeyZ'); typing('keyup','KeyZ');
assert.match($("mist").textContent, /Mapped KEY 7/);
assert.equal(readMappingFile(stored.get('foxxy-devscreen-midi-v1'))[0].channel,15);
$("mldone").click(); typing('keydown','KeyZ'); reloaded._ds_frame();
assert.equal(reloaded._ds_led(21),3);
typing('keydown','KeyZ',true); typing('keyup','KeyZ'); reloaded._ds_frame();
assert.equal(reloaded._ds_led(21),0);
typing('keydown','KeyZ'); reloaded._ds_frame(); window.dispatchEvent(new Event('blur')); reloaded._ds_frame();
assert.equal(reloaded._ds_led(21),0);
$("mlearn").click(); assert(reloadLearn.arm(0,2));
const letterA = new Event('keydown',{cancelable:true}); Object.assign(letterA,{code:'KeyA'});
Object.defineProperty(letterA,'target',{value:{tagName:'SELECT'}});
window.dispatchEvent(letterA); typing('keyup','KeyA');
assert.match($("mist").textContent, /Mapped ENV.*KEY A/);
assert(readMappingFile(stored.get('foxxy-devscreen-midi-v1')).some(b=>b.kind===0 && b.target===2));
$("mldone").click();
console.log("MIDI setup: file round trips, transfer verification/errors, learn UI wiring and shared WebAssembly UI PASS");
