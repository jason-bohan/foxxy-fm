/* SPDX-License-Identifier: GPL-3.0-only */
/* spaceFoxxy: a Star-Fox-style rail shooter. Flies on any canvas; with TUNE
 * SYNC on it plays the FM-1 over Web MIDI (movement -> CCs, events -> notes)
 * so the track bends with the mission. No dependencies. */
"use strict";

/* ---------------- tuning ---------------- */
const W = 960, H = 540, CX = 480, HOR = 300, FAR = 130;
/* Z0 is the camera's near offset: the smaller it is, the harder the near field
 * rushes. At 6 a ring topped out at 51 px and could never surround the ship. */
const Z0 = 1.2, RING_R = 0.34, RING_SEG = 16, RING_GONE = -1.0;
const CYAN = "#4ee2ec", ORANGE = "#ff4500", GOLD = "#ffc618", STEEL = "#2a3b4c";
const PENTA = [72, 74, 76, 79, 81, 84, 86, 88];   /* ring chimes climb with combo */

/* world -> screen. x,y in roughly [-1.5,1.5], z 0 (camera) .. FAR */
function project(x, y, z) {
  const f = 1 / (z + Z0);
  return { x: CX + x * 900 * f, y: HOR - y * 700 * f, s: 150 * f };
}
function buildCC(cc, v) { return [0xB0, cc & 127, Math.max(0, Math.min(127, v | 0))]; }
function buildNoteOn(ch, n, v) { return [0x90 | (ch & 15), n & 127, Math.max(0, Math.min(127, v | 0))]; }
function buildNoteOff(ch, n) { return [0x80 | (ch & 15), n & 127, 0]; }

/* ---- MIDI control input: FM-1 knobs (SysEx CHANGED pushes) + any
 * controller (CC / bend / notes). CHANGED = F0 7D 46 4C 23 scope id lo hi F7,
 * v14 = (lo | hi << 7) - 8192. DESC reply carries min/max for normalizing. */
function parseChanged(bytes) {
  if (!bytes || bytes.length !== 10) return null;
  if (bytes[0] !== 0xF0 || bytes[1] !== 0x7D || bytes[2] !== 0x46 ||
      bytes[3] !== 0x4C || bytes[4] !== 23 || bytes[9] !== 0xF7) return null;
  return { scope: bytes[5], id: bytes[6], value: (bytes[7] | (bytes[8] << 7)) - 8192 };
}
function parseDesc(bytes, scope, id) {
  if (!bytes || bytes.length < 16) return null;
  if (bytes[0] !== 0xF0 || bytes[1] !== 0x7D || bytes[2] !== 0x46 ||
      bytes[3] !== 0x4C || bytes[4] !== 5 || bytes[5] !== scope || bytes[6] !== id) return null;
  const min = (bytes[8] | (bytes[9] << 7)) - 8192;
  const max = (bytes[10] | (bytes[11] << 7)) - 8192;
  let end = 14;
  while (end < bytes.length && bytes[end] !== 0) end++;
  const label = String.fromCharCode.apply(null, Array.from(bytes.slice(14, end)));
  return { scope, id, fmt: bytes[7], min, max, label };
}
function normParam(v, min, max) {
  if (!(max > min)) return 0.5;
  return Math.max(0, Math.min(1, (v - min) / (max - min)));
}
function sysMsg(cmd, args) { return [0xF0, 0x7D, 0x46, 0x4C, cmd].concat(args || [], [0xF7]); }

/* ---------------- state ---------------- */
const G = {
  running: false, over: false, paused: false,
  t: 0, score: 0, combo: 0, comboT: 0, shield: 100, speed: 62,
  shake: 0, flash: 0, msg: "", msgT: 0,
  player: { x: 0, y: -0.1, vx: 0, vy: 0, bank: 0, cool: 0 },
  stars: [], rings: [], foes: [], shots: [], parts: [], rocks: [],
  spawnR: 1.2, spawnF: 2.2, spawnK: 3.0,
  sound: true, sync: false, port: null,
  ccT: 0, lastCC: {},
  /* control bindings: FM-1 knobs (SysEx), controller CC/bend, notes, auto-fire */
  ctl: { knobX: null, knobY: null, ccX: "bend", ccY: 1, fireNote: null, boostNote: null, autoFire: false },
  ktx: { v: 0, t: -1e12 }, kty: { v: 0, t: -1e12 },
  ccx: { v: 0, t: -1e12 }, ccy: { v: 0, t: -1e12 },
  noteFire: false, boostHeld: false,
  sysExOk: false, watching: false,
};
let learnTarget = null, pendingDesc = null;
const keys = {};
let pointer = null;

