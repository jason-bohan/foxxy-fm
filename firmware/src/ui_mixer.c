/* SPDX-License-Identifier: GPL-3.0-only */
/* Persistent global mixer. K1..4 levels, SELECT track, OCT- mute, OCT+ solo. */
static int mixer_read(uint32_t track, uint32_t field)
{
    if (track >= NTRK) return -1;
    return field == 0 ? (track == TRK_DRUM ? song.g[G_DRLVL] : trk[track].p[P_LEVEL]) :
        field == 1 ? trk[track].p[P_MUTE] : (song.solo >> track) & 1u;
}
static void mixer_set(uint32_t track, uint32_t field, int value)
{
    if (track >= NTRK || field > 2) return;
    if (field == 0) {
        int16_t *v = track == TRK_DRUM ? &song.g[G_DRLVL] : &trk[track].p[P_LEVEL];
        *v = (int16_t)clamp(value, 0, 127);
    } else if (field == 1) trk[track].p[P_MUTE] = !!value;
    else { uint8_t bit = (uint8_t)(1u << track); song.solo = (song.solo & ~bit) | (!!value ? bit : 0); }
    ui.force = 1;
}
static void mixer_draw(void)
{
    for (uint32_t pass = 0; pass < 2; pass++) {
        cv_begin(240, 120, C_BLACK); cv_oy = -(int32_t)(pass * 120u);
        cv_text(4, 2, &FONT_S, "MIXER", C_WHITE); te_play_icon(218, 2, song.playing);
        for (uint32_t i = 0; i < NTRK; i++) {
            int32_t y = 28 + (int32_t)i * 45; char name[24], b[8];
            int muted = mixer_read(i, 1), solo = mixer_read(i, 2);
            cv_rect(4, y, 232, 40, i == song.sel ? TE_G2 : TE_G1);
            cv_rect(4, y, 3, 40, TE_COL[i]); trk_short_name(i, name);
            cv_text(12, y + 2, &FONT_S, name, muted ? TE_G3 : TE_COL[i]);
            fmt_int(b, mixer_read(i, 0) * 100 / 127); cv_text(112, y + 2, &FONT_S, b, C_WHITE);
            cv_rect(12, y + 26, mixer_read(i, 0) * 119 / 127, 5, muted ? TE_G3 : TE_COL[i]);
            cv_rect(152, y + 4, 34, 30, muted ? TE_RED : TE_G2); cv_text(164, y + 10, &FONT_S, "M", C_WHITE);
            cv_rect(193, y + 4, 34, 30, solo ? TE_COL[1] : TE_G2); cv_text(205, y + 10, &FONT_S, "S", C_WHITE);
        }
        cv_text(4, 213, &FONT_S, "K1-4 LEVEL / SELECT TRACK", TE_G3);
        cv_text(4, 229, &FONT_S, "OCT- MUTE / OCT+ SOLO", TE_G3);
        cv_oy=0; /* Restore screen coordinates before returning to another page. */
        cv_blit(0, pass * 120u);
    }
}
