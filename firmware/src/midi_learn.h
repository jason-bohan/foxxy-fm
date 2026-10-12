/* SPDX-License-Identifier: GPL-3.0-only */
/* Shared by the hardware and dev screen. Targets are panel roles, not pages:
 * a learned knob does exactly what that panel knob does on the current page. */
#ifndef FOXXY_MIDI_LEARN_H
#define FOXXY_MIDI_LEARN_H
#define ML_MAX 48u
#define ML_MAGIC 0x4D4C3031u
enum { ML_NOTE, ML_CC };
enum { ML_BUTTON, ML_ENCODER, ML_KEY, ML_MASTER, ML_SHIFT };
#define ML_SHIFT_BANK 8u /* kind bit 3 selects the held-Shift mapping bank */
enum { ML_ABSOLUTE, ML_TWOS, ML_OFFSET };
typedef struct { uint8_t source, channel, number, kind, target, mode; } ml_binding_t;
typedef struct { uint32_t magic, count; ml_binding_t binding[ML_MAX]; } ml_bank_t;
static ml_bank_t ml_bank = { ML_MAGIC, 0, {{0}} };
static volatile uint32_t ml_down, ml_notes;
static uint8_t ml_shift;
static volatile int32_t ml_master_pending = -1;
static volatile uint32_t ml_master_active;
static volatile int32_t ml_turn[7];
static uint8_t ml_last[ML_MAX], ml_seen[ML_MAX], ml_held[ML_MAX];
static uint8_t ml_btn[14] = {2,3,4,5,6,7,8,9,10,11,12,13,0,1};

static int ml_valid(const ml_bank_t *p)
{
    uint32_t i, j;
    if (p->magic != ML_MAGIC || p->count > ML_MAX) return 0;
    for (i = 0; i < p->count; i++) {
        const ml_binding_t *b = &p->binding[i];
        uint32_t kind = b->kind & 7u;
        if (b->source > ML_CC || b->channel > 15 || b->number > 127 || b->kind > 11u || kind > ML_SHIFT ||
            b->mode > ML_OFFSET || (kind != ML_ENCODER && b->mode != ML_ABSOLUTE) ||
            (kind == ML_ENCODER && (b->source != ML_CC || b->target >= 7)) ||
            (kind == ML_MASTER && (b->source != ML_CC || b->target != 0)) ||
            (kind == ML_SHIFT && (b->target != 0 || b->kind != ML_SHIFT)) ||
            (kind == ML_BUTTON && b->target >= 14) || (kind == ML_KEY && b->target >= 27)) return 0;
        for (j = 0; j < i; j++)
            if ((kind == ML_SHIFT && p->binding[j].kind == ML_SHIFT) ||
                (p->binding[j].source == b->source && p->binding[j].channel == b->channel &&
                 p->binding[j].number == b->number &&
                 (kind == ML_SHIFT || p->binding[j].kind == ML_SHIFT ||
                  (p->binding[j].kind & ML_SHIFT_BANK) == (b->kind & ML_SHIFT_BANK)))) return 0;
    }
    return 1;
}
static int ml_decode(ml_bank_t *p, const uint8_t *raw, uint32_t n)
{
    uint32_t i, j;
    if (!n || raw[0] > ML_MAX || n != 1u + 6u * raw[0]) return 0;
    p->magic = ML_MAGIC; p->count = raw[0];
    for (i = 0; i < ML_MAX; i++) {
        uint8_t *b = (uint8_t *)&p->binding[i];
        for (j = 0; j < 6; j++) b[j] = i < p->count ? raw[1u + i * 6u + j] : 0;
    }
    return ml_valid(p);
}
static void ml_reset(void)
{
    uint32_t i;
    ml_down = ml_notes = 0;
    ml_shift = 0;
    ml_master_pending = -1; /* Keep the current volume when changing mappings. */
    for (i = 0; i < 7; i++) ml_turn[i] = 0;
    for (i = 0; i < ML_MAX; i++) ml_last[i] = ml_seen[i] = ml_held[i] = 0;
}
static void ml_apply(const ml_bank_t *p) { ml_bank = *p; ml_reset(); }
static uint32_t ml_buttons(uint32_t physical) { return physical | ml_down; }
static uint32_t ml_keys(uint32_t physical) { return physical | ml_notes; }
static int32_t ml_take(uint32_t role)
{
    int32_t n = ml_turn[role]; ml_turn[role] = 0; return n;
}
static int ml_event(uint32_t status, uint32_t number, uint32_t value)
{
    uint32_t i, source, channel = status & 15u, match = ML_MAX;
    uint32_t type = status & 0xF0u;
    if (type != 0x80u && type != 0x90u && type != 0xB0u) return 0;
    source = type == 0xB0u ? ML_CC : ML_NOTE;
    /* Shift is global and consumed. Changing banks releases held controls and
     * reseeds absolute knobs, so neither notes nor encoder jumps get stuck. */
    for (i = 0; i < ml_bank.count; i++) {
        const ml_binding_t *b = &ml_bank.binding[i];
        if (b->source != source || b->channel != channel || b->number != number) continue;
        if (b->kind == ML_SHIFT) {
            uint8_t down = source == ML_NOTE ? type == 0x90u && value != 0 : value >= 64u;
            if (down != ml_shift) { ml_reset(); ml_shift = down; }
            return 1;
        }
        if (!(b->kind & ML_SHIFT_BANK) && match == ML_MAX) match = i;
        if (ml_shift && (b->kind & ML_SHIFT_BANK)) { match = i; break; }
    }
    if (match != ML_MAX) {
        const ml_binding_t *b = &ml_bank.binding[match];
        uint32_t kind = b->kind & 7u;
        i = match;
        if (kind == ML_MASTER) {
            /* Match the physical master's squared taper: knob position is
             * linear, audio gain is not. Keep useful travel at low volumes. */
            ml_master_pending = (int32_t)((value * value * 4096u + 8064u) / 16129u);
            ml_master_active = 1;
        } else if (kind == ML_ENCODER) {
            int32_t d = 0, next;
            if (b->mode == ML_TWOS) d = value < 64u ? (int32_t)value : (int32_t)value - 128;
            else if (b->mode == ML_OFFSET) d = (int32_t)value - 64;
            else if (ml_seen[i]) d = (int32_t)value - ml_last[i];
            ml_seen[i] = 1; ml_last[i] = (uint8_t)value;
            next = ml_turn[b->target] + d;
            ml_turn[b->target] = next < -512 ? -512 : next > 512 ? 512 : next;
        } else {
            uint32_t j, buttons = 0, keys = 0;
            ml_held[i] = (uint8_t)(source == ML_NOTE ? type == 0x90u && value != 0 : value >= 64u);
            for (j = 0; j < ml_bank.count; j++) if (ml_held[j]) {
                const ml_binding_t *h = &ml_bank.binding[j];
                if ((h->kind & 7u) == ML_BUTTON) buttons |= 1u << ml_btn[h->target];
                if ((h->kind & 7u) == ML_KEY) keys |= 1u << h->target;
            }
            ml_down = buttons; ml_notes = keys;
        }
        return 1; /* learned controls are consumed, never also play a MIDI note/CC */
    }
    /* Consume inactive shifted-only controls rather than playing their notes. */
    for (i = 0; i < ml_bank.count; i++)
        if (ml_bank.binding[i].source == source && ml_bank.binding[i].channel == channel && ml_bank.binding[i].number == number) return 1;
    return 0;
}
#endif
