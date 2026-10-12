/* SPDX-License-Identifier: GPL-3.0-only */
/* Move the existing controls, rather than duplicate the firmware or MIDI state. */
import {setupFinish} from "./fm1-theme.js?v=shared-panel-7";
import {WHITE_KEYS, keyName, keyLayout} from "./key-layout.js";
export function setupViews() {
  const $ = id => document.getElementById(id);
  const main = document.querySelector('main');
  const stage = document.createElement('section');
  stage.className = 'instrument-stage'; stage.hidden = true;
  stage.setAttribute('aria-label', 'FM-1 instrument');
  stage.innerHTML = `
    <div class="tool-intro"><div><span class="eyebrow">Foxxy FM / FM-1</span><h1>Your instrument. In the browser.</h1><p>Play, shape a sound, and prepare your MIDI setup.</p></div><div id="tool-audio"></div></div>
    <div class="device-wrap"><div class="fm1-device">
      <div class="device-brand"><b>M-VAVE <span>FM-1</span></b><span>FM SYNTHESIZER / Foxxy FM</span><i></i></div>
      <div class="device-top"><div class="device-left"><div id="device-master-knobs"></div><div id="device-octaves"></div></div><div id="device-display"><button id="screen-zoom" type="button" aria-label="Enlarge FM-1 screen" title="Enlarge screen" aria-haspopup="dialog"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6M7 10h6m-3-3v6"/></svg></button></div><div class="device-right"><div id="device-parameter-knobs"></div><div id="device-buttons"></div></div></div>
      <div class="device-keyframe"><div class="keybed-caption"><span>27 KEY / TOUCH KEYBOARD</span><span>F3 — G5</span></div><div id="device-keybed"></div></div>
      <div class="device-footer"><span>6 OPERATORS · 32 ALGORITHMS</span><span id="shift-light" class="shift-light" role="status" title="Shift released">SHIFT OFF</span></div>
    </div></div>
    <div class="mobile-device-hint">Swipe across the instrument to reach every control.</div>
    <div class="tool-hint">Click grid cells and track rows on the display. Drag or scroll over a value to change it. Double-click BPM for tempo. In TRACKER, double-click a cell to write a note, or focus the display and use the piano typing keys; arrows move, Delete clears, Enter edits. Hold a button for its alternate controls.</div>
    <div class="tool-settings"><div class="settings-heading"><span class="eyebrow">CONTROLLER SETUP</span><span>Learn here. Take it to your FM-1.</span></div><div id="tool-midi"></div></div>`;
  main.prepend(stage);
  setupFinish(stage);
  const zoom = document.createElement('dialog');
  zoom.id = 'screen-zoom-modal'; zoom.setAttribute('aria-labelledby', 'screen-zoom-title');
  zoom.innerHTML = `<div class="zoom-heading"><span id="screen-zoom-title">FM-1 · LIVE SCREEN</span><button id="screen-zoom-close" type="button" aria-label="Close enlarged screen" autofocus><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div><div class="zoom-screen-bezel"><canvas id="screen-zoom-canvas" width="240" height="240" role="img" aria-label="Enlarged live FM-1 display"></canvas></div>`;
  document.body.append(zoom);
  function syncZoomFinish() {
    const finish = getComputedStyle(stage);
    for (const key of ['--device-shell', '--device-label', '--device-border', '--control-base', '--control-ink', '--finish-accent', '--accent-ink']) {
      zoom.style.setProperty(key, finish.getPropertyValue(key).trim());
      $('tempo-dialog').style.setProperty(key, finish.getPropertyValue(key).trim());
      $('ratchet-dialog').style.setProperty(key, finish.getPropertyValue(key).trim());
      $('tracker-dialog').style.setProperty(key, finish.getPropertyValue(key).trim());
    }
  }
  window.addEventListener('fm1viewchange', syncZoomFinish);
  syncZoomFinish();
  const zoomCanvas = $('screen-zoom-canvas'), zoomContext = zoomCanvas.getContext('2d');
  function paintZoom(source) {
    if (zoom.open) zoomContext.drawImage(source, 0, 0);
  }
  $('screen-zoom').addEventListener('click', () => { if (!zoom.open) zoom.showModal(); paintZoom($('scr')); });
  $('screen-zoom-close').addEventListener('click', () => zoom.close());
  zoom.addEventListener('click', e => {
    const r = zoom.getBoundingClientRect();
    if (e.target === zoom && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) zoom.close();
  });
  const moves = [];
  function relocate(el, destination) {
    const marker = document.createComment('dev-view-control');
    el.before(marker); moves.push({el, marker, destination});
  }
  relocate(document.querySelector('.screenbox'), $('device-display'));
  relocate(document.querySelector('[data-midi-target="3:0"]'), $('device-master-knobs'));
  for (const target of [0, 2, 1]) relocate(document.querySelector(`[data-midi-target="1:${target}"]`), $('device-master-knobs'));
  for (let target = 3; target < 7; target++) relocate(document.querySelector(`[data-midi-target="1:${target}"]`), $('device-parameter-knobs'));
  for (let target = 0; target < 14; target++) relocate(document.querySelector(`[data-midi-target="0:${target}"]`), target < 12 ? $('device-buttons') : $('device-octaves'));
  relocate($('bed'), $('device-keybed'));
  relocate($('sound'), $('tool-audio'));
  relocate($('sound-test'), $('tool-audio'));
  relocate($('audio-status'), $('tool-audio'));
  relocate($('control-sounds-label'), $('tool-audio'));
  relocate($('menable').closest('fieldset'), $('tool-midi'));
  relocate($('key-settings'), stage.querySelector('.keybed-caption'));
  let controllerName = '';
  let savedLayouts = {};
  try { savedLayouts = JSON.parse(localStorage.getItem('foxxy-key-layouts-v1')) || {}; } catch {}
  for (const k of WHITE_KEYS) {
    const option = document.createElement('option'); option.value = String(k); option.textContent = keyName(k); $('key-first').append(option);
  }
  function loadKeyLayout() {
    const saved = savedLayouts[controllerName || 'default'];
    $('key-layout').value = ['auto','full','octave','custom'].includes(saved?.mode) ? saved.mode : 'auto';
    $('key-first').value = String(WHITE_KEYS.includes(saved?.first) ? saved.first : 0);
    $('key-count').value = String(saved?.count || 16);
    updateKeyLayout();
  }
  function saveKeyLayout() {
    updateKeyLayout();
    savedLayouts[controllerName || 'default'] = {mode: $('key-layout').value, first: Number($('key-first').value), count: Number($('key-count').value)};
    try { localStorage.setItem('foxxy-key-layouts-v1', JSON.stringify(savedLayouts)); } catch {}
  }
  function updateKeyLayout() {
    const first = Number($('key-first').value), max = WHITE_KEYS.length - WHITE_KEYS.indexOf(first);
    $('key-count').max = String(max);
    $('key-count').value = String(Math.max(1, Math.min(max, Number($('key-count').value) || 1)));
    $('key-custom').hidden = $('key-layout').value !== 'custom';
    const layout = keyLayout($('key-layout').value, controllerName, first, $('key-count').value);
    const bed = $('bed');
    bed.style.setProperty('--key-black-width', `${74 / layout.whites.length}%`);
    bed.style.setProperty('--key-black-offset', `${-27 / layout.whites.length}%`);
    for (const key of bed.children) {
      const k = Number(key.dataset.k);
      const hide = k < layout.low || k > layout.high;
      if (hide && !key.hidden) key.dispatchEvent(new Event('pointercancel'));
      key.hidden = hide;
      if (key.classList.contains('bk')) {
        const whites = layout.whites;
        key.style.left = `calc(${(whites.indexOf(k - 1) + 1) * 100 / whites.length}% - 4px)`;
      }
    }
    const caption = stage.querySelector('.keybed-caption');
    caption.children[0].textContent = `${layout.count} KEY / TOUCH KEYBOARD`;
    caption.children[1].textContent = `${keyName(layout.low)} — ${keyName(layout.high)}`;
    $('key-layout-status').textContent = `${layout.whites.length} white keys · ${layout.count - layout.whites.length} black keys${controllerName ? ' · ' + controllerName : ''}`;
  }
  for (const id of ['key-layout','key-first','key-count']) $(id).addEventListener('change', saveKeyLayout);
  $('key-settings-done').addEventListener('click', () => { $('key-settings').open = false; });
  window.addEventListener('midicontrollerchange', e => { controllerName = e.detail.name; loadKeyLayout(); });
  loadKeyLayout();
  const sub = document.querySelector('header .sub');
  function select(view, updateURL = true) {
    const instrument = view === 'fm1';
    if (zoom.open) zoom.close();
    // Release held pointers before moving the controls between layouts.
    for (const el of document.querySelectorAll('.pad.on, .bed .on')) el.dispatchEvent(new Event('pointercancel'));
    for (const {el, marker, destination} of moves) {
      if (instrument) destination.append(el); else marker.after(el);
    }
    stage.hidden = !instrument;
    document.body.classList.toggle('fm1-view', instrument);
    $('view-fm1').setAttribute('aria-pressed', String(instrument));
    $('view-dev').setAttribute('aria-pressed', String(!instrument));
    window.dispatchEvent(new Event("fm1viewchange"));
    document.title = instrument ? 'FM-1 · Web Tool' : 'FM-1 · Dev Screen';
    sub.textContent = instrument ? 'web tool' : 'dev screen — the real firmware UI, on canvas';
    if (updateURL) {
      const url = new URL(location.href); url.searchParams.set('view', instrument ? 'fm1' : 'dev');
      history.replaceState(null, '', url);
    }
  }
  $('view-fm1').addEventListener('click', () => select('fm1'));
  $('view-dev').addEventListener('click', () => select('dev'));
  window.addEventListener('popstate', () => select(new URL(location.href).searchParams.get('view'), false));
  select(new URL(location.href).searchParams.get('view'), false);
  return {paintZoom};
}
