/* SPDX-License-Identifier: GPL-3.0-only */
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include "../firmware/src/midi_learn.h"
static uint8_t ed_out[600];
static uint32_t ed_n;
static void ed_b(uint32_t b) { ed_out[ed_n++] = (uint8_t)b; }
static struct { int playing; } song;
static uint32_t transport_req;
static void fm1_irq_off(void) {}
static void fm1_irq_on(void) {}
static void midi_controls_release(void) { ml_reset(); }
#define FELUCCA_FLASH 1
typedef struct { uint32_t sentinel; } persist_t;
static persist_t persist_saved;
static int flash_ok = 1, flash_fail, writes;
static ml_bank_t flash_map;
static void persist_fill(persist_t *p) { p->sentinel = 123; }
static int settings_write_map(const persist_t *p, const ml_bank_t *map)
{
    assert(p->sentinel == 123); writes++;
    if (flash_fail) return -1;
    flash_map = *map; return 0;
}
#include "../firmware/src/editor_midi.c"
static void request(const uint8_t *raw, uint32_t n, uint32_t rc)
{
    ed_n = 0; assert(ed_midi_handle(77, raw, n)); assert(ed_out[0] == rc);
}
int main(void)
{
    ml_bank_t b;
    {
        ml_bank_t shifted = {ML_MAGIC, 4, {
            {ML_NOTE, 0, 59, ML_SHIFT, 0, 0},
            {ML_NOTE, 0, 60, ML_BUTTON, 0, 0},
            {ML_NOTE, 0, 60, ML_BUTTON | ML_SHIFT_BANK, 1, 0},
            {ML_CC, 0, 20, ML_ENCODER, 3, 0}
        }};
        assert(ml_valid(&shifted)); ml_apply(&shifted);
        ml_event(0x90, 60, 100); assert(ml_down == (1u << ml_btn[0]));
        ml_event(0x90, 59, 100); assert(ml_shift && !ml_down);
        ml_event(0x80, 60, 0); assert(!ml_down);
        ml_event(0x90, 60, 100); assert(ml_down == (1u << ml_btn[1]));
        ml_event(0xb0, 20, 50); ml_event(0xb0, 20, 52); assert(ml_take(3) == 2); // fallback
        ml_event(0x90, 59, 0); assert(!ml_shift && !ml_down);
        ml_event(0xb0, 20, 90); assert(!ml_take(3)); // reseed after bank change
        ml_event(0x80, 60, 0); assert(!ml_down);
        ml_event(0x90, 60, 100); assert(ml_down == (1u << ml_btn[0]));
        ml_reset(); assert(!ml_shift && !ml_down);
        shifted.binding[2].kind = ML_BUTTON; assert(!ml_valid(&shifted));
        shifted.binding[2].kind = ML_SHIFT; assert(!ml_valid(&shifted));
        shifted.binding[2].kind = ML_SHIFT | ML_SHIFT_BANK; assert(!ml_valid(&shifted));
        shifted.binding[2].kind = ML_KEY | ML_SHIFT_BANK;
        shifted.binding[0].source = ML_CC;
        assert(ml_valid(&shifted)); ml_apply(&shifted);
        ml_event(0xb0, 59, 127); ml_event(0x90, 60, 100); assert(ml_notes == 2u);
        ml_event(0xb0, 59, 0); assert(!ml_notes);
    }
    {
        ml_bank_t master = {ML_MAGIC, 1, {{ML_CC, 0, 7, ML_MASTER, 0, ML_ABSOLUTE}}};
        assert(ml_valid(&master)); ml_apply(&master);
        assert(ml_event(0xb0, 7, 0) && ml_master_pending == 0);
        assert(ml_event(0xb0, 7, 127) && ml_master_pending == 4096);
        assert(ml_event(0xb0, 7, 64) && ml_master_pending == 1040);
        assert(ml_event(0xb0, 7, 32) && ml_master_pending == 260);
        int32_t prior = -1;
        for (uint32_t value = 0; value < 128; value++) {
            assert(ml_event(0xb0, 7, value));
            assert(ml_master_pending >= prior); prior = ml_master_pending;
        }
        master.binding[0].source = ML_NOTE; assert(!ml_valid(&master));
        master.binding[0].source = ML_CC; master.binding[0].mode = ML_TWOS; assert(!ml_valid(&master));
    }
    uint8_t raw[] = {4, ML_NOTE, 0, 60, ML_BUTTON, 0, 0,
        ML_CC, 0, 20, ML_ENCODER, 3, ML_ABSOLUTE,
        ML_NOTE, 1, 61, ML_KEY, 26, 0, ML_CC, 1, 21, ML_KEY, 26, 0};
    assert(ml_decode(&b, raw, sizeof raw)); ml_apply(&b);
    assert(ml_event(0x90, 60, 100) && ml_buttons(0) == (1u << ml_btn[0]));
    assert(ml_buttons(1u << 13) & (1u << 13));
    assert(!ml_event(0x91, 60, 100));
    assert(ml_event(0x80, 60, 64) && !ml_down);
    ml_event(0x90, 60, 100); ml_event(0x90, 60, 0); assert(!ml_down);
    ml_event(0xb0, 20, 90); assert(ml_take(3) == 0);
    ml_event(0xb0, 20, 94); assert(ml_take(3) == 4);
    ml_event(0xb0, 20, 92); assert(ml_take(3) == -2);
    ml_event(0x91, 61, 100); ml_event(0xb1, 21, 127); ml_event(0x81, 61, 0);
    assert(ml_keys(1) == ((1u << 26) | 1u));
    ml_event(0xb1, 21, 0); assert(!ml_notes);
    b.binding[1].mode = ML_TWOS; ml_apply(&b);
    ml_event(0xb0, 20, 1); ml_event(0xb0, 20, 127); assert(ml_take(3) == 0);
    ml_event(0xb0, 20, 2); assert(ml_take(3) == 2);
    b.binding[1].mode = ML_OFFSET; ml_apply(&b);
    ml_event(0xb0, 20, 64); ml_event(0xb0, 20, 63); assert(ml_take(3) == -1);
    ml_event(0x91, 61, 100); ml_reset(); assert(!ml_notes && !ml_down && !ml_take(3));
    b.binding[1] = b.binding[0]; assert(!ml_valid(&b));
    assert(!ml_decode(&b, raw, sizeof raw - 1));
    raw[5] = 14; assert(!ml_decode(&b, raw, sizeof raw)); raw[5] = 0;
    raw[6] = 1; assert(!ml_decode(&b, raw, sizeof raw)); raw[6] = 0;
    {
        uint8_t put[sizeof raw + 1], get[] = {0};
        put[0] = 1; memcpy(put + 1, raw, sizeof raw);
        request(put, sizeof put, 0); assert(writes == 1 && flash_map.count == 4 && ml_bank.count == 4);
        request(get, sizeof get, 0); assert(ed_n == 2 + 6 * 4 && ed_out[1] == 4);
        ml_bank_t previous = ml_bank;
        put[6] = 14; request(put, sizeof put, 2); assert(writes == 1); put[6] = 0;
        song.playing = 1; request(put, sizeof put, 3); assert(writes == 1); song.playing = 0;
        transport_req = 1; request(put, sizeof put, 3); transport_req = 0;
        flash_fail = 1; request(put, sizeof put, 4); assert(!memcmp(&previous, &ml_bank, sizeof previous)); flash_fail = 0;
        flash_ok = 0; request(put, sizeof put, 4); flash_ok = 1;
        uint8_t empty[] = {1,0}; request(empty, sizeof empty, 0); assert(!ml_bank.count && !flash_map.count);
        request(get, 0, 2); assert(!ed_midi_handle(76, get, 1));
    }
    puts("MIDI learn: validation, modes, holds, releases, protocol errors and save-before-apply PASS");
    return 0;
}
