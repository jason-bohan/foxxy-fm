/* SPDX-License-Identifier: GPL-3.0-only */
/* The TRACKER page (FAM_TRC, SC_TRC): the four tracks as one dense hex view, the STEP page's
 * scrolling rows of note / velocity / dynamics for every track at once. The playhead
 * and editing cursor are distinct; K1 row, K2 note/lane, K3 velocity, K4 time. Reached from the
 * HOME menu (SCREEN > TRACKER). */
#define TR_X0 20            /* the first track's note column */
#define TR_DX 56            /* a track: note 3 + vel 2 + fx 1 characters, then a gap */
#define TR_ROWY 29          /* the first step's text row */
#define TR_ROWH 12          /* a step's row height */
#define TR_ROWS 17          /* compact header; use the rest for pattern rows */
#define TR_BG_PLAY RGB(52, 14, 16)   /* the playhead row's band */

const char *drum_lane_short(uint32_t lane);   /* drums.c */

/* Follow playback row by row. Manual browsing briefly takes priority. */
static uint32_t tracker_browse_until;
static uint32_t tracker_browse_base;
static uint8_t tracker_voice;
static int tracker_voice_read(int target, uint32_t slot)
{
    if (target < 0 || target >= NTRK * NSTEP) return 0;
    track_t *t = &trk[target / NSTEP]; uint32_t idx = target % NSTEP;
    if (is_drum(t)) {
        uint32_t mask = dstep_mask(&t->dstep[idx]);
        for (uint32_t lane = 0; lane < DRUM_LANES; lane++) if (mask & (1u << lane)) {
            if (!slot) return LANE_NOTE[lane]; slot--;
        }
        return 0;
    }
    return slot < t->step[idx].n && slot < 4 ? t->step[idx].note[slot] : 0;
}
/* Replace a synth chord while retaining dynamics/ratchets for surviving notes. */
static int tracker_chord_set(int target, uint32_t packed, int mark)
{
    if (target < 0 || target >= NPART * NSTEP) return 0;
    track_t *t = &trk[target / NSTEP]; uint32_t idx = target % NSTEP;
    if (idx >= trk_len(t)) return 0;
    uint8_t notes[4]; uint32_t n = 0;
    for (uint32_t i = 0; i < 4; i++) {
        uint32_t note = (packed >> (i * 8u)) & 255u;
        if (note > 127) return 0;
        if (note) { for (uint32_t j = 0; j < n; j++) if (notes[j] == note) return 0; notes[n++] = (uint8_t)note; }
    }
    fm1_irq_off(); if (mark) undo_mark(t, (undo_sess += 4u) | 3u);
    step_t old = t->step[idx], *s = &t->step[idx];
    int metadata = lock_find(t, idx, LOCK_RATCHET6, 0);
    uint32_t old_mask = metadata >= 0 ? (uint16_t)t->lock[metadata].val : 0, new_mask = 0;
    s->n = (uint8_t)n; s->lvl = s->rat = 0;
    for (uint32_t i = 0; i < 4; i++) s->note[i] = i < n ? notes[i] : 0;
    for (uint32_t i = 0; i < n; i++) {
        uint32_t level = i < old.n ? (old.lvl >> (i*2u)) & 3u : vel_lvl(old.n ? old.vel : 100);
        uint32_t rat = i < old.n ? (old.rat >> (i*2u)) & 3u : 0;
        uint32_t previous = i;
        for (uint32_t j = 0; j < old.n && j < 4; j++) if (old.note[j] == notes[i]) { level = (old.lvl >> (j*2u)) & 3u; rat = (old.rat >> (j*2u)) & 3u; previous = j; }
        if (old_mask & (1u << previous)) new_mask |= 1u << i;
        s->lvl |= level << (i*2u); s->rat |= rat << (i*2u);
    }
    if (metadata >= 0) { t->lock[metadata].val = (int16_t)new_mask; if (!new_mask) t->lock[metadata].step = LOCK_FREE; }
    if (!old.n) s->vel = 100;
    s->time = n ? ST_NOTE : ST_REST;
    if (!n) lock_del(t, idx, P_COUNT);
    t->seq_active = 1; ui.force = 1; sync_reload = 1; fm1_irq_on(); return 1;
}
static int tracker_browsing(void)
{
    return tracker_browse_until && (int32_t)(tracker_browse_until - fm1_ms) > 0;
}
static uint32_t tracker_base(void)
{
    uint32_t len = trk_len(TSEL);
    if (tracker_browsing()) return (uint32_t)clamp(tracker_browse_base, 0, len - 1);
    uint32_t focus = song.playing && !tracker_browsing() ? TSEL->seq_idx % len : ui.cursor % len;
    return focus > 7u ? focus - 7u : 0u;
}

