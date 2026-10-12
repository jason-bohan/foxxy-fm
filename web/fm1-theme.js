/* SPDX-License-Identifier: GPL-3.0-only */
const STORAGE = 'foxxy-fm-finish-v1';
const BG_STORAGE = 'foxxy-fm-bgimage-v1';  /* the backdrop photo, kept apart so a quota failure never eats the color prefs */
const BG_MAX_SIDE = 1600;
// Stock-inspired colors from FM-1 product photographs; not calibrated paint values.
const finishes = [
  {id:'pink', name:'Pink / Purple', shell:'#e8a3bd', controls:'#8968ae', accent:'#d4b7f3', keybed:'#654c83'},
  {id:'purple', name:'Purple', shell:'#71608f', controls:'#e5e0ee', accent:'#c5a4ee'},
  {id:'orange', name:'Orange', shell:'#e87530', controls:'#eee9dd', accent:'#ffe091'},
  {id:'black', name:'Black', shell:'#343837', controls:'#252c27', accent:'#bed368'},
  {id:'black-green', name:'Black / Green', shell:'#303637', controls:'#39a598', accent:'#7aead3'},
  {id:'white-blue', name:'White / Blue', shell:'#e7e8e4', controls:'#426eb5', accent:'#739fe8'},
  {id:'white-grey', name:'White / Grey', shell:'#e7e8e4', controls:'#777d7e', accent:'#b8c8ce'},
];
const validColors = colors => colors && ['shell','controls','accent'].every(k => /^#[0-9a-f]{6}$/i.test(colors[k]));
const rgb = hex => [1,3,5].map(i => parseInt(hex.slice(i,i+2),16));
const mix = (hex, end, amount) => '#' + rgb(hex).map((n,i) => Math.round(n+(rgb(end)[i]-n)*amount).toString(16).padStart(2,'0')).join('');
function ink(hex) {
  const c = rgb(hex).map(n => n/255).map(n => n <= .04045 ? n/12.92 : ((n+.055)/1.055)**2.4);
  const lum = c[0]*.2126+c[1]*.7152+c[2]*.0722;
  return lum > .179 ? '#171b1a' : '#f5f5ef';
}
export function bgFitSize(w, h, max) {
  const s = Math.min(1, max / Math.max(w, h));
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}
export function setupFinish(stage) {
  const panel = document.createElement('section'); panel.className = 'finish-picker';
  panel.setAttribute('aria-label', 'Instrument color theme');
  panel.innerHTML = `<div class="finish-heading"><span class="eyebrow">FINISH</span><span id="finish-name" aria-live="polite"></span></div><div class="finish-options"></div><div class="custom-finish" hidden><label>Shell <input type="color" data-finish="shell"></label><label>Knobs & keys <input type="color" data-finish="controls"></label><label>Buttons <input type="color" data-finish="buttons"></label><label>Button & key panels <input type="color" data-finish="buttonPanel"></label><label>Accent <input type="color" data-finish="accent"></label><button type="button" id="finish-reset">RESET CUSTOM</button></div><div class="bg-image" style="display:flex;gap:10px;align-items:center;margin-top:8px;flex-wrap:wrap"><label>Backdrop image <input type="file" id="bg-file" accept="image/*"></label><button type="button" id="bg-clear">CLEAR IMAGE</button><span id="bg-status" role="status"></span></div><div id="finish-status" role="status"></div>`;
  stage.querySelector('.device-wrap').before(panel);
  let selected = 'pink', custom = {...finishes[0]}, bgImage = null;
  const bgStatus = (t) => { panel.querySelector('#bg-status').textContent = t; };
  function applyBg() {
    if (bgImage) {
      stage.style.backgroundImage = `url("${bgImage}")`;
      stage.style.backgroundSize = 'cover';
      stage.style.backgroundPosition = 'center';
      stage.style.backgroundRepeat = 'no-repeat';
    } else {
      stage.style.backgroundImage = '';
      stage.style.backgroundSize = '';
      stage.style.backgroundPosition = '';
      stage.style.backgroundRepeat = '';
    }
  }
  function shrinkBg(dataUrl, mime) {
    const img = new Image();
    img.onload = () => {
      try {
        const [w, h] = bgFitSize(img.naturalWidth || img.width, img.naturalHeight || img.height, BG_MAX_SIDE);
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        const keepPng = mime === 'image/png' && dataUrl.length < 1200000;
        bgImage = cv.toDataURL(keepPng ? 'image/png' : 'image/jpeg', 0.85);
        applyBg();
        try { localStorage.setItem(BG_STORAGE, bgImage); bgStatus('Backdrop saved.'); }
        catch { bgStatus('Image shown for this visit only: too large for browser storage.'); }
      } catch { bgStatus('Could not read that image.'); }
    };
    img.onerror = () => bgStatus('Could not read that image.');
    img.src = dataUrl;
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? localStorage.getItem('sloop-fm1-finish-v1'));
    if (saved && (saved.selected === 'custom' || finishes.some(p => p.id === saved.selected))) selected = saved.selected;
    if (validColors(saved?.custom)) custom = saved.custom;
    try {
      const bg = localStorage.getItem(BG_STORAGE);
      if (typeof bg === 'string' && bg.startsWith('data:image')) bgImage = bg;
    } catch { /* no saved backdrop: plain stage */ }
  } catch { /* A missing or damaged preference uses the pink finish. */ }
  function completeCustom() {
    if (!/^#[0-9a-f]{6}$/i.test(custom.buttons || '')) custom.buttons = custom.controls;
    if (!/^#[0-9a-f]{6}$/i.test(custom.buttonPanel || '')) custom.buttonPanel = custom.keybed || mix(custom.shell,'#000000',.12);
  }
  completeCustom();
  const buttons = [];
  for (const preset of [...finishes, {id:'custom',name:'Custom'}]) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'finish-option';
    b.dataset.finish = preset.id; b.setAttribute('aria-label', `${preset.name} finish`);
    const chip = document.createElement('span'); chip.className = 'finish-chip'; chip.setAttribute('aria-hidden','true');
    if (preset.id !== 'custom') chip.style.background = `linear-gradient(135deg,${preset.shell} 55%,${preset.controls} 55%)`;
    else chip.classList.add('custom-chip');
    const label = document.createElement('span'); label.textContent = preset.name;
    b.append(chip,label); panel.querySelector('.finish-options').append(b); buttons.push(b);
    b.addEventListener('click', () => { selected = preset.id; apply(true); });
  }
  function apply(save) {
    const colors = selected === 'custom' ? custom : finishes.find(p => p.id === selected);
    const shellInk = ink(colors.shell), controlInk = ink(colors.controls);
    const buttonColor = selected === 'custom' ? colors.buttons : colors.controls;
    const vars = {
      '--device-shell':colors.shell, '--device-shell-light':mix(colors.shell,'#ffffff',.09), '--device-shell-dark':mix(colors.shell,'#000000',.1),
      '--device-label':shellInk, '--device-label-muted':mix(shellInk,colors.shell,.25),
      '--device-tray':/^#[0-9a-f]{6}$/i.test(colors.keybed || '') ? colors.keybed : mix(colors.shell,'#000000',.12), '--keybed-tray':selected === 'custom' ? colors.buttonPanel : /^#[0-9a-f]{6}$/i.test(colors.keybed || '') ? colors.keybed : mix(colors.shell,'#000000',.12), '--device-border':mix(colors.shell,'#000000',.45),
      '--control-base':colors.controls, '--control-light':mix(colors.controls,'#ffffff',.15), '--control-dark':mix(colors.controls,'#000000',.18),
      '--control-ink':controlInk, '--finish-accent':colors.accent, '--accent-ink':ink(colors.accent),
      '--button-light':mix(buttonColor,'#ffffff',.15), '--button-dark':mix(buttonColor,'#000000',.18), '--button-ink':ink(buttonColor),
      '--button-panel':selected === 'custom' ? colors.buttonPanel : colors.keybed || mix(colors.shell,'#000000',.12),
    };
    for (const [key,value] of Object.entries(vars)) stage.style.setProperty(key,value);
    applyBg();
    buttons.forEach(b => b.setAttribute('aria-pressed',String(b.dataset.finish === selected)));
    panel.querySelector('#finish-name').textContent = selected === 'custom' ? 'Custom' : colors.name;
    panel.querySelector('.custom-finish').hidden = selected !== 'custom';
    for (const input of panel.querySelectorAll('[data-finish]')) input.value = custom[input.dataset.finish];
    window.dispatchEvent(new Event('fm1viewchange'));
    if (save) {
      try { localStorage.setItem(STORAGE,JSON.stringify({selected,custom})); panel.querySelector('#finish-status').textContent = ''; }
      catch { panel.querySelector('#finish-status').textContent = 'Theme applied. Browser storage is unavailable.'; }
    }
  }
  for (const input of panel.querySelectorAll('[data-finish]')) input.addEventListener('input', () => { custom[input.dataset.finish] = input.value; apply(true); });
  panel.querySelector('#finish-reset').addEventListener('click', () => { custom = {...finishes[0]}; completeCustom(); apply(true); });
  panel.querySelector('#bg-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) { bgStatus('That file is not an image.'); return; }
    const rd = new FileReader();
    rd.onload = () => shrinkBg(String(rd.result), f.type);
    rd.onerror = () => bgStatus('Could not read that image.');
    rd.readAsDataURL(f);
    e.target.value = '';
  });
  panel.querySelector('#bg-clear').addEventListener('click', () => {
    bgImage = null;
    try { localStorage.removeItem(BG_STORAGE); } catch {}
    applyBg();
    bgStatus('');
  });
  apply(false);
}