function reset() {
  G.t = 0; G.score = 0; G.combo = 0; G.comboT = 0; G.shield = 100; G.speed = 62;
  G.shake = 0; G.flash = 0; G.msg = ""; G.msgT = 0; G.over = false;
  G.player = { x: 0, y: -0.1, vx: 0, vy: 0, bank: 0, cool: 0 };
  G.rings = []; G.foes = []; G.shots = []; G.parts = []; G.rocks = [];
  G.spawnR = 1.2; G.spawnF = 2.2; G.spawnK = 3.0;
  G.stars = [];
  for (let i = 0; i < 110; i++)
    G.stars.push({ x: (Math.random() * 4 - 2), y: (Math.random() * 3 - 1.5), z: Math.random() * FAR });
}

/* ---------------- audio (game SFX) ---------------- */
let AC = null, master = null;
function audio() {
  if (!AC) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; AC = new C(); master = AC.createGain(); master.gain.value = 0.5; master.connect(AC.destination); }
  if (AC.state === "suspended") AC.resume();
  return AC;
}
function tone(f0, f1, dur, type, vol, when) {
  if (!G.sound || !audio()) return;
  const t = AC.currentTime + (when || 0);
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol, fc, when) {
  if (!G.sound || !audio()) return;
  const t = AC.currentTime + (when || 0);
  const len = Math.max(1, (dur * AC.sampleRate) | 0);
  const buf = AC.createBuffer(1, len, AC.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = AC.createBufferSource(); src.buffer = buf;
  const fl = AC.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = fc;
  const g = AC.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(fl); fl.connect(g); g.connect(master); src.start(t);
}
const sfx = {
  zap() { tone(920, 180, 0.12, "square", 0.16); },
  boom() { noise(0.45, 0.5, 900); tone(160, 40, 0.4, "sawtooth", 0.25); },
  chime(n) { const f = 440 * Math.pow(2, (PENTA[n % PENTA.length] - 69) / 12); tone(f, f, 0.18, "sine", 0.22); tone(f * 2, f * 2, 0.12, "sine", 0.1, 0.05); },
  hit() { noise(0.3, 0.5, 500); tone(110, 45, 0.3, "sawtooth", 0.3); },
  ring() { tone(660, 1320, 0.15, "sine", 0.2); },
};

/* ---------------- MIDI tune sync ---------------- */
function midiSend(bytes) { try { if (G.sync && G.port) G.port.send(bytes); } catch (e) { /* unplugged */ } }
function cc(cc, v) {
  v = Math.max(0, Math.min(127, v | 0));
  const k = "c" + cc;
  if (G.lastCC[k] === v) return;
  G.lastCC[k] = v;
  midiSend(buildCC(cc, v));
}
function pluck(ch, n, v, dur) {
  midiSend(buildNoteOn(ch, n, v));
  setTimeout(() => midiSend(buildNoteOff(ch, n)), dur || 140);
}
const sync = {
  move() {  /* steering bends the track: X -> pan, Y -> filter, boost -> resonance */
    cc(10, 64 + G.player.x * 60);
    cc(74, 64 + G.player.y * 60);
    cc(71, 20 + (G.speed - 62) * 2.2);
  },
  laser() { pluck(9, 40, 90, 90); },
  ring() {
    pluck(0, PENTA[G.combo % PENTA.length] + 12, 100, 300);
    midiSend(buildCC(94, 110));
    setTimeout(() => G.sync && midiSend(buildCC(94, 40)), 260);
  },
  kill() { pluck(9, 36, 115, 200); },
  crash() {
    midiSend(buildCC(7, 45));
    pluck(9, 37, 110, 160);
    setTimeout(() => G.sync && midiSend(buildCC(7, 100)), 380);
  },
  over() { for (const ch of [0, 9]) midiSend([0xB0 | ch, 123, 0]); },
};

/* ---------------- control bindings ---------------- */
const CTL_KEY = "spacefoxxy-controls-v1";
function saveCtl() {
  try { localStorage.setItem(CTL_KEY, JSON.stringify(G.ctl)); } catch (e) { /* private mode */ }
}
function loadCtl() {
  try {
    const s = JSON.parse(localStorage.getItem(CTL_KEY));
    if (s && typeof s === "object") G.ctl = Object.assign(G.ctl, s);
  } catch (e) { /* fresh defaults */ }
}
function bindLabel(b, kind) {
  if (!b) return "—";
  if (kind === "cc") return b === "bend" ? "bend" : "CC " + b;
  if (kind === "note") return "NOTE " + b;
  return "knob " + (b.label || (b.scope + ":" + b.id));
}
function refreshBinds() {
  if (typeof document === "undefined" || !document.getElementById) return;
  const set = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
  set("bindKX", bindLabel(G.ctl.knobX));
  set("bindKY", bindLabel(G.ctl.knobY));
  set("bindCX", bindLabel(G.ctl.ccX, "cc"));
  set("bindCY", bindLabel(G.ctl.ccY, "cc"));
  set("bindFire", bindLabel(G.ctl.fireNote, "note"));
  set("bindBoost", bindLabel(G.ctl.boostNote, "note"));
  const ab = document.getElementById("autoBtn");
  if (ab) { ab.textContent = G.ctl.autoFire ? "AUTO-FIRE ON" : "AUTO-FIRE OFF"; ab.classList.toggle("on", G.ctl.autoFire); }
}
function setLearn(t, btn) {
  learnTarget = (learnTarget === t) ? null : t;
  if (typeof document === "undefined" || !document.getElementById) return;
  for (const id of ["learnKX", "learnKY", "learnCX", "learnCY", "learnFire", "learnBoost"]) {
    const el = document.getElementById(id);
    if (el) el.classList.remove("learn");
  }
  if (learnTarget && btn) btn.classList.add("learn");
  if (learnTarget === "knobX" || learnTarget === "knobY") setState("Turn a knob on the FM-1…");
}
function routeMidiInput(data) {
  const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
  const st = data[0] & 0xF0;
  if (data[0] === 0xF0) {  /* SysEx: knob pushes + DESC replies */
    if (learnTarget === "knobX" || learnTarget === "knobY") {
      const m = parseChanged(data);
      if (!m) return;
      const slot = learnTarget === "knobX" ? "knobX" : "knobY";
      G.ctl[slot] = { scope: m.scope, id: m.id, min: 0, max: 1, label: "" };
      pendingDesc = { slot, scope: m.scope, id: m.id };
      knobSend(sysMsg(5, [m.scope, m.id]));  /* DESC for min/max */
      refreshBinds(); saveCtl();
      return;
    }
    if (data.length >= 10 && data[4] === 5 && pendingDesc) {
      const d = parseDesc(data, pendingDesc.scope, pendingDesc.id);
      if (d) {
        const b = G.ctl[pendingDesc.slot];
        if (b) { b.min = d.min; b.max = d.max; b.label = d.label; }
        pendingDesc = null;
        refreshBinds(); saveCtl();
      }
      return;
    }
    const m = parseChanged(data);  /* live knob steering */
    if (!m) return;
    for (const pair of [["knobX", "ktx"], ["knobY", "kty"]]) {
      const b = G.ctl[pair[0]];
      if (b && b.scope === m.scope && b.id === m.id) {
        const tgt = G[pair[1]];
        tgt.v = normParam(m.value, b.min, b.max) * 2 - 1;
        tgt.t = now;
      }
    }
    return;
  }
  if (st === 0x90 && data[2] > 0) {  /* note on */
    const n = data[1];
    if (learnTarget === "fire") { G.ctl.fireNote = n; setLearn(null); refreshBinds(); saveCtl(); return; }
    if (learnTarget === "boost") { G.ctl.boostNote = n; setLearn(null); refreshBinds(); saveCtl(); return; }
    if (n === G.ctl.fireNote) G.noteFire = true;
    if (n === G.ctl.boostNote) G.boostHeld = true;
    return;
  }
  if (st === 0x80 || (st === 0x90 && data[2] === 0)) {  /* note off */
    if (data[1] === G.ctl.boostNote) G.boostHeld = false;
    return;
  }
  if (st === 0xB0) {  /* CC */
    const num = data[1], val = data[2] / 63.5 - 1;
    if (learnTarget === "ccX") { G.ctl.ccX = num; setLearn(null); refreshBinds(); saveCtl(); return; }
    if (learnTarget === "ccY") { G.ctl.ccY = num; setLearn(null); refreshBinds(); saveCtl(); return; }
    if (num === G.ctl.ccX && typeof G.ctl.ccX === "number") { G.ccx.v = val; G.ccx.t = now; }
    if (num === G.ctl.ccY && typeof G.ctl.ccY === "number") { G.ccy.v = val; G.ccy.t = now; }
    return;
  }
  if ((data[0] & 0xF0) === 0xE0) {  /* pitch bend: default steer X */
    const v = ((data[1] | (data[2] << 7)) - 8192) / 8192;
    if (learnTarget === "ccX") { G.ctl.ccX = "bend"; setLearn(null); refreshBinds(); saveCtl(); return; }
    if (G.ctl.ccX === "bend") { G.ccx.v = Math.max(-1, Math.min(1, v)); G.ccx.t = now; }
  }
}

/* ---------------- spawning ---------------- */
function spawnRing() {
  G.rings.push({ x: Math.random() * 1.8 - 0.9, y: Math.random() * 1.1 - 0.25, z: FAR, got: false,
    rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 1.1 });
}
function spawnFoe() {
  const weaver = Math.random() < 0.4;
  G.foes.push({ x: Math.random() * 2 - 1, y: Math.random() * 1.2 - 0.3, z: FAR, wv: weaver, ph: Math.random() * 6.28, sp: weaver ? 26 : 34 });
}
function spawnRock() {
  G.rocks.push({ x: Math.random() * 2.4 - 1.2, y: Math.random() * 1.4 - 0.5, z: FAR, r: 0.22 + Math.random() * 0.25, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 2 });
}
function burst(x, y, n, colors, spd) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.28, v = (0.3 + Math.random() * 0.7) * (spd || 260);
    G.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.5, t: 0, c: colors[(Math.random() * colors.length) | 0], s: 2 + Math.random() * 3 });
  }
}

