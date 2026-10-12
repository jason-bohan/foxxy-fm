/* SPDX-License-Identifier: GPL-3.0-only */
#define main hostsim_main
#include "hostsim.c"
#undef main
#include <assert.h>
typedef struct { uint8_t bytes[88]; } persist_t;
#include "../firmware/src/storage.c"
static uint8_t flash_image[0x100000];
static int fail_write;
static int st_read(uint32_t off, void *dst, uint32_t n)
{ assert(off + n <= sizeof flash_image); memcpy(dst, flash_image + off, n); return 0; }
static int st_erase(uint32_t off)
{ assert(off + ST_SECTOR <= sizeof flash_image); if (fail_write) return -1; memset(flash_image + off, 255, ST_SECTOR); return 0; }
static int st_prog(uint32_t off, const void *src, uint32_t n)
{
    uint32_t i; const uint8_t *s = src;
    assert(off + n <= sizeof flash_image); if (fail_write) return -1;
    for (i = 0; i < n; i++) { assert((flash_image[off + i] & s[i]) == s[i]); flash_image[off + i] &= s[i]; }
    return 0;
}
#include "../firmware/src/settings_banks.c"
int main(void)
{
    persist_t p = {{0}};
    ml_bank_t b = {ML_MAGIC, 1, {{ML_CC, 2, 21, ML_ENCODER, 4, ML_OFFSET}}};
    memset(flash_image, 255, sizeof flash_image); dsu_defaults();
    dsu.k[0].s[0].level = 93;
    dsu_bank_t drums_before = dsu;
    assert(settings_write_map(&p, &b) == 0);
    ml_reset(); ml_bank.count = 0; dsu_defaults(); dsu_boot();
    assert(ml_bank.count == 1 && ml_bank.binding[0].channel == 2 && ml_bank.binding[0].mode == ML_OFFSET);
    assert(!memcmp(&dsu, &drums_before, sizeof dsu));
    fail_write = 1; b.count = 0; assert(settings_write_map(&p, &b) == -1);
    fail_write = 0; dsu_boot(); assert(ml_bank.count == 1);
    ml_bank_t shifted = {ML_MAGIC, 3, {
        {ML_NOTE, 0, 59, ML_SHIFT, 0, 0},
        {ML_NOTE, 0, 60, ML_KEY, 0, 0},
        {ML_NOTE, 0, 60, ML_KEY | ML_SHIFT_BANK, 1, 0}
    }};
    assert(settings_write_map(&p, &shifted) == 0);
    ml_bank.count = 0; dsu_boot();
    assert(!memcmp(&ml_bank, &shifted, sizeof shifted));
    assert(!memcmp(&dsu, &drums_before, sizeof dsu));
    /* Old firmware settings have no mapping tail; their SYN kits still load. */
    assert(st_save2(OBJ_SETTINGS, &p, sizeof p, &drums_before, sizeof drums_before) == 0);
    dsu_boot(); assert(!ml_bank.count && !memcmp(&dsu, &drums_before, sizeof dsu));
    b.count = ML_MAX + 1; assert(settings_write_map(&p, &b) == 0);
    dsu_boot(); assert(!ml_bank.count && !memcmp(&dsu, &drums_before, sizeof dsu));
    b.count = 0; assert(settings_write_map(&p, &b) == 0); dsu_boot(); assert(!ml_bank.count);
    puts("Settings banks: MIDI power-cycle persistence, failed-write recovery, old settings and SYN preservation PASS");
    return 0;
}
