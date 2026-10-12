// SPDX-License-Identifier: GPL-3.0-only
// spaceFoxx smoke tests: projection math, MIDI byte builders, page wiring.
import assert from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";

// the game is a classic browser script (type:module would break <script src>),
// so load it in a bare context with a fake module object
const src = readFileSync(new URL("./spacefoxx-game.js", import.meta.url), "utf8");
const module = { exports: {} };
new vm.Script(src, { filename: "spacefoxx-game.js" }).runInNewContext({ module, console });
const game = module.exports;
assert.equal(typeof game.project, "function", "game surface loads");

// projection: nearer = bigger and further from center
const near = game.project(0.5, 0.2, 2);
const far = game.project(0.5, 0.2, 100);
assert.ok(near.s > far.s, "near scale exceeds far scale");
assert.ok(Math.abs(near.x - 480) > Math.abs(far.x - 480), "near spreads wider");
assert.ok(near.y < 300 && far.y <= 300, "up is above the horizon");

// MIDI builders: status bytes, 7-bit clamping
assert.deepEqual(game.buildCC(10, 64), [0xB0, 10, 64]);
assert.deepEqual(game.buildCC(74, 999), [0xB0, 74, 127]);
assert.deepEqual(game.buildNoteOn(9, 40, 90), [0x99, 40, 90]);
assert.deepEqual(game.buildNoteOff(0, 72), [0x80, 72, 0]);
assert.ok(game.PENTA.length >= 6, "ring chime ladder");

// page wires every control the script expects
const html = readFileSync(new URL("./spacefoxx.html", import.meta.url), "utf8");
for (const id of ["game", "soundBtn", "syncBtn", "midiOut", "midiIn", "midiBtn", "helpBtn",
  "helpClose", "startBtn", "againBtn", "startOv", "overOv", "helpOv",
  "overTitle", "overScore", "midiState", "controls", "autoBtn",
  "learnKX", "learnKY", "learnCX", "learnCY", "learnFire", "learnBoost", "ctrlReset",
  "bindKX", "bindKY", "bindCX", "bindCY", "bindFire", "bindBoost",
  "spacefoxx-game.js"]) {
  assert.ok(html.includes(id), `spacefoxx.html wires #${id}`);
}

// knob SysEx: CHANGED parses, DESC parses with min/max/label, normalization clamps
const chg = game.parseChanged([0xF0, 0x7D, 0x46, 0x4C, 23, 0, 12, 0x00, 0x40, 0xF7]);
assert.deepEqual(chg, { scope: 0, id: 12, value: 0 });
assert.equal(game.parseChanged([0xF0, 0x7D, 0x46, 0x4C, 23, 0, 12, 0x00, 0x40]), null);
assert.equal(game.parseChanged([0x90, 40, 90]), null);
const desc = game.parseDesc([0xF0, 0x7D, 0x46, 0x4C, 5, 0, 12, 1, 0, 64, 100, 64, 0, 64,
  84, 69, 77, 80, 79, 0, 117, 0, 0xF7], 0, 12);
assert.equal(desc.min, 0);
assert.equal(desc.max, 100);
assert.equal(desc.label, "TEMPO");
assert.equal(game.parseDesc([0xF0, 0x7D, 0x46, 0x4C, 5, 0, 13, 1, 0, 64, 100, 64, 0, 64,
  84, 69, 77, 80, 79, 0, 117, 0, 0xF7], 0, 12), null);
assert.equal(game.normParam(50, 0, 100), 0.5);
assert.equal(game.normParam(-5, 0, 100), 0);
assert.equal(game.normParam(500, 0, 100), 1);
assert.equal(game.normParam(5, 5, 5), 0.5);
assert.ok(existsSync(new URL("./spacefoxx-game.js", import.meta.url)), "game script ships");
console.log("spaceFoxx: projection, MIDI builders, page wiring PASS");
