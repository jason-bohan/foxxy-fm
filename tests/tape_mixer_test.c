/* SPDX-License-Identifier: GPL-3.0-only */
#define DS_HARNESS_ONLY 1
#include "devscreen.c"
int main(void)
{
    ds_init(); ds_select_track(0); ds_play(0); song.rec = rec_wait = ft_on = 0;
    /* Tape records audio, never changes the pattern. */
    step_t pattern[NSTEP];memcpy(pattern,TSEL->step,sizeof pattern);
    at_acquire();at.speed=100;at.loop=at.overdub=0;at_record();
    int32_t left[CTL],right[CTL];
    for(uint32_t block=0;block<180u;block++) {
        for(uint32_t i=0;i<CTL;i++)left[i]=right[i]=(int32_t)(6000*sin(2*M_PI*440*(block*CTL+i)/FS));
        at_process(left,right,CTL);
    }
    at_record();assert(at.length>1000 && !at.recording && at.playing && at.loop);
    assert(!memcmp(pattern,TSEL->step,sizeof pattern));
    uint32_t length=at.length;int32_t original=at_read(0,100);
    at_stop();at_seek(0);at_set(0,100);at_play();
    memset(left,0,sizeof left);memset(right,0,sizeof right);at_process(left,right,CTL);
    int64_t normal=at.head;assert(normal>0);
    at_seek(0);at_set(0,50);memset(left,0,sizeof left);memset(right,0,sizeof right);at_process(left,right,CTL);
    assert(at.head==normal/2 && at_read(0,100)==original);
    at_seek((int64_t)(length-1u)*256);at_set(0,-100);int64_t reverse=at.head;
    memset(left,0,sizeof left);memset(right,0,sizeof right);at_process(left,right,CTL);assert(at.head<reverse);
    at_set(8,200);at_set(9,800);at_seek((int64_t)at.in*256);at_set(0,-100);
    memset(left,0,sizeof left);memset(right,0,sizeof right);at_process(left,right,CTL);assert(at.head>=(int64_t)at.in*256 && at.head<(int64_t)at.out*256);
    at_stop();at_set(8,0);at_set(9,500);assert(at_lift(0)==1);uint32_t clip=at.clip_len;
    assert(at_lift(1)==1 && at_read(0,100)==0);at_seek(0);assert(at_drop()==1 && at_read(0,100)==original && at.clip_len==clip);
    at_set(0,50);at_set(1,42);at.pan[0]=-20;meow_set(5,1);at_memo_op(0,1);
    at_set(0,200);at_set(1,0);at.pan[0]=40;meow_set(5,0);at_memo_op(0,0);
    assert(at.speed==50 && at.drive==42 && at.pan[0]==-20 && cat.enabled);
    meow_set(5,0);at_reel(7);assert(at.scrub && at.speed==105);at_reel_release();assert(!at.scrub && at.speed==50);
    at_stop();at.selected=1;at_set(0,100);at_set(7,1);at_seek(0);at_record();
    for(uint32_t i=0;i<CTL;i++)left[i]=right[i]=1000;at_process(left,right,CTL);at_record();
    assert(at_read(1,2)>500 && at_read(0,100)==original);
    at_stop();ds_tape_open();song.rec=rec_wait=ft_on=0;ds_tap(B_REC);assert(at.recording && !song.rec && !rec_wait);ds_tap(B_REC);assert(!at.recording);
    ds_mixer_open();int level=ds_mixer_read(3,0);ds_turn(EN_K4,-10);assert(ds_mixer_read(3,0)==level-10);
    ds_mixer_set(1,1,1);assert(trk[1].p[P_MUTE]);
    ds_mixer_set(2,2,1);assert(song.solo==4 && trk_silent(&trk[0]) && !trk_silent(&trk[2]));
    ds_select_track(2);ds_tap(B_OCTUP);assert(!song.solo);ds_tap(B_OCTDN);assert(trk[2].p[P_MUTE]);
    /* Chords retain separate dynamics/ratchets when a note is removed/reordered. */
    TSEL->p[P_SLEN]=8;
    uint32_t chord=60u | 64u<<8 | 67u<<16;
    assert(ds_tracker_chord(2*64,chord,95,ST_NOTE));assert(trk[2].step[0].n==3);
    assert(ds_tracker_voice(128,0)==60 && ds_tracker_voice(128,1)==64 && ds_tracker_voice(128,2)==67);
    assert(!ds_tracker_chord(128,60u | 60u<<8,95,ST_NOTE));assert(trk[2].step[0].n==3);
    trk[2].step[0].rat=3u<<4;
    int metadata=lock_find(&trk[2],0,LOCK_RATCHET6,1);assert(metadata>=0);
    trk[2].lock[metadata]=(plock_t){.step=0,.param=LOCK_RATCHET6,.val=4};
    assert(tracker_chord_set(128,60u | 67u<<8,1));assert(trk[2].step[0].rat==3u<<2);
    assert(ratchet_hits(&trk[2],0,1,3)==6);
    assert(undo_swap(0));assert(trk[2].step[0].n==3 && trk[2].step[0].rat==3u<<4);
    assert(ratchet_hits(&trk[2],0,2,3)==6);
    ds_tracker_open();tracker_voice=1;ds_turn(EN_K2,1);assert(trk[2].step[0].note[1]==65 && trk[2].step[0].note[2]==67);
    assert(ds_tracker_drum_mask(192,5,100,ST_NOTE));assert(dstep_mask(&TDRUM->dstep[0])==5);
    assert(ds_tracker_voice(192,0)==LANE_NOTE[0] && ds_tracker_voice(192,1)==LANE_NOTE[2]);
    assert(ds_tracker_drum_mask(192,0,100,ST_REST));assert(!dstep_mask(&TDRUM->dstep[0]));
    /* Meow cannot make an animal sound: silence in gives silence out. */
    meow_set(6,MF_MEOW);meow_set(5,1);meow_clear();
    memset(left,0,sizeof left);memset(right,0,sizeof right);meow_render(left,right,CTL);
    for(uint32_t i=0;i<CTL;i++)assert(!left[i]&&!right[i]);
    /* True sideband selection: a 2 kHz sine shifts up/down by 200 Hz. */
    for(uint32_t side=0;side<2;side++) {
        meow_clear();cat.frequency=200;cat.sideband=side;cat.mix=100;cat.feedback=0;cat.time=10;
        double up_c=0,up_s=0,down_c=0,down_s=0;
        for(uint32_t block=0;block<FS/CTL;block++) {
            for(uint32_t i=0;i<CTL;i++)left[i]=right[i]=(int32_t)(10000*sin(2*M_PI*2000*(block*CTL+i)/FS));
            meow_render(left,right,CTL);
            if(block<400)continue;
            for(uint32_t i=0;i<CTL;i++) {double t=(double)(block*CTL+i)/FS;up_c+=left[i]*cos(2*M_PI*2200*t);up_s+=left[i]*sin(2*M_PI*2200*t);down_c+=left[i]*cos(2*M_PI*1800*t);down_s+=left[i]*sin(2*M_PI*1800*t);}
        }
        double up=up_c*up_c+up_s*up_s,down=down_c*down_c+down_s*down_s;
        assert(side==0?up>down*30:down>up*30);
    }
    meow_set(5,0);for(uint32_t i=0;i<CTL;i++){left[i]=100+i;right[i]=-100-i;}meow_render(left,right,CTL);
    for(uint32_t i=0;i<CTL;i++)assert(left[i]==100+i&&right[i]==-100-(int32_t)i);
    for(uint32_t type=0;type<MF_COUNT;type++) {
        meow_set(6,type);meow_set(5,1);cat.feedback=95;cat.mix=100;
        for(uint32_t b=0;b<400;b++){for(uint32_t i=0;i<CTL;i++)left[i]=right[i]=b<10?15000:0;meow_render(left,right,CTL);for(uint32_t i=0;i<CTL;i++)assert(abs(left[i])<70000);}
    }
    meow_set(5,0);ds_meow();assert(ds_meow_active());ds_tap(B_OCTUP);assert(cat.enabled);ds_tap(B_OCTDN);assert(!ds_meow_active());
    at_stop();at.length=at.in=at.out=0;at.loop=1;at_record();assert(at.recording&&!at.loop);at_stop();
    assert(ds_tape_read(18)==AT_STUDIO);assert(ds_tape_read(19)==(int)((uint64_t)AT_CLIP*1000/AT_RATE));
    puts("Audio tape capture/speed/reverse/loops/edit/memos/reels, mixer, chords, Meow sidebands and seven bounded effects PASS");
}
