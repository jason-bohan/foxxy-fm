/* SPDX-License-Identifier: GPL-3.0-only */
/* Sample slot encoding and chop detection shared with the hardware editor. */
const NOTE_NAMES=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const SMP = { SLOT_SIZE: 0x14000, DATA_OFF: 512, RATE: 22050, HDR_LEN: 32 + 16 * 28, MAX_ZONES: 16 };
SMP.MAX_DATA = SMP.SLOT_SIZE - SMP.DATA_OFF;

/* groups of up to 7 bytes, each preceded by their top bits */
function pack7(b) {
  const out = [];
  for (let i = 0; i < b.length; i += 7) {
    const g = Array.from(b.slice(i, i + 7));
    out.push(g.reduce((m, x, j) => m | (((x >> 7) & 1) << j), 0));
    for (const x of g) out.push(x & 0x7F);
  }
  return out;
}
function unpack7(a) {
  const out = [];
  for (let i = 0; i < a.length; i += 8) {
    const top = a[i];
    for (let j = 0; j < 7 && i + 1 + j < a.length; j++) out.push(a[i + 1 + j] | (((top >> j) & 1) << 7));
  }
  return Uint8Array.from(out);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

const IMA_STEP = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88,
  97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658,
  724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660,
  4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818,
  18500, 20350, 22385, 24623, 27086, 29794, 32767];
const IMA_IDX = [-1, -1, -1, -1, 2, 4, 6, 8];
/* IMA ADPCM, 4 bit, low nibble first, from predictor 0 / index 0 -> {data, pred, idx} (state at loopStart) */
function imaEncode(s, loopStart = 0) {
  let pred = 0, idx = 0, atLoop = [0, 0];
  const nib = new Uint8Array(s.length + (s.length & 1));
  for (let n = 0; n < s.length; n++) {
    if (n === loopStart) atLoop = [pred, idx];
    const step = IMA_STEP[idx];
    let diff = s[n] - pred, code = 0;
    if (diff < 0) { code = 8; diff = -diff; }
    let vd = step >> 3;
    if (diff >= step) { code |= 4; diff -= step; vd += step; }
    if (diff >= step >> 1) { code |= 2; diff -= step >> 1; vd += step >> 1; }
    if (diff >= step >> 2) { code |= 1; vd += step >> 2; }
    pred = Math.max(-32768, Math.min(32767, code & 8 ? pred - vd : pred + vd));
    idx = Math.max(0, Math.min(88, idx + IMA_IDX[code & 7]));
    nib[n] = code;
  }
  const out = new Uint8Array(nib.length >> 1);
  for (let k = 0; k < nib.length; k += 2) out[k >> 1] = nib[k] | (nib[k + 1] << 4);
  return { data: out, pred: atLoop[0], idx: atLoop[1] };
}

/* WAV: PCM 8/16/24/32 or float, any channel count, mixed to mono -> {sr, x} (gen_samples.read_any_wav) */
function parseWav(buf) {
  const d = new Uint8Array(buf), v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const id = (i) => String.fromCharCode(d[i], d[i + 1], d[i + 2], d[i + 3]);
  if (d.length < 12 || id(0) !== "RIFF" || id(8) !== "WAVE") throw new Error("not a WAV file");
  let i = 12, fmt = null, data = null;
  while (i + 8 <= d.length) {
    const cid = id(i), n = v.getUint32(i + 4, true);
    if (cid === "fmt ") {
      let tag = v.getUint16(i + 8, true);
      const ch = v.getUint16(i + 10, true), sr = v.getUint32(i + 12, true), bits = v.getUint16(i + 22, true);
      if (tag === 0xFFFE) tag = v.getUint16(i + 32, true);
      fmt = { tag, ch, sr, bits };
    } else if (cid === "data") {
      data = [i + 8, Math.min(d.length, i + 8 + n)];
      break;
    }
    i += 8 + n + (n & 1);
  }
  if (!fmt || !data) throw new Error("WAV without fmt/data");
  const { tag, ch, sr, bits } = fmt, bps = bits >> 3, frame = bps * ch;
  if (!(tag === 1 || tag === 3) || !bps || !ch) throw new Error("unsupported WAV format");
  const nfr = Math.floor((data[1] - data[0]) / frame), x = new Float64Array(nfr);
  for (let f = 0; f < nfr; f++) {
    let acc = 0;
    for (let c = 0; c < ch; c++) {
      const o = data[0] + f * frame + c * bps;
      let s;
      if (tag === 3) s = bps === 4 ? v.getFloat32(o, true) : v.getFloat64(o, true);
      else if (bps === 2) s = v.getInt16(o, true) / 32768;
      else if (bps === 3) s = (((d[o] | (d[o + 1] << 8) | (d[o + 2] << 16)) << 8) >> 8) / 8388608;
      else if (bps === 4) s = v.getInt32(o, true) / 2147483648;
      else s = (d[o] - 128) / 128;
      acc += s;
    }
    x[f] = acc / ch;
  }
  return { sr, x };
}

