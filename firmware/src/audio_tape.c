/* SPDX-License-Identifier: GPL-3.0-only */
/* Audio tape. The browser has RAM for six minutes; the board shares the
 * punch workspace and stores companded mono at 11.025 kHz. No flash writes
 * or allocation occur in the audio callback. Tracks share one tape head. */
#if defined(__EMSCRIPTEN__) || defined(DEVSCREEN_TAPE_STUDIO)
#define AT_BROWSER 1
#endif
#ifdef AT_BROWSER
static uint8_t at_studio=1;
#define AT_STUDIO at_studio
#define AT_TITLE (at_studio?"STUDIO TAPE":"LOOP TAPE")
#define AT_HINT (at_studio?"6 MIN / TRACK":"15 SEC / TRACK")
#define AT_RATE FS
#define AT_N (FS * (at_studio?360u:15u))
#define AT_CLIP (FS * (at_studio?12u:15u))
static int16_t at_pcm[4][FS*360u],at_loop_pcm[4][FS*15u];
static int16_t at_studio_clip[FS*12u],at_loop_clip[FS*15u];
#define at_clip (at_studio?at_studio_clip:at_loop_clip)
#else
#define AT_STUDIO 0
#define AT_TITLE "LOOP TAPE"
#define AT_HINT "1.49 SEC / TRACK"
#define AT_RATE (FS / 4u)
#define AT_N (PUNCH_N / 2u)
#define AT_CLIP 2048u
static uint8_t at_clip[AT_CLIP];
#endif
static void __attribute__((noinline, minsize)) meow_memo_op(uint32_t slot,int save);
typedef struct {
    volatile uint8_t owned, playing, recording, loop, selected, overdub, brake, scrub;
    int8_t pan[4], eq[3];
    uint8_t recorded, mute, solo, level[4], drive, wow, hiss, bits, clip_track;
    int16_t speed, resume_speed;
    uint32_t length, in, out, clip_len, split, phase, seed;
    int64_t head;                     /* Q8 source samples; wide enough for six minutes */
    int32_t eq_low[2],eq_high[2];
    int32_t lp, lp_r, rec_sum, rec_n, tail, gain, last;
    uint32_t last_write;
} at_state_t;
static at_state_t at = {.speed=100, .resume_speed=100, .level={100,100,100,100}, .seed=0x193af31u, .last_write=0xffffffffu};
typedef struct {
    int16_t speed;
    uint8_t drive, wow, hiss, bits, mute, solo, level[4];
    int8_t pan[4],eq[3];
    int16_t global[G_COUNT];
    int16_t instrument_pan[NTRK], track_level[NTRK];
} at_memo_t;
static at_memo_t at_memo[2];
static uint8_t at_memo_valid;
#ifdef AT_BROWSER
static at_state_t at_saved[2];
static at_memo_t at_saved_memo[2][2];
static uint8_t at_saved_valid,at_saved_memo_valid[2];
static int at_mode_set(int studio) {
    if(studio<0||studio>1)return 0;
    if(studio==at_studio)return 1;
    fm1_irq_off();
    at.playing=at.recording=at.brake=at.scrub=0;at.gain=0;
    at_saved[at_studio]=at;memcpy(at_saved_memo[at_studio],at_memo,sizeof at_memo);
    at_saved_memo_valid[at_studio]=at_memo_valid;at_saved_valid|=1u<<at_studio;
    at_studio=(uint8_t)studio;
    if(at_saved_valid&(1u<<studio))at=at_saved[studio];
    else at=(at_state_t){.speed=100,.resume_speed=100,.level={100,100,100,100},.seed=0x193af31u,.last_write=0xffffffffu};
    memcpy(at_memo,at_saved_memo[studio],sizeof at_memo);at_memo_valid=at_saved_memo_valid[studio];
    fm1_irq_on();return 1;
}
#endif


