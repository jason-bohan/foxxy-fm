/* SPDX-License-Identifier: GPL-3.0-only */
/* Copyright (C) 2026 Leo Kuroshita (@kurogedelic), Hügelton Instruments */
/* Dev screen: the REAL FELUCCA UI (gfx.c, ui.c, ui_draw.c, ui_studio.c, ui_layers.c, ui_song.c,
 * ui_menu.c, ui_input.c, ui_vis.c, splash.c) driven off-hardware, behind a small C ABI so it can
 * be compiled to WebAssembly (tools/build_devscreen.sh) and shown in the editor's dev-screen window.
 * The whole host harness of tests/ui_pages_test.c (the 240x240 framebuffer, the lcd_blit / lcd_fill
 * doubles, frame(), press / release / tap / key, panel / flash / storage doubles) is reused as is:
 * the pixels are the firmware's, not a re-drawing of them. */
static int ds_wall_clock;
static int ds_adriven;
#define UI_FRAME_AUDIO_BLOCKS() (ds_adriven ? 0u : 22u)
#define UI_FRAME_CLOCK_ADVANCE() do { if (!ds_wall_clock) fm1_ms += 16u; } while (0)
#define DEVSCREEN_SAMPLE_BANK 1
#define UI_PAGES_HARNESS_ONLY 1
#include "ui_pages_test.c"
#undef main
#include "devscreen_selection.c"

#if defined(__EMSCRIPTEN__)
#include <emscripten.h>
#define DS_API EMSCRIPTEN_KEEPALIVE
#else
#define DS_API
#endif

#ifndef DS_SCREEN_W
#define DS_SCREEN_W 240
#endif
#ifndef DS_SCREEN_H
#define DS_SCREEN_H 240
#endif

/* Power on as ui_pages_test's main does: the panel table, the palette, the four factory tracks (the
 * drum track on the 808 kit). Leaves the editor on the TRACKS (home) screen. */
DS_API void ds_init(void)
{
    uint32_t i;
    panel = PANEL_DEFAULT;
    layers_init();
    settings.palette = PALETTE_MONO;
    palette_set(PALETTE_MONO);
    host_tracks_init();
    for (i = 0; i < NPART; i++) {
        set_engine_of(&trk[i], TRK_DEF[i][0]);
        apply_preset_to(&trk[i], TRK_DEF[i][1]);
        trk[i].engine = trk[i].eng_req;
    }
    TDRUM->p[P_E0] = DRUM_DEFAULT_KIT;
    song.master_q12 = 2048;             /* main.c sets 2048 at power-on: the harness would mix at 0 */
    go_home();
    ui.force = 1;
    frame();
}

/* the frame the JS reads: 240x240 RGB565, big-endian (swap16 the u16 to recover r5g6b5) */
DS_API uint16_t *ds_screen(void) { return screen; }
DS_API int ds_width(void) { return DS_SCREEN_W; }
DS_API int ds_height(void) { return DS_SCREEN_H; }
DS_API unsigned ds_ms(void) { return fm1_ms; }
/* Logical panel buttons 0..13, then keyboard keys 14..40.
 * Read the real ui_leds output: off, backlight, guide glow, full light. */
DS_API int ds_led(int control)
{
    uint32_t id, q, bit;
    if (control < 0 || control >= 41) return 0;
    id = control < NB ? panel.btn[control] : (uint32_t)control;
    q = led_pos[id];
    if (q == 0xffu) return 0;
    bit = 1u << (q & 7u);
    if (fm1_led[q >> 3] & bit) return 3;
    if (fm1_led_dim[q >> 3] & bit) return 2;
    return fm1_led_bg_ns && (fm1_led_bg[q >> 3] & bit) ? 1 : 0;
}