static int tracker_read(int target, int field)
{
    if (target < 0 || target >= NTRK * NSTEP) return -1;
    track_t *t = &trk[target / NSTEP]; uint32_t idx = target % NSTEP;
    if (is_drum(t)) {
        uint32_t mask = dstep_mask(&t->dstep[idx]), lane = 0;
        while (lane < 15 && !(mask & (1u << lane))) lane++;
        if (field == 0) return LANE_NOTE[mask ? lane : drum_lane];
        if (field == 1) return mask ? (dstep_lvl(&t->dstep[idx], lane) == LV_HARD ? 127 : dstep_lvl(&t->dstep[idx], lane) == LV_GHOST ? 40 : dstep_lvl(&t->dstep[idx], lane) == LV_SOFT ? 72 : 100) : 100;
        return mask ? ST_NOTE : ST_REST;
    }
    if (field == 0) return t->step[idx].n ? t->step[idx].note[0] : 60;
    if (field == 1) return t->step[idx].n ? t->step[idx].vel : 100;
    return t->step[idx].n || t->step[idx].time == ST_TIE ? t->step[idx].time : ST_REST;
}
static int tracker_update(int target, int field, int value)
{
    if (target < 0 || target >= NTRK * NSTEP || field < 0 || field > 2) return 0;
    track_t *t = &trk[target / NSTEP]; uint32_t idx = target % NSTEP;
    if (idx >= trk_len(t) || (field < 2 ? value < 1 || value > 127 : value < ST_NOTE || value > ST_REST) ||
        (is_drum(t) && field == 2 && value == ST_TIE)) return 0;
    if (field == 2 && value == ST_REST) {
        fm1_irq_off(); undo_mark(t, (undo_sess += 4u) | 3u);
        if (is_drum(t)) memset(&t->dstep[idx], 0, sizeof t->dstep[idx]);
        else { memset(&t->step[idx], 0, sizeof t->step[idx]); t->step[idx].time = ST_REST; }
        lock_del(t, idx, P_COUNT); sync_reload = 1; ui.force = 1; fm1_irq_on(); return 1;
    }
    fm1_irq_off(); undo_mark(t, (undo_sess += 4u) | 3u);
    if (is_drum(t)) {
        uint32_t lane = lane_of_note(tracker_read(target, 0));
        uint32_t level = dstep_has(&t->dstep[idx], lane) ? dstep_lvl(&t->dstep[idx], lane) : LV_NORM;
        uint32_t rat = dstep_rat(&t->dstep[idx], lane);
        if (field == 0) {
            uint32_t new_lane = lane_of_note(value);
            if (new_lane != lane) { dstep_clr(&t->dstep[idx], lane); ratchet_clear6(t, idx, 1u << lane); rat = 0; }
            lane = new_lane;
        }
        dstep_set(&t->dstep[idx], lane, field == 1 ? vel_lvl(value) : level, rat);
    } else {
        step_t *s = &t->step[idx];
        if (field == 0) { if (!s->n) { s->n = 1; s->vel = 100; s->lvl = LV_NORM; } s->note[0] = value; s->time = ST_NOTE; }
        if (field == 1) { s->vel = value; for (uint32_t n = 0; n < s->n; n++) s->lvl = (s->lvl & ~(3u << (2u*n))) | vel_lvl(value) << (2u*n); }
        if (field == 2) { s->time = value; if (value == ST_NOTE && !s->n) { s->n = 1; s->note[0] = last_note; s->vel = 100; } }
    }
    t->seq_active = 1; sync_reload = 1; ui.force = 1; fm1_irq_on(); return 1;
}
static void tracker_move(int32_t delta)
{
    cursor_set(clamp((int32_t)ui.cursor + delta, 0, trk_len(TSEL) - 1));
    tracker_browse_base = ui.cursor > 7u ? ui.cursor - 7u : 0u;
    tracker_browse_until = fm1_ms + 3000u; ui.force = 1;
}

/* a visible step's signature, track t, step s (the whole step_t / dstep_t) */
static uint32_t tr_step_hash(uint32_t h, uint32_t t, uint32_t s)
{
    if (is_drum(&trk[t])) {
        const dstep_t *d = &trk[t].dstep[s];
        h = h * 31u + d->on[0] + (uint32_t)d->on[1] * 256u + d->lvl[0] + (uint32_t)d->lvl[1] * 1024u +
            (uint32_t)d->rat[0] * 4099u + (uint32_t)d->rat[1] * 65537u;
    } else {
        const step_t *x = &trk[t].step[s];
        h = h * 31u + x->note[0] + (uint32_t)x->note[1] * 257u + (uint32_t)x->note[2] * 4099u + (uint32_t)x->note[3] * 65537u + x->n * 7919u + x->time * 104729u +
            x->flags * 1299709u + x->vel * 15485863u + x->lvl * 32452843u + x->rat * 49979687u;
    }
    return h;
}

