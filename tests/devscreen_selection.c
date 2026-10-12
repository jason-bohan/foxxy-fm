/* Mouse selection is transient UI state; patterns remain the firmware source. */
static int seq_selection_edit(int field,int value,int relative);
static uint8_t seq_sel_track=0xffu;
static uint32_t seq_sel[2],seq_sel_gen;
static uint16_t seq_sel_lanes[NSTEP];
static uint32_t seq_sel_count(void) {
    uint32_t n=0;for(uint32_t i=0;i<NSTEP;i++)if(seq_sel[i/32u]&(1u<<(i%32u)))n++;return n;
}
static int seq_selected(uint32_t track,uint32_t step,uint32_t lane) {
    if(track!=seq_sel_track || step>=NSTEP || !(seq_sel[step/32u]&(1u<<(step%32u))))return 0;
    return lane>=16u || !!(seq_sel_lanes[step]&(1u<<lane));
}
static void seq_selection_clear(void) {
    seq_sel[0]=seq_sel[1]=0;memset(seq_sel_lanes,0,sizeof seq_sel_lanes);seq_sel_track=0xffu;seq_sel_gen++;ui.force=1;
}
/* SPDX-License-Identifier: GPL-3.0-only */
static int __attribute__((noinline, minsize)) seq_selection_add(int target,uint32_t op)
{
    if(op==4u){seq_selection_clear();return 1;}
    uint32_t track=(uint32_t)target>>11,lane=((uint32_t)target>>6)&31u,step=(uint32_t)target&63u;
    if(target<0||track>=NTRK||step>=trk_len(&trk[track])||lane>16u)return 0;
    if(op==0u || seq_sel_track!=track)seq_selection_clear();
    seq_sel_track=(uint8_t)track;uint32_t bit=1u<<(step%32u);
    uint16_t mask=(uint16_t)(lane>=16u?65535u:1u<<lane);
    if(op==2u)seq_sel_lanes[step]^=mask;
    else if(op==3u)seq_sel_lanes[step]&=~mask;
    else seq_sel_lanes[step]|=mask;
    if(seq_sel_lanes[step])seq_sel[step/32u]|=bit;else seq_sel[step/32u]&=~bit;
    seq_sel_gen++;ui.force=1;return 1;
}
/* One undo snapshot for the complete group, including locks and drum metadata. */
static int __attribute__((noinline, minsize)) seq_selection_edit(int field,int value,int relative)
{
    if(seq_sel_track>=NTRK||!seq_sel_count()||field<0||field>5)return 0;
    if(song.rec || ft_on || rec_wait)return 0;
#if FELUCCA_ARRANGER
    if(song.playing && arrangement_enabled)return 0;
#endif
    if(field==3 && value!=1&&value!=2&&value!=3&&value!=4&&value!=6)return 0;
    track_t *t=&trk[seq_sel_track];
    /* Reserve all six-hit metadata before mutating anything. */
    if(field==3 && value==6) {
        uint32_t needed=0,free=0;
        for(uint32_t i=0;i<NLOCK;i++)if(t->lock[i].step==LOCK_FREE)free++;
        for(uint32_t i=0;i<trk_len(t);i++)if(seq_selected(seq_sel_track,i,16)&&lock_find(t,i,LOCK_RATCHET6,0)<0 &&
            (is_drum(t)?(dstep_mask(&t->dstep[i])&seq_sel_lanes[i]):t->step[i].n))needed++;
        if(needed>free)return -1;
    }
    fm1_irq_off();undo_mark(t,(undo_sess+=4u)|3u);
    for(uint32_t idx=0;idx<trk_len(t);idx++) {
        if(!seq_selected(seq_sel_track,idx,16))continue;
        step_t *s=&t->step[idx];uint32_t mask=is_drum(t)?seq_sel_lanes[idx]:((1u<<s->n)-1u);
        if(field==5){t->micro[idx]=(int8_t)clamp(relative?t->micro[idx]+value:value,-24,24);continue;}
        if(field==2 && value==ST_REST && !relative) {
            if(is_drum(t)){for(uint32_t lane=0;lane<16u;lane++)if(mask&(1u<<lane))dstep_clr(&t->dstep[idx],lane);ratchet_clear6(t,idx,mask);}
            else {memset(s,0,sizeof *s);s->time=ST_REST;}
            if(is_drum(t)?!dstep_mask(&t->dstep[idx]):!s->n){lock_del(t,idx,P_COUNT);t->micro[idx]=0;step_fill_set(t,idx,FC_NORM);}
            continue;
        }
        if(field==3) {
            mask &= is_drum(t)?dstep_mask(&t->dstep[idx]):mask;
            if(!mask)continue;ratchet_clear6(t,idx,mask);
            if(value==6){int k=lock_find(t,idx,LOCK_RATCHET6,1);if(k>=0){if(t->lock[k].step==LOCK_FREE)t->lock[k].val=0;t->lock[k].step=(uint8_t)idx;t->lock[k].param=LOCK_RATCHET6;t->lock[k].val=(int16_t)((uint16_t)t->lock[k].val|mask);}}
            uint32_t rat=value==6?3u:(uint32_t)value-1u;
            for(uint32_t lane=0;lane<(is_drum(t)?16u:s->n);lane++)if(mask&(1u<<lane)){
                if(is_drum(t))dstep_set(&t->dstep[idx],lane,dstep_lvl(&t->dstep[idx],lane),rat);
                else s->rat=(uint8_t)((s->rat&~(3u<<(lane*2u)))|(rat<<(lane*2u)));
            }
            continue;
        }
        if(is_drum(t)) {
            if(field==0 && !relative) {
                uint32_t lane=lane_of_note(value);if(lane>=16u)continue;
                for(uint32_t old=0;old<16u;old++)if(mask&(1u<<old)){dstep_clr(&t->dstep[idx],old);ratchet_clear6(t,idx,1u<<old);}
                dstep_set(&t->dstep[idx],lane,LV_NORM,0);
            } else for(uint32_t lane=0;lane<16u;lane++)if(mask&(1u<<lane)) {
                if(field==1){int old=dstep_lvl(&t->dstep[idx],lane)==LV_HARD?127:dstep_lvl(&t->dstep[idx],lane)==LV_GHOST?40:dstep_lvl(&t->dstep[idx],lane)==LV_SOFT?72:100;dstep_set(&t->dstep[idx],lane,vel_lvl(clamp(relative?old+value:value,1,127)),dstep_rat(&t->dstep[idx],lane));}
                else if(field==2 && value==ST_NOTE)dstep_set(&t->dstep[idx],lane,LV_NORM,0);
            }
        } else if(field==0) {
            if(!s->n && relative)continue;
            if(!s->n){s->n=1;s->vel=100;s->lvl=LV_NORM;}
            int delta=relative?value:value-s->note[0],lo=127,hi=0;
            for(uint32_t j=0;j<s->n;j++){if(s->note[j]<lo)lo=s->note[j];if(s->note[j]>hi)hi=s->note[j];}
            delta=clamp(delta,1-lo,127-hi);
            for(uint32_t j=0;j<s->n;j++)s->note[j]=(uint8_t)(s->note[j]+delta);
            s->time=ST_NOTE;
        } else if(field==1){s->vel=(uint8_t)clamp(relative?s->vel+value:value,1,127);for(uint32_t j=0;j<s->n;j++)s->lvl=(uint8_t)((s->lvl&~(3u<<(j*2u)))|vel_lvl(s->vel)<<(j*2u));}
        else if(field==2){s->time=(uint8_t)clamp(relative?s->time+value:value,ST_NOTE,ST_REST);}
        else if(field==4){int f=(s->flags&SF_ACCENT?1:0)|(s->flags&SF_SLIDE?2:0);f=clamp(relative?f+value:value,0,3);s->flags=(uint8_t)((s->flags&~(SF_ACCENT|SF_SLIDE))|(f&1?SF_ACCENT:0)|(f&2?SF_SLIDE:0));}
    }
    t->seq_active=1;seq_sel_gen++;sync_reload=1;ui.force=1;fm1_irq_on();return 1;
}
/* Browser clipboard only: hardware patterns and controls do not carry selection state. */
static track_t seq_clip,seq_paste_work;
static uint16_t seq_clip_lanes[NSTEP];
static uint32_t seq_clip_first,seq_clip_last;
static int seq_clip_valid,seq_clip_drum;
static int seq_copy(void) {
    if(seq_sel_track>=NTRK||!seq_sel_count())return 0;
    seq_clip=trk[seq_sel_track];memcpy(seq_clip_lanes,seq_sel_lanes,sizeof seq_clip_lanes);
    seq_clip_first=0;while(!seq_clip_lanes[seq_clip_first])seq_clip_first++;
    seq_clip_last=NSTEP-1;while(!seq_clip_lanes[seq_clip_last])seq_clip_last--;
    seq_clip_drum=is_drum(&seq_clip);seq_clip_valid=1;return 1;
}
static int seq_paste(uint32_t track,uint32_t start) {
    if(!seq_clip_valid||track>=NTRK||song.rec||ft_on||rec_wait)return 0;
    track_t *t=&trk[track];
    if(is_drum(t)!=seq_clip_drum||start+seq_clip_last-seq_clip_first>=trk_len(t))return 0;
    seq_paste_work=*t;track_t *w=&seq_paste_work;
    for(uint32_t i=seq_clip_first;i<=seq_clip_last;i++)if(seq_clip_lanes[i]) {
        uint32_t dst=start+i-seq_clip_first;
        if(seq_clip_drum){for(uint32_t lane=0;lane<16;lane++)if(seq_clip_lanes[i]&(1u<<lane)) {
            dstep_clr(&w->dstep[dst],lane);
            if(dstep_has(&seq_clip.dstep[i],lane))dstep_set(&w->dstep[dst],lane,dstep_lvl(&seq_clip.dstep[i],lane),dstep_rat(&seq_clip.dstep[i],lane));
        }}else w->step[dst]=seq_clip.step[i];
        w->micro[dst]=seq_clip.micro[i];step_fill_set(w,dst,step_fill(&seq_clip,i));
        if(seq_clip_drum)ratchet_clear6(w,dst,seq_clip_lanes[i]);else lock_del(w,dst,P_COUNT);
        for(uint32_t j=0;j<NLOCK;j++)if(seq_clip.lock[j].step==i){
            int k=lock_find(w,dst,seq_clip.lock[j].param,1);if(k<0)return -1;
            uint16_t keep=(w->lock[k].step!=LOCK_FREE&&seq_clip_drum&&seq_clip.lock[j].param==LOCK_RATCHET6)?(uint16_t)w->lock[k].val:0;
            w->lock[k]=seq_clip.lock[j];w->lock[k].step=(uint8_t)dst;
            if(w->lock[k].param==LOCK_RATCHET6 && seq_clip_drum)w->lock[k].val=(w->lock[k].val&seq_clip_lanes[i])|keep;
        }
    }
    fm1_irq_off();undo_mark(t,(undo_sess+=4u)|3u);
    memcpy(t->step,w->step,sizeof t->step);memcpy(t->micro,w->micro,sizeof t->micro);
    memcpy(t->fill,w->fill,sizeof t->fill);memcpy(t->lock,w->lock,sizeof t->lock);
    t->seq_active=1;sync_reload=1;ui.force=1;fm1_irq_on();return 1;
}