/* gen_samples.resample: moving average over the ratio, then linear interpolation */
function resample(x, sr, to) {
  if (sr === to) return Array.from(x);
  if (sr > to) {
    const k = Math.max(1, pyRound(sr / to));
    if (k > 1) {
      const y = new Array(x.length);
      for (let i = 0; i < x.length; i++) { let s = 0; for (let j = i; j < Math.min(x.length, i + k); j++) s += x[j]; y[i] = s / k; }
      x = y;
    }
  }
  const step = sr / to, out = [];
  let p = 0;
  while (p < x.length - 1) { const i = Math.floor(p), f = p - i; out.push(x[i] * (1 - f) + x[i + 1] * f); p += step; }
  return out;
}
function pyRound(v) { const f = Math.floor(v), r = v - f; return r > 0.5 ? f + 1 : r < 0.5 ? f : (f % 2 ? f + 1 : f); }

/* mono float -> int16, peak normalised to 30000 */
function normalize(x) {
  let pk = 1e-9;
  for (const v of x) pk = Math.max(pk, Math.abs(v));
  return Int16Array.from(x, (v) => Math.max(-32768, Math.min(32767, Math.trunc(v / pk * 30000))));
}

/* root from a file name like "piano_C4" or "F#3" (C4 = 60), else 60 (sampleio.note_from_name) */
function rootFromName(name) {
  const m = /(?<![A-Za-z])([A-G])([#b]?)(-?\d)(?!\d)/.exec(name);
  if (!m) return 60;
  const n = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + (parseInt(m[3], 10) + 1) * 12;
  return Math.max(0, Math.min(127, n));
}

/* zones: [{s: Int16Array (22050 Hz), root, lo?, hi?}] -> {hdr (480 B), data, zones} (sampleio.user_slot) */
function buildSlot(name, zonesIn, sampleRate = SMP.RATE) {
  const zones = [], parts = [];
  let len = 0;
  for (const z of zonesIn) {
    const e = imaEncode(z.s, 0);
    zones.push({ off: len, n: z.s.length, ls: 0, le: z.s.length - 1, root: z.root, lo: z.lo ?? null, hi: z.hi ?? null, pred: e.pred, idx: e.idx });
    parts.push(e.data);
    len += e.data.length;
  }
  const data = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { data.set(p, o); o += p.length; }
  if (len > SMP.MAX_DATA) throw new Error(`too long: ${len} B (max ${SMP.MAX_DATA} B)`);
  if (!zones.length || zones.length > SMP.MAX_ZONES) throw new Error("1..16 files per slot");
  zones.sort((a, b) => a.root - b.root);
  zones.forEach((z, j) => {
    if (z.lo == null) {
      z.lo = j === 0 ? 0 : Math.floor((zones[j - 1].root + z.root) / 2) + 1;
      z.hi = j === zones.length - 1 ? 127 : Math.floor((z.root + zones[j + 1].root) / 2);
    }
  });
  const hdr = new Uint8Array(SMP.HDR_LEN), v = new DataView(hdr.buffer);
  v.setUint32(0, 0x504D5346, true);
  v.setUint16(4, 1, true);
  hdr[6] = zones.length;
  const nm = String(name).toUpperCase().replace(/[^\x20-\x7E]/g, "").slice(0, 8);
  for (let i = 0; i < nm.length; i++) hdr[8 + i] = nm.charCodeAt(i);
  v.setUint32(16, len, true);
  v.setUint32(20, crc32(data), true);
  const rate = pyRound(sampleRate / 44100 * 65536);
  zones.forEach((z, j) => {
    const b = 32 + j * 28;
    [z.off, z.n, z.ls, z.le, rate].forEach((x, k) => v.setUint32(b + k * 4, x >>> 0, true));
    v.setInt16(b + 20, z.root * 16, true);
    v.setInt16(b + 22, z.pred, true);
    hdr[b + 24] = z.idx; hdr[b + 25] = z.lo; hdr[b + 26] = z.hi; hdr[b + 27] = 0;
  });
  return { hdr, data, zones };
}

/* ------------------------------------------------------------------- chop --- */
/* Chopping a recording into a slot (the CHOP block of the samples tab). All at SMP.RATE, positions
   in samples. These are pure: test_web.mjs runs them. */
const CHOP = { HOP: 128, MAX: 16, FADE_IN: 22, FADE_OUT: 132, PRE: 32 };   /* 5.8 ms frames; fades 1 / 6 ms; start 1.5 ms early */

/* onset novelty per frame: the rise of the log energy of the signal's first difference (the attack
   of a hit, not its body), over the louder of the two frames before */
function chopNovelty(x) {
  const H = CHOP.HOP, F = Math.ceil(x.length / H), L = new Float64Array(F), P = new Float64Array(F), nov = new Float64Array(F);
  let top = 1e-12, ptop = 1e-12;
  for (let f = 0; f < F; f++) {
    let e = 0, p = 0;
    for (let i = f * H, n = Math.min(x.length, i + H); i < n; i++) { const d = x[i] - (i ? x[i - 1] : 0); e += d * d; p += x[i] * x[i]; }
    L[f] = e;
    P[f] = p;
    if (e > top) top = e;
    if (p > ptop) ptop = p;
  }
  for (let f = 0; f < F; f++) { L[f] = Math.log10(L[f] / top + 1e-9); P[f] = Math.log10(P[f] / ptop + 1e-9); }   /* 0 = the loudest */
  for (let f = 0; f < F; f++) {
    const before = Math.max(f ? L[f - 1] : -9, f > 1 ? L[f - 2] : -9);
    nov[f] = L[f] > -3.5 ? Math.max(0, L[f] - before) : 0;              /* (under -35 dB: no hit) */
  }
  nov.level = P;                                                         /* (log10 power, 0 = the loudest frame) */
  return nov;
}

/* the first sample of the hit in frame f: where the signal first reaches 30 % of its peak over the
   frames f-1..f+2, then PRE samples earlier (the attack is kept whole) */
function chopAttack(x, f) {
  const H = CHOP.HOP, a = Math.max(0, (f - 1) * H), b = Math.min(x.length, (f + 3) * H);
  let pk = 0;
  for (let i = a; i < b; i++) pk = Math.max(pk, Math.abs(x[i]));
  for (let i = a; i < b; i++) if (Math.abs(x[i]) >= 0.3 * pk) return Math.max(0, i - CHOP.PRE);
  return a;
}

/* hits: sens 1 (only the hardest and loudest) .. 10 (every small one); at least 60 ms apart. A hit is a
   sharp rise (nov over thr) to a level (its loudest frame within 3) over the gate */
function chopHits(x, nov, sens) {
  const k = Math.max(1, Math.min(10, sens)), thr = 0.15 + (10 - k) * 0.08, gate = -(0.5 + k * 0.35);
  const gap = Math.round(0.06 * SMP.RATE / CHOP.HOP), L = nov.level;
  const out = [];
  let last = -1e9;
  for (let f = 0; f < nov.length - 1; f++) {        /* (a hit on the very first frame counts too) */
    if (nov[f] < thr || (f && nov[f] < nov[f - 1]) || nov[f] < nov[f + 1]) continue;
    if (L && Math.max(L[f], L[Math.min(L.length - 1, f + 1)], L[Math.min(L.length - 1, f + 2)]) < gate) continue;
    if (f - last < gap) {
      if (out.length && nov[f] > nov[last]) { out[out.length - 1] = chopAttack(x, f); last = f; }
      continue;
    }
    out.push(chopAttack(x, f));
    last = f;
  }
  return out;
}

/* a tap at pos (as heard) moved to the hit it meant: the strongest attack within +-win s, if any */
function chopSnap(x, nov, pos, win = 0.05) {
  const H = CHOP.HOP, w = Math.round(win * SMP.RATE / H), c = Math.round(pos / H);
  let best = -1, bv = 0.12;
  for (let f = Math.max(1, c - w); f <= Math.min(nov.length - 1, c + w); f++) if (nov[f] > bv) { bv = nov[f]; best = f; }
  return best < 0 ? Math.max(0, Math.min(x.length - 1, Math.round(pos))) : chopAttack(x, best);
}

/* markers every `beats` beats at bpm from start to end */
function chopGrid(start, end, bpm, beats) {
  const step = SMP.RATE * 60 / bpm * beats, out = [];
  for (let p = start; p < end - step * 0.25 && out.length < 64; p += step) out.push(Math.round(p));
  return out;
}

/* n equal parts of start..end */
function chopEqual(start, end, n) {
  return Array.from({ length: n }, (_, i) => Math.round(start + (end - start) * i / n));
}

/* the chops of sorted markers: each to the next marker (the last to the end), cut at maxLen samples
   when maxLen > 0 -> [{start, end, i, off, full}] (all of them; the slot takes CHOP.MAX).
   opt[i] (optional) = {off: left out of the slot, len: its own length in samples, over maxLen};
   a chop is never longer than up to the next marker (`full`) */
function chopList(marks, total, maxLen = 0, opt = null) {
  return marks.map((m, i) => {
    const full = Math.max(m + 1, i + 1 < marks.length ? marks[i + 1] : total), o = (opt && opt[i]) || {};
    let e = full;
    if (o.len > 0) e = Math.min(e, m + o.len);
    else if (maxLen > 0) e = Math.min(e, m + maxLen);
    return { start: m, end: Math.max(m + 1, e), i, off: !!o.off, full };
  });
}

/* the chops the slot gets: mode 0 the kept ones, the first CHOP.MAX of them; mode 1 the chop `sel` */
function chopPick(chops, mode = 0, sel = 0) {
  if (mode === 1) return chops.length ? [chops[Math.max(0, Math.min(chops.length - 1, sel))]] : [];
  return chops.filter((c) => !c.off).slice(0, CHOP.MAX);
}

/* the longest common length L (samples) so the chops, each cut at L, fit in room; Infinity if they fit */
function chopFit(chops, room) {
  const len = chops.map((c) => c.end - c.start), sum = (L) => len.reduce((a, n) => a + Math.min(n, L), 0);
  if (sum(Infinity) <= room) return Infinity;
  let lo = 0, hi = Math.max(...len);
  while (lo < hi) { const L = (lo + hi + 1) >> 1; if (sum(L) <= room) lo = L; else hi = L - 1; }
  return lo;
}

/* chops -> slot zones {s (Int16Array, one gain for all: their levels are kept), root, lo, hi, fname}.
   mode 0: the kept chops (chopPick), one key each from key0 (each key plays its chop at its own speed,
   the keys between are silent); mode 1: the chop `sel` alone over the whole keyboard, at its own speed
   on key0. The file names keep the chop's own number. */
function chopZones(x, chops, key0, mode = 0, sel = 0) {
  const use = chopPick(chops, mode, sel);
  let pk = 1e-9;
  for (const c of use) for (let i = c.start; i < c.end; i++) pk = Math.max(pk, Math.abs(x[i]));
  return use.map((c, j) => {
    const n = c.end - c.start, s = new Int16Array(n), fi = Math.min(CHOP.FADE_IN, n >> 2), fo = Math.min(CHOP.FADE_OUT, n >> 2);
    for (let i = 0; i < n; i++) {
      let g = 1;
      if (i < fi) g = i / fi;
      if (i >= n - fo) g = Math.min(g, (n - i) / fo);
      s[i] = Math.max(-32768, Math.min(32767, Math.trunc(x[c.start + i] / pk * 30000 * g)));
    }
    const key = Math.min(127, key0 + (mode === 1 ? 0 : j));
    return { s, root: key, lo: mode === 1 ? 0 : key, hi: mode === 1 ? 127 : key,
      fname: `CHOP${String((c.i != null ? c.i : mode === 1 ? sel : j) + 1).padStart(2, "0")}_${NOTE_NAMES[key % 12]}${Math.floor(key / 12) - 1}.wav` };
  });
}


export { SMP, buildSlot, normalize, resample, chopNovelty, chopHits, chopEqual, chopList, chopZones };