/* the note / lane cell of step s on track t: 3 characters, its colour */
static void tr_note_cell(uint32_t t, uint32_t s, int selected, char out[4], uint16_t *col)
{
    if (is_drum(&trk[t])) {
        const dstep_t *d = &trk[t].dstep[s];
        uint32_t mask = d->on[0] | ((uint32_t)d->on[1] << 8), lane = 0, n = 0, i;
        const char *nm;
        for (i = 0; i < DRUM_LANES; i++)
            if (mask & (1u << i)) {
                if (!n)
                    lane = i;
                n++;
            }
        if (!n) {
            str_cpy(out, "---", 4);
            *col = TE_G2;
            return;
        }
        nm = drum_lane_short(lane);
        for (i = 0; i < 3u; i++)
            out[i] = nm[i] >= 'a' && nm[i] <= 'z' ? (char)(nm[i] - 32) : nm[i] ? nm[i] : ' ';
        out[3] = 0;
        if (n > 1u)
            out[2] = '+';
        *col = selected ? C_WHITE : TE_COL[3];
    } else {
        const step_t *x = &trk[t].step[s];
        if (x->n == 0u && x->time != ST_TIE) {
            str_cpy(out, "---", 4);
            *col = TE_G2;
        } else if (x->time == ST_TIE) {
            str_cpy(out, "TIE", 4);
            *col = selected ? C_WHITE : TE_G3;
        } else {
            note_name(out, x->note[selected && tracker_voice < x->n ? tracker_voice : 0]);
            if (x->n > 1u)
                out[2] = '+';
            *col = selected ? C_WHITE : TE_COL[t];
        }
    }
}

/* the velocity cell of step s on track t: 2 hex characters, colour */
static void tr_vel_cell(uint32_t t, uint32_t s, char out[3], uint16_t *col)
{
    static const char H[16] = "0123456789ABCDEF";
    uint32_t v, on;
    if (is_drum(&trk[t])) {
        const dstep_t *d = &trk[t].dstep[s];
        uint32_t mask = d->on[0] | ((uint32_t)d->on[1] << 8), lane = 0, i;
        on = 0;
        for (i = 0; i < DRUM_LANES; i++)
            if (mask & (1u << i)) {
                lane = i;
                on = 1;
                break;
            }
        v = (d->lvl[lane / 4u] >> (2u * (lane % 4u))) & 3u;
    } else {
        const step_t *x = &trk[t].step[s];
        on = x->n != 0u && x->time != ST_TIE;
        v = x->vel & 0x7Fu;
    }
    if (!on) {
        str_cpy(out, "..", 3);
        *col = TE_G2;
        return;
    }
    out[0] = H[(v >> 4) & 15u], out[1] = H[v & 15u], out[2] = 0;
    *col = TE_G4;
}

/* the dynamics cell of step s on track t: 1 character (A accent, S slide, * both, 1..3 ratchet) */
static void tr_fx_cell(uint32_t t, uint32_t s, char out[2], uint16_t *col)
{
    uint32_t rat = 0, acc = 0, sld = 0;
    if (is_drum(&trk[t])) {
        const dstep_t *d = &trk[t].dstep[s];
        uint32_t mask = d->on[0] | ((uint32_t)d->on[1] << 8), lane = 0, i;
        for (i = 0; i < DRUM_LANES; i++)
            if (mask & (1u << i)) {
                lane = i;
                break;
            }
        if (mask)
            rat = (d->rat[lane / 4u] >> (2u * (lane % 4u))) & 3u;
    } else {
        const step_t *x = &trk[t].step[s];
        acc = (x->flags & SF_ACCENT) != 0u;
        sld = (x->flags & SF_SLIDE) != 0u;
        rat = x->rat;
    }
    if (!rat && !acc && !sld) {
        out[0] = '.', out[1] = 0;
        *col = TE_G2;
        return;
    }
    if (rat)
        out[0] = (char)('0' + rat);
    else if (acc && sld)
        out[0] = '*';
    else
        out[0] = acc ? 'A' : 'S';
    out[1] = 0;
    *col = TE_G3;
}

