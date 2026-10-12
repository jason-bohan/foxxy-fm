/* SPDX-License-Identifier: GPL-3.0-only */
#define DS_HARNESS_ONLY 1
#include "devscreen.c"
int main(void) {
    ds_init();ds_fox_open();assert(cur_page()->scope==SC_FOX);
    fox.food=40;fox_act(0);assert(fox.food==58);
    fm1_ms+=701;fox.fun=20;fox.energy=50;fox_act(1);assert(fox.fun==40&&fox.energy==42);
    fm1_ms+=701;fox.clean=10;fox_act(2);assert(fox.clean==100);
    fm1_ms+=701;fox_act(3);assert(fox.sleeping);
    fox.clock=fm1_ms;fm1_ms+=120000;fox_tick();assert(fox.energy==50&&fox.food==56);
    uint8_t food=fox.food;fox_act(0);assert(fox.food==food);
    fm1_ms+=701;fox_act(3);assert(!fox.sleeping);
    ds_fox_restore(0,999);assert(ds_fox_read(0)==100);
    ds_fox_restore(2,-1);assert(ds_fox_read(2)==0);
    fm1_ms+=701;fox_act(1);assert(fox.energy==0);
    uint32_t clk=clk_pos;ds_screen_pointer(200,225,1);assert(clk_pos>=clk);
    fm1_ms+=701;ds_turn(EN_SELECT,-4);assert(fox.action==0);
    fm1_ms+=701;ds_tap(B_OCTUP);assert(fox.action==0);
    ds_tap(B_OCTDN);assert(cur_page()->scope!=SC_FOX);
    assert(fox_voice.left); /* Actual actions trigger the sound voice. */
    for(uint32_t kind=0;kind<6;kind++) {
        fox_sound(kind);uint64_t energy=0;int32_t l[CTL],r[CTL];
        while(fox_voice.left){memset(l,0,sizeof l);memset(r,0,sizeof r);fox_audio(l,r,CTL);for(uint32_t i=0;i<CTL;i++){assert(l[i]==r[i]&&l[i]>=-4096&&l[i]<=4096);energy+=(uint64_t)((int64_t)l[i]*l[i]);}}
        assert(energy>1000);memset(l,0,sizeof l);memset(r,0,sizeof r);fox_audio(l,r,CTL);for(uint32_t i=0;i<CTL;i++)assert(!l[i]&&!r[i]);
    }
    song.master_q12=0;master_cur=0;dc_l=dc_r=dce_l=dce_r=lc_l1=lc_l2=lc_r1=lc_r2=0;memset(lce,0,sizeof lce);fox_sound(4);int32_t muted[CTL*2];mix_block(muted,CTL);for(uint32_t i=0;i<CTL*2;i++)assert(!muted[i]);
    puts("Pocket fox: care, sleep recovery, needs decay, bounds, mouse and hardware controls PASS");
}
