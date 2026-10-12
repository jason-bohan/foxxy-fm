#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Tamagotchi fox sprite sheets for the FM-1's 240x240 TFT (24x24 RGB565 frames).

  tools/gen_fox_sprites.py firmware/src/fox_tamagotchi_assets.h
  tools/gen_fox_sprites.py --preview /tmp/fox-preview.png   (8 frames side by side)

Palette (RGB565): black background, dark outline, retro orange fur, yellow highlights.
Frames: idle (sit + blink), sleep (curled + breathe), play (leap + land),
eat (bow + munch). The pet screen (ui_fox.c) picks the sequence by state.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

W, H = 24, 24
BG = (0, 0, 0)
OUTLINE = (0x1A, 0x18, 0x28)
FUR = (0xFF, 0x77, 0x00)
YELLOW = (0xFF, 0xFF, 0x00)


def rgb565(c):
    r, g, b = c
    return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)


def new():
    return Image.new("RGB", (W, H), BG)


def o_ellipse(d, box, fill):
    """filled ellipse with a 1px outline"""
    x0, y0, x1, y1 = box
    d.ellipse([x0 - 1, y0 - 1, x1 + 1, y1 + 1], fill=OUTLINE)
    d.ellipse(box, fill=fill)


def tri(d, pts, fill):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    d.polygon([(x - 1, y) for x, y in pts] + [(xs[0], min(ys) - 1)], fill=OUTLINE)
    d.polygon([(x, y - 1) for x, y in pts], fill=OUTLINE)
    d.polygon(pts, fill=fill)


def ears(d, dy=0, flop=False):
    if flop:  # ears angled out (landing / eating)
        tri(d, [(4, 9 + dy), (1, 4 + dy), (9, 7 + dy)], FUR)
        tri(d, [(20, 9 + dy), (23, 4 + dy), (15, 7 + dy)], FUR)
    else:  # upright triangles with yellow inner tufts
        tri(d, [(4, 10 + dy), (4, 1 + dy), (11, 9 + dy)], FUR)
        tri(d, [(20, 10 + dy), (20, 1 + dy), (13, 9 + dy)], FUR)
        d.polygon([(5, 8 + dy), (5, 4 + dy), (8, 8 + dy)], fill=YELLOW)
        d.polygon([(19, 8 + dy), (19, 4 + dy), (16, 8 + dy)], fill=YELLOW)


def idle_0():
    return _idle(False)


def _idle(blink):
    im = new()
    d = ImageDraw.Draw(im)
    ears(d)
    o_ellipse(d, (5, 8, 19, 20), FUR)          # head
    d.ellipse((9, 14, 15, 19), fill=YELLOW)    # muzzle
    if blink:
        d.line([(8, 12), (10, 12)], fill=OUTLINE, width=1)
        d.line([(14, 12), (16, 12)], fill=OUTLINE, width=1)
    else:
        d.rectangle([(8, 11), (10, 13)], fill=OUTLINE)
        d.rectangle([(14, 11), (16, 13)], fill=OUTLINE)
    d.point((12, 15), fill=OUTLINE)            # nose
    d.line([(12, 16), (12, 17)], fill=OUTLINE, width=1)
    # sitting body + tail curl at the base
    o_ellipse(d, (7, 18, 17, 24), FUR)
    d.arc((13, 17, 23, 25), start=270, end=90, fill=OUTLINE, width=3)
    d.arc((13, 17, 23, 25), start=300, end=60, fill=YELLOW, width=1)
    return im


def idle_1():
    return _idle(True)


def _sleep(dy=0):
    im = new()
    d = ImageDraw.Draw(im)
    o_ellipse(d, (3, 10 + dy, 21, 22 + dy), FUR)      # curled body
    d.arc((9, 11 + dy, 23, 23 + dy), start=270, end=120, fill=OUTLINE, width=3)  # tail wrap
    d.arc((9, 11 + dy, 23, 23 + dy), start=300, end=90, fill=FUR, width=1)
    d.ellipse((17, 18 + dy, 20, 21 + dy), fill=YELLOW)  # tail tip
    tri(d, [(5, 11 + dy), (4, 6 + dy), (9, 9 + dy)], FUR)  # ear peeking out
    d.line([(8, 14 + dy), (12, 14 + dy)], fill=OUTLINE, width=1)  # closed eye
    d.line([(12, 14 + dy), (13, 15 + dy)], fill=OUTLINE, width=1)
    return im


def sleep_0():
    return _sleep(0)


def sleep_1():
    return _sleep(-1)  # breathing lift


def play_0():
    im = new()  # leap: body high, legs out, tail up
    d = ImageDraw.Draw(im)
    d.line([(8, 13), (3, 5)], fill=OUTLINE, width=3)
    d.line([(8, 13), (3, 5)], fill=FUR, width=1)
    d.point((3, 5), fill=YELLOW)
    o_ellipse(d, (7, 10, 16, 19), FUR)         # body
    o_ellipse(d, (12, 3, 21, 12), FUR)         # head up-right
    tri(d, [(13, 4), (12, -1), (17, 3)], FUR)
    tri(d, [(19, 4), (20, -1), (16, 3)], FUR)
    d.rectangle([(15, 6), (16, 7)], fill=OUTLINE)  # eye
    d.point((19, 8), fill=OUTLINE)             # nose
    d.line([(9, 19), (6, 22)], fill=OUTLINE, width=2)   # legs extended
    d.line([(14, 19), (14, 23)], fill=OUTLINE, width=2)
    return im


