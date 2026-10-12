/* SPDX-License-Identifier: GPL-3.0-only */
export const MAX_BINDINGS = 48;
export const MAP_COMMAND = 77;
export const PANEL_NAMES = ["FX", "SEL", "ENV", "LFO", "EDIT", "GLO", "HOME", "SAVE", "ARP", "SEQ", "PLAY", "REC", "OCT-", "OCT+"];
export const ENCODER_NAMES = ["SELECT", "ALGO", "PRES", "K1", "K2", "K3", "K4"];
export const midiNoteName = number => ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][number % 12] + (Math.floor(number / 12) - 1);
export const sourceName = b => `CH ${b.channel + 1} · ${b.source ? 'CC ' + b.number : 'NOTE ' + midiNoteName(b.number) + ' (' + b.number + ')'}`;
const fields = ["source", "channel", "number", "kind", "target", "mode"];
export function validateBindings(bindings) {
  if (!Array.isArray(bindings) || bindings.length > MAX_BINDINGS) throw new Error("At most 48 mappings are supported");
  const seen = new Set(), controls = new Map();
  let shiftCount = 0;
  return bindings.map(b => {
    if (!b || fields.some(f => !Number.isInteger(b[f]))) throw new Error("Invalid MIDI mapping");
    const {source, channel, number, kind, target, mode} = b;
    const bank = b.bank ?? 0;
    if (source < 0 || source > 1 || channel < 0 || channel > 15 || number < 0 || number > 127 ||
        kind < 0 || kind > 4 || target < 0 || target >= [14, 7, 27, 1, 1][kind] || mode < 0 || mode > 2 ||
        ![0,1].includes(bank) || (kind === 4 && bank !== 0) ||
        (kind !== 1 && mode !== 0) || ((kind === 1 || kind === 3) && source !== 1)) throw new Error("Invalid MIDI mapping");
    const control = `${source}:${channel}:${number}`, key = `${control}:${bank}`;
    if (kind === 4 && ++shiftCount > 1) throw new Error("Only one Shift control can be assigned");
    if (controls.has(control) && (kind === 4 || controls.get(control) === 4)) throw new Error("The Shift control cannot have another assignment");
    if (seen.has(key)) throw new Error("A MIDI control can only have one target");
    seen.add(key);
    controls.set(control, kind);
    return {...Object.fromEntries(fields.map(f => [f, b[f]])), ...(bank ? {bank} : {})};
  });
}
export function encodeBindings(bindings) {
  const clean = validateBindings(bindings);
  return Uint8Array.from([clean.length, ...clean.flatMap(b => fields.map(f => f === 'kind' ? b.kind | ((b.bank || 0) << 3) : b[f]))]);
}
export function decodeBindings(raw) {
  if (!raw.length || raw.length !== 1 + raw[0] * 6) throw new Error("Invalid MIDI mapping length");
  return validateBindings(Array.from({length: raw[0]}, (_, i) => {
    const b = Object.fromEntries(fields.map((f, j) => [f, raw[1 + i * 6 + j]]));
    if (b.kind & 8) { b.bank = 1; b.kind &= ~8; }
    return b;
  }));
}
export function mapRequest(bindings) {
  return Uint8Array.from([0xf0, 0x7d, 0x46, 0x4c, MAP_COMMAND, 1, ...encodeBindings(bindings), 0xf7]);
}
export function mappingFile(bindings) {
  return {format: "foxxy-midi-map", version: 1, bindings: validateBindings(bindings)};
}
export function readMappingFile(raw) {
  if (raw instanceof Uint8Array && raw[0] === 0xf0) {
    if (raw.length < 8 || raw[1] !== 0x7d || raw[2] !== 0x46 || raw[3] !== 0x4c ||
        raw[4] !== MAP_COMMAND || raw[5] !== 1 || raw.at(-1) !== 0xf7) throw new Error("Not a Foxxy FM MIDI mapping SysEx file");
    return decodeBindings(raw.subarray(6, -1));
  }
  const file = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
  if ((file?.format !== "foxxy-midi-map" && file?.format !== "sloop-midi-map") || file.version !== 1) throw new Error("Unsupported MIDI mapping file");
  return validateBindings(file.bindings);
}
export function targetName(b) {
  return b.kind === 4 ? "SHIFT" : b.kind === 3 ? "MASTER VOLUME" : b.kind === 0 ? PANEL_NAMES[b.target] : b.kind === 1 ? ENCODER_NAMES[b.target] : `KEY ${b.target} (${midiNoteName(53 + b.target)})`;
}

/* Only a valid reply to cmd 77 can establish support; a successful PUT must
 * echo the exact mappings. Older firmware times out without a success claim. */
export function requestMap(input, output, bindings, timeout = 5000) {
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (err, result) => {
      clearTimeout(timer); input.removeEventListener("midimessage", reply);
      err ? reject(err) : resolve(result);
    };
    const reply = event => {
      const d = event.data;
      if (d.length < 7 || d[0] !== 0xf0 || d[1] !== 0x7d || d[2] !== 0x46 || d[3] !== 0x4c || d[4] !== MAP_COMMAND || d.at(-1) !== 0xf7) return;
      try {
        if (d[5]) throw new Error(({2:"FM-1 rejected the mappings", 3:"Stop playback on the FM-1 before sending", 4:"FM-1 could not save the mappings to flash"})[d[5]] || "FM-1 mapping request failed");
        const result = decodeBindings(d.subarray(6, -1));
        if (bindings !== undefined && JSON.stringify(result) !== JSON.stringify(validateBindings(bindings))) throw new Error("FM-1 returned different mappings");
        finish(null, result);
      } catch (err) { finish(err); }
    };
    input.addEventListener("midimessage", reply);
    timer = setTimeout(() => finish(new Error("No MIDI mapping reply. Select the FM-1 input/output and install the matching Foxxy FM firmware (protocol 11 or later).")), timeout);
    try {
      output.send(bindings === undefined ? [0xf0, 0x7d, 0x46, 0x4c, MAP_COMMAND, 0, 0xf7] : mapRequest(bindings));
    } catch (err) { finish(err); }
  });
}
