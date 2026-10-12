/* SPDX-License-Identifier: GPL-3.0-only */
/* A small original virtual fox. Care state is independent of songs. Actions trigger a dedicated sound voice. */
#include "fox_tamagotchi_assets.h"
static struct {
    uint8_t food,fun,energy,clean,sleeping,action;
    uint32_t clock,acted,anim;
} fox={80,80,80,80,0,0,0,0,0};
static const char *const FOX_ACTION[]={"FEED","PLAY","CLEAN","SLEEP","PET"};
static void __attribute__((noinline,minsize)) fox_tick(void) {
    if(!fox.clock){fox.clock=fm1_ms;return;}
    uint32_t minutes=(fm1_ms-fox.clock)/60000u;
    if(!minutes)return;fox.clock+=minutes*60000u;
    int d=(int)(minutes>100u?100u:minutes);
    fox.food=(uint8_t)clamp(fox.food-d,0,100);
    fox.clean=(uint8_t)clamp(fox.clean-d,0,100);
    fox.fun=(uint8_t)clamp(fox.fun-d,0,100);
    fox.energy=(uint8_t)clamp(fox.energy+(fox.sleeping?d*4:-d),0,100);
}
static void __attribute__((noinline,minsize)) fox_act(uint32_t action) {
    fox_tick();if(action>=5u)return;fox.action=(uint8_t)action;
    if(fox.acted&&fm1_ms-fox.acted<700u)return;
    fox.acted=fm1_ms?fm1_ms:1;
    if(action==3u){fox.sleeping^=1u;fox_sound(fox.sleeping?3u:5u);ui_message(fox.sleeping?"SWEET DREAMS":"GOOD MORNING");}
    else if(fox.sleeping)ui_message("SHHH... FOX IS ASLEEP");
    else if(action==0u){fox_sound(0);fox.food=(uint8_t)clamp(fox.food+18,0,100);ui_message("NOM NOM");}
    else if(action==1u){if(fox.energy<10u)ui_message("TIME FOR A NAP");else{fox_sound(1);fox.fun=(uint8_t)clamp(fox.fun+20,0,100);fox.energy-=8;fox.clean=(uint8_t)clamp(fox.clean-4,0,100);ui_message("ZOOMIES!");}}
    else if(action==2u){fox_sound(2);fox.clean=100;ui_message("ALL CLEAN");}
    else{fox_sound(4);fox.fun=(uint8_t)clamp(fox.fun+8,0,100);ui_message("YIP YIP!");}
    ui.force=1;
}
/* a 24x24 four-colour sprite frame (2 bits a pixel through FOX_PAL), scaled up,
 * black transparent, into the canvas strip */
static void fox_sprite(int32_t x0,int32_t y0,uint32_t s,const uint8_t *f) {
    for(uint32_t y=0;y<FOX_FRAME_HEIGHT;y++)
        for(uint32_t x=0;x<FOX_FRAME_WIDTH;x++) {
            uint32_t i=y*FOX_FRAME_WIDTH+x;
            uint16_t c=FOX_PAL[(f[i>>2]>>((i&3u)*2u))&3u];
            if(!c)continue;
            for(uint32_t dy=0;dy<s;dy++)
                for(uint32_t dx=0;dx<s;dx++)
                    cv_pset(x0+(int32_t)(x*s+dx),y0+(int32_t)(y*s+dy),c);
        }
}
static void __attribute__((noinline,minsize)) fox_draw(void) {
    fox_tick();
    int32_t bob=fox.sleeping?0:(int32_t)(((fm1_ms/400u)%2u)*3u);
    for(uint32_t pass=0;pass<2;pass++) {
        cv_begin(240,120,C_BLACK);cv_oy=-(int32_t)(pass*120u);
        cv_text(4,2,&FONT_S,"POCKET FOXXY",C_WHITE);
        te_text_c(120,24,ui.msg_t?ui.msg:fox.sleeping?"NAP TIME":fox.food<25?"HUNGRY":fox.energy<25?"SLEEPY":fox.clean<25?"NEEDS A BATH":fox.fun<25?"LET'S PLAY":"HAPPY FOX",C_WHITE);
        const uint8_t *fr;                      /* the animation follows the state */
        if(fox.sleeping)fr=fox_sleep_sequence[(fm1_ms/500u)%FOX_SLEEP_FRAMES];
        else if(fox.action==1u&&fm1_ms-fox.acted<2000u)fr=fox_play_sequence[(fm1_ms/250u)%FOX_PLAY_FRAMES];
        else if(fox.action==0u&&fm1_ms-fox.acted<2000u)fr=fox_eat_sequence[(fm1_ms/300u)%FOX_EAT_FRAMES];
        else fr=fox_idle_sequence[(fm1_ms%4000u)>3800u?1u:0u];   /* blink */
        fox_sprite(84,52+bob,3u,fr);
        if(fox.sleeping)cv_text(162,56,&FONT_S,"Z z",TE_COL[0]);
        if(fox.action==1&&!fox.sleeping&&fm1_ms-fox.acted<2000u){int32_t ball=178+(fm1_ms/90u)%18u;te_disc(ball,111,6,FOX_COLOR_HIGHLIGHT);cv_line(ball,117,ball+14,125,FOX_COLOR_HIGHLIGHT);}
        const uint8_t values[]={fox.food,fox.fun,fox.energy,fox.clean};
        static const char *const labels[]={"FOOD","FUN","ENERGY","CLEAN"};
        for(uint32_t i=0;i<4;i++){int y=139+(int)i*15;cv_text(8,y,&FONT_S,labels[i],TE_COL[i]);cv_rect(68,y+3,160,8,TE_G1);cv_rect(68,y+3,values[i]*160/100,8,TE_COL[i]);}
        te_text_c(120,199,"SELECT / OCT+ CARE",TE_G3);
        for(uint32_t i=0;i<5;i++){int x=i*48;cv_rect(x+1,220,46,19,fox.action==i?TE_DIM[2]:TE_G1);te_text_c(x+24,221,FOX_ACTION[i],C_WHITE);}
        cv_oy=0; /* Restore screen coordinates before returning to another page. */
        cv_blit(0,pass*120u);
    }
}
