/* SPDX-License-Identifier: GPL-3.0-only */
import {PANEL_NAMES, ENCODER_NAMES, MAX_BINDINGS, validateBindings, encodeBindings,
  mappingFile, readMappingFile, mapRequest, requestMap, targetName, sourceName, midiNoteName} from "./midi-map.js?v=shift-labels-2";
import {computerKeyboard, typingKeyName} from './computer-keyboard.js?v=all-keys-2';

const STORAGE = "foxxy-devscreen-midi-v1";
const CONNECTION_STORAGE = "foxxy-devscreen-midi-connection-v1";
export function setupMidiLearn(M) {
  const $ = id => document.getElementById(id);
  let bindings = [], learning = false, armed = null, access = null, controller = null, busy = false;
  let editBank = 0, shiftDown = false;
  const keyboard = computerKeyboard(window, () => controller === keyboard, () => learning && !!armed);
  const inputLabel = b => controller === keyboard && b.source === 0 && b.channel === 15
    ? `KEY ${typingKeyName(b.number)} · ${sourceName(b)}` : sourceName(b);
  const targets = [...document.querySelectorAll("[data-midi-target]")];
  const mappingBadges = new Map();
  for (const el of targets) {
    const stack = document.createElement('span'); stack.className = 'midi-layer-labels';
    el.append(stack); mappingBadges.set(el, stack);
  }
  const heldControls = new Set();
  const feedbackValues = new Map();
  const feedback = kind => window.dispatchEvent(new CustomEvent('controlfeedback', {detail:{kind}}));
  function midiFeedback(s, number, value) {
    const type = s & 0xf0, source = type === 0xb0 ? 1 : 0, channel = s & 15;
    if (![0x80,0x90,0xb0].includes(type)) return;
    const matches = bindings.filter(b => b.source === source && b.channel === channel && b.number === number);
    const b = (shiftDown && matches.find(b => b.bank === 1)) || matches.find(b => !b.bank);
    if (!b || b.kind === 2) return;
    const key = `${source}:${channel}:${number}`, previous = feedbackValues.get(key);
    feedbackValues.set(key, type === 0x80 ? 0 : value);
    if (b.kind === 0 && (source ? value >= 64 && !(previous >= 64) : type === 0x90 && value > 0 && !previous)) feedback('button');
    if ((b.kind === 1 || b.kind === 3) && type === 0xb0 &&
      (b.kind === 1 && b.mode ? value !== (b.mode === 2 ? 64 : 0) : previous !== undefined && previous !== value)) feedback('knob');
  }
  function paintShiftLight() {
    const light = $("shift-light");
    if (!light) return;
    light.classList.toggle("active", shiftDown);
    light.textContent = shiftDown ? "SHIFT ON" : "SHIFT OFF";
    light.title = shiftDown ? "Shift held · second mappings active" : "Shift released";
  }
  function clearHeldControls() {
    heldControls.clear();
    feedbackValues.clear();
    shiftDown = false;
    paintShiftLight();
    $("mshiftstatus").textContent = "Shift released";
    for (const el of targets) el.classList.toggle("midi-held", false);
  }
  function paintHeldControls(s, number, value) {
    const type = s & 0xf0, source = type === 0xb0 ? 1 : 0;
    if (![0x80, 0x90, 0xb0].includes(type)) return;
    const key = `${source}:${s & 15}:${number}`;
    if (type !== 0x80 && (source ? value >= 64 : value > 0)) heldControls.add(key);
    else heldControls.delete(key);
    for (const el of targets) {
      const [kind, target] = el.dataset.midiTarget.split(":").map(Number);
      if (kind !== 0 && kind !== 2) continue;
      el.classList.toggle("midi-held", bindings.some(b => b.kind === kind && b.target === target &&
        (b.bank || 0) === (shiftDown && bindings.some(other => other.bank === 1 && other.source === b.source && other.channel === b.channel && other.number === b.number) ? 1 : 0) &&
        heldControls.has(`${b.source}:${b.channel}:${b.number}`)));
    }
  }
  const status = text => { $("mist").textContent = text; $("mlprompt").textContent = text; };
  let clocks = 0, controls = 0, notes = 0, ccs = 0, lastControl = "", lastTransport = "", activityPaint = 0;
  function activity(s, number, value) {
    const type = s & 0xf0;
    if ([0xfa, 0xfb, 0xfc].includes(s)) lastTransport = ({250:"START",251:"CONTINUE",252:"STOP"})[s];
    if (s === 0xf8) clocks++;
    else if (s >= 0x80 && s < 0xf0) {
      controls++;
      if (type === 0xb0) ccs++;
      if (type === 0x90 && value > 0) notes++;
      const name = type === 0xb0 ? "CC" : type === 0x90 && value ? "NOTE ON" : type === 0x80 || type === 0x90 ? "NOTE OFF" : "OTHER";
      lastControl = `CH ${(s & 15) + 1} ${name} ${number} · value ${value}`;
    }
    if (s === 0xf8 && clocks > 1 && performance.now() - activityPaint < 150) return;
    activityPaint = performance.now();
    $("mlcounts").textContent = $("mlsignalcounts").textContent = `Notes: ${notes} · CC: ${ccs} · Clock: ${clocks}`;
    const text = lastControl ? `MIDI received: ${lastControl} · ${controls} channel messages · ${clocks} clock ticks` : clocks ? `Receiving clock (${clocks} ticks), but no notes or CC yet. On Circuit Rhythm check Note Tx / CC Tx in Shift + Save.` : "No MIDI received yet. Turn a knob or press a pad.";
    const syncText = clocks && !lastControl && !learning && M._ds_sync_source?.() === 1 ? `Receiving MIDI clock · ${clocks} ticks · ${lastTransport ? lastTransport + " received" : "no Start/Stop received yet"}` : text;
    $("mlactivity").textContent = $("mlsignal").textContent = syncText;
  }
  const hwStatus = text => { $("mhwstatus").textContent = text; };
  const supported = typeof M._ds_midi_map === "function" && typeof M._ds_midi === "function";
  if (!supported) {
    status("The dev-screen core needs rebuilding for MIDI learn (tools/build_devscreen.sh).");
    for (const id of ["menable", "mlearn", "marm", "mclear", "mlclear", "mexport", "msyx", "mimport"]) $(id).disabled = true;
    return {arm: () => false};
  }
  function apply(next) {
    const clean = validateBindings(next), raw = encodeBindings(clean), ptr = M._malloc(raw.length);
    if (!ptr) throw new Error("Unable to allocate MIDI setup memory");
    try {
      M.HEAPU8.set(raw, ptr);
      if (!M._ds_midi_map(ptr, raw.length)) throw new Error("Firmware rejected MIDI setup");
    } finally { M._free(ptr); }
    bindings = clean;
    clearHeldControls();
    try { localStorage.setItem(STORAGE, JSON.stringify(mappingFile(bindings))); }
    catch { status("Setup is active, but browser storage is unavailable. Use SAVE SETUP to keep it."); }
    render();
  }
  function render() {
    const list = $("mlist"); list.replaceChildren();
    if (!bindings.length) {
      const none = document.createElement("div"); none.className = "none"; none.textContent = "No learned controls"; list.append(none);
    }
    bindings.forEach((b, i) => {
      const row = document.createElement("div"); row.className = "b";
      const label = document.createElement("span"), remove = document.createElement("button");
      label.textContent = `${b.kind === 4 ? "MODIFIER" : b.bank ? "SHIFT" : "NORMAL"} · ${inputLabel(b)} → ${targetName(b)}${b.kind === 1 ? [" · absolute", " · relative ±", " · relative 64"][b.mode] : ""}`;
      remove.textContent = "REMOVE"; remove.addEventListener("click", () => apply(bindings.filter((_, j) => j !== i)));
      row.append(label);
      if (b.kind === 1) {
        const mode = document.createElement("select");
        mode.title = `MIDI mode for ${targetName(b)}`;
        ["Absolute CC", "Relative ±", "Relative 64"].forEach((name, value) => {
          const option = document.createElement("option"); option.value = String(value); option.textContent = name; mode.append(option);
        });
        mode.value = String(b.mode);
        mode.addEventListener("change", () => apply(bindings.map((binding, j) => j === i ? {...binding, mode: +mode.value} : binding)));
        row.append(mode);
      }
      row.append(remove); list.append(row);
    });
    $("mlearn").textContent = learning ? "LEARN ON" : "LEARN OFF";
    $("mlearn").classList.toggle("on", learning);
    $("marm").classList.toggle("armed", !!armed);
    $("marm").textContent = armed ? "ARMED" : "ARM";
    document.body.classList.toggle("midi-learning", learning);
    $("mlearn-overlay").hidden = !learning;
    $("mlmode").value = $("mmode").value;
    $("mbank").value = $("mlbank").value = String(editBank);
    const modifier = bindings.find(b => b.kind === 4);
    const shiftLabel = modifier ? `Shift pad: ${sourceName(modifier)} · hold for second functions` : "Shift pad: not assigned";
    $("mshiftassignment").textContent = $("mlshiftassignment").textContent = shiftLabel;
    const bankList = $("mlbanklist"); bankList.replaceChildren();
    const bankBindings = bindings.filter(b => b.kind !== 4 && (b.bank || 0) === editBank);
    $("mlbanksummary").textContent = `${editBank ? 'Shift' : 'Normal'} mappings (${bankBindings.length})`;
    for (const b of bankBindings) {
      const row = document.createElement('div'); row.textContent = `${inputLabel(b)} → ${targetName(b)}`; bankList.append(row);
    }
    if (!bankBindings.length) bankList.textContent = 'No assignments in this bank yet.';
    $("mshift").textContent = modifier ? "REASSIGN SHIFT" : "ASSIGN SHIFT";
    $("mlshift").textContent = $("mshift").textContent;
    $("mlremove").disabled = !armed || !bindings.some(b => b.kind === armed.kind && b.target === armed.target && (b.bank || 0) === (armed.bank || 0));
    for (const el of targets) {
      const [kind, target] = el.dataset.midiTarget.split(":").map(Number);
      const assigned = bindings.filter(b => b.kind === kind && b.target === target);
      el.classList.toggle("learn-selected", !!armed && armed.kind === kind && armed.target === target);
      el.classList.toggle("learn-mapped", assigned.length > 0);
      el.dataset.midiLabel = assigned.map(b => `${controller === keyboard && b.source === 0 && b.channel === 15 ? 'KEY ' + typingKeyName(b.number) : b.source ? 'CC ' + b.number : midiNoteName(b.number) + ' (' + b.number + ')'} · CH ${b.channel + 1}`).join(" / ");
      const stack = mappingBadges.get(el); stack.replaceChildren();
      for (const bank of [0, 1]) {
        const matches = assigned.filter(b => (b.bank || 0) === bank);
        if (!matches.length) continue;
        const badge = document.createElement('span'); badge.className = bank ? 'midi-layer-shift' : 'midi-layer-normal';
        badge.textContent = `${bank ? 'SHIFT' : 'NORMAL'} · ${matches.map(b => `${controller === keyboard && b.source === 0 && b.channel === 15 ? 'KEY ' + typingKeyName(b.number) : b.source ? 'CC ' + b.number : midiNoteName(b.number) + ' (' + b.number + ')'} · CH ${b.channel + 1}`).join(' / ')}`;
        stack.append(badge);
      }
      el.title = `${targetName({kind, target})}${assigned.length ? ' ← ' + assigned.map(b => `${b.bank ? 'Shift' : 'Normal'}: ${inputLabel(b)}`).join(' / ') : ''} · editing ${editBank ? 'Shift' : 'Normal'}`;
    }
  }
  for (const [kind, names] of [[0, PANEL_NAMES], [1, ENCODER_NAMES], [2, Array.from({length: 27}, (_, i) => `KEY ${i} (F3 + ${i})`)], [3, ["MASTER VOLUME"]]]) {
    names.forEach((name, target) => {
      const option = document.createElement("option"); option.value = `${kind}:${target}`; option.textContent = name; $("mtgt").append(option);
    });
  }
  function arm(kind, target) {
    if (!learning) return false;
    armed = {kind, target, ...(kind !== 4 && editBank ? {bank: editBank} : {})}; $("mtgt").value = `${kind}:${target}`;
    if (controller === keyboard) document.activeElement?.blur?.();
    status(`Waiting for ${(kind === 1 || kind === 3) ? "a CC knob" : "a note/pad or CC button"} for ${targetName(armed)}${kind === 4 ? " (hold to use your second mappings)" : editBank ? " · Shift bank" : " · Normal bank"}…`); render();
    return true;
  }
  let syncPaint = 0;
  function refreshSync(force = false) {
    if (!M._ds_sync_source || !M._ds_bpm) return;
    if (!force && performance.now() - syncPaint < 150) return;
    syncPaint = performance.now();
    const source = M._ds_sync_source(), alive = M._ds_clock_alive();
    $("msync").value = source === 2 ? "" : String(source);
    $("msyncstatus").textContent = source === 0 ? `Internal · ${M._ds_bpm()} BPM` : source === 2 ? "TRS sync selected in firmware. Choose Controller clock for browser MIDI." : !controller ? "Select a controller input for clock sync." : `${alive ? "Clock received" : "Waiting for clock · internal fallback"} · ${M._ds_bpm()} BPM · ${M._ds_playing() ? "playing" : "stopped"}`;
    $("bpm").value = String(M._ds_bpm());
  }
  $("msync").addEventListener("change", () => { M._ds_sync_set?.(+$("msync").value); refreshSync(true); });
  function message(event) {
    const [s, number, value = 0] = event.data;
    activity(s, number, value);
    const stamp = Number.isFinite(event.timeStamp) ? event.timeStamp : event.receivedTime;
    M._ds_time?.(Math.floor(Number.isFinite(stamp) ? stamp : performance.now()));
    if ([0xf8, 0xfa, 0xfb, 0xfc].includes(s)) {
      M._ds_midi(s, 0, 0); refreshSync(s !== 0xf8); return;
    }
    if (s < 0x80 || s >= 0xf0 || number === undefined) return;
    const type = s & 0xf0;
    const modifier = [0x80, 0x90, 0xb0].includes(type) && bindings.find(b => b.kind === 4 && b.source === (type === 0xb0 ? 1 : 0) && b.channel === (s & 15) && b.number === number);
    if (modifier && armed?.kind !== 4) {
      const down = type === 0xb0 ? value >= 64 : type === 0x90 && value > 0;
      if (down && !shiftDown) feedback('button');
      if (down !== shiftDown) { clearHeldControls(); shiftDown = down; }
      $("mshiftstatus").textContent = shiftDown ? "SHIFT HELD · second mappings active" : "Shift released";
      paintShiftLight();
      if (!learning) M._ds_midi(s, number, value);
      return;
    }
    if (learning) {
      if (!armed || !((type === 0x90 && value > 0) || type === 0xb0)) return;
      if ((armed.kind === 1 || armed.kind === 3) && type !== 0xb0) { status("Note received, but this target is a knob. Turn a controller knob that sends CC."); return; }
      if (armed.kind !== 1 && armed.kind !== 3 && type === 0xb0 && value < 64) { status("CC received. Button/key targets learn a press (value 64–127); select a knob target to map this knob."); return; }
      const b = {source: type === 0xb0 ? 1 : 0, channel: s & 15, number,
        ...armed, mode: armed.kind === 1 ? +$("mmode").value : 0};
      if (b.kind !== 4 && bindings.some(old => old.kind === 4 && old.source === b.source && old.channel === b.channel && old.number === b.number)) {
        status("That control is assigned to Shift. Choose another pad, or reassign Shift first."); return;
      }
      const next = bindings.filter(old => !(b.kind === 4 && old.kind === 4) &&
        (old.source !== b.source || old.channel !== b.channel || old.number !== b.number ||
         (b.kind !== 4 && (old.bank || 0) !== (b.bank || 0))));
      if (next.length >= MAX_BINDINGS) { status("All 48 mapping slots are used. Remove one first."); return; }
      try { apply([...next, b]); armed = null; render(); status(`Mapped ${targetName(b)} ← ${inputLabel(b)}${b.kind === 4 ? ' · hold this control for Shift' : b.bank ? ' · Shift bank' : ' · Normal bank'}. Click another control, or choose DONE to play.`); }
      catch (err) { status(err.message); }
      return;
    }
    midiFeedback(s, number, value);
    paintHeldControls(s, number, value);
    M._ds_midi(s, number, value);
    if (type === 0x90 && value > 0) {
      const matches = bindings.filter(b => b.source === 0 && b.channel === (s & 15) && b.number === number);
      const mapped = (shiftDown && matches.find(b => b.bank === 1)) || matches.find(b => !b.bank);
      if (mapped?.kind === 2 || !matches.length) window.dispatchEvent(new CustomEvent('synthnote'));
    }
  }
  function setLearning(on) {
    clearHeldControls();
    learning = on; armed = null; M._ds_midi_release(); render();
    status(learning ? "Click a highlighted control, then press a pad or turn a knob." : "Controller ready. The first absolute knob message sets its starting position.");
  }
  $("mlearn").addEventListener("click", () => setLearning(!learning));
  $("mldone").addEventListener("click", () => setLearning(false));
  for (const id of ["mshift", "mlshift"]) $(id).addEventListener("click", () => { setLearning(true); arm(4, 0); });
  for (const id of ["mbank", "mlbank"]) $(id).addEventListener("change", () => {
    editBank = +$(id).value; armed = null; render();
    status(editBank ? "Editing Shift mappings. Click a control, then press its pad or turn its knob." : "Editing Normal mappings. Click a control to assign it.");
  });
  $("mlmode").addEventListener("change", () => { $("mmode").value = $("mlmode").value; });
  $("mlremove").addEventListener("click", () => {
    if (!armed) return;
    apply(bindings.filter(b => b.kind !== armed.kind || b.target !== armed.target || (b.bank || 0) !== (armed.bank || 0)));
    status(`Unmapped ${targetName(armed)}. Move a controller control to assign it again.`);
  });
  for (const el of targets) {
    el.addEventListener("pointerdown", e => {
      if (!learning) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const [kind, target] = el.dataset.midiTarget.split(":").map(Number); arm(kind, target);
    }, {capture: true});
    el.addEventListener("pointerup", e => { if (learning) { e.preventDefault(); e.stopImmediatePropagation(); } }, {capture: true});
  }
  window.addEventListener("keydown", e => { if (learning && e.key === "Escape") setLearning(false); });
  $("marm").addEventListener("click", () => {
    learning = true; const [kind, target] = $("mtgt").value.split(":").map(Number); arm(kind, target);
  });
  $("mtgt").addEventListener("change", () => { if (armed) { const [kind, target] = $("mtgt").value.split(":").map(Number); arm(kind, target); } });
  for (const id of ["mclear", "mlclear"]) $(id).addEventListener("click", () => {
    if (!window.confirm("Are you sure you want to unmap all controls? This clears both mapping banks and the Shift assignment.")) return;
    apply([]); armed = null; editBank = 0; render();
    status("All mappings cleared, including both banks and Shift.");
  });
  function download(name, bytes, type) {
    const url = URL.createObjectURL(new Blob([bytes], {type})), a = document.createElement("a");
    a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $("mexport").addEventListener("click", () => download("foxxy-midi-setup.json", JSON.stringify(mappingFile(bindings), null, 2), "application/json"));
  $("msyx").addEventListener("click", () => download("foxxy-midi-setup.syx", mapRequest(bindings), "application/octet-stream"));
  $("mimport").addEventListener("click", () => $("mfile").click());
  $("mfile").addEventListener("change", async () => {
    try {
      const file = $("mfile").files[0]; if (!file) return;
      if (file.size > 65536) throw new Error("MIDI setup file is too large");
      apply(readMappingFile(new Uint8Array(await file.arrayBuffer())));
      armed = null; learning = false; render(); status("MIDI setup loaded.");
    } catch (err) { status(err.message); }
    finally { $("mfile").value = ""; }
  });
  function ports(select, available) {
    const previous = select.value; select.replaceChildren();
    const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = "Select MIDI port"; select.append(placeholder);
    if (select === $("mi")) {
      const option = document.createElement('option'); option.value = keyboard.id; option.textContent = keyboard.name; select.append(option);
    }
    for (const port of available.values()) if (port.state === "connected") {
      const option = document.createElement("option"); option.value = port.id; option.textContent = port.name || port.id; select.append(option);
    }
    if ([...select.options].some(o => o.value === previous)) select.value = previous;
  }
  function chooseController() {
    const next = $("mi").value === keyboard.id ? keyboard : access?.inputs.get($("mi").value);
    if (controller === next) return;
    controller?.removeEventListener("midimessage", message);
    keyboard.release();
    clearHeldControls();
    M._ds_midi_release();
    controller = next; controller?.addEventListener("midimessage", message);
    if (controller) {
      try { localStorage.setItem(CONNECTION_STORAGE, JSON.stringify({enabled:true, name:controller.name, id:controller.id})); } catch {}
    }
    window.dispatchEvent(new CustomEvent("midicontrollerchange", {detail: {name: controller?.name || ""}}));
    clocks = controls = notes = ccs = 0; lastControl = lastTransport = ""; activity(0, 0, 0);
    if (controller) controller.open().catch(err => { if (controller === next) status(`Could not open MIDI input: ${err.message}`); });
    $("circuit-input-help").hidden = !/circuit rhythm/i.test(controller?.name || "");
    if (controller === keyboard) $("mi").blur?.();
    if (controller) status(controller === keyboard ? 'Computer Keyboard ready · Z S X D C V G B H N J M… play notes. In LEARN, click a target and press a typing key. Click the display/background first if a form control has focus.' : `Controller: ${controller.name}`);
  }
  function updateHardwareButtons() {
    const ready = access && access.inputs.get($("mhwinput").value)?.state === "connected" && access.outputs.get($("mhwoutput").value)?.state === "connected";
    $("mcheck").disabled = $("msend").disabled = busy || !ready;
  }
  function updatePorts() {
    ports($("mi"), access.inputs); ports($("mhwinput"), access.inputs); ports($("mhwoutput"), access.outputs);
    chooseController(); updateHardwareButtons();
  }
  $("mi").addEventListener("change", chooseController);
  ports($("mi"), new Map());
  for (const id of ["mhwinput", "mhwoutput"]) $(id).addEventListener("change", () => { hwStatus("Select CHECK FM-1 to verify MIDI mapping support."); updateHardwareButtons(); });
  $("menable").addEventListener("click", async () => {
    if (!navigator.requestMIDIAccess) { status("This browser does not expose Web MIDI. Open this dev screen in Chrome or Edge on localhost or HTTPS."); return; }
    if (!window.isSecureContext && window.isSecureContext !== undefined) { status("MIDI requires localhost or HTTPS. Open http://localhost:8000/devscreen.html"); return; }
    $("menable").disabled = true; $("menable").textContent = "CONNECTING…";
    status("Waiting for MIDI permission…");
    try {
      if (!access) {
        access = await navigator.requestMIDIAccess({sysex: false});
        access.addEventListener("statechange", updatePorts);
      }
      updatePorts();
      const inputs = [...access.inputs.values()].filter(p => p.state === "connected");
      const rhythm = inputs.find(p => /circuit rhythm/i.test(p.name));
      let saved;
      try { saved = JSON.parse(localStorage.getItem(CONNECTION_STORAGE) ?? localStorage.getItem("sloop-devscreen-midi-connection-v1")); } catch {}
      const previous = inputs.find(p => p.id === saved?.id) || inputs.find(p => p.name === saved?.name);
      if (!$("mi").value && (previous || rhythm || inputs.length === 1)) {
        $("mi").value = (previous || rhythm || inputs[0]).id; chooseController();
      }
      status(controller ? `Connected: ${controller.name}. Turn LEARN on to map a control.` : inputs.length ? "MIDI enabled. Select your controller input." : "MIDI enabled, but no connected inputs were found.");
    } catch (err) { status(`MIDI access failed: ${err.message}. Allow MIDI for localhost in your browser's site settings, then retry.`); }
    finally { $("menable").disabled = false; $("menable").textContent = access ? "MIDI ENABLED" : "ENABLE MIDI"; }
  });
  async function hardware(send) {
    if (busy) return;
    let input = access?.inputs.get($("mhwinput").value), output = access?.outputs.get($("mhwoutput").value);
    if (!input || !output) return;
    const toSend = validateBindings(bindings);
    busy = true; updateHardwareButtons(); hwStatus(send ? "Saving mappings to FM-1…" : "Checking FM-1 support…");
    try {
      if (!access.sysexEnabled) {
        const next = await navigator.requestMIDIAccess({sysex: true});
        if (!next.sysexEnabled) throw new Error("Allow SysEx MIDI permission to transfer to the FM-1.");
        access.removeEventListener("statechange", updatePorts);
        access = next; access.addEventListener("statechange", updatePorts); updatePorts();
        input = access.inputs.get($("mhwinput").value); output = access.outputs.get($("mhwoutput").value);
        if (!input || !output) throw new Error("Select the FM-1 ports again after enabling SysEx.");
      }
      // Probe first: do not send a setup to a device that has not identified
      // itself through the mapping protocol.
      const existing = await requestMap(input, output);
      if (send) {
        const saved = await requestMap(input, output, toSend);
        hwStatus(JSON.stringify(bindings) === JSON.stringify(toSend) ? `${saved.length} mappings saved and verified on FM-1. Connect the controller to its MIDI input to use them.` : "Setup saved on FM-1, but the dev setup changed during transfer. Send again to sync it.");
      } else hwStatus(`FM-1 supports MIDI learn (${existing.length} saved mappings). Ready to send this setup.`);
    } catch (err) { hwStatus(err.message); }
    finally { busy = false; updateHardwareButtons(); }
  }
  $("mcheck").addEventListener("click", () => hardware(false));
  $("msend").addEventListener("click", () => hardware(true));
  window.addEventListener("blur", () => M._ds_midi_release());
  try { const saved = localStorage.getItem(STORAGE) ?? localStorage.getItem("sloop-devscreen-midi-v1"); if (saved) apply(readMappingFile(saved)); else render(); }
  catch (err) { status(`Saved setup could not be loaded: ${err.message}`); render(); }
  refreshSync(true);
  // Reconnect after reload only when the user already enabled MIDI and Chrome
  // confirms permission is granted. Otherwise keep the explicit enable button.
  (async () => {
    try {
      const saved = JSON.parse(localStorage.getItem(CONNECTION_STORAGE) ?? localStorage.getItem("sloop-devscreen-midi-connection-v1"));
      if (saved?.id === keyboard.id) { $("mi").value = keyboard.id; chooseController(); return; }
      if (!saved?.enabled || !navigator.permissions?.query) return;
      const permission = await navigator.permissions.query({name:"midi", sysex:false});
      if (permission.state === "granted" && !access) $("menable").click();
    } catch { /* Browsers without a MIDI permission query use ENABLE MIDI. */ }
  })();
  return {arm, refreshSync};
}