/* ---------------- update ---------------- */
function fire() {
  const p = G.player;
  if (p.cool > 0 || G.over) return;
  p.cool = 0.16;
  G.shots.push({ x: p.x - 0.09, y: p.y + 0.02, z: 3 }, { x: p.x + 0.09, y: p.y + 0.02, z: 3 });
  sfx.zap(); sync.laser();
}
function damage(n, sx, sy) {
  G.shield = Math.max(0, G.shield - n);
  G.shake = 10; G.flash = 0.5;
  burst(sx, sy, 26, [ORANGE, "#ffd23f", "#888"], 320);
  sfx.hit(); sync.crash();
  if (G.shield <= 0 && !G.over) {
    G.over = true; sync.over();
    burst(sx, sy, 80, [ORANGE, GOLD, CYAN, "#fff"], 420);
    sfx.boom();
    showOver();
  }
}
function update(dt) {
  G.t += dt;
  const p = G.player;
  /* steering: keys + pointer */
  let ix = 0, iy = 0;
  if (keys.ArrowLeft || keys.a) ix -= 1;
  if (keys.ArrowRight || keys.d) ix += 1;
  if (keys.ArrowUp || keys.w) iy += 1;
  if (keys.ArrowDown || keys.s) iy -= 1;
  if (pointer) { ix = (pointer.x - CX) / 300; iy = -(pointer.y - 400) / 160; }
  /* absolute sources (knobs, controller) ease toward their targets while fresh;
   * keyboard velocity always adds on top, so methods compose instead of fighting */
  const nowMs = (typeof performance !== "undefined" ? performance.now() : 0);
  const kEase = Math.min(1, dt * 10);
  if (G.ctl.knobX && nowMs - G.ktx.t < 2000) p.x += (G.ktx.v * 1.35 - p.x) * kEase;
  else if (nowMs - G.ccx.t < 800) p.x += (G.ccx.v * 1.35 - p.x) * kEase;
  if (G.ctl.knobY && nowMs - G.kty.t < 2000) p.y += (G.kty.v * 0.95 - p.y) * kEase;
  else if (nowMs - G.ccy.t < 800) p.y += (G.ccy.v * 0.95 - p.y) * kEase;
  const boosting = !!(keys.Shift || G.boostHeld);
  p.vx = p.vx * 0.86 + ix * 3.4 * 0.14 * 3;
  p.vy = p.vy * 0.86 + iy * 2.6 * 0.14 * 3;
  p.x = Math.max(-1.35, Math.min(1.35, p.x + p.vx * dt));
  p.y = Math.max(-0.95, Math.min(0.95, p.y + p.vy * dt));
  p.bank = p.bank * 0.85 + Math.max(-1, Math.min(1, p.vx * 0.35)) * 0.15 * 3;
  p.bank = Math.max(-1, Math.min(1, p.bank));
  p.cool -= dt;
  const target = boosting ? 105 : 62;
  G.speed += (target - G.speed) * Math.min(1, dt * 1.6);
  if ((keys[" "] || G.mouseFire || G.noteFire || G.ctl.autoFire) && !G.over) fire();
  G.mouseFire = false; G.noteFire = false;

  /* difficulty ramp */
  const hard = Math.min(1, G.t / 90);
  G.spawnR -= dt; if (G.spawnR <= 0) { spawnRing(); G.spawnR = 2.6 - hard * 1.2; }
  G.spawnF -= dt; if (G.spawnF <= 0) { spawnFoe(); G.spawnF = 2.4 - hard * 1.3; }
  G.spawnK -= dt; if (G.spawnK <= 0) { spawnRock(); G.spawnK = 3.2 - hard * 1.4; }
  if (G.comboT > 0) { G.comboT -= dt; if (G.comboT <= 0) G.combo = 0; }

  /* entities drift closer */
  const dz = G.speed * dt;
  for (const s of G.stars) { s.z -= dz * 1.4; if (s.z < 1) { s.z = FAR; s.x = Math.random() * 4 - 2; s.y = Math.random() * 3 - 1.5; } }
  for (const r of G.rings) { r.z -= dz; r.rot += r.vr * dt; }
  for (const f of G.foes) { f.z -= f.sp * dt; if (f.wv) f.x += Math.sin(G.t * 3 + f.ph) * dt * 0.9; }
  for (const k of G.rocks) { k.z -= dz * 0.85; k.rot += k.vr * dt; }
  for (const s of G.shots) s.z += 170 * dt;
  for (const q of G.parts) { q.t += dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.96; q.vy *= 0.96; }
  G.parts = G.parts.filter(q => q.t < q.life);
  G.shots = G.shots.filter(s => s.z < FAR);
  G.shake *= Math.pow(0.02, dt); if (G.shake < 0.2) G.shake = 0;
  G.flash = Math.max(0, G.flash - dt * 1.4);
  if (G.msgT > 0) { G.msgT -= dt; if (G.msgT <= 0) G.msg = ""; }

  /* ring pass */
  for (const r of G.rings) {
    if (!r.got && r.z < 0.8) {
      r.got = true;
      const d = Math.hypot(r.x - p.x, r.y - p.y);
      if (d < 0.34) {
        G.combo++; G.comboT = 4;
        const pts = 100 + G.combo * 50;
        G.score += pts;
        G.msg = "RING +" + pts; G.msgT = 1.2;
        const pr = project(r.x, r.y, 0.8);
        burst(pr.x, pr.y, 22, [GOLD, "#fff2b0", CYAN], 240);
        sfx.ring(); sfx.chime(G.combo); sync.ring();
      }
    }
  }
  G.rings = G.rings.filter(r => r.z > RING_GONE);   /* keep it alive past the camera */

  /* lasers vs foes + rocks */
  for (const s of G.shots) {
    const sp = project(s.x, s.y, s.z);
    for (const f of G.foes) {
      if (f.dead) continue;
      const fp = project(f.x, f.y, f.z);
      const rr = 26 * fp.s + 8;
      if (Math.hypot(sp.x - fp.x, sp.y - fp.y) < rr) {
        f.dead = true; s.z = FAR + 1;
        G.score += 150; G.combo++; G.comboT = 4;
        burst(fp.x, fp.y, 30, [ORANGE, "#ffd23f", "#999"], 300);
        sfx.boom(); sync.kill();
        break;
      }
    }
    for (const k of G.rocks) {
      if (k.dead) continue;
      const kp = project(k.x, k.y, k.z);
      if (Math.hypot(sp.x - kp.x, sp.y - kp.y) < 30 * kp.s + 8) {
        k.dead = true; s.z = FAR + 1;
        G.score += 50;
        burst(kp.x, kp.y, 18, ["#999", "#555", ORANGE], 240);
        sfx.boom(); sync.kill();
        break;
      }
    }
  }
  G.foes = G.foes.filter(f => !f.dead && f.z > 0.5);
  G.rocks = G.rocks.filter(k => !k.dead && k.z > 0.5);

  /* rams: foe or rock reaches the ship */
  const px = p.x, py = p.y;
  for (const f of G.foes) {
    if (f.z < 5 && Math.hypot(f.x - px, f.y - py) < 0.42) {
      f.z = -10;
      const fp = project(f.x, f.y, 4);
      damage(22, fp.x, fp.y);
      G.msg = "HIT!"; G.msgT = 1;
    }
  }
  for (const k of G.rocks) {
    if (k.z < 5 && Math.hypot(k.x - px, k.y - py) < 0.4 + k.r * 0.4) {
      k.z = -10;
      damage(30, CX + px * 300, 430 - py * 140);
      G.msg = "CRASH!"; G.msgT = 1.2;
    }
  }
  G.foes = G.foes.filter(f => f.z > 0.5);
  G.rocks = G.rocks.filter(k => k.z > 0.5);

  /* continuous tune sync, throttled */
  G.ccT -= dt;
  if (G.sync && G.port && G.ccT <= 0) { G.ccT = 0.08; sync.move(); }
}