def play_1():
    im = new()  # land: low crouch, ears back, tail down
    d = ImageDraw.Draw(im)
    d.line([(5, 18), (3, 23)], fill=OUTLINE, width=3)
    d.line([(5, 18), (3, 23)], fill=FUR, width=1)
    d.point((3, 23), fill=YELLOW)
    o_ellipse(d, (6, 12, 18, 21), FUR)         # crouched body
    o_ellipse(d, (9, 6, 19, 15), FUR)          # head low
    tri(d, [(10, 7), (7, 2), (13, 5)], FUR)
    tri(d, [(18, 7), (21, 2), (15, 5)], FUR)
    d.line([(11, 10), (13, 10)], fill=OUTLINE, width=1)  # happy closed eyes
    d.line([(15, 10), (17, 10)], fill=OUTLINE, width=1)
    d.point((14, 13), fill=OUTLINE)            # nose
    d.line([(8, 21), (6, 23)], fill=OUTLINE, width=2)   # folded legs
    d.line([(16, 21), (18, 23)], fill=OUTLINE, width=2)
    return im


def _eat(munch=False):
    im = new()
    d = ImageDraw.Draw(im)
    dy = 1 if munch else 0
    ears(d, dy=dy, flop=True)
    o_ellipse(d, (6, 7 + dy, 18, 17 + dy), FUR)  # bowed head
    d.line([(9, 11 + dy), (11, 11 + dy)], fill=OUTLINE, width=1)
    d.line([(13, 11 + dy), (15, 11 + dy)], fill=OUTLINE, width=1)
    if munch:
        d.rectangle([(11, 14 + dy), (13, 16 + dy)], fill=OUTLINE)  # open mouth
    else:
        d.point((12, 14 + dy), fill=OUTLINE)
    # food bowl
    d.ellipse((6, 18, 18, 23), fill=OUTLINE)
    d.ellipse((8, 19, 16, 22), fill=BG)
    d.ellipse((9, 18, 15, 21), fill=FUR)
    d.point((11, 19), fill=YELLOW)
    d.point((13, 20), fill=YELLOW)
    if munch:
        d.point((6, 17), fill=YELLOW)  # crumbs
        d.point((18, 17), fill=YELLOW)
    return im


def eat_0():
    return _eat(False)


def eat_1():
    return _eat(True)


FRAMES = [
    ("idle", [idle_0, idle_1]),
    ("sleep", [sleep_0, sleep_1]),
    ("play", [play_0, play_1]),
    ("eat", [eat_0, eat_1]),
]


def frame_data(im):
    px = im.load()
    return [rgb565(px[x, y]) for y in range(H) for x in range(W)]


def emit_header(path):
    L = ["/* Generated by tools/gen_fox_sprites.py: Tamagotchi fox sprite sheets (24x24 RGB565).",
         " * Target: M-VAVE FM-1 1.54-inch TFT. Do not edit by hand; rerun the generator. */",
         "#ifndef FOX_TAMAGOTCHI_ASSETS_H",
         "#define FOX_TAMAGOTCHI_ASSETS_H",
         "",
         "#include <stdint.h>",
         "",
         "/* --- Color Definitions (RGB565) --- */",
         "#define FOX_COLOR_BG_BLACK   0x%04X  /* #000000 - True Black Background */" % rgb565(BG),
         "#define FOX_COLOR_OUTLINE    0x%04X  /* #1A1828 - Dark Shadow / Outline */" % rgb565(OUTLINE),
         "#define FOX_COLOR_FUR_ORANGE 0x%04X  /* #FF7700 - Bright Retro Orange */" % rgb565(FUR),
         "#define FOX_COLOR_HIGHLIGHT  0x%04X  /* #FFFF00 - Crisp Yellow Highlight / Details */" % rgb565(YELLOW),
         "",
         "/* --- Frame Dimensions --- */",
         "#define FOX_FRAME_WIDTH  24",
         "#define FOX_FRAME_HEIGHT 24",
         "#define FOX_FRAME_PIXELS (FOX_FRAME_WIDTH * FOX_FRAME_HEIGHT)",
         ""]
    for state, makers in FRAMES:
        for i, make in enumerate(makers):
            data = frame_data(make())
            L.append("/* %s frame %d: %d pixels, row by row */" % (state, i + 1, len(data)))
            L.append("static const uint16_t fox_sprite_frame_%s_%02d[FOX_FRAME_PIXELS] = {" % (state, i + 1))
            for r in range(H):
                row = data[r * W:(r + 1) * W]
                L.append("    " + ", ".join("0x%04X" % v for v in row) + ",")
            L.append("};")
        L.append("/* Animation State Mapping: %s sequence (%d frames) */" % (state, len(makers)))
        L.append("static const uint16_t *const fox_%s_sequence[] = {" % state)
        for i in range(len(makers)):
            L.append("    fox_sprite_frame_%s_%02d," % (state, i + 1))
        L.append("};")
        L.append("#define FOX_%s_FRAMES %du" % (state.upper(), len(makers)))
        L.append("")
    L.append("#endif /* FOX_TAMAGOTCHI_ASSETS_H */")
    Path(path).write_text("\n".join(L) + "\n")
    print("fox: %d frames -> %s" % (sum(len(m) for _, m in FRAMES), path))


def preview(path):
    sheet = Image.new("RGB", (W * 8, H * 2), (32, 32, 40))
    for i, (state, makers) in enumerate(FRAMES):
        for j, make in enumerate(makers):
            sheet.paste(make(), (i * 2 * W + j * W, 0))
    sheet = sheet.resize((sheet.width * 6, sheet.height * 6), Image.NEAREST)
    sheet.save(path)
    print("fox: preview -> %s" % path)


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--preview":
        preview(sys.argv[2])
    elif len(sys.argv) == 2:
        emit_header(sys.argv[1])
    else:
        sys.exit(__doc__)