/* one UI frame (~16 ms) with the audio between, as the device runs it; n frames = n*16 ms of clock */
DS_API void ds_time(uint32_t ms) { ds_wall_clock = 1; fm1_ms = ms; }
DS_API void ds_sync_set(int source) {
    if (source < 0 || source > 1) return;
    if (song.g[G_SYNC] != source) {
        song.g[G_SYNC] = (int16_t)source;
        memset(&mclk, 0, sizeof mclk);
    }
}
DS_API int ds_sync_source(void) { return song.g[G_SYNC]; }
DS_API int ds_clock_alive(void) { return mclk_on(); }
DS_API int ds_bpm_hit(int x,int y) {
    if(ui.menu||vis_shown())return 0;
    uint32_t scope=cur_page()->scope;
    if(!ui.home&&ui.layer==LY_PLAY&&(scope==SC_TAPE||scope==SC_FOX||scope==SC_MEOW||scope==SC_MIX))return 0;
    if(!ui.home&&ui.layer==LY_PLAY){
        if(scope==SC_SONG)return x>=180&&x<240&&y>=0&&y<20;
        if(scope==SC_TRK||scope==SC_DRUM||rec_wait||ft_on)return x>=4&&x<96&&y>=0&&y<38;
    }
    int compact=!ui.home&&ui.layer==LY_PLAY&&scope==SC_TRC;
    return y>=0&&y<(compact?24:20)&&x>=(compact?4:32)&&x<(compact?32:80);
}
DS_API int ds_bpm(void) { return song.g[G_BPM]; }
DS_API int ds_scope_active(void) { return vis_shown() && vis_style % VIS_N == 0; }
DS_API void ds_scope_open(void) { open_family(FAM_TRK); studio_open(SC_TRK); vis_style = 0; vis_open(); frame(); }
DS_API int ds_scope_setting(int slot) { return slot >= 0 && slot < 4 ? osc_setting(slot) : -1; }
DS_API int ds_fox_active(void) {return !ui.home&&cur_page()->scope==SC_FOX;}
DS_API void ds_fox_open(void) {vis_on=0;studio_open(SC_FOX);frame();}
DS_API int ds_fox_read(int slot) {fox_tick();return slot==0?fox.food:slot==1?fox.fun:slot==2?fox.energy:slot==3?fox.clean:slot==4?fox.sleeping:-1;}
DS_API void ds_fox_restore(int slot,int value) {uint8_t v=(uint8_t)clamp(value,0,100);if(slot==0)fox.food=v;else if(slot==1)fox.fun=v;else if(slot==2)fox.energy=v;else if(slot==3)fox.clean=v;else if(slot==4)fox.sleeping=!!value;fox.clock=fm1_ms;}
DS_API int ds_tape_mode(int studio) {
#ifdef AT_BROWSER
    if(!at_mode_set(studio))return 0;
    tape_clear_t=0;tape_bank=tape_action=0;song.sel=at.selected;ui.force=1;frame();return 1;
#else
    return studio==0;
#endif
}
DS_API int ds_tape_active(void) { return !ui.home && cur_page()->scope == SC_TAPE; }
DS_API void ds_tape_open(void) { vis_on = 0; at_acquire(); studio_open(SC_TAPE); frame(); }
DS_API void ds_tape_clear(int track) {if(track<0||track>=4)return;at.selected=(uint8_t)track;tape_clear_track=(uint8_t)track;tape_clear_t=fm1_ms?fm1_ms:1;tape_run(TP_CLEAR);frame();}
DS_API void ds_tape_action(int action) { tape_run((uint32_t)action); frame(); }
DS_API void ds_meow(void) { vis_on = 0; studio_open(SC_MEOW); frame(); }
DS_API int ds_meow_active(void) { return !ui.home && cur_page()->scope == SC_MEOW; }
DS_API int ds_meow_read(int slot) { return meow_setting((uint32_t)slot); }
DS_API void ds_meow_set(int slot,int value) { meow_set((uint32_t)slot,value); frame(); }
DS_API int ds_tape_read(int slot) { return at_setting((uint32_t)slot); }
DS_API void ds_tape_set(int slot,int value) { at_acquire();at_set((uint32_t)slot,value);frame(); }
DS_API void ds_tape_seek(int ms) { at_seek((int64_t)ms*AT_RATE*256/1000); }
DS_API void ds_tape_reel(int delta) { if(delta)at_reel(delta);else at_reel_release(); }
DS_API void ds_tape_memo(int slot,int save) { at_memo_op((uint32_t)slot,save); }
DS_API int ds_tape_mix(int track,int field,int value) {
    if(track<0||track>=4)return -1;
    if(value>=0){if(field==0)at.level[track]=(uint8_t)clamp(value,0,100);
        else if(field==1)at.mute=(at.mute&~(1u<<track))|(!!value<<track);
        else if(field==2)at.solo=(at.solo&~(1u<<track))|(!!value<<track);
        else if(field==3)at.pan[track]=(int8_t)clamp(value-64,-64,63);}
    return field==3?at.pan[track]+64:field==0?at.level[track]:field==1?!!(at.mute&(1u<<track)):!!(at.solo&(1u<<track));
}
DS_API int ds_tape_sample(int track,int index) { return track>=0&&track<4&&index>=0?at_read((uint32_t)track,(uint32_t)index):0; }
DS_API int ds_tape_rate(void) { return AT_RATE; }
DS_API int ds_tape_length(void) { return at.length; }
DS_API int ds_tape_import(int track,const float *pcm,int frames,int rate) {
    if(track<0||track>=4||!pcm||frames<=0||rate<=0)return 0;
    uint32_t n=(uint32_t)((uint64_t)frames*AT_RATE/(uint32_t)rate);
    if(n>AT_N)return -1;
    at_acquire();at_stop();
    for(uint32_t i=0;i<n;i++){uint32_t p=(uint32_t)((uint64_t)i*(uint32_t)rate/AT_RATE);at_write((uint32_t)track,i,(int32_t)(pcm[p]*32767));}
    if(n<at.length)for(uint32_t i=n;i<at.length;i++)at_write((uint32_t)track,i,0);
    if(n>at.length)at.length=n;at.recorded|=1u<<track;at.in=0;at.out=at.length;at.head=0;return 1;
}
/* Same slot format and SAMPLE/drum renderer as the board; only storage is RAM. */
DS_API int ds_sampler_load(int slot,const uint8_t *bytes,int length,int track,int drums_mode) {
    if(slot<0||slot>=4||length<512||length>SMP_USER_SIZE||track<0||track>=NTRK)return 0;
    const smp_user_hdr_t *h=(const smp_user_hdr_t *)bytes;
    if(h->magic!=SMP_USER_MAGIC||h->version!=1||!h->nz||h->nz>16||h->data_len>(uint32_t)length-512u)return 0;
    for(uint32_t i=0;i<h->nz;i++)if(!smp_zone_ok(&h->zone[i],h->data_len))return 0;
    fm1_irq_off();memcpy(ds_smp_slots[slot],bytes,(uint32_t)length);smp_user_scan((uint32_t)slot);
    if(drums_mode){track=TRK_DRUM;TDRUM->p[P_E0]=(int16_t)(DRUM_USR+slot);}
    else if(track<NPART){set_engine_of(&trk[track],4);trk[track].p[P_E0]=(int16_t)(SMP_NSETS+slot);}
    song.sel=(uint8_t)track;fm1_irq_on();ui.force=1;frame();return usr_nz[slot]>0;
}
DS_API int ds_sampler_note(int lane) { return lane>=0&&lane<16?LANE_NOTE[lane]:60; }
DS_API int ds_mixer_read(int track, int field) { return mixer_read((uint32_t)track, (uint32_t)field); }
DS_API void ds_mixer_set(int track, int field, int value) { mixer_set((uint32_t)track, (uint32_t)field, value); frame(); }
DS_API void ds_mixer_open(void) { vis_on = 0; studio_open(SC_MIX); frame(); }
DS_API void ds_scope_set(int slot, int value) { if (slot >= 0 && slot < 4) { osc_set(slot, value); frame(); } }
DS_API void ds_frame(void) { ui.force = 1; frame(); }
DS_API void ds_frames(int n) { while (n-- > 0) frame(); }

