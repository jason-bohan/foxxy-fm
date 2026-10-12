/* SPDX-License-Identifier: GPL-3.0-only */
#define DS_HARNESS_ONLY 1
#include "devscreen.c"
int main(void) {
    ds_init();ds_open_family(FAM_ENV);ds_audio_enable(1);song.playing=1;
    at_acquire();at.length=at.out=1024;at.loop=at.playing=1;
    uint32_t clock=clk_pos;int64_t head=at.head;int bpm=ds_bpm();
    for(int i=0;i<40;i++) {ds_turn(EN_K1,i%2?1:-1);ds_key(0,i%2);ds_mixer_set(0,0,75);ds_set_bpm(bpm);}
    assert(clk_pos==clock&&at.head==head&&ds_bpm()==bpm);
    ds_audio(CTL);assert(clk_pos!=clock&&at.head!=head);
    at_stop();song.playing=1;ds_audio_enable(0);clock=clk_pos;ds_frame();assert(clk_pos!=clock);
    puts("Devtool clock: control edits preserve BPM, sequencer clock and tape head; only audio advances playback PASS");
}
