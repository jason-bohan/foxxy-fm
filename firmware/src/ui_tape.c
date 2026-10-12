/* SPDX-License-Identifier: GPL-3.0-only */
/* Audio tape controls, shared by hardware and browser. */
enum {TP_RECORD,TP_PLAY,TP_LOOP,TP_REVERSE,TP_BRAKE,TP_BITS,TP_LIFT,TP_DROP,
      TP_SPLIT,TP_COPY,TP_OVERDUB,TP_MUTE,TP_SOLO,TP_MEMO1,TP_MEMO2,TP_CLEAR,TP_ACTIONS};
static const char *const TAPE_ACTION[TP_ACTIONS]={"REC","PLAY","LOOP","REV","BRAKE","BITS","LIFT","DROP","SPLIT","COPY","OVERDUB","MUTE","SOLO","MEMO1","MEMO2","CLEAR"};
static uint8_t tape_action,tape_bank;
static uint32_t tape_clear_t;
static uint8_t tape_clear_track;
static void __attribute__((noinline, minsize)) tape_edit(uint32_t knob,int32_t delta)
{
    at_acquire();
    if(tape_bank==1u) { uint32_t slot=knob==3u?4u:knob+1u;at_set(slot,at_setting(slot)+delta); }
    else if(tape_bank==2u) at.level[knob]=(uint8_t)clamp(at.level[knob]+delta,0,100);
    else if(knob==0u)at_set(0,at.speed+delta);
    else if(knob==1u)at_seek(at.head+(int64_t)delta*AT_RATE*256/50);
    else if(knob==2u)at_set(8,at_setting(8)+delta*5);
    else at_set(9,at_setting(9)+delta*5);
    ui.force=1;
}
static void __attribute__((noinline, minsize)) tape_run(uint32_t action)
{
    at_acquire();if(action>=TP_ACTIONS)return;tape_action=(uint8_t)action;
    switch(action) {
    case TP_RECORD:at_record();break;case TP_PLAY:at_play();break;
    case TP_LOOP:at.loop^=1u;if(!at.out)at.out=at.length;break;
    case TP_REVERSE:at_set(0,at.speed?-at.speed:-100);if(!at.playing && at.length)at_seek((int64_t)(at.length-1u)*256);break;
    case TP_BRAKE:at.resume_speed=at.speed;at.brake=1;break;
    case TP_BITS:at.bits=at.bits?0:6;break;
    case TP_LIFT:case TP_COPY: {
        int ok=at_lift(action==TP_LIFT);ui_message(ok<0?"REGION TOO LONG":ok?"AUDIO COPIED":"RECORD AUDIO FIRST");break;
    }
    case TP_DROP: { int ok=at_drop();ui_message(ok<0?"END OF TAPE":ok?"AUDIO DROPPED":"CLIPBOARD EMPTY");break; }
    case TP_SPLIT:at.split=(uint32_t)(at.head>>8);if(at.split>at.in && at.split<at.out)at.out=at.split;ui_message("REGION SPLIT AT HEAD");break;
    case TP_OVERDUB:at.overdub^=1u;break;
    case TP_MUTE:at.mute^=1u<<at.selected;break;
    case TP_SOLO:at.solo^=1u<<at.selected;break;
    case TP_MEMO1:case TP_MEMO2: { uint32_t k=action-TP_MEMO1;int save=!(at_memo_valid&(1u<<k));at_memo_op(k,save);ui_message(save?"MEMO SAVED":"MEMO RECALLED");break; }
    case TP_CLEAR:
        if(!tape_clear_t || tape_clear_track!=at.selected || fm1_ms-tape_clear_t>2500u){tape_clear_t=fm1_ms?fm1_ms:1;tape_clear_track=at.selected;ui_message("PRESS CLEAR AGAIN");}
        else { at_stop();for(uint32_t i=0;i<at.length;i++)at_write(at.selected,i,0);tape_clear_t=0;at.recorded&=~(1u<<at.selected);
            if(!at.recorded){at.length=at.in=at.out=0;at.head=0;at.owned=0;punch_pool_locked=0;punch.req=punch.cur=-1;punch.g=0;memset(punch_ring,0,sizeof punch_ring);}
            ui_message("TAPE TRACK CLEARED"); }
        break;
    }
    ui.force=1;
}
static void __attribute__((noinline, minsize)) tape_reel(int32_t cx,uint32_t phase,uint16_t color)
{
    te_disc(cx,67,30,TE_G1);te_disc(cx,67,25,TE_G2);te_disc(cx,67,20,C_BLACK);
    for(uint32_t i=0;i<3u;i++) {
        uint32_t p=phase+i*341u;
        int32_t x=SINE[(p+256u)&1023u]*18/32768,y=SINE[p&1023u]*18/32768;
        cv_line(cx,67,cx+x,67+y,color);
    }
    te_disc(cx,67,5,color);
}
static void __attribute__((noinline, minsize)) tape_draw(void)
{
    char b[24];uint32_t phase=(uint32_t)((at.head>>8)*1024/AT_RATE);
    static const char *const transport[4]={"SPEED","HEAD","IN","OUT"};
    static const char *const tone[4]={"DRIVE","WOW","HISS","BITS"};
    for(uint32_t pass=0;pass<2u;pass++) {
        cv_begin(240,120,C_BLACK);cv_oy=-(int32_t)(pass*120u);
        cv_text(4,2,&FONT_S,AT_TITLE,C_WHITE);
        fmt_int(b,at.selected+1u);cv_text(112,2,&FONT_S,b,TE_COL[at.selected]);
        te_play_icon(218,2,at.playing);if(at.recording)te_disc(202,9,6,TE_RED);
        if(ui.msg_t)te_text_c(120,23,ui.msg,C_WHITE);
        else te_text_c(120,23,tape_bank==1u?"TONE / PRESETS BANK":tape_bank==2u?"TAPE LEVELS":AT_HINT,TE_G3);
        tape_reel(48,phase,TE_COL[at.selected]);tape_reel(192,phase,TE_COL[at.selected]);
        cv_line(48,98,192,98,TE_G3);cv_line(77,67,163,67,TE_G2);
        fmt_int(b,(int32_t)((at.head>>8)*10/AT_RATE));cv_text(96,77,&FONT_S,b,C_WHITE);
        cv_text(96,94,&FONT_S,"0.1S",TE_G3);
        for(uint32_t k=0;k<4u;k++) {
            int32_t x=(int32_t)k*60;cv_rect(x+3,114,54,7,at.mute&(1u<<k)?TE_G1:TE_DIM[k]);
            cv_rect(x+3,114,54*at.level[k]/100,7,TE_COL[k]);
            if(k==at.selected)cv_line(x+3,110,x+56,110,C_WHITE);
            if(at.solo&(1u<<k))cv_line(x+3,123,x+56,123,TE_COL[1]);
        }
        for(uint32_t i=0;i<TP_ACTIONS;i++) {
            int32_t x=(int32_t)(i%4u)*60,y=132+(int32_t)(i/4u)*18;
            int active=i==TP_RECORD?at.recording:i==TP_PLAY?at.playing:i==TP_LOOP?at.loop:i==TP_REVERSE?at.speed<0:i==TP_BITS?at.bits:i==TP_OVERDUB?at.overdub:i==TP_MUTE?!!(at.mute&(1u<<at.selected)):i==TP_SOLO?!!(at.solo&(1u<<at.selected)):0;
            cv_rect(x+1,y,58,17,active?TE_DIM[1]:TE_G1);
            if(i==tape_action)cv_line(x+1,y,x+58,y,C_WHITE);
            te_text_c(x+30,y+1,TAPE_ACTION[i],active?TE_COL[1]:C_WHITE);
        }
        for(uint32_t k=0;k<4u;k++) {
            int32_t x=(int32_t)k*60;
            const char *lab=tape_bank==1u?tone[k]:tape_bank==2u?"LEVEL":transport[k];
            cv_text(x+3,208,&FONT_S,lab,TE_COL[k]);
            int32_t v=tape_bank==1u?at_setting(k==3u?4u:k+1u):tape_bank==2u?at.level[k]:k==0u?at.speed:k==1u?at_setting(12):at_setting(k==2u?8u:9u);
            fmt_int(b,v);cv_text(x+3,225,&FONT_S,b,C_WHITE);
        }
        cv_oy=0; /* Restore screen coordinates before returning to another page. */
        cv_blit(0,pass*120u);
    }
}
static void __attribute__((noinline, minsize)) meow_draw(void)
{
    char b[24];static const char *const label[4]={"FREQ","DELAY","FDBK","SIDE"};
    static const char *const side[3]={"UP","DOWN","BOTH"};
    for(uint32_t pass=0;pass<2u;pass++) {
        cv_begin(240,120,C_BLACK);cv_oy=-(int32_t)(pass*120u);
        cv_text(4,2,&FONT_S,MEOW_FX_NAME[cat.type],C_WHITE);
        cv_text(180,2,&FONT_S,cat.enabled?"ON":"OFF",cat.enabled?TE_COL[1]:TE_G3);
        te_text_c(120,24,"SELECT FX / OCT+ ON",TE_G3);
        /* Original cat graphic: ears, face, whiskers; eyes follow the audio. */
        uint16_t c=cat.enabled?TE_COL[0]:TE_G2;
        te_disc(120,114,51,c);te_disc(120,114,46,C_BLACK);
        cv_line(76,88,74,54,c);cv_line(74,54,103,73,c);
        cv_line(164,88,166,54,c);cv_line(166,54,137,73,c);
        int32_t eye=cat.energy>200?5:2;
        te_disc(98,105,eye,TE_COL[1]);te_disc(142,105,eye,TE_COL[1]);
        cv_line(115,123,125,123,TE_COL[3]);cv_line(115,123,120,130,TE_COL[3]);cv_line(125,123,120,130,TE_COL[3]);
        cv_line(120,130,110,138,c);cv_line(120,130,130,138,c);
        for(int32_t j=-1;j<=1;j++){cv_line(86,128+j*5,54,124+j*12,c);cv_line(154,128+j*5,186,124+j*12,c);}
        fmt_int(b,cat.mix);cv_text(80,176,&FONT_S,"WET",TE_G3);cv_text(120,176,&FONT_S,b,C_WHITE);
        te_text_c(120,192,"PRESETS = WET",TE_G3);
        for(uint32_t k=0;k<4u;k++) {
            cv_text(k*60+3,208,&FONT_S,label[k],TE_COL[k]);
            if(k==3u)str_cpy(b,side[cat.sideband],sizeof b);
            else fmt_int(b,k==0u?cat.frequency:k==1u?8+cat.time*177/100:cat.feedback);
            cv_text(k*60+3,225,&FONT_S,b,C_WHITE);
        }
        cv_oy=0; /* Restore screen coordinates before returning to another page. */
        cv_blit(0,pass*120u);
    }
}
