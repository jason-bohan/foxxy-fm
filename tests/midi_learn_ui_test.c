/* SPDX-License-Identifier: GPL-3.0-only */
#define DS_HARNESS_ONLY 1
#include "devscreen.c"
int main(void)
{
    static const uint8_t raw[] = {4,
        ML_NOTE, 0, 60, ML_BUTTON, B_ENV, 0,
        ML_NOTE, 0, 61, ML_BUTTON, B_GLO, 0,
        ML_CC, 0, 20, ML_ENCODER, EN_K1, ML_TWOS,
        ML_NOTE, 2, 62, ML_KEY, 0, 0};
    ds_init(); assert(ds_midi_map(raw, sizeof raw));
    tap(B_ENV); uint32_t expected_page = ui.page;
    int16_t before = TSEL->p[P_ATK];
    frames(5); ds_turn(EN_K1, 2); int16_t expected_attack = TSEL->p[P_ATK];
    TSEL->p[P_ATK] = before; ds_home();
    ds_midi(0x90,60,100); frame(); ds_midi(0x80,60,0); frame();
    assert(ui.page == expected_page);
    frames(5); ds_midi(0xb0,20,2); frame(); assert(TSEL->p[P_ATK] == expected_attack);
    /* Fast MIDI moves keep their requested size, without physical acceleration. */
    TSEL->p[P_ATK] = 20;
    for (unsigned i = 0; i < 4; i++) {
        ds_midi(0xb0,20,1); frame();
        assert(TSEL->p[P_ATK] == 21 + i);
    }
    ds_home(); ds_midi(0x90,61,100); frame();
    assert(layer_now() == LY_MIX);
    ds_midi(0x80,61,0); frame(); assert(layer_now() == LY_PLAY);
    ds_midi(0x92,62,100); frame(); assert(kb_prev & 1u);
    assert(!(trk[2].v[0].gate)); /* learned key is selected-track panel input, not channel 3 */
    ds_midi(0x92,62,0); frame(); assert(!(kb_prev & 1u));
    ds_midi(0x92,62,100); frame(); ds_midi_release(); frame(); assert(!(kb_prev & 1u));
    /* Physical and learned holds combine: releasing MIDI cannot lift the panel. */
    press(B_GLO); ds_midi(0x90,61,100); frame(); ds_midi(0x80,61,0); frame();
    assert(layer_now() == LY_MIX); release(B_GLO); assert(layer_now() == LY_PLAY);
    ds_midi(0x90, 65, 100); frame(); assert(midi_live[0][2] & 2u);
    ds_midi(0x80, 65, 0); /* note-off is still queued when controller disconnects */
    ds_midi_release(); frame(); assert(!(midi_live[0][2] & 2u));
    for (unsigned i = 0; i < NVOICE; i++) assert(!trk[0].v[i].gate);
    ds_midi(0x90, 65, 100); frame();
    assert(ds_midi_map(raw, sizeof raw)); frame();
    assert(!(midi_live[0][2] & 2u));
    /* The same pad changes role while an assignable Shift pad is held. */
    const uint8_t shifted[] = {3,
        ML_NOTE, 0, 59, ML_SHIFT, 0, 0,
        ML_NOTE, 0, 60, ML_BUTTON, B_ENV, 0,
        ML_NOTE, 0, 60, ML_KEY | ML_SHIFT_BANK, 0, 0};
    assert(ds_midi_map(shifted, sizeof shifted)); ds_home();
    ds_midi(0x90, 59, 100); frame();
    ds_midi(0x90, 60, 100); frame(); assert(kb_prev & 1u);
    ds_midi(0x80, 59, 0); frame(); assert(!(kb_prev & 1u));
    ds_midi(0x80, 60, 0); frame();
    ds_midi(0x90, 60, 100); frame(); ds_midi(0x80, 60, 0); frame();
    assert(ui.page == expected_page);
    ds_midi(0x90, 59, 100); frame(); ds_midi_release(); frame(); assert(!ml_shift);
    /* Browser clock arrival times must survive UI/audio batching. */
    ds_play(0); ds_time(5000); ds_sync_set(0);
    ds_midi(0xfa, 0, 0); ds_frame(); assert(!ds_playing());
    ds_sync_set(1); ds_midi(0xfa, 0, 0); ds_midi(0xf8, 0, 0); ds_frame();
    assert(ds_playing() && ds_clock_alive());
    for (unsigned i = 1; i <= 48; i++) {
        ds_time(5000u + (i * 500u + 12u) / 24u);
        ds_midi(0xf8, 0, 0); ds_frame();
    }
    assert(ds_bpm() == 120);
    for (unsigned i = 1; i <= 48; i++) {
        ds_time(6000u + i * 25u); ds_midi(0xf8, 0, 0); ds_frame();
    }
    assert(ds_bpm() == 100);
    ds_midi(0xfc, 0, 0); ds_frame(); assert(!ds_playing());
    ds_midi(0xfb, 0, 0); ds_frame(); assert(ds_playing());
    ds_time(7800); assert(!ds_clock_alive()); /* hardware's 500 ms fallback */
    ds_sync_set(0); ds_midi(0xfc, 0, 0); ds_frame(); assert(ds_playing());
    ds_play(0);
    ui.tap_n = 0; ds_time(10000); ds_tap_tempo();
    ds_time(10500); ds_tap_tempo(); assert(ds_bpm() == 120);
    ds_time(11000); ds_tap_tempo(); assert(ds_bpm() == 120);
    ds_set_bpm(999); assert(ds_bpm() == 240);
    ds_set_bpm(1); assert(ds_bpm() == 40);
    ds_set_metronome(1); assert(ds_metronome() == 1);
    ds_set_metronome(2); assert(ds_metronome() == 2);
    ds_set_metronome(0); assert(ds_metronome() == 0);
    /* Arp HOLD lights the latched chord after release, without NOTES enabled. */
    ds_home(); ds_select_track(0); lights_notes = 0;
    TSEL->p[P_AMODE] = 1; TSEL->p[P_AHOLD] = 2;
    ds_key(7, 1); ds_key(7, 0); frames(10);
    assert(TSEL->nheld && (keys_lit() & (1u << 7)));
    assert(ds_led(14 + 7) == 3);
    unsigned latched_hits = 0;
    for (unsigned i = 0; i < 120; i++) {
        frame(); assert(TSEL->nheld == 1);
        if (TSEL->arp_note) latched_hits++;
    }
    assert(latched_hits > 0); /* HOLD keeps triggering audio, not just LEDs. */
    ds_key(9, 1); ds_key(9, 0); frames(10);
    ds_key(11, 1); ds_key(11, 0); frames(10);
    assert(TSEL->nheld == 3);
    assert((keys_lit() & ((1u << 7) | (1u << 9) | (1u << 11))) == ((1u << 7) | (1u << 9) | (1u << 11)));
    ds_key(7, 1); ds_key(7, 0); frames(10);
    assert(TSEL->nheld == 2);
    assert(!(keys_lit() & (1u << 7)) && (keys_lit() & (1u << 9)));
    assert(keys_lit() & (1u << 11));
    ds_key(9, 1); ds_key(9, 0); ds_key(11, 1); ds_key(11, 0); frames(10);
    assert(!TSEL->nheld && !TSEL->arp_note);
    ds_key(9, 1); ds_key(9, 0); frames(10); assert(TSEL->nheld == 1);
    TSEL->p[P_AHOLD] = 0; frames(10);
    assert(!(keys_lit() & (1u << 9)));
    TSEL->p[P_AHOLD] = 1;
    ds_key(7, 1); ds_key(7, 0); frames(10);
    ds_key(9, 1); ds_key(9, 0); frames(10);
    assert(TSEL->nheld == 1 && TSEL->held[0] == kb_map(TSEL, 9));
    ds_key(9, 1); ds_key(9, 0); frames(10);
    assert(TSEL->nheld == 1); /* ON replaces, rather than toggling off. */
    TSEL->p[P_AHOLD] = 0; frames(10);
    /* Step lights describe stored steps, independent of released input keys. */
    press(B_SEQ); key(key_of_white(0));
    assert(keys_lit() & (1u << key_of_white(0)));
    assert(ds_led(14 + key_of_white(0)) == 3);
    release(B_SEQ);
    /* Both screen sizes share these native-coordinate hit targets. */
    ds_home(); ds_screen_pointer(10, 120, 1); assert(song.sel == 2);
    ds_select_track(TRK_DRUM); ds_open_family(FAM_TRK);
    for (unsigned p = 0; p < NPAGES; p++) if (PAGES[p].scope == SC_DRUM) ds_set_page(p);
    drum_page = 0; drum_lane = 0; drum_cursor = 0;
    int grid_before = dstep_has(&TDRUM->dstep[0], 0);
    ds_screen_pointer(14, 87, 1); ds_screen_pointer(14, 87, 0);
    assert(dstep_has(&TDRUM->dstep[0], 0) != grid_before);
    ds_screen_pointer(14, 87, 1); ds_screen_pointer(14, 87, 0);
    assert(dstep_has(&TDRUM->dstep[0], 0) == grid_before);
    assert(ds_screen_encoder(190, 210) == EN_K4);
    /* Parameter clicks must not select the step underneath their column. */
    ds_wall_clock = 0; frames(20); /* Let the preceding held layer's release settle. */
    ds_select_track(0);
    for (unsigned p = 0; p < NPAGES; p++) if (PAGES[p].scope == SC_STEP) ds_set_page(p);
    cursor_set(10);
    memset(&TSEL->step[10], 0, sizeof TSEL->step[10]);
    step_add(TSEL, 10, 60, 100, LV_NORM, 0);
    ds_screen_pointer(75, 45, 1); ds_screen_pointer(75, 45, 0);
    assert(ui.cursor == 10 && ds_screen_encoder(75, 45) == EN_K2);
    ds_turn(EN_K2, 1);
    assert(ui.cursor == 10 && TSEL->step[10].note[0] == 61);
    ds_screen_pointer(135, 45, 1); ds_screen_pointer(135, 45, 0);
    assert(ui.cursor == 10 && ds_screen_encoder(135, 45) == EN_K3);
    ds_turn(EN_K3, 1);
    assert(ui.cursor == 10 && TSEL->step[10].time == ST_TIE);
    ds_screen_pointer(60, 100, 1); ds_screen_pointer(60, 100, 0);
    assert(ui.cursor == 4);
    ds_open_family(FAM_TRC); TSEL->p[P_SLEN] = 64; cursor_set(15);
    int tracker_bpm = ds_bpm();
    assert(ds_screen_encoder(80, 80) == EN_SELECT && ds_screen_encoder(200, 220) == EN_SELECT);
    ds_turn(EN_SELECT, 1); assert(ui.cursor == 16 && ui.bank == 1 && ds_bpm() == tracker_bpm);
    ds_turn(EN_SELECT, 40); assert(ui.cursor == 56 && ui.bank == 3);
    ds_turn(EN_SELECT, 100); assert(ui.cursor == 63 && ui.bank == 3);
    ds_turn(EN_SELECT, -100); assert(ui.cursor == 0 && ui.bank == 0 && ds_bpm() == tracker_bpm);
    tracker_browse_until = 0; cursor_set(32); ds_screen_pointer(5, TR_ROWY + 3 * TR_ROWH, 1);
    assert(ui.cursor == 28 && ui.bank == 1 && song.sel == 0);
    assert(tracker_base() == 25);
    assert(ds_tracker_cell(TR_X0, TR_ROWY + 3 * TR_ROWH) == 28);
    assert(ds_tracker_edit(28, 66, 90, ST_NOTE));
    assert(TSEL->step[28].n == 1 && TSEL->step[28].note[0] == 66 && TSEL->step[28].vel == 90);
    assert(ds_tracker_read(28,0) == 66 && ds_tracker_read(28,1) == 90);
    assert(ds_tracker_edit(28, 66, 90, ST_TIE) && TSEL->step[28].time == ST_TIE);
    assert(ds_tracker_edit(28, 60, 100, ST_REST) && !TSEL->step[28].n);
    assert(!ds_tracker_edit(28, 200, 100, ST_NOTE));
    ds_tracker_select(0, 28);
    assert(ds_tracker_update(28, 0, 60));
    TSEL->step[28].n = 2; TSEL->step[28].note[1] = 67; TSEL->step[28].flags = SF_ACCENT; TSEL->step[28].rat = 1;
    ds_turn(EN_K2, 1);
    assert(TSEL->step[28].note[0] == 61 && TSEL->step[28].note[1] == 67 && TSEL->step[28].n == 2);
    assert(TSEL->step[28].flags == SF_ACCENT && TSEL->step[28].rat == 1);
    ds_turn(EN_K3, -10); assert(TSEL->step[28].vel == 90 && TSEL->step[28].rat == 1);
    ds_turn(EN_K4, 1); assert(TSEL->step[28].time == ST_TIE);
    ds_turn(EN_K1, 1); assert(ui.cursor == 29);
    assert(ds_tracker_edit(TRK_DRUM * NSTEP, 36, 100, ST_NOTE));
    assert(dstep_has(&TDRUM->dstep[0], lane_of_note(36)));
    assert(!ds_tracker_edit(TRK_DRUM * NSTEP, 36, 100, ST_TIE));
    assert(ds_tracker_edit(TRK_DRUM * NSTEP, 36, 100, ST_REST) && !dstep_mask(&TDRUM->dstep[0]));
    tracker_browse_until = 0; song.playing = 1; TSEL->seq_idx = 15;
    assert(tracker_base() == 8);
    TSEL->seq_idx = 16; assert(tracker_base() == 9); /* One row, rather than a bank jump. */
    TSEL->seq_idx = 40; assert(tracker_base() == 33);
    cursor_set(5); tracker_browse_base = 0; tracker_browse_until = fm1_ms + 3000u;
    assert(tracker_base() == 0); /* Manual scrolling can inspect earlier notes during playback. */
    tracker_browse_until = fm1_ms; assert(tracker_base() == 33);
    TSEL->seq_idx = 0; assert(tracker_base() == 0);
    song.playing = 0; tracker_browse_until = 0;
    ui.home_t0 = 0;
    ui.menu = 1; ui.menu_sel = MI_TRACKER; ds_tap(B_OCTUP);
    assert(!ui.menu && cur_page()->scope == SC_TRC);
    ui.menu = 1; ds_tap(B_OCTDN); assert(!ui.menu);
    assert(!strcmp(ds_tracker_drum_name(0), "KICK"));
    assert(!strcmp(ds_tracker_drum_name(2), "SNARE"));
    assert(ds_tracker_drum_note(0) == 36 && ds_tracker_drum_note(2) == 38);
    assert(!strcmp(ds_tracker_track_name(TRK_DRUM), DRUM_KIT_NAMES[drum_kit()]));
    assert(ds_tracker_track_name(0)[0]);
    assert(TR_ROWS == 17);
    ds_tracker_open();
    ds_tracker_select(0, 23); tracker_browse_base = 8;
    for (unsigned pixel = 0; pixel < 240 * 240; pixel++) screen[pixel] = swap16(RGB(255, 0, 0));
    ui.force = 1; frame();
    assert(screen[239 * 240 + 239] == swap16(C_BLACK));
    assert(screen[(TR_ROWY + 15 * TR_ROWH - 1) * 240 + TR_X0 - 1] == swap16(C_WHITE));
    /* Drum notes entered in TRACKER must be visible in SEQ's drum grid, including later banks. */
    TDRUM->p[P_SLEN] = 32;
    ds_tracker_select(TRK_DRUM, 20);
    assert(ds_tracker_update(TRK_DRUM * NSTEP + 20, 0, 38));
    assert(ds_tracker_update(TRK_DRUM * NSTEP + 20, 1, 100));
    drum_cursor = 0; drum_page = 1; drum_lane = 0;
    ds_tap(B_SEQ); frames(20);
    assert(on_drum_page() && !drum_page && drum_cursor == 20 && drum_lane == lane_of_note(38));
    assert(dstep_has(&TDRUM->dstep[20], drum_lane));
    assert(screen[(86 + drum_lane * 6 + 2) * 240 + 12 + 4 * 14 + 4] == swap16(lvl_col(LV_NORM)));
    ds_tracker_open(); ds_tracker_select(TRK_DRUM, 20); ds_open_family(FAM_SEQ);
    assert(on_drum_page() && drum_cursor == 20 && !drum_page);
    ds_select_track(TRK_DRUM);
    for (unsigned p = 0; p < NPAGES; p++) if (PAGES[p].scope == SC_DRUM) ds_set_page(p);
    drum_cursor = 0; drum_lane = 0; drum_page = 0;
    /* Right-click ratchets use actual subdivisions, including six hits. */
    dstep_set(&TDRUM->dstep[0], 15, LV_NORM, 0);
    int drum_target = TRK_DRUM << 11 | 15 << 6;
    assert(ds_screen_step(14, 177) == drum_target);
    for (unsigned hits = 1; hits <= 4; hits++) {
        assert(ds_step_ratchet(drum_target, hits) == 1);
        assert(ratchet_hits(TDRUM, 0, 15, dstep_rat(&TDRUM->dstep[0], 15)) == hits);
    }
    assert(ds_step_ratchet(drum_target, 6) == 1);
    assert(ratchet_hits(TDRUM, 0, 15, 3) == 6);
    TDRUM->seq_idx = 0; TDRUM->rat_lanes = 0; TDRUM->seq_skip = 0;
    for (unsigned hit = 1; hit < 6; hit++) {
        seq_ratchets(TDRUM, hit * 100, 600);
        assert(((TDRUM->rat_lanes >> 45) & 7u) == hit);
    }
    ds_select_track(0); step_add(TSEL, 0, 60, 100, LV_NORM, 0);
    int synth_target = 16 << 6;
    assert(ds_step_ratchet(synth_target, 6) == 1);
    assert(ratchet_hits(TSEL, 0, 0, TSEL->step[0].rat & 3u) == 6);
    TSEL->seq_idx = 0; TSEL->seq_skip = 0; memset(TSEL->rat_done, 0, sizeof TSEL->rat_done);
    for (unsigned hit = 1; hit < 6; hit++) {
        seq_ratchets(TSEL, hit * 100, 600); assert(TSEL->rat_done[0] == hit);
    }
    assert(ds_step_ratchet(synth_target, 4) == 1);
    assert(ratchet_hits(TSEL, 0, 0, 3) == 4);
    /* A scope locks phase, keeps stereo channels, and captures peaks at wider sweeps. */
    osc_set(0, 2); osc_set(2, 0); osc_set(3, 0);
    for (unsigned i = 0; i < VIS_FFT; i++) { vis_l[i] = isin(i * 16u) / 2; vis_r[i] = -vis_l[i]; }
    osc_acquire(); assert(osc.ready && osc.triggered);
    int16_t scope_reference[224]; memcpy(scope_reference, osc.low[0], sizeof scope_reference);
    for (unsigned i = 0; i < VIS_FFT; i++) { vis_l[i] = isin((i + 7u) * 16u) / 2; vis_r[i] = -vis_l[i]; }
    osc_acquire(); assert(!memcmp(scope_reference, osc.low[0], sizeof scope_reference));
    osc_set(3, 1);
    for (unsigned i = 0; i < VIS_FFT; i++) vis_l[i] = vis_r[i] = 1000;
    osc_acquire(); assert(!osc.triggered && !memcmp(scope_reference, osc.low[0], sizeof scope_reference));
    osc_set(3, 2);
    for (unsigned i = 0; i < VIS_FFT; i++) vis_l[i] = isin(i * 16u) / 2;
    osc_acquire(); assert(osc.ready && osc.triggered);
    for (unsigned i = 0; i < VIS_FFT; i++) vis_l[i] = 0;
    osc_acquire(); assert(!memcmp(scope_reference, osc.low[0], sizeof scope_reference));
    osc_set(3, 3); osc_acquire(); assert(!memcmp(scope_reference, osc.low[0], sizeof scope_reference));
    osc_set(3, 0); osc_set(0, 4);
    memset(vis_l, 0, sizeof vis_l); memset(vis_r, 0, sizeof vis_r); vis_l[256] = 30000;
    osc_acquire(); int scope_peak = 0;
    for (unsigned i = 0; i < 224; i++) if (osc.high[0][i] > scope_peak) scope_peak = osc.high[0][i];
    assert(scope_peak == 30000);
    memset(vis_l, 0, sizeof vis_l); osc_acquire();
    for (unsigned i = 0; i < 224; i++) assert(!osc.low[0][i] && !osc.high[0][i]);
    osc_set(0, 2);
    /* UI cadence carries the remainder across 2048-sample audio callbacks. */
    ds_wall_clock = 0; ds_ui_blocks = 0;
    uint32_t audio_ms = fm1_ms;
    uint32_t scope_before_audio = scope_w;
    for (unsigned i = 0; i < 3; i++) ds_audio(2048);
    assert(fm1_ms - audio_ms == 128);
    assert(scope_w - scope_before_audio == 3072);
    puts("MIDI learn UI: physical/MIDI buttons, held layers, encoder edits, key releases, clock transport/tempo and audio cadence PASS");
    return 0;
}