static void tracker_draw(void)
{
    static uint32_t grid;
    static const char HEX[16] = "0123456789ABCDEF";
    track_t *t = TSEL;
    uint32_t len = (uint32_t)clamp(t->p[P_SLEN], 1, NSTEP);
    uint32_t play = song.playing ? (uint32_t)t->seq_idx % len : 0xFFFFFFFFu;
    uint32_t cur = len ? ui.cursor % len : 0u;
    uint32_t base = tracker_base(), i, k, sig;
    {
        char bpm[8], name[13], label[6] = "T1";
        fmt_int(bpm, song.g[G_BPM]); label[1] = (char)('1' + song.sel);
        if (is_drum(t)) str_cpy(name, DRUM_KIT_NAMES[drum_kit()], sizeof name);
        else trk_short_name(song.sel, name);
        cv_begin(240, 24, C_BLACK);
        cv_text(4, 1, &FONT_S, bpm, TE_G4);
        te_play_icon(36, 4, song.playing);
        cv_text(56, 1, &FONT_S, label, TE_COL[song.sel]);
        cv_text(84, 1, &FONT_S, name, TE_G3);
        if (!is_drum(t)) { char voice[4] = {'V', (char)('1' + tracker_voice), 0}; cv_text(218, 1, &FONT_S, voice, TE_COL[tracker_voice]); }
        cv_blit(0, 0);
    }
    sig = studio_hash((uint32_t)song.sel * 7u + song.playing * 3u + play * 131u + cur * 7919u + base * 104729u +
                      (uint32_t)len * 37u, "tracker");
    for (k = 0; k < NTRK; k++)
        for (i = 0; i < TR_ROWS; i++) {
            uint32_t s = base + i;
            if (s < len)
                sig = tr_step_hash(sig, k, s);
        }
    if (!ui.force && sig == grid)
        return;
    grid = sig;
    /* The firmware canvas holds at most 124 rows; render the body in two strips. */
    for (uint32_t pass = 0; pass < 2u; pass++) {
        uint32_t offset = 24u + pass * 124u;
        cv_begin(240, pass ? 92u : 124u, C_BLACK);
        cv_oy = -(int32_t)offset;
        for (k = 0; k < NTRK; k++) {                       /* a colour chip over each track's columns */
            int32_t x = TR_X0 + (int32_t)k * TR_DX;
            cv_rect(x, 25, 48, 3, k == TRK_DRUM ? TE_COL[3] : TE_COL[k]);
        }
        for (i = 0; i < TR_ROWS; i++) {
            uint32_t s = base + i;
            int32_t y = TR_ROWY + (int32_t)i * TR_ROWH;
            int row = s < len;
            if (row && s == play)                          /* the playhead */
                cv_rect(0, y - 1, 240, TR_ROWH, TR_BG_PLAY);
            else if (row && s == cur)                      /* the SEQ cursor */
                cv_rect(0, y - 1, 240, TR_ROWH, TE_G1);
            for (k = 0; k < NTRK; k++) {
                char nb[4], vb[3], fb[2];
                uint16_t nc, vc, fc;
                int32_t x = TR_X0 + (int32_t)k * TR_DX;
                if (!row) {
                    cv_text(x, y, &FONT_S, "---", TE_G2);
                    cv_text(x + 24, y, &FONT_S, "..", TE_G2);
                    cv_text(x + 40, y, &FONT_S, ".", TE_G2);
                    continue;
                }
                tr_note_cell(k, s, song.sel == k, nb, &nc);
                tr_vel_cell(k, s, vb, &vc);
                tr_fx_cell(k, s, fb, &fc);
                cv_text(x, y, &FONT_S, nb, nc);
                cv_text(x + 24, y, &FONT_S, vb, vc);
                cv_text(x + 40, y, &FONT_S, fb, fc);
                if (s == cur && song.sel == k) {
                    cv_rect(x - 1, y - 1, 49, 1, C_WHITE); cv_rect(x - 1, y + TR_ROWH - 2, 49, 1, C_WHITE);
                    cv_rect(x - 1, y - 1, 1, TR_ROWH, C_WHITE); cv_rect(x + 47, y - 1, 1, TR_ROWH, C_WHITE);
                }
            }
            {
                char rh[3];
                uint16_t rc;
                rh[0] = HEX[(s >> 4) & 15u], rh[1] = HEX[s & 15u], rh[2] = 0;
                rc = !row ? TE_G2 : s == play ? TE_RED : s == cur ? C_WHITE : TE_G3;
                cv_text(4, y, &FONT_S, rh, rc);
            }
        }
        cv_oy = 0;
        cv_blit(0, offset);
    }
}