/* the panel: a button (0..NB-1: FX SEL ENV LFO EDIT GLO HOME SAVE ARP SEQ PLAY REC OCT- OCT+),
 * a key (0..15), a knob (0..NE-1: SELECT ALGORITHM PRESETS KNOB1..4) by delta. */
DS_API void ds_press(int b) { press((uint32_t)b); }
DS_API void ds_release(int b) { release((uint32_t)b); }
DS_API void ds_tap(int b) { tap((uint32_t)b); }
DS_API void ds_key(int k, int on)
{
    if (on) fm1_in.notes |= 1u << k; else fm1_in.notes &= ~(1u << k);
    frame();
}
DS_API void ds_turn(int enc, int delta) { encs[panel.enc[enc]] = delta; frame(); }

/* Mouse input uses the same firmware key/encoder paths as the panel. */
static int ds_mouse_key = -1;
DS_API int ds_screen_encoder(int x, int y)
{
    if (x < 0 || x >= 240 || y < 0 || y >= 240) return -1;
    if (ui.menu) return y >= H_HEAD + 1 + MI_Y0 && y < 240
        ? EN_K1 + (y - H_HEAD - 1 - MI_Y0) / MI_DY : EN_SELECT;
    if (!ui.home && (cur_page()->scope == SC_TAPE || cur_page()->scope == SC_MEOW)) return y >= 207 ? EN_K1 + x / 60 : EN_SELECT;
    if (!ui.home && cur_page()->scope == SC_MIX) return y >= 28 && y < 208 ? EN_K1 + (y - 28) / 45 : EN_SELECT;
    if (!ui.home && cur_page()->scope == SC_TRC && ui.layer == LY_PLAY) return EN_SELECT;
    if(!ui.home&&cur_page()->scope==SC_FOX)return EN_SELECT;
    if (y >= 184) return EN_K1 + x / 60;
    if (!ui.home && cur_page()->scope != SC_DRUM && cur_page()->scope != SC_TRK && ui.layer == LY_PLAY && y >= 40)
        return EN_K1 + x / 60;
    return EN_SELECT;
}
DS_API void ds_screen_pointer(int x, int y, int down)
{
    if (!down) {
        if (ds_mouse_key >= 0) ds_key(ds_mouse_key, 0);
        ds_mouse_key = -1; return;
    }
    if (x < 0 || x >= 240 || y < 0 || y >= 240) return;
    if (ui.menu) {
        if (ui.menu == 1 && y >= 24 && y < 44) {
            int32_t left = 4;
            for (uint32_t sec = 0; sec < MS_COUNT; sec++) {
                int32_t width = text_w(&FONT_S, MS_NAME[sec]) + 10;
                if (x >= left && x < left + width) { ui.menu_sel = MS_FIRST[sec]; ui.force = 1; frame(); return; }
                left += width;
            }
        } else if (ui.menu == 1 && y >= 47 && y < 240) {
            uint32_t sec = mi_sec(ui.menu_sel), item = MS_FIRST[sec] + (uint32_t)(y - 47) / MI_DY;
            if (item < MS_FIRST[sec + 1]) { ui.menu_sel = (uint8_t)item; ds_tap(13); }
        }
        return;
    }
    if(!ui.home&&cur_page()->scope==SC_FOX){if(y>=220)fox_act((uint32_t)x/48u);frame();return;}
    if (ds_tape_active()) {
        if (y < 20 && x >= 212) ds_tap(B_PLAY);
        else if (y >= 132 && y < 204) { tape_run((uint32_t)(y-132)/18u*4u+(uint32_t)x/60u); frame(); }
        else if (y >= 108 && y < 128) { at.selected=(uint8_t)(x/60);song.sel=at.selected; frame(); }
        return;
    }
    if (ds_meow_active()) { if(y<20 && x>=170)meow_trigger(0);frame();return; }
    if (!ui.home && cur_page()->scope == SC_MIX) {
        if (y < 20 && x >= 212) ds_tap(B_PLAY);
        else if (y >= 28 && y < 208) {
            uint32_t track = (uint32_t)(y - 28) / 45; track_select(track);
            if (x >= 152) { uint32_t field = x >= 193 ? 2 : 1; mixer_set(track, field, !mixer_read(track, field)); }
            ui.force = 1; frame();
        }
        return;
    }
    if (!ui.home && cur_page()->scope == SC_TRC && y < 24) {
        if (x >= 36 && x < 52) ds_tap(B_PLAY);
        return;
    }
    if (y < 20 && x < 28) { ds_tap(10); return; }
    if (ui.layer != LY_PLAY && y >= 40 && y < 184) {
        ds_mouse_key = (int)key_of_white((uint32_t)((y - 40) / 36 * 4 + x / 60));
        ds_key(ds_mouse_key, 1); return;
    }
    if ((ui.home || cur_page()->scope == SC_TRK) && y >= 40 && y < 184) {
        track_select((uint32_t)((y - 40) / 36)); ui.force = 1; frame(); return;
    }
    if (on_drum_page()) {
        if (x >= 196 && y >= 40 && y < 84) { drum_page = y < 62 ? 0 : 1; ui.force = 1; frame(); return; }
        if (y >= 84 && y < 184) {
            if (drum_page) {
                drum_lane = (uint8_t)((y - 84) / 25 * 4 + x / 60);
                ds_mouse_key = (int)key_of_white(drum_lane); ds_key(ds_mouse_key, 1);
            } else {
                drum_lane = (uint8_t)clamp((y - 86) / 6, 0, 15);
                if (x < 12) { audition_lane(drum_lane); ui.force = 1; frame(); }
                else { grid_key(key_of_white((uint32_t)clamp((x - 12) / 14, 0, 15))); ui.force = 1; frame(); }
            }
            return;
        }
    }
    if (!ui.home && cur_page()->scope == SC_STEP && y >= Y_GRAPH && y < Y_GRAPH + 100) {
        cursor_set(clamp(ui.bank * 16 + x / 15, 0, trk_len(TSEL) - 1));
        ui.force = 1; frame();
    }
    if (on_song_page() && y >= 42 && y < 172) {
        uint32_t start = song_cursor > 3u ? song_cursor - 3u : 0u;
        song_cursor = (uint8_t)clamp(start + (y - 42) / 26, 0, arrangement.count - 1);
        ui.force = 1; frame();
    }
    if (!ui.home && cur_page()->scope == SC_TRC && y >= TR_ROWY && y < TR_ROWY + TR_ROWS * TR_ROWH) {
        uint32_t base = tracker_base(), row = base + (y - TR_ROWY) / TR_ROWH;
        if (x >= TR_X0) track_select((uint32_t)clamp((x - TR_X0) / TR_DX, 0, NTRK - 1));
        cursor_set(clamp(row, 0, trk_len(TSEL) - 1));
        tracker_browse_base = base;
        tracker_browse_until = fm1_ms + 3000u;
        ui.force = 1; frame();
    }
}

