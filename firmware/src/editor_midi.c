/* SPDX-License-Identifier: GPL-3.0-only */
/* Protocol v11: 77 MIDI_MAP. GET [0], PUT [1,count,6-byte bindings...].
 * Reply: rc,count,bindings. PUT persists before changing the live map. */
static int ed_midi_handle(uint32_t cmd, const uint8_t *a, uint32_t na)
{
    uint32_t rc = 0, i, j;
    static ml_bank_t next;
    if (cmd != 77u) return 0;
    if (!na || a[0] > 1u || (a[0] == 0u && na != 1u)) rc = 2;
    else if (a[0] == 1u) {
        if (!ml_decode(&next, a + 1, na - 1u)) rc = 2;
        else if (song.playing || transport_req) rc = 3;
        else {
#if FELUCCA_FLASH
            persist_t p;
            persist_fill(&p);
            if (!flash_ok || settings_write_map(&p, &next)) rc = 4;
            else {
                persist_saved = p;
                fm1_irq_off(); midi_controls_release(); ml_apply(&next); fm1_irq_on();
            }
#else
            rc = 4;
#endif
        }
    }
    ed_b(rc); ed_b(ml_bank.count);
    for (i = 0; i < ml_bank.count; i++) {
        const uint8_t *b = (const uint8_t *)&ml_bank.binding[i];
        for (j = 0; j < 6; j++) ed_b(b[j]);
    }
    return 1;
}