/* ---------------- drawing ---------------- */
let ctx = null;
function poly(pts, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
}
function drawShip(sx, sy, bank) {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(bank * 0.28);
  const S = 1 + Math.abs(bank) * 0.1;
  ctx.scale(S, S);
  /* wings */
  poly([[-8, 2], [-52, 14 + bank * 10], [-56, 22 + bank * 10], [-10, 12]], "#5a626e", "#222");
  poly([[8, 2], [52, 14 - bank * 10], [56, 22 - bank * 10], [10, 12]], "#5a626e", "#222");
  /* wing-tip laser cannons */
  ctx.fillStyle = ORANGE;
  ctx.fillRect(-60, 16 + bank * 10, 10, 5);
  ctx.fillRect(50, 16 - bank * 10, 10, 5);
  /* fuselage */
  poly([[0, -26], [9, -6], [9, 16], [0, 22], [-9, 16], [-9, -6]], "#8b93a1", "#222");
  /* cockpit */
  ctx.fillStyle = CYAN;
  ctx.beginPath(); ctx.ellipse(0, -6, 4.5, 9, 0, 0, 6.29); ctx.fill();
  /* engine glow */
  const fl = 6 + Math.random() * 5;
  poly([[-6, 22], [6, 22], [0, 22 + fl + 8]], ORANGE);
  ctx.restore();
}
function drawFoe(f) {
  const p = project(f.x, f.y, f.z);
  const s = p.s * 1.4;
  if (s < 2) return;
  const w = 16 * s, h = 10 * s;
  ctx.save(); ctx.translate(p.x, p.y);
  if (f.wv) ctx.rotate(Math.sin(G.t * 3 + f.ph) * 0.3);
  poly([[-w, 0], [-w * 0.3, -h * 0.5], [0, 0]], "#4a4f58", "#111");
  poly([[w, 0], [w * 0.3, -h * 0.5], [0, 0]], "#4a4f58", "#111");
  poly([[0, -h * 1.1], [w * 0.35, 0], [0, h * 0.7], [-w * 0.35, 0]], "#777d89", "#111");
  ctx.fillStyle = "#ff2222";
  ctx.beginPath(); ctx.arc(0, -h * 0.3, Math.max(1.5, 3 * s), 0, 6.29); ctx.fill();
  ctx.restore();
}
function drawRock(k) {
  const p = project(k.x, k.y, k.z);
  const r = k.r * p.s * 60;
  if (r < 2) return;
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(k.rot);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * 6.283, rr = r * (0.75 + ((i * 37) % 10) / 32);
    const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = "#4c443c"; ctx.fill();
  ctx.strokeStyle = "#8a7f70"; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
}
/* the ring's rim, as world points on a circle at its depth, each projected on its
 * own: an ellipse drawn flat to the camera can only ever be a hoop pasted on the
 * screen, while real vertices keep their perspective as the ring sweeps past. */
