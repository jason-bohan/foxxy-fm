/* SPDX-License-Identifier: GPL-3.0-only */
/* Original, sample-free sounds for Pocket Fox; independent of the Meow effect. */
static struct {uint32_t left,total,phase,flutter,seed;int32_t noise;uint8_t kind;} fox_voice;
static void __attribute__((noinline,minsize)) fox_sound(uint32_t kind) {
    fm1_irq_off();
    fox_voice.kind=(uint8_t)kind;fox_voice.phase=fox_voice.flutter=0;
    fox_voice.noise=0;fox_voice.seed=0x193af31u;
    fox_voice.total=FS*(kind==4u?1200u:kind==3u?900u:650u)/1000u;
    fox_voice.left=fox_voice.total;fm1_irq_on();
}
static void __attribute__((noinline,minsize)) fox_audio(int32_t *l,int32_t *r,uint32_t n) {
    if(!fox_voice.left)return;
    for(uint32_t i=0;i<n&&fox_voice.left;i++) {
        uint32_t elapsed=fox_voice.total-fox_voice.left;
        int32_t t=(int32_t)((uint64_t)elapsed*1024u/fox_voice.total);
        uint32_t kind=fox_voice.kind;
        int32_t hz=kind==1u||kind==5u?420+(1024-t)*500/1024:kind==4u?85:kind==3u?120-t*60/1024:180;
        fox_voice.phase+=(uint32_t)((uint64_t)hz*0x100000000ull/FS);
        fox_voice.flutter+=(uint32_t)((uint64_t)(kind==0u?7u:27u)*0x100000000ull/FS);
        int32_t wave=sine_i(fox_voice.phase),pulse=(sine_i(fox_voice.flutter)+32768)/2;
        fox_voice.seed^=fox_voice.seed<<13;fox_voice.seed^=fox_voice.seed>>17;fox_voice.seed^=fox_voice.seed<<5;
        int32_t noise=(int32_t)(fox_voice.seed&65535u)-32768;
        fox_voice.noise+=(noise-fox_voice.noise)/6;
        if(kind==1u||kind==5u)wave=(wave*2+sine_i(fox_voice.phase*2u)+sine_i(fox_voice.phase*3u)/2)/4;
        else if(kind==2u)wave=fox_voice.noise/2;
        else if(kind==4u||kind==3u)wave=(wave+fox_voice.noise/5)*(8192+pulse)/40960;
        else wave=(wave+fox_voice.noise/2)*pulse/49152;
        int32_t env=clamp((int32_t)elapsed*32767/(FS/125u),0,32767);
        int32_t tail=clamp((int32_t)fox_voice.left*32767/(FS/16u),0,32767);
        if(tail<env)env=tail;
        int32_t x=(wave/12)*env/32768;
        l[i]+=x;r[i]+=x;fox_voice.left--;
    }
}
