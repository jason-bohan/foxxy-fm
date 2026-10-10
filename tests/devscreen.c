/* SPDX-License-Identifier: GPL-3.0-only */
/* Copyright (C) 2026 Leo Kuroshita (@kurogedelic), Hügelton Instruments */
/* Dev screen: the REAL FELUCCA UI (gfx.c, ui.c, ui_draw.c, ui_studio.c, ui_layers.c, ui_song.c,
 * ui_menu.c, ui_input.c, ui_vis.c, splash.c) driven off-hardware, behind a small C ABI so it can
 * be compiled to WebAssembly (tools/build_devscreen.sh) and shown in the editor's dev-screen window.
 * The whole host harness of tests/ui_pages_test.c (the 240x240 framebuffer, the lcd_blit / lcd_fill
 * doubles, frame(), press / release / tap / key, panel / flash / storage doubles) is reused as is:
 * the pixels are the firmware's, not a re-drawing of them. */
#define UI_PAGES_HARNESS_ONLY 1
#include "ui_pages_test.c"
#undef main

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
    settings.palette = 4;
    palette_set(4);
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

/* one UI frame (~16 ms) with the audio between, as the device runs it; n frames = n*16 ms of clock */
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

/* navigation, mirroring the buttons: HOME, a family's page, an exact page */
DS_API void ds_home(void) { go_home(); ui.force = 1; frame(); }
DS_API void ds_open_family(int fam) { open_family((uint32_t)fam); ui.force = 1; frame(); }
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
DS_API void ds_set_bpm(int bpm) { song.g[G_BPM] = (int16_t)bpm; ui.force = 1; frame(); }
DS_API void ds_set_engine(int t, int e) { if (t >= 0 && t < NPART) { set_engine_of(&trk[t], (uint32_t)e); ui.force = 1; frame(); } }
DS_API void ds_set_preset(int t, int p) { if (t >= 0 && t < NPART) { apply_preset_to(&trk[t], (uint32_t)p); ui.force = 1; frame(); } }

/* the mix, as the audio ISR produces it (44100 Hz, stereo, -1..1). ds_audio runs n samples into the
 * buffer at ds_out (2n floats); when enabled it also steps the UI once per 704-sample frame (16 ms),
 * so what you hear and what the screen shows stay in lockstep and the JS loop must not also call
 * ds_frame. The master level is the song's (2048 at power-on; ds_master sets it, 0..4096). */
#define DS_FRAME_BLOCKS 22u
#define DS_OUT_N (2u * (64u * CTL))
static float ds_aout[DS_OUT_N];
static int ds_adriven;

DS_API float *ds_out(void) { return ds_aout; }
DS_API void ds_audio_enable(int on) { ds_adriven = on ? 1 : 0; }
DS_API void ds_master(uint32_t q12) { song.master_q12 = q12 > 4096 ? 4096 : q12; ui.force = 1; }
DS_API void ds_audio(uint32_t n)
{
    static int32_t o[2u * CTL];
    uint32_t i = 0u, b = 0u;
    while (i < n) {
        uint32_t k, this = n - i > (uint32_t)CTL ? CTL : n - i;
        mix_block(o, CTL);
        for (k = 0u; k < this; k++) {
            ds_aout[2u * (i + k)] = (float)o[2u * k] * (1.f / 32768.f);
            ds_aout[2u * (i + k) + 1u] = (float)o[2u * k + 1u] * (1.f / 32768.f);
        }
        i += this;
        if (++b == DS_FRAME_BLOCKS) { ui_input(); ui_leds(); ui_draw(); fm1_ms += 16u; b = 0u; }
    }
}

#ifndef __EMSCRIPTEN__
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
