/* SPDX-License-Identifier: GPL-3.0-only */
import {TYPING_KEYS} from './computer-keyboard.js';
const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export const trackerNoteName = n => names[n % 12] + (Math.floor(n / 12) - 1);
export function populateTrackerNotes(select, M, track, empty = true) {
  select.replaceChildren();
  const add = (value, label) => { const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option); };
  if (empty) add(0, '---');
  if (track === 3) {
    for (let lane = 0; lane < 16; lane++) {
      const note = M._ds_tracker_drum_note(lane);
      add(note, `${M.UTF8ToString(M._ds_tracker_drum_name(lane))} · ${trackerNoteName(note)}`);
    }
  } else for (let note = 1; note <= 127; note++) add(note, trackerNoteName(note));
}
export function parseTrackerNote(text) {
  text = text.trim();
  if (/^\d+$/.test(text)) return +text >= 1 && +text <= 127 ? +text : -1;
  const m = /^([A-G])([#b]?)(-?\d)$/i.exec(text);
  if (!m) return -1;
  const n = (+m[3]+1)*12 + ({C:0,D:2,E:4,F:5,G:7,A:9,B:11}[m[1].toUpperCase()]) + (m[2]==='#'?1:m[2].toLowerCase()==='b'?-1:0);
  return n >= 1 && n <= 127 ? n : -1;
}
export function setupTracker(M, enableSound, multiselect = null) {
  const panel = document.createElement('section'); panel.id = 'browser-tracker'; panel.hidden = true;
  panel.setAttribute('aria-label','Editable pattern tracker');
  panel.innerHTML = `<div class="tracker-heading"><div><span class="eyebrow">PATTERN EDITOR</span><h1>Tracker</h1></div><div class="tracker-tools"><button id="tracker-play">PLAY</button><button id="tracker-follow" aria-pressed="true">FOLLOW ON</button><label>Edit step <select id="tracker-advance"><option value="1">1 row</option><option value="0">Stay</option><option value="2">2 rows</option><option value="4">4 rows</option></select></label><button id="tracker-exit">BACK TO INSTRUMENT</button></div></div><p class="tracker-help">Choose notes from the dropdowns or use the piano typing keys. Click the note summary to edit chords or drum hits. Shift + piano key adds a chord note. Drag across cells or Shift/Cmd-click to select steps. Arrows navigate; Delete clears; Space plays/stops. Knobs: K1 row · K2 note/sound · K3 velocity · K4 time · PRESETS selects chord voice.</p><div id="tracker-message" role="status"></div><div class="tracker-scroll" tabindex="0" aria-label="Tracker grid"><table><thead><tr><th>STEP</th>${['TRACK 1','TRACK 2','TRACK 3','DRUMS'].map((n,i)=>`<th class="tracker-track-head" data-track="${i}">${n}<span>NOTE · VEL · TIME</span></th>`).join('')}</tr></thead><tbody></tbody></table></div><div class="tracker-footer"><span id="tracker-selection"></span><span>Edits change the playing pattern · EDIT + OCT− to undo</span></div>`;
  document.querySelector('main').prepend(panel);
  const open = document.createElement('button'); open.id = 'open-tracker'; open.type = 'button'; open.textContent = 'TRACKER';
  document.querySelector('.view-switch').after(open); open.addEventListener('click',()=>M._ds_tracker_open());
  const grid = panel.querySelector('.tracker-scroll'), tbody = panel.querySelector('tbody');
  const knobTools=document.createElement('div'); knobTools.className='tracker-knob-tools';
  knobTools.innerHTML=['Row','Note / sound','Velocity','Time'].map((label,i)=>`<div><span>K${i+1} · ${label}</span><button type="button" data-enc="${i+3}" data-delta="-1" aria-label="Decrease ${label}">−</button><button type="button" data-enc="${i+3}" data-delta="1" aria-label="Increase ${label}">+</button></div>`).join('');
  panel.querySelector('.tracker-heading').after(knobTools);
  for(const button of knobTools.querySelectorAll('button'))button.addEventListener('click',()=>{pauseUntil=performance.now()+3000;M._ds_turn(+button.dataset.enc,+button.dataset.delta);refresh();});
  let selection = {track:0,row:0}, follow = true, pauseUntil = 0, active = false, lastPlay = -1;
  const cells = [], rows = [];
  const message = text => { panel.querySelector('#tracker-message').textContent = text; };
  const select = (track,row,field=0,focus=true) => {
    track = Math.max(0,Math.min(3,track)); row = Math.max(0,Math.min(M._ds_tracker_info(track,0)-1,row));
    selection = {track,row}; pauseUntil = performance.now()+3000;
    M._ds_tracker_select(track,row);
    if (focus) cells[row][track][field].focus({preventScroll:true});
    const top=rows[row].offsetTop, bottom=top+rows[row].offsetHeight;
    if(top<grid.scrollTop+50)grid.scrollTop=Math.max(0,top-50);else if(bottom>grid.scrollTop+grid.clientHeight)grid.scrollTop=bottom-grid.clientHeight;refresh();
  };
  const advance = () => select(selection.track,selection.row + +panel.querySelector('#tracker-advance').value);
  const write = (track,row,field,value) => {
    const ok = M._ds_tracker_update(track*64+row,field,value);
    message(ok ? '' : 'Use a note from C−1 to G9 (MIDI 1–127), velocity 1–127, or a valid time.');
    return !!ok;
  };
  for (let row=0;row<64;row++) {
    const tr=document.createElement('tr'); tr.dataset.row=row;
    const label=document.createElement('th'); label.scope='row'; label.textContent=String(row+1).padStart(2,'0'); tr.append(label);
    cells[row]=[]; rows.push(tr);
    for(let track=0;track<4;track++) {
      const td=document.createElement('td'); td.dataset.track=track;
      td.innerHTML=`<div class="tracker-cell"><select class="tracker-note" aria-label="Track ${track+1} step ${row+1} note"></select><input class="tracker-vel" aria-label="Track ${track+1} step ${row+1} velocity" type="number" min="1" max="127"><select aria-label="Track ${track+1} step ${row+1} time"><option value="0">NOTE</option>${track<3?'<option value="1">TIE</option>':''}<option value="2">REST</option></select></div>`;
      const [note,vel,time]=td.querySelectorAll('input,select'); cells[row][track]=[note,vel,time];
      const chord = document.createElement('button'); chord.type = 'button'; chord.className = 'tracker-chord-summary';
      chord.setAttribute('aria-label', `Edit all notes on track ${track+1} step ${row+1}`);
      chord.addEventListener('click', () => { select(track,row,0,false); window.dispatchEvent(new CustomEvent('trackeredit', {detail:{target:track*64+row}})); });
      td.append(chord); cells[row][track].push(chord);
      populateTrackerNotes(note,M,track);
      [note,vel,time].forEach((input,field)=>{
        input.dataset.track=track;input.dataset.row=row;input.dataset.field=field;
        input.addEventListener('focus',()=>{if(selection.track!==track||selection.row!==row)select(track,row,field,false);pauseUntil=performance.now()+3000;});
      });
      note.addEventListener('change',()=>{write(track,row,+note.value===0?2:0,+note.value===0?2:+note.value);refresh();});
      vel.addEventListener('change',()=>{write(track,row,1,+vel.value);refresh();});
      time.addEventListener('change',()=>{write(track,row,2,+time.value);refresh();});
      tr.append(td);
    }
    tbody.append(tr);
  }
  multiselect?.bindTracker(panel);
  grid.addEventListener('wheel',()=>{pauseUntil=performance.now()+3000;},{passive:true});
  grid.addEventListener('pointerdown',()=>{pauseUntil=performance.now()+3000;});
  grid.addEventListener('keydown',e=>{
    if(e.ctrlKey||e.metaKey||e.altKey||document.body.classList.contains('midi-learning'))return;
    if(multiselect && M._ds_seq_count()>1 && (e.code==='Delete'||e.code==='Backspace')){e.preventDefault();e.stopPropagation();multiselect.apply(2,2);return;}
    const input=e.target, field=+(input.dataset.field||0);
    if(field===1 || input.tagName==='SELECT' && field===2)return;
    const piano=TYPING_KEYS.indexOf(e.code);
    if(piano<0&&!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Delete','Backspace','Enter','Space'].includes(e.code))return;
    e.preventDefault();e.stopPropagation();
    if(e.repeat&&piano>=0)return;
    const {track,row}=selection;
    if (e.shiftKey && piano >= 0 && track < 3) {
      const notes = Array.from({length:4}, (_,slot) => M._ds_tracker_voice(track*64+row,slot)).filter(Boolean), note = 53+piano;
      if (!notes.includes(note)) {
        if (notes.length===4) { message('Four notes already: use the chord editor to change them.'); return; }
        notes.push(note);
        const packed=notes.reduce((bits,n,i)=>bits | n << (8*i),0)>>>0;
        M._ds_tracker_chord(track*64+row,packed,M._ds_tracker_read(track*64+row,1),0); refresh();
      }
      return;
    }
    if(e.code==='Space'){togglePlay();return;}
    if(e.code==='Enter'){cells[row][track][0].focus();return;}
    if(e.code.startsWith('Arrow')){select(track+(e.code==='ArrowRight'?1:e.code==='ArrowLeft'?-1:0),row+(e.code==='ArrowDown'?1:e.code==='ArrowUp'?-1:0));return;}
    if(write(track,row,piano>=0?0:2,piano>=0?53+piano:2))advance();
  });
  const togglePlay=()=>{const on=!M._ds_playing();M._ds_play(on?1:0);if(on)enableSound();refresh();};
  panel.querySelector('#tracker-play').addEventListener('click',togglePlay);
  panel.querySelector('#tracker-follow').addEventListener('click',()=>{follow=!follow;pauseUntil=0;lastPlay=-1;refresh();});
  panel.querySelector('#tracker-exit').addEventListener('click',()=>M._ds_home());
  function refresh() {
    const on=M._ds_tracker_cell(-1,0)>=0;
    panel.hidden=!on; document.body.classList.toggle('tracker-active',on);
    open.setAttribute('aria-pressed',String(on));
    if(!on){active=false;return;}
    const native=M._ds_tracker_cell(-1,0);
    if(active && (Math.floor(native/64)!==selection.track || native%64!==selection.row)) {selection={track:Math.floor(native/64),row:native%64};pauseUntil=performance.now()+3000;}
    if(!active){
      document.getElementById('screen-zoom-modal')?.close();
      selection={track:Math.floor(native/64),row:native%64};lastPlay=-1;active=true;
    }
    for (const th of panel.querySelectorAll('.tracker-track-head')) {
      const track=+th.dataset.track, name=M.UTF8ToString(M._ds_tracker_track_name(track));
      const label=`${track===3?'DRUMS':'TRACK '+(track+1)} · ${name}`;
      if(th.firstChild.textContent!==label)th.firstChild.textContent=label;
    }
    const playing=!!M._ds_playing(), play=M._ds_tracker_info(selection.track,1)%M._ds_tracker_info(selection.track,0);
    panel.querySelector('#tracker-play').textContent=playing?'STOP':'PLAY';
    panel.querySelector('#tracker-follow').textContent=follow?'FOLLOW ON':'FOLLOW OFF';
    panel.querySelector('#tracker-follow').setAttribute('aria-pressed',String(follow));
    panel.querySelector('#tracker-selection').textContent=`Track ${selection.track+1} · Step ${selection.row+1} · ${M._ds_bpm()} BPM`;
    const maxLen=Math.max(...[0,1,2,3].map(t=>M._ds_tracker_info(t,0)));
    for(let row=0;row<64;row++) {
      rows[row].hidden=row>=maxLen;
      rows[row].classList.toggle('playhead',playing&&row===play);
      rows[row].classList.toggle('beat-row',row%4===0);
      for(let track=0;track<4;track++) {
        const [note,vel,time,chord]=cells[row][track], target=track*64+row, valid=row<M._ds_tracker_info(track,0), type=M._ds_tracker_read(target,2);
        const notes=Array.from({length:track===3?16:4},(_,slot)=>M._ds_tracker_voice(target,slot)).filter(Boolean);
        const labels=notes.map(n=>track===3?M.UTF8ToString(M._ds_tracker_drum_name(Array.from({length:16},(_,i)=>M._ds_tracker_drum_note(i)).indexOf(n))):trackerNoteName(n));
        const summary=labels.length?labels.join(' + '):track===3?'+ HITS':'+ CHORD';
        if(chord.textContent!==summary)chord.textContent=summary;chord.title=summary;chord.disabled=!valid;
        note.parentElement.classList.toggle('selected',selection.track===track&&selection.row===row);
        for(const input of [note,vel,time])input.disabled=!valid;
        const values=[valid&&type===0?M._ds_tracker_read(target,0):0,M._ds_tracker_read(target,1),type];
        [note,vel,time].forEach((input,i)=>{if(document.activeElement!==input || i!==1) { if(String(input.value)!==String(values[i]))input.value=values[i]; }});
      }
    }
    if(follow&&playing&&performance.now()>pauseUntil&&play!==lastPlay){grid.scrollTop=Math.max(0,rows[play].offsetTop-grid.clientHeight/2);}
    lastPlay=play;
  }
  return {refresh};
}
