/* SPDX-License-Identifier: GPL-3.0-only */
#define DS_HARNESS_ONLY 1
#include "devscreen.c"
int main(void) {
    ds_init();ds_play(0);ds_home();
    uint16_t expected[240*240];memcpy(expected,screen,sizeof expected);
    void (*open[])(void)={ds_meow,ds_tape_open,ds_mixer_open,ds_fox_open};
    for(unsigned i=0;i<4;i++) {
        open[i]();ds_home();
        assert(!memcmp(expected,screen,sizeof expected));
        assert(cv_oy==0);
        open[i]();ds_tap(B_HOME);assert(cur_page()->scope==SC_TRK);assert(cv_oy==0);
        ds_home();assert(!memcmp(expected,screen,sizeof expected));
    }
    puts("Home redraw: Meow FX, tape, mixer and Pocket Fox return to the complete Tracks screen PASS");
}