#ifndef AT_BROWSER
/* G.711-style logarithmic companding, eight bits with thirteen-bit resolution
 * near silence. Zero has a canonical representation so fresh tape is silent. */
static uint8_t __attribute__((noinline, minsize)) at_pack(int32_t x)
{
    int sign=x<0; uint32_t a=(uint32_t)(sign ? -x : x), e=0;
    a=(uint32_t)clamp((int32_t)a,0,32767)+132u;
    while (a>255u && e<7u) { a>>=1; e++; }
    return (uint8_t)((sign<<7) | (e<<4) | ((a>>3)&15u));
}
static int32_t __attribute__((noinline, minsize)) at_unpack(uint8_t x)
{
    int32_t a=(((int32_t)(x&15u)*8+132)<<(x>>4&7u))-132;
    return x&128u ? -a : a;
}
#endif
static int32_t __attribute__((noinline, minsize)) at_read(uint32_t track, uint32_t p)
{
    if (p>=at.length || p>=AT_N) return 0;
#ifdef AT_BROWSER
    return at_studio?at_pcm[track][p]:at_loop_pcm[track][p];
#else
    return at_unpack(((uint8_t *)punch_ring)[track*AT_N+p]);
#endif
}
static void __attribute__((noinline, minsize)) at_write(uint32_t track, uint32_t p, int32_t x)
{
    if (p>=AT_N) return;
#ifdef AT_BROWSER
    if(at_studio)at_pcm[track][p]=(int16_t)clamp(x,-32768,32767);else at_loop_pcm[track][p]=(int16_t)clamp(x,-32768,32767);
#else
    ((uint8_t *)punch_ring)[track*AT_N+p]=at_pack(x);
#endif
}
static void __attribute__((noinline, minsize)) at_acquire(void)
{
    if (at.owned) return;
    fm1_irq_off();
    at.playing=at.recording=0; at.length=at.in=at.out=0; at.head=0;
#ifdef AT_BROWSER
    /* Browser BSS starts clear and keeps tape when opening/closing screens. */
#else
    memset(punch_ring,at_pack(0),sizeof punch_ring);
    punch_pool_locked=1;
#endif
    punch.req=punch.cur=-1; punch.g=0;
    at.owned=1; fm1_irq_on();
}
static void __attribute__((noinline, minsize)) at_record(void)
{
    at_acquire();
    fm1_irq_off();
    at.recording^=1u;
    if (at.recording) {
        at.playing=1; at.brake=0; at.last_write=0xffffffffu; at.rec_sum=at.rec_n=0;
        if (!at.speed) at.speed=100;
        if (!at.length) {at.head=0;at.loop=0;}
        else if ((uint32_t)(at.head>>8)>=at.length) at.head=at.speed<0 ? (int64_t)(at.length-1u)*256 : 0;
    } else if (at.length) { at.out=at.length; at.loop=1; }
    fm1_irq_on();
}
static void __attribute__((noinline, minsize)) at_play(void)
{
    at_acquire(); fm1_irq_off();
    if (at.recording) { at.recording=0; at.out=at.length; at.loop=1; }
    else if (at.length) {
        at.playing^=1u; at.brake=0;
        if (!at.speed) at.speed=at.resume_speed ? at.resume_speed : 100;
        if ((uint32_t)(at.head>>8)>=at.length) at.head=0;
    }
    fm1_irq_on();
}
static void __attribute__((noinline, minsize)) at_stop(void) { fm1_irq_off(); at.playing=at.recording=at.brake=0; fm1_irq_on(); }
static void __attribute__((noinline, minsize)) at_seek(int64_t p)
{
    fm1_irq_off();
    int64_t end=(int64_t)(at.length ? at.length-1u : 0u)*256;
    at.head=p<0 ? 0 : p>end ? end : p;
    at.last_write=0xffffffffu;
    fm1_irq_on();
}
static void __attribute__((noinline, minsize)) at_reel(int32_t delta)
{
    if (!at.length || at.recording) return;
    /* A reel revolution moves one second of tape. Hold the reel still to stop. */
    fm1_irq_off();
    if (!at.scrub) at.resume_speed=at.speed;
    at.scrub=1; at.speed=(int16_t)clamp(delta*15,-400,400);
    at.tail=AT_RATE/12u;
    fm1_irq_on();
}
static void __attribute__((noinline, minsize)) at_reel_release(void)
{
    fm1_irq_off(); at.scrub=0; at.speed=at.resume_speed; at.tail=0; fm1_irq_on();
}
static void __attribute__((noinline, minsize)) at_memo_op(uint32_t slot, int save)
{
    if (slot>=2u) return;
    fm1_irq_off(); at_memo_t *m=&at_memo[slot];
    if (save) {
        m->speed=at.speed; m->drive=at.drive; m->wow=at.wow; m->hiss=at.hiss; m->bits=at.bits;
        m->mute=at.mute; m->solo=at.solo; memcpy(m->level,at.level,4);memcpy(m->pan,at.pan,4);memcpy(m->eq,at.eq,3);
        memcpy(m->global,song.g,sizeof m->global);
        for (uint32_t i=0;i<NTRK;i++) { m->instrument_pan[i]=trk[i].p[P_PAN]; m->track_level[i]=trk[i].p[P_LEVEL]; }
        at_memo_valid|=1u<<slot;
    } else if (at_memo_valid&(1u<<slot)) {
        at.speed=m->speed; at.drive=m->drive; at.wow=m->wow; at.hiss=m->hiss; at.bits=m->bits;
        at.mute=m->mute; at.solo=m->solo; memcpy(at.level,m->level,4);memcpy(at.pan,m->pan,4);memcpy(at.eq,m->eq,3);
        /* Transport/sync are not memo settings. */
        for (uint32_t i=G_DTIME;i<=G_CDEPTH;i++) song.g[i]=m->global[i];
        song.g[G_DUST]=m->global[G_DUST]; song.g[G_FILT]=m->global[G_FILT];
        for (uint32_t i=0;i<NTRK;i++) { trk[i].p[P_PAN]=m->instrument_pan[i]; trk[i].p[P_LEVEL]=m->track_level[i]; }
    }
    meow_memo_op(slot,save);
    fm1_irq_on();
}
static int __attribute__((noinline, minsize)) at_lift(int cut)
{
    if (!at.length || at.recording) return 0;
    uint32_t lo=at.in, hi=at.out>lo ? at.out : at.length, n=hi-lo;
    if (!n || n>AT_CLIP) return -1; /* refuse truncation */
    at_stop();
    for (uint32_t i=0;i<n;i++) {
#ifdef AT_BROWSER
        at_clip[i]=(int16_t)at_read(at.selected,lo+i);
#else
        at_clip[i]=((uint8_t *)punch_ring)[at.selected*AT_N+lo+i];
#endif
        if (cut) at_write(at.selected,lo+i,0);
    }
    at.clip_len=n; at.clip_track=at.selected; return 1;
}
static int __attribute__((noinline, minsize)) at_drop(void)
{
    if (!at.clip_len || at.recording) return 0;
    uint32_t p=(uint32_t)(at.head>>8);
    if (p>AT_N-at.clip_len) return -1;
    at_stop();
    for (uint32_t i=0;i<at.clip_len;i++) {
#ifdef AT_BROWSER
        at_write(at.selected,p+i,at_clip[i]);
#else
        ((uint8_t *)punch_ring)[at.selected*AT_N+p+i]=at_clip[i];
#endif
    }
    if (at.length<p+at.clip_len) at.length=p+at.clip_len;
    at.recorded|=1u<<at.selected;
    at.out=at.length; return 1;
}
static int32_t __attribute__((noinline, minsize)) at_setting(uint32_t slot)
{
    switch(slot) {
    case 0:return at.speed; case 1:return at.drive; case 2:return at.wow; case 3:return at.hiss;
    case 4:return at.bits; case 5:return at.selected; case 6:return at.overdub; case 7:return at.loop;
    case 8:return at.length ? (int32_t)((uint64_t)at.in*1000u/at.length) : 0;
    case 9:return at.length ? (int32_t)((uint64_t)at.out*1000u/at.length) : 1000;
    case 10:return at.playing; case 11:return at.recording;
    case 12:return (int32_t)((uint64_t)(at.head>>8)*1000u/AT_RATE);
    case 13:return (int32_t)((uint64_t)at.length*1000u/AT_RATE);
    case 18:return AT_STUDIO;
    case 19:return (int32_t)((uint64_t)AT_CLIP*1000u/AT_RATE);
    case 14:return (int32_t)((uint64_t)AT_N*1000u/AT_RATE);
    case 15:case 16:case 17:return at.eq[slot-15u];
    default:return -1;
    }
}
static void __attribute__((noinline, minsize)) at_set(uint32_t slot,int32_t v)
{
    fm1_irq_off();
    switch(slot) {
    case 0:at.speed=(int16_t)clamp(v,-400,400); at.brake=0; break;
    case 1:at.drive=(uint8_t)clamp(v,0,100);break;
    case 2:at.wow=(uint8_t)clamp(v,0,100);break;
    case 3:at.hiss=(uint8_t)clamp(v,0,100);break;
    case 4:at.bits=(uint8_t)clamp(v,0,8);break;
    case 5:at.selected=(uint8_t)clamp(v,0,3);break;
    case 6:at.overdub=!!v;break;
    case 7:at.loop=!!v;break;
    case 15:case 16:case 17:at.eq[slot-15u]=(int8_t)clamp(v,-12,12);break;
    case 8:at.in=(uint32_t)((uint64_t)at.length*(uint32_t)clamp(v,0,999)/1000u); if(at.out<=at.in)at.out=at.in+1u;break;
    case 9:at.out=(uint32_t)((uint64_t)at.length*(uint32_t)clamp(v,1,1000)/1000u);if(at.out<=at.in)at.out=at.in+1u;break;
    }
    fm1_irq_on();
}
static void __attribute__((noinline, minsize)) at_process(int32_t *l,int32_t *r,uint32_t n)
{
    if (!at.owned || (!at.playing && !at.recording && !at.scrub && !at.gain)) return;
    int32_t speed=at.speed;
    if(at.brake) { at.speed+=(at.speed>0?-1:at.speed<0?1:0);speed=at.speed;if(!speed){at.playing=at.recording=at.brake=0;} }
    at.phase+=(uint32_t)((uint64_t)n*0xffffffffu/FS); /* one Hz wow */
    int32_t flutter=sine_i(at.phase*7u);
    int32_t wobble=(sine_i(at.phase)+flutter/4)*at.wow/32768;
    int32_t inc=(int32_t)((int64_t)speed*AT_RATE*256/(100*FS));
    inc+=inc*wobble/2500;
    for(uint32_t i=0;i<n;i++) {
        int32_t live=(l[i]+r[i])/2;
        int32_t target=(at.playing||at.scrub)&&at.length ? 32767:0;
        at.gain+=clamp(target-at.gain,-512,512);
        if(at.scrub && !at.tail) inc=0;
        if(at.tail>0)at.tail--;
        uint32_t pos=(uint32_t)(at.head>>8), frac=(uint32_t)at.head&255u;
        int32_t tape_l=0,tape_r=0;
        uint32_t lo=at.loop?at.in:0u,hi=at.loop && at.out>lo?at.out:at.length;
        for(uint32_t k=0;k<4u;k++) {
            if((at.mute&(1u<<k)) || (at.solo && !(at.solo&(1u<<k))))continue;
            if(at.recording && k==at.selected && !at.overdub)continue;
            uint32_t next=pos+1u;if(next>=hi)next=at.loop?lo:pos;
            int32_t a=at_read(k,pos),b=at_read(k,next);
            int32_t x=(a+(b-a)*(int32_t)frac/256)*at.level[k]/100;
            tape_l+=x*(64-(at.pan[k]>0?at.pan[k]:0))/64;
            tape_r+=x*(64+(at.pan[k]<0?at.pan[k]:0))/64;
        }
        int32_t pair[2]={tape_l,tape_r};
        static const uint16_t eq_gain[25]={1029,1154,1295,1453,1631,1830,2053,2304,2584,2900,3253,3651,4096,4596,5157,5786,6492,7284,8173,9170,10289,11544,12953,14533,16306};
        for(uint32_t c=0;c<2;c++) {
            int32_t tape=clamp(pair[c],-120000,120000);
            if(at.eq[0]||at.eq[1]||at.eq[2]) {
                at.eq_low[c]+=(tape-at.eq_low[c])/32;
                at.eq_high[c]+=(tape-at.eq_high[c])/3;
                int32_t low=at.eq_low[c],high=tape-at.eq_high[c],mid=at.eq_high[c]-low;
                tape=(int32_t)(((int64_t)low*eq_gain[at.eq[0]+12]+(int64_t)mid*eq_gain[at.eq[1]+12]+(int64_t)high*eq_gain[at.eq[2]+12])/4096);
                tape=clamp(tape,-120000,120000);
            }
            if(at.drive)tape=softclip(clamp(tape,-50000,50000)*(100+at.drive*2)/100);
            if(at.bits)tape=crush_bits(tape,at.bits);
            int32_t *lp=c?&at.lp_r:&at.lp;
            *lp+=(tape-*lp)*(220-at.drive)/256;
            if(at.drive)tape=*lp;
            at.seed^=at.seed<<13;at.seed^=at.seed>>17;at.seed^=at.seed<<5;
            if(at.hiss)tape+=((int32_t)(at.seed&65535u)-32768)*at.hiss/8192;
            pair[c]=mulq15(clamp(tape,-131000,131000),at.gain);
        }
        l[i]+=pair[0];r[i]+=pair[1];
        if(at.recording && inc && pos<AT_N) {
            at.rec_sum+=clamp(live,-32768,32767); at.rec_n++;
            if(pos!=at.last_write) {
                /* Average on downsampling. At high speeds fill skipped source cells. */
                int32_t x=at.rec_sum/at.rec_n;
                uint32_t begin=pos,end=pos;
                if(at.last_write!=0xffffffffu && pos>at.last_write && pos-at.last_write<=4u) begin=at.last_write+1u;
                if(at.last_write!=0xffffffffu && pos<at.last_write && at.last_write-pos<=4u) end=at.last_write-1u;
                for(uint32_t p=begin;p<=end;p++) {
                    int32_t old=at.overdub ? at_read(at.selected,p):0;
                    at_write(at.selected,p,clamp(old+x,-32768,32767));
                }
                at.recorded|=1u<<at.selected;
                at.last_write=pos;at.rec_sum=at.rec_n=0;
                if(at.length<pos+1u)at.length=pos+1u;
                if(!at.loop)at.out=at.length;
            }
        }
        if(at.playing||at.recording||at.scrub) {
            at.head+=inc;
            lo=at.loop?at.in:0u;hi=at.loop && at.out>lo?at.out:at.length;
            if(at.recording && !at.loop)hi=AT_N;
            int64_t a=(int64_t)lo*256,b=(int64_t)hi*256;
            if(hi>lo && (at.head<a || at.head>=b)) {
                if(at.loop) { if(at.head<a)at.head+=b-a; else at.head-=b-a; }
                else { at.head=at.head<a?a:b-256;at.playing=at.recording=0;at.out=at.length; }
            }
        }
    }
}
