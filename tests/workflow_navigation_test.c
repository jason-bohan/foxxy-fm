/* SPDX-License-Identifier: GPL-3.0-only */
#define DS_HARNESS_ONLY 1
#include "devscreen.c"
int main(void) {
 ds_init();ds_home();assert(ds_workflow()==0);assert(ds_bpm_hit(10,25)&&!ds_bpm_hit(110,10));
 ds_tap(B_SAVE);assert(ds_workflow()==1);assert(ds_bpm_hit(195,10)&&!ds_bpm_hit(10,10));
 ds_tap(B_GLO);assert(ds_workflow()==2&&cur_btn()==B_GLO);
 ds_tap(B_SAVE);assert(ds_workflow()==1);
 ds_tap(B_HOME);assert(ds_workflow()==0);
 ds_tap(B_GLO);assert(ds_workflow()==2);
 ds_tap(B_GLO);assert(cur_fam()==FAM_GLO);
 ds_song_open();assert(ds_workflow()==1);
 ds_mixer_open();assert(ds_workflow()==2);
 ds_home();assert(ds_workflow()==0);vis_open();assert(ds_workflow()==-1);ds_home();assert(ds_workflow()==0);
 press(B_GLO);frames(20);assert(ui.layer==LY_MIX);release(B_GLO);frames(2);
 puts("Workflow navigation: Tracks, Song and Mixer shortcuts, button light and preserved GLO hold PASS");
}
