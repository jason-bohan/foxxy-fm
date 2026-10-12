/* SPDX-License-Identifier: GPL-3.0-only */
export const TYPING_KEYS = ['KeyZ','KeyS','KeyX','KeyD','KeyC','KeyV','KeyG','KeyB','KeyH','KeyN','KeyJ','KeyM','Comma','KeyL','Period','Semicolon','Slash','KeyQ','Digit2','KeyW','Digit3','KeyE','KeyR','Digit5','KeyT','Digit6','KeyY'];
const extraKeys = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(c => `Key${c}`).concat(
  [...'0123456789'].map(c => `Digit${c}`), ['Space','ShiftLeft','ShiftRight','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Backspace','Tab','Backquote','Minus','Equal','BracketLeft','BracketRight','Backslash','Quote'],
  Array.from({length:12},(_,i)=>`F${i+1}`)).filter(code => !TYPING_KEYS.includes(code));
const codeNotes = new Map(TYPING_KEYS.map((code,i)=>[code,53+i]));
extraKeys.forEach((code,i)=>codeNotes.set(code,i<53?i:i+27));
export const typingKeyName = note => {
  const code = [...codeNotes].find(([,n])=>n===note)?.[0];
  return code?.replace(/^Key|^Digit/,'').replace('ShiftLeft','Left Shift').replace('ShiftRight','Right Shift') || '';
};
export function computerKeyboard(host, active, capturing = () => false) {
  const input = new EventTarget();
  Object.assign(input, {id:'computer-keyboard', name:'Computer Keyboard', state:'connected', open:async () => input});
  const held = new Set();
  const send = (code, on) => {
    const event = new Event('midimessage');
    event.data = Uint8Array.of(on ? 0x9f : 0x8f, codeNotes.get(code), on ? 100 : 0);
    input.dispatchEvent(event);
  };
  input.release = () => { for (const code of held) send(code, false); held.clear(); };
  host.addEventListener('keydown', e => {
    if (!active() || e.repeat || e.metaKey || e.ctrlKey || e.altKey || !codeNotes.has(e.code) ||
      (!capturing() && (e.target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '')))) return;
    e.preventDefault(); if (held.has(e.code)) return;
    held.add(e.code); send(e.code, true);
  });
  host.addEventListener('keyup', e => { if (!held.delete(e.code)) return; e.preventDefault(); send(e.code, false); });
  host.addEventListener('blur', input.release);
  return input;
}
