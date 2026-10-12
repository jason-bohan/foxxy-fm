/* SPDX-License-Identifier: GPL-3.0-only */
#define DEVSCREEN_TAPE_STUDIO 1
#define DS_HARNESS_ONLY 1
#include "devscreen.c"
int main(void) {
    ds_init();ds_tape_open();assert(ds_tape_read(18)==1&&ds_tape_read(14)==360000);
    at.length=at.out=64;at.recorded=1;at_write(0,0,1234);at.drive=25;
    at.in=0;assert(at_lift(0)==1);assert(at.clip_len==64);
    assert(ds_tape_mode(0));assert(ds_tape_read(18)==0&&ds_tape_read(14)==15000&&!at.length&&!at.clip_len);
    at_acquire();at.length=at.out=32;at.recorded=1;at_write(0,0,-2345);at.drive=70;
    assert(ds_tape_mode(1));assert(at.length==64&&at_read(0,0)==1234&&at.drive==25&&at.clip_len==64);
    assert(ds_tape_mode(0));assert(at.length==32&&at_read(0,0)==-2345&&at.drive==70);
    at.head=(int64_t)(AT_N-1)*256;at.recording=at.playing=1;at.loop=0;
    int32_t l[1]={1000},r[1]={1000};at_process(l,r,1);
    assert(!at.recording&&!at.playing&&at.length==AT_N&&at.length/AT_RATE==15);
    assert(!ds_tape_mode(2));
    assert(ds_tape_mode(1));assert(at.length==64&&!at.recording&&!at.playing);
    puts("Tape modes: separate audio/settings/clipboard, 15-second cap, stopped transport and six-minute studio PASS");
}