/* navigation, mirroring the buttons: HOME, a family's page, an exact page */
DS_API int ds_tracker_cell(int x, int y)
{
    if (ui.home || ui.menu || cur_page()->scope != SC_TRC) return -1;
    if (x == -1) return song.sel * NSTEP + ui.cursor;
    if (x < TR_X0 || x >= 240 || y < TR_ROWY || y >= TR_ROWY + TR_ROWS * TR_ROWH) return -1;
    uint32_t track = clamp((x - TR_X0) / TR_DX, 0, NTRK - 1);
    uint32_t row = tracker_base() + (y - TR_ROWY) / TR_ROWH;
    return row < trk_len(&trk[track]) ? (int)(track * NSTEP + row) : -1;
}
DS_API int ds_tracker_read(int target, int field) { return tracker_read(target, field); }
DS_API int ds_tracker_voice(int target, int slot) { return tracker_voice_read(target, (uint32_t)slot); }
DS_API int ds_tracker_chord(int target, uint32_t packed, int vel, int time)
{
    if (target < 0 || target >= NPART * NSTEP || vel < 1 || vel > 127 || time < ST_NOTE || time > ST_REST) return 0;
    uint32_t seen[4] = {0}, n = 0;
    for (uint32_t i = 0; i < 4; i++) {
        uint32_t note = (packed >> (8u*i)) & 255u;
        if (note > 127) return 0;
        if (note) { for (uint32_t j = 0; j < n; j++) if (seen[j] == note) return 0; seen[n++] = note; }
    }
    if (time != ST_REST && !n) return 0;
    if (!tracker_chord_set(target, time == ST_REST ? 0 : packed, 1)) return 0;
    step_t *s = &trk[target / NSTEP].step[target % NSTEP]; s->vel = (uint8_t)vel; s->time = (uint8_t)time;
    for (uint32_t i = 0; i < s->n; i++) s->lvl = (s->lvl & ~(3u << (2u*i))) | vel_lvl(vel) << (2u*i);
    frame(); return 1;
}
DS_API int ds_tracker_drum_mask(int target, int mask, int vel, int time)
{
    if (target < TRK_DRUM * NSTEP || target >= NTRK * NSTEP || mask < 0 || mask > 65535 || vel < 1 || vel > 127 || (time != ST_NOTE && time != ST_REST)) return 0;
    uint32_t idx = target % NSTEP; track_t *t = TDRUM;
    if (idx >= trk_len(t) || (!mask && time == ST_NOTE)) return 0;
    fm1_irq_off(); undo_mark(t, (undo_sess += 4u) | 3u);
    if (time == ST_REST) mask = 0;
    for (uint32_t lane = 0; lane < 16; lane++) {
        if (mask & (1u << lane)) dstep_set(&t->dstep[idx], lane, vel_lvl(vel), dstep_rat(&t->dstep[idx], lane));
        else { dstep_clr(&t->dstep[idx], lane); ratchet_clear6(t, idx, 1u << lane); }
    }
    if (!mask) lock_del(t, idx, P_COUNT);
    t->seq_active = 1; sync_reload = 1; ui.force = 1; fm1_irq_on(); frame(); return 1;
}
DS_API const char *ds_tracker_track_name(int track)
{
    static char name[13];
    if (track < 0 || track >= NTRK) return "";
    if (track == TRK_DRUM) return DRUM_KIT_NAMES[drum_kit()];
    trk_short_name(track, name); return name;
}
DS_API int ds_tracker_drum_note(int lane) { return lane >= 0 && lane < DRUM_LANES ? LANE_NOTE[lane] : -1; }
DS_API const char *ds_tracker_drum_name(int lane) { return lane >= 0 && lane < DRUM_LANES ? LANE_NAME[lane] : ""; }
DS_API int ds_tracker_edit(int target, int note, int vel, int time)
{
    if (target < 0 || target >= NTRK * NSTEP || note < 1 || note > 127 || vel < 1 || vel > 127 || time < ST_NOTE || time > ST_REST) return 0;
    track_t *t = &trk[target / NSTEP]; uint32_t idx = target % NSTEP;
    if (idx >= trk_len(t) || (is_drum(t) && time == ST_TIE)) return 0;
    fm1_irq_off(); undo_mark(t, (undo_sess += 4u) | 3u);
    if (is_drum(t)) {
        if (time == ST_REST) { memset(&t->dstep[idx], 0, sizeof t->dstep[idx]); lock_del(t, idx, P_COUNT); }
        else {
            uint32_t old_lane = lane_of_note(tracker_read(target, 0)), lane = lane_of_note(note);
            uint32_t rat = dstep_rat(&t->dstep[idx], lane);
            if (old_lane != lane) { dstep_clr(&t->dstep[idx], old_lane); ratchet_clear6(t, idx, 1u << old_lane); }
            dstep_set(&t->dstep[idx], lane, vel_lvl(vel), rat);
        }
    } else {
        step_t *s = &t->step[idx];
        if (time == ST_REST) { memset(s, 0, sizeof *s); s->time = ST_REST; lock_del(t, idx, P_COUNT); }
        else {
            if (time == ST_NOTE) {
                if (!s->n) s->n = 1;
                s->note[0] = note; s->vel = vel;
                for (uint32_t n = 0; n < s->n; n++) s->lvl = (s->lvl & ~(3u << (2u*n))) | vel_lvl(vel) << (2u*n);
            }
            s->time = (uint8_t)time;
        }
    }
    t->seq_active = 1; sync_reload = 1; ui.force = 1;
    fm1_irq_on(); frame(); return 1;
}
DS_API int ds_tracker_info(int track, int field)
{
    if (track < 0 || track >= NTRK) return -1;
    return field == 0 ? (int)trk_len(&trk[track]) : (int)trk[track].seq_idx;
}
DS_API void ds_tracker_open(void) { open_family(FAM_TRC); ui.force = 1; frame(); }
DS_API void ds_tracker_select(int track, int row)
{
    if (track < 0 || track >= NTRK) return;
    track_select(track); cursor_set(clamp(row, 0, trk_len(TSEL) - 1));
    tracker_browse_base = ui.cursor > 7 ? ui.cursor - 7 : 0;
    tracker_browse_until = fm1_ms + 3000u; ui.force = 1; frame();
}
DS_API int ds_tracker_update(int target, int field, int value)
{
    int ok = tracker_update(target, field, value); if (ok) frame(); return ok;
}
DS_API int ds_seq_visible(void) {
    return !ui.menu && (ui.layer==LY_STEP || (!ui.home && (cur_page()->scope==SC_STEP || cur_page()->scope==SC_TRC || (on_drum_page()&&!drum_page))));
}
DS_API int ds_seq_hit(int x,int y) {
    if(x<0||x>=240||y<0||y>=240||!ds_seq_visible())return -1;
    uint32_t track=song.sel,lane=16,idx=NSTEP;
    if(ui.layer==LY_STEP && y>=40&&y<184){idx=ui.step_page*16u+(y-40)/36*4+x/60;if(is_drum(TSEL))lane=pen_lane;}
    else if(on_drum_page()&&!drum_page&&y>=86&&y<182&&x>=12&&x<236){track=TRK_DRUM;lane=(y-86)/6;idx=drum_cursor/16u*16u+(x-12)/14;}
    else if(!ui.home&&cur_page()->scope==SC_STEP&&y>=74&&y<174)idx=ui.bank*16u+x/15;
    else if(!ui.home&&cur_page()->scope==SC_TRC){int target=ds_tracker_cell(x,y);if(target>=0){track=(uint32_t)target/64u;idx=(uint32_t)target%64u;}}
    if(idx>=trk_len(&trk[track]))return -1;
    return (int)(track<<11|lane<<6|idx);
}
DS_API int ds_seq_select(int target,int op) { int ok=seq_selection_add(target,(uint32_t)op);ui.force=1;return ok; }
DS_API int ds_seq_selected(int target) {return target>=0?seq_selected((uint32_t)target>>11,(uint32_t)target&63u,((uint32_t)target>>6)&31u):0;}
DS_API int ds_seq_count(void) {return seq_sel_count();}
DS_API int ds_seq_copy(void) {return seq_copy();}
DS_API int ds_seq_paste(void) {int ok=seq_paste(song.sel,ui.cursor);if(ok)frame();return ok;}
DS_API int ds_seq_edit(int field,int value,int relative) {int ok=seq_selection_edit(field,value,relative);if(ok>0)frame();return ok;}
DS_API int ds_screen_step(int x, int y)
{
    int track = (int)song.sel, idx = -1, lane = -1;
    if (x < 0 || x >= 240 || y < 0 || y >= 240 || ui.menu) return -1;
    if (ui.layer == LY_STEP && y >= 40 && y < 184) {
        idx = ui.step_page * 16 + (y - 40) / 36 * 4 + x / 60;
        if (is_drum(TSEL)) lane = pen_lane;
    } else if (on_drum_page() && !drum_page && y >= 86 && y < 182 && x >= 12 && x < 236) {
        track = TRK_DRUM; lane = (y - 86) / 6; idx = drum_cursor / 16 * 16 + (x - 12) / 14;
    } else if (!ui.home && cur_page()->scope == SC_STEP && y >= 74 && y < 174) {
        idx = ui.bank * 16 + x / 15;
    } else if ((ui.home || cur_page()->scope == SC_TRK) && y >= 40 && y < 184 && x >= 34 && x < 194) {
        track = (y - 40) / 36;
        uint32_t len = trk_len(&trk[track]);
        idx = song.playing ? trk[track].seq_idx / 16 * 16 + (x - 34) / 10 : (x - 34) / 10 * (int)len / 16;
        if (track == TRK_DRUM) lane = drum_lane;
    }
    if (idx < 0 || idx >= (int)trk_len(&trk[track])) return -1;
    if (lane >= 0 ? !dstep_has(&trk[track].dstep[idx], lane) : !step_on(&trk[track].step[idx])) return -1;
    return track << 11 | (lane < 0 ? 16 : lane) << 6 | idx;
}
DS_API int ds_step_ratchet(int target, int hits)
{
    if (target < 0 || (hits != 1 && hits != 2 && hits != 3 && hits != 4 && hits != 6)) return 0;
    uint32_t track = (uint32_t)target >> 11, lane = ((uint32_t)target >> 6) & 31u, idx = (uint32_t)target & 63u;
    if (track >= NTRK || idx >= trk_len(&trk[track])) return 0;
    track_t *t = &trk[track];
    uint32_t mask = lane == 16 ? (1u << t->step[idx].n) - 1u : 1u << lane;
    if (is_drum(t) ? lane >= 16 || !dstep_has(&t->dstep[idx], lane) : lane != 16 || !step_on(&t->step[idx])) return 0;
    int k = lock_find(t, idx, LOCK_RATCHET6, hits == 6);
    if (hits == 6 && k < 0) return -1;
    undo_mark(t, (undo_sess += 4u) | 3u);
    fm1_irq_off();
    ratchet_clear6(t, idx, mask);
    if (hits == 6) {
        if (t->lock[k].step != idx || t->lock[k].param != LOCK_RATCHET6) t->lock[k].val = 0;
        t->lock[k].step = (uint8_t)idx; t->lock[k].param = LOCK_RATCHET6;
        t->lock[k].val = (int16_t)((uint16_t)t->lock[k].val | mask);
    }
    uint32_t rat = hits == 6 ? 3u : (uint32_t)hits - 1u;
    if (is_drum(t)) dstep_set(&t->dstep[idx], lane, dstep_lvl(&t->dstep[idx], lane), rat);
    else { t->step[idx].rat = 0; for (uint32_t n = 0; n < t->step[idx].n; n++) t->step[idx].rat |= (uint8_t)(rat << (2u * n)); }
    sync_reload = 1; ui.force = 1;
    fm1_irq_on(); frame(); return 1;
}
DS_API void ds_song_open(void) {vis_on=0;studio_open(SC_SONG);frame();}
DS_API int ds_workflow(void) {if(ui.home||ui.menu||ui.layer!=LY_PLAY||vis_shown())return -1;uint32_t scope=cur_page()->scope;return scope==SC_TRK?0:scope==SC_SONG?1:scope==SC_MIX?2:-1;}
DS_API void ds_home(void) { vis_on=0;go_home(); ui.force = 1; frame(); }
DS_API void ds_open_family(int fam) {
    if (fam == FAM_SEQ && is_drum(TSEL) && !ui.home && cur_page()->scope == SC_TRC) layer_tap(LY_STEP);
    else open_family((uint32_t)fam);
    ui.force = 1; frame();
}
DS_API void ds_set_page(int p) { ui.page = (uint8_t)p; page_entered(); ui.force = 1; frame(); }
DS_API int ds_cur_page(void) { return (int)ui.page; }

