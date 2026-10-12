/* SPDX-License-Identifier: GPL-3.0-only */
export function createSequencerSelection(M) {
  let anchor=-1,gesture=null;
  const encode=(track,step,lane=16)=>track<<11|lane<<6|step;
  const parse=target=>({track:target>>11,step:target&63,lane:target>>6&31});
  const current=()=>{const selected=[];for(let track=0;track<4;track++)for(let step=0;step<64;step++){if(!M._ds_seq_selected(encode(track,step)))continue;if(track===3){for(let lane=0;lane<16;lane++)if(M._ds_seq_selected(encode(track,step,lane)))selected.push(encode(track,step,lane));}else selected.push(encode(track,step));}return selected;};
  function apply(field,value,relative=0) {
    const ok=M._ds_seq_edit(field,value,relative);
    if(ok<0)document.getElementById('audio-status').textContent='No free metadata slots for this retrigger.';
    refresh();return ok;
  }
  function range(from,to,base=[]) {
    const a=parse(from),b=parse(to);if(a.track!==b.track)return;
    M._ds_seq_select(0,4);for(const target of base)M._ds_seq_select(target,1);
    const lo=Math.min(a.step,b.step),hi=Math.max(a.step,b.step);
    const ll=a.lane<16&&b.lane<16?Math.min(a.lane,b.lane):16,lh=ll===16?16:Math.max(a.lane,b.lane);
    for(let row=lo;row<=hi;row++)for(let lane=ll;lane<=lh;lane++)M._ds_seq_select(encode(a.track,row,lane),1);
  }
  function start(target,e) {
    if(target<0)return false;
    const toggle=e.ctrlKey||e.metaKey,extend=e.shiftKey,a=parse(target);
    if(anchor<0||parse(anchor).track!==a.track)anchor=target;
    const base=toggle?current():[];
    gesture={start:extend?anchor:target,target,base,toggle,extend};
    if(extend)range(anchor,target,base);
    else M._ds_seq_select(target,toggle?2:0);
    if(!extend)anchor=target;
    if(a.track!==M._ds_selected_track())M._ds_select_track(a.track);
    M._ds_tracker_select(a.track,a.step);refresh();return true;
  }
  function move(target) {
    if(!gesture||target<0||parse(target).track!==parse(gesture.start).track)return;
    if(target===gesture.target)return;gesture.target=target;range(gesture.start,target,gesture.base);refresh();
  }
  function end(){gesture=null;refresh();}
  function clear(){M._ds_seq_select(0,4);anchor=-1;refresh();}
  function selectAll(){const track=M._ds_selected_track(),n=M._ds_tracker_info(track,0);M._ds_seq_select(0,4);for(let row=0;row<n;row++)M._ds_seq_select(encode(track,row),1);anchor=encode(track,0);refresh();}
  document.addEventListener('keydown',e=>{
    if(!M._ds_seq_visible()||document.body.classList.contains('midi-learning')||document.querySelector('dialog[open]')||e.target.closest('input,select,textarea,[contenteditable=true]'))return;
    if(e.code==='Escape'){e.preventDefault();clear();}
    else if((e.ctrlKey||e.metaKey)&&e.code==='KeyA'){e.preventDefault();selectAll();}
    else if((e.ctrlKey||e.metaKey)&&e.code==='KeyC'&&M._ds_seq_count()){e.preventDefault();e.stopImmediatePropagation();M._ds_seq_copy();}
    else if((e.ctrlKey||e.metaKey)&&e.code==='KeyV'){e.preventDefault();e.stopImmediatePropagation();M._ds_seq_paste();refresh();}
    else if(M._ds_seq_count()&&(e.code==='Delete'||e.code==='Backspace')){e.preventDefault();e.stopImmediatePropagation();apply(2,2);}
  },true);
  function bindTracker(panel) {
    const grid=panel.querySelector('.tracker-scroll');let held=false;
    const targetAt=e=>{const td=e.target.closest('td[data-track]'),row=td?.closest('tr[data-row]');return td&&row?encode(+td.dataset.track,+row.dataset.row):-1;};
    grid.addEventListener('pointerdown',e=>{
      if(e.button!==0||document.body.classList.contains('midi-learning'))return;
      const control=e.target.closest('input,select,button');
      if(control&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey)return;
      const target=targetAt(e);if(target<0)return;
      e.preventDefault();e.stopPropagation();held=start(target,e);
    },true);
    grid.addEventListener('pointermove',e=>{if(held)move(targetAt(e));});
    document.addEventListener('pointerup',()=>{if(held){held=false;end();}});
    grid.addEventListener('click',e=>{if(e.shiftKey||e.ctrlKey||e.metaKey){e.preventDefault();e.stopImmediatePropagation();}},true);
  }
  let lastPaint=0;
  function refresh() {
    const visible=M._ds_seq_visible();
    if(performance.now()-lastPaint>100){
      lastPaint=performance.now();
      for(const screen of document.querySelectorAll('#scr,#screen-zoom-canvas')) {
        let overlay=screen.parentElement.querySelector('.seq-mouse-overlay');
        if(!overlay){overlay=document.createElement('canvas');overlay.className='seq-mouse-overlay';overlay.width=overlay.height=240;overlay.style.cssText='position:absolute;pointer-events:none;z-index:3';screen.parentElement.style.position='relative';screen.after(overlay);}
        overlay.style.left=screen.offsetLeft+'px';overlay.style.top=screen.offsetTop+'px';overlay.style.width=screen.offsetWidth+'px';overlay.style.height=screen.offsetHeight+'px';
        const ctx=overlay.getContext('2d');ctx.clearRect(0,0,240,240);ctx.fillStyle='rgba(255,190,60,.34)';
        if(visible&&M._ds_seq_count())for(let y=0;y<240;y+=3)for(let x=0;x<240;x+=3){const target=M._ds_seq_hit(x+1,y+1);if(target>=0&&M._ds_seq_selected(target))ctx.fillRect(x,y,3,3);}
      }
    }
    if(!visible)return;
    for(const canvas of document.querySelectorAll('#scr,#screen-zoom-canvas'))canvas.dataset.selectedSteps=String(M._ds_seq_count());
    for(const td of document.querySelectorAll('#browser-tracker td[data-track]')) {
      const row=+td.closest('tr').dataset.row;
      td.classList.toggle('multi-selected',!!M._ds_seq_selected(encode(+td.dataset.track,row)));
    }
  }
  return {start,move,end,refresh,bindTracker,apply,clear};
}