function ringRim(r, rad) {
  const pts = [];
  for (let i = 0; i < RING_SEG; i++) {
    const a = r.rot + i * 6.2832 / RING_SEG;
    pts.push(project(r.x + Math.cos(a) * rad, r.y + Math.sin(a) * rad, r.z));
  }
  return pts;
}
function drawRing(r) {
  const out = ringRim(r, RING_R), inn = ringRim(r, RING_R * 0.68);
  const span = Math.abs(out[0].x - out[RING_SEG >> 1].x);
  if (span < 3) return;                        /* still a speck on the horizon */
  const near = Math.max(0, Math.min(1, 1 - r.z / 40));
  /* one quad a segment, lit down the upper left, so the facets read as metal */
  for (let i = 0; i < RING_SEG; i++) {
    const j = (i + 1) % RING_SEG;
    const a = r.rot + i * 6.2832 / RING_SEG;
    const lit = 0.45 + 0.55 * Math.max(0, Math.cos(a - 2.2));
    const g = Math.round((r.got ? 70 : 150) * lit + 70 * lit * near);
    ctx.fillStyle = `rgb(${g},${Math.round(g * 0.76)},${Math.round(g * 0.1)})`;
    ctx.beginPath();
    ctx.moveTo(out[i].x, out[i].y); ctx.lineTo(out[j].x, out[j].y);
    ctx.lineTo(inn[j].x, inn[j].y); ctx.lineTo(inn[i].x, inn[i].y);
    ctx.closePath(); ctx.fill();
  }
  ctx.strokeStyle = r.got ? "rgba(90,77,0,0.9)" : GOLD;
  ctx.lineWidth = Math.max(1, 1 + 3 * near);
  ctx.beginPath();
  for (let i = 0; i < RING_SEG; i++) i ? ctx.lineTo(out[i].x, out[i].y) : ctx.moveTo(out[0].x, out[0].y);
  ctx.closePath(); ctx.stroke();
}
function render() {
  ctx.save();
  if (G.shake > 0) ctx.translate((Math.random() - 0.5) * G.shake, (Math.random() - 0.5) * G.shake);
  /* space */
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#02030a"); bg.addColorStop(0.55, "#000"); bg.addColorStop(1, "#050208");
  ctx.fillStyle = bg; ctx.fillRect(-20, -20, W + 40, H + 40);
  /* planet */
  ctx.fillStyle = "#12324a";
  ctx.beginPath(); ctx.arc(760, 110, 95, 0, 6.29); ctx.fill();
  ctx.fillStyle = "#1b4a6b";
  ctx.fillRect(665, 95, 190, 12); ctx.fillRect(665, 125, 190, 7);
  ctx.strokeStyle = STEEL; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(760, 110, 95, 0, 6.29); ctx.stroke();
  /* stars */
  for (const s of G.stars) {
    const p = project(s.x, s.y, s.z);
    if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) continue;
    const b = 1 - s.z / FAR;
    ctx.fillStyle = "rgba(200,230,255," + (0.25 + b * 0.75).toFixed(2) + ")";
    const sz = b > 0.85 ? 2.5 : 1.5;
    ctx.fillRect(p.x, p.y, sz, sz + b * 6);
  }
  /* horizon glow */
  ctx.strokeStyle = "rgba(78,226,236,0.25)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, HOR); ctx.lineTo(W, HOR); ctx.stroke();

  for (const r of G.rings) drawRing(r);
  for (const k of G.rocks) drawRock(k);
  for (const f of G.foes) drawFoe(f);
  /* player lasers */
  ctx.strokeStyle = CYAN; ctx.lineWidth = 4; ctx.lineCap = "round";
  for (const s of G.shots) {
    const a = project(s.x, s.y, s.z), b = project(s.x, s.y, Math.max(0, s.z - 7));
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  /* particles */
  for (const q of G.parts) {
    ctx.globalAlpha = Math.max(0, 1 - q.t / q.life);
    ctx.fillStyle = q.c;
    ctx.fillRect(q.x, q.y, q.s, q.s);
  }
  ctx.globalAlpha = 1;
  /* ship */
  if (!G.over) drawShip(CX + G.player.x * 300, 430 - G.player.y * 140, G.player.bank);

  /* HUD */
  ctx.fillStyle = CYAN;
  ctx.font = "bold 20px monospace"; ctx.textAlign = "left";
  ctx.fillText("SCORE " + G.score, 16, 30);
  if (G.combo > 1) { ctx.fillStyle = GOLD; ctx.fillText("COMBO x" + G.combo, 16, 56); }
  ctx.fillStyle = CYAN; ctx.textAlign = "right";
  ctx.fillText("SPEED " + (G.speed | 0), W - 16, 30);
  ctx.fillText("SHIELD", W - 16, 56);
  const sw = 160, shc = G.shield > 50 ? "#1ecc70" : G.shield > 25 ? GOLD : ORANGE;
  ctx.fillStyle = "#222"; ctx.fillRect(W - 16 - sw, 64, sw, 10);
  ctx.fillStyle = shc; ctx.fillRect(W - 16 - sw, 64, sw * G.shield / 100, 10);
  if (G.sync && G.port) { ctx.fillStyle = GOLD; ctx.textAlign = "left"; ctx.fillText("TUNE SYNC", 16, H - 16); }
  if (G.msg) {
    ctx.fillStyle = GOLD; ctx.textAlign = "center"; ctx.font = "bold 26px monospace";
    ctx.fillText(G.msg, CX, 120);
  }
  if (G.paused) {
    ctx.fillStyle = CYAN; ctx.textAlign = "center"; ctx.font = "bold 34px monospace";
    ctx.fillText("PAUSED", CX, H / 2);
  }
  /* damage vignette */
  if (G.flash > 0) {
    ctx.strokeStyle = "rgba(255,69,0," + G.flash.toFixed(2) + ")";
    ctx.lineWidth = 26; ctx.strokeRect(0, 0, W, H);
  }
  ctx.restore();
}

