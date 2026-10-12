/* SPDX-License-Identifier: GPL-3.0-only */
#define DS_HARNESS_ONLY 1
#include "devscreen.c"
int main(void)
{
    ds_init();ds_play(0);ds_select_track(0);ds_open_family(FAM_SEQ);song.rec=rec_wait=ft_on=0;
    track_t *t=&trk[0];t->p[P_SLEN]=16;
    for(uint32_t i=0;i<16;i++)t->step[i]=(step_t){.n=2,.note={60+i,64+i},.vel=100,.time=ST_NOTE,.rat=5,.lvl=5};
    assert(ds_seq_visible());assert(ds_bpm_hit(50,10)&&!ds_bpm_hit(50,50));

    int first=ds_seq_hit(1,100),last=ds_seq_hit(59,100);assert(first==16<<6 && (last&63)==3);
    uint32_t clk=clk_pos;ds_seq_select(first,0);ds_seq_select(last,1);assert(clk_pos==clk&&ds_seq_count()==2);
    ds_seq_select(first,2);assert(ds_seq_count()==1 && !ds_seq_selected(first));ds_seq_select(first,1);
    step_t before[16];memcpy(before,t->step,sizeof before);
    assert(ds_seq_edit(0,12,1));assert(t->step[0].note[0]==72 && t->step[0].note[1]==76 && t->step[3].note[0]==75);
    assert(t->step[1].note[0]==61 && t->step[0].rat==5);assert(undo_swap(0));assert(!memcmp(before,t->step,sizeof before));
    assert(ds_seq_edit(1,72,0));assert(t->step[0].vel==72 && t->step[3].vel==72 && t->step[1].vel==100);
    assert(ds_seq_edit(3,6,0));assert(ratchet_hits(t,0,0,3)==6 && ratchet_hits(t,3,1,3)==6 && t->step[1].rat==5);
    assert(ds_seq_edit(2,ST_REST,0));assert(!t->step[0].n&&!t->step[3].n&&t->step[1].n==2);
    assert(undo_swap(0));assert(t->step[0].n==2 && t->step[3].n==2 && ratchet_hits(t,0,0,3)==6);
    assert(ds_seq_edit(5,8,0));assert(t->micro[0]==8 && t->micro[3]==8 && t->micro[1]==0);
    ds_seq_select(0,4);assert(!ds_seq_count());
    /* Empty steps are selectable. Absolute note writes create notes in the group. */
    t->step[5].n=t->step[6].n=0;ds_seq_select(16<<6|5,0);ds_seq_select(16<<6|6,1);
    assert(ds_seq_edit(0,67,0));assert(t->step[5].note[0]==67&&t->step[6].note[0]==67);
    /* Drum rectangles select lanes, without toggling or clearing other hits. */
    TDRUM->p[P_SLEN]=16;ds_select_track(3);studio_open(SC_DRUM);drum_page=0;drum_cursor=0;
    memset(TDRUM->dstep,0,sizeof TDRUM->dstep);
    dstep_set(&TDRUM->dstep[0],0,LV_NORM,0);dstep_set(&TDRUM->dstep[0],1,LV_NORM,0);dstep_set(&TDRUM->dstep[1],0,LV_NORM,0);
    int hit=ds_seq_hit(13,87);assert(hit==(3<<11));ds_seq_select(hit,0);ds_seq_select(hit|1,1);
    assert(ds_seq_count()==2 && !ds_seq_selected(hit|(1<<6)));
    assert(ds_seq_edit(2,ST_REST,0));assert(!dstep_has(&TDRUM->dstep[0],0)&&dstep_has(&TDRUM->dstep[0],1)&&!dstep_has(&TDRUM->dstep[1],0));
    assert(undo_swap(0));assert(dstep_has(&TDRUM->dstep[0],0)&&dstep_has(&TDRUM->dstep[0],1)&&dstep_has(&TDRUM->dstep[1],0));
    assert(ds_seq_edit(1,40,0));assert(dstep_lvl(&TDRUM->dstep[0],0)==LV_GHOST&&dstep_lvl(&TDRUM->dstep[0],1)==LV_NORM);
    ds_seq_select(0,4);ds_select_track(0);ds_seq_select(16<<6,0);ds_seq_select(16<<6|3,1);
    assert(ds_seq_copy());step_t copied=t->step[0];ds_tracker_select(0,8);assert(ds_seq_paste());
    assert(!memcmp(&copied,&t->step[8],sizeof copied));assert(!memcmp(&t->step[3],&t->step[11],sizeof copied));
    assert(undo_swap(0));ds_tracker_select(0,15);assert(!ds_seq_paste());
    /* Recording guard: selection edits cannot disturb an active take. */
    song.rec=1;assert(!ds_seq_edit(2,ST_REST,0));song.rec=0;
    studio_open(SC_TRC);ui.layer=LY_PLAY;assert(ds_bpm_hit(10,10)&&!ds_bpm_hit(50,10));
    layer_tap(LY_STEP);assert(ds_bpm_hit(50,10));
    puts("Sequencer selection: empty/filled steps, toggle, chords, grouped undo, ratchets, nudge, drum lane rectangles and recording guards PASS");
}