/* the page table, for the window's menus */
DS_API int ds_page_count(void) { return (int)NPAGES; }
DS_API const char *ds_page_title(int p) { return (p >= 0 && p < (int)NPAGES) ? PAGES[p].title : ""; }
DS_API int ds_page_family(int p) { return (p >= 0 && p < (int)NPAGES) ? (int)PAGES[p].fam : -1; }
DS_API int ds_family_count(void) { return FAM_COUNT; }
DS_API const char *ds_family_title(int fam)
{
    uint32_t i;
    for (i = 0; i < NPAGES; i++)
        if ((int)PAGES[i].fam == fam)
            return PAGES[i].title;
    return "";
}

/* the transport and the mix, as the editor's commands set them on the device */
DS_API void ds_select_track(int t) { song.sel = (uint8_t)(((t % NTRK) + NTRK) % NTRK); ui.force = 1; frame(); }
DS_API int ds_selected_track(void) { return (int)song.sel; }
DS_API void ds_play(int on) { song.playing = (uint8_t)(on ? 1 : 0); ui.force = 1; frame(); }
DS_API int ds_playing(void) { return (int)song.playing; }
DS_API void ds_set_bpm(int bpm) { song.g[G_BPM] = (int16_t)clamp(bpm, 40, 240); ui.force = 1; frame(); }
DS_API void ds_tap_tempo(void) { tap_tempo(); ui.force = 1; frame(); }
DS_API int ds_metronome(void) { return song.g[G_CLOCK]; }
DS_API void ds_set_metronome(int mode) { song.g[G_CLOCK] = (int16_t)clamp(mode, 0, 2); ui.force = 1; frame(); }
DS_API void ds_set_engine(int t, int e) { if (t >= 0 && t < NPART) { set_engine_of(&trk[t], (uint32_t)e); ui.force = 1; frame(); } }
DS_API void ds_set_preset(int t, int p) { if (t >= 0 && t < NPART) { apply_preset_to(&trk[t], (uint32_t)p); ui.force = 1; frame(); } }