/* ---------------- main loop ---------------- */
let last = 0;
function frame(ts) {
  if (!G.running) return;
  const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
  last = ts;
  if (!G.paused && !G.over) update(dt);
  else if (!G.paused && G.over) { updatePartsOnly(dt); }
  render();
  requestAnimationFrame(frame);
}
function updatePartsOnly(dt) {
  for (const q of G.parts) { q.t += dt; q.x += q.vx * dt; q.y += q.vy * dt; }
  G.parts = G.parts.filter(q => q.t < q.life);
  G.shake *= Math.pow(0.02, dt);
  G.flash = Math.max(0, G.flash - dt * 1.4);
}
function showOver() {
  setTimeout(() => {
    if (!G.over) return;
    document.getElementById("overTitle").textContent = "SHIP DOWN";
    document.getElementById("overScore").textContent =
      "Score " + G.score + " · rings speak in chimes, lasers in drums. Tune sync stays live — fly again.";
    document.getElementById("overOv").hidden = false;
  }, 1200);
}

/* ---------------- DOM wiring ---------------- */
function init() {
  const cv = document.getElementById("game");
  ctx = cv.getContext("2d");
  reset();
  render();

  window.addEventListener("keydown", e => {
    keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = true;
    if (e.key === " ") e.preventDefault();
    if ((e.key === "p" || e.key === "P") && G.running && !G.over) G.paused = !G.paused;
  });
  window.addEventListener("keyup", e => { keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false; });
  cv.addEventListener("pointermove", e => {
    const r = cv.getBoundingClientRect();
    pointer = { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
    G.ktx.t = G.kty.t = G.ccx.t = G.ccy.t = -1e12;  /* hands on: release knob/CC hold */
  });
  cv.addEventListener("pointerleave", () => { pointer = null; });
  cv.addEventListener("pointerdown", e => {
    if (!G.running || G.over || G.paused) return;
    const r = cv.getBoundingClientRect();
    pointer = { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
    G.mouseFire = true;
  });

  document.getElementById("startBtn").addEventListener("click", () => {
    audio();
    document.getElementById("startOv").hidden = true;
    document.getElementById("overOv").hidden = true;
    reset(); G.running = true; G.paused = false; last = performance.now();
    requestAnimationFrame(frame);
  });
  document.getElementById("againBtn").addEventListener("click", () => {
    document.getElementById("overOv").hidden = true;
    reset(); G.running = true; G.paused = false; last = performance.now();
    requestAnimationFrame(frame);
  });
  document.getElementById("soundBtn").addEventListener("click", e => {
    G.sound = !G.sound;
    e.target.textContent = G.sound ? "SOUND ON" : "SOUND OFF";
    e.target.classList.toggle("on", G.sound);
  });
  document.getElementById("syncBtn").addEventListener("click", e => {
    G.sync = !G.sync;
    e.target.textContent = G.sync ? "TUNE SYNC ON" : "TUNE SYNC OFF";
    e.target.classList.toggle("on", G.sync);
    setState(G.sync ? (G.port ? "Syncing the FM-1: fly and listen." : "No FM-1 port: CONNECT first.") : "FM-1 not connected: game sounds only.");
  });
  document.getElementById("midiBtn").addEventListener("click", connectMidi);
  document.getElementById("helpBtn").addEventListener("click", () => { document.getElementById("helpOv").hidden = false; });
  document.getElementById("helpClose").addEventListener("click", () => { document.getElementById("helpOv").hidden = true; });
  loadCtl(); refreshBinds(); updateKnobButtons();
  document.getElementById("autoBtn").addEventListener("click", () => {
    G.ctl.autoFire = !G.ctl.autoFire; refreshBinds(); saveCtl();
  });
  const learn = (id, t) => document.getElementById(id).addEventListener("click", (e) => setLearn(t, e.target));
  learn("learnKX", "knobX"); learn("learnKY", "knobY");
  learn("learnCX", "ccX"); learn("learnCY", "ccY");
  learn("learnFire", "fire"); learn("learnBoost", "boost");
  document.getElementById("ctrlReset").addEventListener("click", () => {
    G.ctl = { knobX: null, knobY: null, ccX: "bend", ccY: 1, fireNote: null, boostNote: null, autoFire: false };
    setLearn(null); refreshBinds(); saveCtl();
  });
}

function setState(t) { document.getElementById("midiState").textContent = t; }

/* knob pushes bypass the tune-sync gate: watching works with sync off */
function knobSend(bytes) { try { if (G.port) G.port.send(bytes); } catch (e) { /* unplugged */ } }

let midiAcc = null, midiInPort = null, pingTimer = null;
function updateKnobButtons() {
  const ok = G.sysExOk && !!G.port;
  for (const id of ["learnKX", "learnKY"]) {
    const el = document.getElementById(id);
    if (el) { el.disabled = !ok; if (!ok) el.title = "CONNECT the FM-1 first (needs SysEx)"; else el.title = ""; }
  }
  if (!ok) setLearn(null);
}
function startWatch() {
  if (!G.sysExOk || !G.port || G.watching) return;
  knobSend(sysMsg(22, [1]));
  G.watching = true;
  if (!pingTimer) pingTimer = setInterval(() => { if (G.watching && G.port) knobSend(sysMsg(25, [])); }, 1000);
}
function fillPorts(sel, ports, guessRe) {
  sel.replaceChildren();
  for (const p of ports) {
    const el = document.createElement("option");
    el.value = p.id; el.textContent = p.name || p.id;
    sel.appendChild(el);
  }
  const guess = ports.find(p => guessRe.test(p.name || ""));
  if (guess) sel.value = guess.id;
  else if (ports.length) sel.value = ports[0].id;
}
async function connectMidi() {
  if (!navigator.requestMIDIAccess) { setState("Web MIDI needs Chrome or Edge on localhost / HTTPS."); return; }
  try {
    try { midiAcc = await navigator.requestMIDIAccess({ sysex: true }); G.sysExOk = true; }
    catch (e) { midiAcc = await navigator.requestMIDIAccess(); G.sysExOk = false; }
    const outs = [...midiAcc.outputs.values()];
    const ins = [...midiAcc.inputs.values()];
    if (!outs.length && !ins.length) { setState("No MIDI ports found."); return; }
    const sel = document.getElementById("midiOut"), selIn = document.getElementById("midiIn");
    fillPorts(sel, outs, /fm-1|felucca|foxxy/i);
    fillPorts(selIn, ins, /fm-1|felucca|foxxy/i);
    pickPort(sel.value);
    pickInput(selIn.value);
    sel.onchange = () => pickPort(sel.value);
    selIn.onchange = () => pickInput(selIn.value);
    if (!G.sysExOk) setState("SysEx blocked: notes/CCs work, FM-1 knobs need SysEx allowed.");
  } catch (e) { setState("MIDI blocked: allow access and retry."); }
}
function pickPort(id) {
  G.port = (midiAcc && midiAcc.outputs.get(id)) || null;
  G.lastCC = {};
  updateKnobButtons();
  startWatch();
  if (G.sysExOk) setState(G.port ? ("FM-1 on: " + (G.port.name || id) + ". Press TUNE SYNC.") : "Port lost.");
}
function pickInput(id) {
  if (midiInPort) midiInPort.onmidimessage = null;
  midiInPort = (midiAcc && midiAcc.inputs.get(id)) || null;
  if (midiInPort) midiInPort.onmidimessage = (e) => routeMidiInput(e.data);
}

if (typeof window !== "undefined" && typeof document !== "undefined" && document.getElementById) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}
/* node smoke-test surface */
if (typeof module !== "undefined") module.exports = { project, buildCC, buildNoteOn, buildNoteOff, PENTA, parseChanged, parseDesc, normParam,
  Z0, RING_R, RING_SEG, RING_GONE };
