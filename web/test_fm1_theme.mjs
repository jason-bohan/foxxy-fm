// SPDX-License-Identifier: GPL-3.0-only
// fm1-theme: finish vars apply, backdrop image loads/clears (stub DOM).
import assert from "node:assert";
import { setupFinish, bgFitSize } from "./fm1-theme.js";

assert.deepEqual(bgFitSize(3200, 200, 1600), [1600, 100]);
assert.deepEqual(bgFitSize(800, 600, 1600), [800, 600]);
assert.deepEqual(bgFitSize(100, 4000, 1600), [40, 1600]);

function stubEl() {
  return {
    textContent: "", hidden: false, value: "", dataset: {},
    style: {}, listeners: {},
    classList: { add() {}, toggle() {}, contains: () => false },
    setAttribute() {}, append() {},
    addEventListener(t, f) { (this.listeners[t] ??= []).push(f); },
  };
}
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = { dispatchEvent() {} };

function run() {
  const subs = {};
  const panel = {
    setAttribute() {},
    querySelector: (s) => (subs[s] ??= stubEl()),
    querySelectorAll: () => [],
  };
  globalThis.document = { createElement: (tag) => (tag === "section" ? panel : stubEl()) };
  const style = { props: {}, setProperty(k, v) { this.props[k] = v; } };
  const stage = { style, querySelector: () => ({ before() {} }) };
  setupFinish(stage);
  return { subs, style };
}

store.set("foxxy-fm-bgimage-v1", "data:image/png;base64,iVBORw0KGgo=");
let r = run();
assert.ok(r.style.backgroundImage.startsWith('url("data:image'), "saved backdrop applied on load");
assert.ok(r.style.props["--device-shell"], "finish vars applied");
assert.ok(!("#bg-status" in r.subs), "no bg notice on clean load");

r.subs["#bg-clear"].listeners.click[0]();
assert.equal(r.style.backgroundImage, "", "clear removes the backdrop");
assert.equal(store.has("foxxy-fm-bgimage-v1"), false, "clear removes the stored image");
assert.equal(r.subs["#bg-status"].textContent, "", "clear leaves no notice");

r = run();
assert.equal(r.style.backgroundImage, "", "no backdrop without a saved image");

console.log("fm1-theme: finish vars, backdrop load/clear PASS");