/* the mix, as the audio ISR produces it (44100 Hz, stereo, -1..1). ds_audio runs n samples into the
 * buffer at ds_out (2n floats); when enabled it also steps the UI once per 704-sample frame (16 ms),
 * so what you hear and what the screen shows stay in lockstep and the JS loop must not also call
 * ds_frame. The master level is the song's (2048 at power-on; ds_master sets it, 0..4096). */
#define DS_FRAME_BLOCKS 22u
#define DS_OUT_N (2u * (64u * CTL))
static float ds_aout[DS_OUT_N];
static uint32_t ds_ui_blocks;

DS_API float *ds_out(void) { return ds_aout; }
DS_API void ds_audio_enable(int on) { ds_adriven = on ? 1 : 0; }
DS_API uint32_t ds_master_value(void) { return song.master_q12; }
DS_API void ds_master(uint32_t q12) { song.master_q12 = q12 > 4096 ? 4096 : q12; ui.force = 1; }
DS_API void ds_audio(uint32_t n)
{
    static int32_t o[2u * CTL];
    uint32_t i = 0u;
    while (i < n) {
        uint32_t k, this = n - i > (uint32_t)CTL ? CTL : n - i;
        mix_block(o, CTL);
        for (k = 1u; k < (uint32_t)CTL; k += 2u) {
            scope_bufr[scope_w & (SCOPE_N - 1u)] = vis_tap[2u * k + 1u];
            scope_buf[scope_w++ & (SCOPE_N - 1u)] = vis_tap[2u * k];
        }
        for (k = 0u; k < this; k++) {
            ds_aout[2u * (i + k)] = (float)o[2u * k] * (1.f / 32768.f);
            ds_aout[2u * (i + k) + 1u] = (float)o[2u * k + 1u] * (1.f / 32768.f);
        }
        i += this;
        if (++ds_ui_blocks == DS_FRAME_BLOCKS) { ui_input(); ui_leds(); ui_draw(); UI_FRAME_CLOCK_ADVANCE(); ds_ui_blocks = 0u; }
    }
}

