/* SPDX-License-Identifier: GPL-3.0-only */
/* Keep the existing SYN bank at its original offset. Append mappings so older
 * settings and drum-kit backups stay compatible. */
static struct { dsu_bank_t drums; ml_bank_t midi; } settings_tail;
_Static_assert(sizeof(persist_t) + sizeof(settings_tail) <= ST_PAYLOAD_MAX, "settings and MIDI mappings fit");
static int settings_write_map(const persist_t *p, const ml_bank_t *map)
{
    if (!dsu_valid(&dsu)) dsu_defaults();
    settings_tail.drums = dsu;
    settings_tail.midi = *map;
    if (st_save2(OBJ_SETTINGS, p, sizeof *p, &settings_tail, sizeof settings_tail)) return -1;
    dsu_dirty = 0;
    return 0;
}
static int settings_write(const persist_t *p) { return settings_write_map(p, &ml_bank); }
static void dsu_boot(void)
{
    st_hdr_t h;
    uint32_t off = sizeof(persist_t) + sizeof(dsu_bank_t);
    ml_bank_t empty = {ML_MAGIC, 0, {{0}}};
    dsu_defaults(); ml_apply(&empty);
    if (st_current(OBJ_SETTINGS, &h) >= 0 && h.len >= off &&
        dsu_valid((const dsu_bank_t *)(st_buf + sizeof(persist_t)))) {
        uint32_t k;
        memcpy(&dsu, st_buf + sizeof(persist_t), sizeof dsu);
        for (k = 0; k < DSU_N; k++) dsu_fix_kit(&dsu.k[k]);
        if (h.len == off + sizeof(ml_bank_t) && ml_valid((const ml_bank_t *)(st_buf + off)))
            ml_apply((const ml_bank_t *)(st_buf + off));
    }
    dsu_dirty = 0;
}
