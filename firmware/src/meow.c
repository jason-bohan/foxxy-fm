/* SPDX-License-Identifier: GPL-3.0-only */
/* MEOW is an original frequency-shifting delay effect, not an animal sample.
 * Analytic signal: windowed 31-tap Hilbert FIR at 11.025 kHz. Quadrature
 * modulation selects the upper/lower sideband; the shifted echo feeds back.
 * All modes share one fixed delay workspace; bypass is exactly transparent. */
#define MEOW_N 2048u
static int16_t meow_delay[MEOW_N];
enum { MF_MEOW, MF_DELAY, MF_PHONE, MF_PUNCH, MF_GRID, MF_SPRING, MF_NITRO, MF_COUNT };
static const char *const MEOW_FX_NAME[MF_COUNT]={"MEOW","DELAY","PHONE","PUNCH","GRID","SPRING","NITRO"};
static struct {
    volatile uint8_t enabled, type;
    int16_t frequency;
    uint8_t time, feedback, sideband, mix;
    uint32_t phase,w,sub,hi;
    int16_t history[31];
    int32_t lp, held, env, dc, filter;
    uint32_t energy;
} cat={.frequency=180,.time=60,.feedback=45,.mix=50};
static const int16_t MEOW_H[16]={-111,-192,-440,-922,-1753,-3213,-6343,-20651,20651,6343,3213,1753,922,440,192,111};
static void __attribute__((noinline, minsize)) meow_clear(void)
{
    memset(meow_delay,0,sizeof meow_delay);memset(cat.history,0,sizeof cat.history);
    cat.phase=cat.w=cat.sub=cat.hi=cat.energy=0;cat.lp=cat.held=cat.env=cat.dc=cat.filter=0;
}
static void __attribute__((noinline, minsize)) meow_trigger(int ignored)
{
    (void)ignored; fm1_irq_off();cat.enabled^=1u;meow_clear();fm1_irq_on();
}
static int32_t __attribute__((noinline, minsize)) meow_setting(uint32_t slot)
{
    switch(slot) {
    case 0:return cat.frequency;case 1:return cat.time;case 2:return cat.feedback;
    case 3:return cat.sideband;case 4:return cat.mix;case 5:return cat.enabled;case 6:return cat.type;
    default:return -1;
    }
}
static void __attribute__((noinline, minsize)) meow_set(uint32_t slot,int32_t v)
{
    fm1_irq_off();
    switch(slot) {
    case 0:cat.frequency=(int16_t)clamp(v,-1000,1000);break;
    case 1:cat.time=(uint8_t)clamp(v,1,100);break;
    case 2:cat.feedback=(uint8_t)clamp(v,0,95);break;
    case 3:cat.sideband=(uint8_t)clamp(v,0,2);break;
    case 4:cat.mix=(uint8_t)clamp(v,0,100);break;
    case 5:if(cat.enabled!=!!v){cat.enabled=!!v;meow_clear();}break;
    case 6:if(cat.type!=(uint8_t)clamp(v,0,MF_COUNT-1)){cat.type=(uint8_t)clamp(v,0,MF_COUNT-1);meow_clear();}break;
    }
    fm1_irq_on();
}
static void __attribute__((noinline, minsize)) meow_render(int32_t *l,int32_t *r,uint32_t n)
{
    if(!cat.enabled)return;
    uint32_t delay=16u+(uint32_t)cat.time*(MEOW_N-32u)/100u;
    if(cat.type==MF_GRID) {
        /* Tempo divisions, alternating quarter/eighth/dotted echoes. */
        uint32_t div=1u+cat.time/17u;
        delay=beat_samples()/(4u*div);
        if(delay>=MEOW_N/2u)delay=MEOW_N/2u-1u;
        if(delay<16u)delay=16u;
    }
    uint32_t frequency=(uint32_t)(cat.frequency<0?-cat.frequency:cat.frequency);
    uint32_t inc=(uint32_t)((uint64_t)frequency*0x100000000ull/(FS/4u));
    int32_t fb=cat.feedback*310;
    uint32_t energy=0;
    for(uint32_t i=0;i<n;i++) {
        int32_t x=clamp((l[i]+r[i])/2,-60000,60000);
        cat.lp+=(x-cat.lp)/2; /* anti-alias low pass ahead of the decimator */
        if((cat.sub++&3u)==0u) {
            int32_t echo=meow_delay[(cat.w-delay)&(MEOW_N-1u)],y=echo;
            if(cat.type==MF_MEOW) {
                cat.history[cat.hi]=(int16_t)echo;
                int32_t q=0;
                for(uint32_t k=0;k<16u;k++) {
                    int32_t p=(int32_t)cat.hi-(int32_t)(k*2u);
                    if(p<0)p+=31;
                    q+=cat.history[p]*MEOW_H[k]/32768;
                }
                int32_t p=(int32_t)cat.hi-15;if(p<0)p+=31;
                int32_t a=cat.history[p],s=sine_i(cat.phase),c=sine_i(cat.phase+0x40000000u);
                if(cat.frequency<0)s=-s;
                int32_t quadrature=cat.sideband==2u?0:mulq15(q,s);
                y=mulq15(a,c)+(cat.sideband==1u?quadrature:-quadrature);
                if(++cat.hi>=31u)cat.hi=0;
                cat.phase+=inc;
            } else if(cat.type==MF_GRID) {
                y=(echo+meow_delay[(cat.w-delay*2u)&(MEOW_N-1u)])/2;
            } else if(cat.type==MF_SPRING) {
                /* Dispersive all-pass echo train, with a damped feedback loop. */
                int32_t a=meow_delay[(cat.w-173u)&(MEOW_N-1u)];
                y=(echo+a-meow_delay[(cat.w-379u)&(MEOW_N-1u)])/2;
                cat.filter+=(y-cat.filter)/4;y=(y+cat.filter)/2;
            }
            int32_t input=cat.lp/2;
            if(cat.type==MF_PHONE) {
                cat.dc+=(input-cat.dc)/8;cat.filter+=(input-cat.filter)/2;
                y=softclip((cat.filter-cat.dc)*4)/2;
            } else if(cat.type==MF_PUNCH) {
                int32_t a=input<0?-input:input;
                cat.env+=(a-cat.env)/(a>cat.env?2:256);
                int32_t threshold=2500+cat.time*90;
                int32_t g=cat.env>threshold?threshold*32768/(cat.env|1):32768;
                y=mulq15(input,g)*(100+cat.feedback)/100;
            } else if(cat.type==MF_NITRO) {
                int32_t a=input<0?-input:input;cat.env+=(a-cat.env)/32;
                int32_t k=clamp(1000+cat.time*180+cat.env*cat.feedback/100,1000,30000);
                cat.filter+=mulq15(input-cat.filter,k);y=cat.filter;
                if(cat.sideband==1u)y=input-y;
            }
            meow_delay[cat.w++&(MEOW_N-1u)]=(int16_t)clamp(input+mulq15(clamp(y,-32768,32767),fb),-32768,32767);
            cat.held=y*2;
        }
        int32_t wet=cat.held, mix=cat.mix;
        l[i]=l[i]*(100-mix)/100+wet*mix/100;
        r[i]=r[i]*(100-mix)/100+wet*mix/100;
        energy+=(uint32_t)(wet<0?-wet:wet);
    }
    cat.energy=energy/(n?n:1u);
}

static int16_t cat_memo[2][7];
static void __attribute__((noinline, minsize)) meow_memo_op(uint32_t slot,int save)
{
    if(slot>=2u)return;
    if(save)for(uint32_t i=0;i<7u;i++)cat_memo[slot][i]=(int16_t)meow_setting(i);
    else {
        cat.frequency=cat_memo[slot][0];cat.time=(uint8_t)cat_memo[slot][1];cat.feedback=(uint8_t)cat_memo[slot][2];
        cat.sideband=(uint8_t)cat_memo[slot][3];cat.mix=(uint8_t)cat_memo[slot][4];cat.enabled=(uint8_t)cat_memo[slot][5];cat.type=(uint8_t)cat_memo[slot][6];
        meow_clear();
    }
}