#if !defined(__EMSCRIPTEN__) && !defined(DS_HARNESS_ONLY)
/* a native render, to check the harness compiles and the screens come out (build/host/dev-*.ppm) */
#include <string.h>
int main(int argc, char **argv)
{
    uint32_t i;
    outdir = argc > 1 ? argv[1] : "build/host";
    ds_init();
    ppm("dev-home");
    ds_open_family(FAM_ENV); ppm("dev-env");
    ds_open_family(FAM_FX); ppm("dev-fx");
    ds_open_family(FAM_SEQ); ppm("dev-seq");
    ds_open_family(FAM_GLO); ppm("dev-global");
    ds_open_family(FAM_SCL); ppm("dev-scale");
    for (i = 0; i < NPAGES; i++)
        if (!strcmp(PAGES[i].title, "DRUMS")) { ds_set_page((int)i); break; }
    ppm("dev-drums");
    ds_home(); ds_select_track(0);
    for (i = 0; i < NPAGES; i++)
        if (!strcmp(PAGES[i].title, "TRACKS")) { ds_set_page((int)i); break; }
    ppm("dev-tracks");
    puts("devscreen: rendered");
    return 0;
}
#endif

/* Same parser, queue and mapping runtime as USB/TRS MIDI on the FM-1. */
DS_API void ds_midi_release(void);
DS_API int ds_midi_map(const uint8_t *raw, unsigned n)
{
    ml_bank_t next;
    if (!ml_decode(&next, raw, n)) return 0;
    ds_midi_release(); ml_apply(&next); return 1;
}
DS_API void ds_midi(int status, int number, int value)
{
    uint32_t s = (uint32_t)status & 255u;
    if (s == 0xF8u || s == 0xFAu || s == 0xFBu || s == 0xFCu) {
        /* Browser events carry their arrival time; do not batch clock timestamps
         * together behind a 2048-sample audio callback. Same handler as USB. */
        mclk_event(s, 1);
        return;
    }
    if (s < 0x80u || s >= 0xF0u || number < 0 || number > 127 || value < 0 || value > 127) return;
    if (mi_w - mi_r < MQ) {
        midi_in_q[mi_w % MQ] = (s >> 4) | s << 8 | (uint32_t)number << 16 | (uint32_t)value << 24;
        mi_w++;

    }
}
DS_API void ds_midi_release(void)
{
    mi_r = mi_w; /* cancel events queued before a disconnect or entering learn */
    midi_controls_release();
}
