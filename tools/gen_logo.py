#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""The Foxxy FM logo: a fox head (the spaceFoxxy mascot) in a 270-degree dial
(the knobs of the UI), plus a geometric wordmark.

  tools/gen_logo.py OUT.h          firmware boot splash (RLE, 16-colour palette, RGB565)
  tools/gen_logo.py --assets DIR   foxxy-logo.svg, foxxy-logo.png, foxxy-icon.svg/png, foxxy-splash.png
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

WORD = "FOXXY FM"                            # the wordmark, set in a rounded bold sans
_FONT_CANDIDATES = ("Arial Rounded Bold.ttf", "Arial Bold.ttf", "Arial.ttf",
                    "DejaVuSans-Bold.ttf", "LiberationSans-Bold.ttf")
_FONT_DIRS = ("/System/Library/Fonts/Supplemental", "/System/Library/Fonts",
              "/Library/Fonts", "/usr/share/fonts")
_font_cache = {}


def _word_font(px):
    """a rounded bold sans at px em-size, cached (falls back to PIL's default)"""
    px = max(8, int(px))
    if px in _font_cache:
        return _font_cache[px]
    for d in _FONT_DIRS:
        for name in _FONT_CANDIDATES:
            p = Path(d) / name
            if p.exists():
                try:
                    return _font_cache.setdefault(px, ImageFont.truetype(str(p), px))
                except OSError:
                    continue
    try:
        return _font_cache.setdefault(px, ImageFont.load_default(size=px))
    except TypeError:
        return _font_cache.setdefault(px, ImageFont.load_default())

BLUE, GREEN = (40, 124, 255), (30, 204, 112)    # splash palette only now
YELLOW = (241, 196, 15)                          # forehead diamond base
FUR = (232, 124, 36)                             # primary orange fur
LIGHT_FUR = (245, 161, 76)                       # lighter accent orange
DARK_FUR = (198, 90, 21)                         # shading / darker fur
CHEST = (244, 164, 96)                           # mid-tone neck/chest
RED = (255, 44, 52)                              # first X of the wordmark
DARK = (42, 24, 16)                              # nose, eyes & outer ear accents
WHITE, BLACK = (242, 242, 242), (0, 0, 0)
HEX = lambda c: "#%02X%02X%02X" % c
ORANGE = (255, 98, 26)                           # the track orange (splash palette only)

# ---- geometry (units: the icon is 240 x 240) --------------------------------
ICON = dict(r=106, w=12)

# low-poly vector fox head, in icon-box coordinates (dial arc as drawn before)
EAR_L_OUTER = [(58, 104), (64, 28), (116, 78)]
EAR_R_OUTER = [(182, 104), (176, 28), (124, 78)]
EAR_L_INNER = [(68, 94), (70, 46), (106, 76)]
EAR_R_INNER = [(172, 94), (170, 46), (134, 76)]
HEAD_TOP = [(80, 72), (160, 72), (150, 102), (90, 102)]
HEAD_LEFT = [(90, 102), (120, 102), (120, 172), (98, 158), (88, 148), (94, 118), (70, 118), (78, 102)]
HEAD_RIGHT = [(150, 102), (120, 102), (120, 172), (142, 158), (152, 148), (146, 118), (170, 118), (162, 102)]
CHEEK_L = [(94, 120), (112, 120), (108, 150), (90, 146)]
CHEEK_R = [(146, 120), (128, 120), (132, 150), (150, 146)]
DIAMOND = [(120, 84), (130, 96), (120, 108), (110, 96)]
DIAMOND_SHINE = [(115, 89), (121, 89), (117, 101)]
MUZZLE_TOP = [(106, 122), (134, 122), (130, 136), (110, 136)]
MUZZLE_L = [(106, 136), (120, 136), (120, 164), (104, 160)]
MUZZLE_R = [(134, 136), (120, 136), (120, 164), (136, 160)]
CHIN = [(112, 160), (128, 160), (120, 172)]
NOSE = [(112, 134), (128, 134), (120, 145)]
EYE_L_SLOPE = [(90, 110), (106, 105)]
EYE_R_SLOPE = [(150, 110), (134, 105)]


def draw_icon(d, ox, oy, k):
    g = ICON
    cx, cy, r, w = ox + 120 * k, oy + 120 * k, g["r"] * k, g["w"] * k
    d.arc([cx - r, cy - r, cx + r, cy + r], start=135, end=405, fill=WHITE, width=max(1, round(w)))
    for a in (135, 405):
        x = cx + (r - w / 2) * math.cos(math.radians(a))
        y = cy + (r - w / 2) * math.sin(math.radians(a))
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=WHITE)

    def poly(pts, fill):
        d.polygon([(ox + x * k, oy + y * k) for x, y in pts], fill=fill)

    poly(EAR_L_OUTER, DARK_FUR)
    poly(EAR_R_OUTER, DARK_FUR)
    poly(EAR_L_INNER, FUR)
    poly(EAR_R_INNER, FUR)

    poly(HEAD_TOP, DARK_FUR)
    poly(HEAD_LEFT, FUR)
    poly(HEAD_RIGHT, FUR)
    poly(CHEEK_L, LIGHT_FUR)
    poly(CHEEK_R, LIGHT_FUR)

    poly(DIAMOND, YELLOW)
    poly(DIAMOND_SHINE, WHITE)

    poly(MUZZLE_TOP, LIGHT_FUR)
    poly(MUZZLE_L, WHITE)
    poly(MUZZLE_R, WHITE)
    poly(CHIN, WHITE)

    poly(NOSE, DARK)

    # Eyes (geometric low-poly accents)
    ew = max(1, round(2 * k))
    for x0, y0, x1, y1 in (EYE_L_SLOPE[0] + EYE_L_SLOPE[1], EYE_R_SLOPE[0] + EYE_R_SLOPE[1]):
        d.line([ox + x0 * k, oy + y0 * k, ox + x1 * k, oy + y1 * k], fill=DARK, width=ew)


def word_width(k):
    f = _word_font(84 * k)
    try:
        return sum(f.getlength(ch) for ch in WORD)
    except AttributeError:
        return int(len(WORD) * 55 * k)


# letter colors of "FOXXY FM": first X red, second X orange, Y yellow, rest white
WORD_FILLS = {2: RED, 3: FUR, 4: YELLOW}


def draw_word(d, ox, oy, k, col=WHITE):
    f = _word_font(84 * k)
    x = ox
    for i, ch in enumerate(WORD):
        d.text((x, oy), ch, font=f, fill=WORD_FILLS.get(i, col))
        try:
            x += f.getlength(ch)
        except AttributeError:
            x += 55 * k


def render(kind, W, H, k, bg=BLACK, ss=4):
    im = Image.new("RGB", (W * ss, H * ss), bg)
    d = ImageDraw.Draw(im)
    K = k * ss
    if kind == "h":                                   # icon + wordmark side by side
        draw_icon(d, 10 * K, (H * ss - 240 * K) / 2, K)
        draw_word(d, 270 * K, H * ss / 2 - 36 * K, K)
    elif kind == "v":                                 # icon over the wordmark (the boot splash)
        draw_icon(d, (W * ss - 240 * K) / 2, 0, K)
        draw_word(d, (W * ss - word_width(K)) / 2, 262 * K, K)
    else:
        draw_icon(d, (W * ss - 240 * K) / 2, (H * ss - 240 * K) / 2, K)
    return im.resize((W, H), Image.LANCZOS)


# ---- SVG (stroke centred on the path) ---------------------------------------------------------
def svg_icon(ox, oy):
    g, k = ICON, 1.0
    cx, cy, w = ox + 120, oy + 120, g["w"]
    r = g["r"] - w / 2
    a0, a1 = math.radians(135), math.radians(405)
    p0 = (cx + r * math.cos(a0), cy + r * math.sin(a0))
    p1 = (cx + r * math.cos(a1), cy + r * math.sin(a1))
    s = [f'<path d="M{p0[0]:.2f} {p0[1]:.2f} A{r:.2f} {r:.2f} 0 1 1 {p1[0]:.2f} {p1[1]:.2f}" fill="none" '
         f'stroke="{HEX(WHITE)}" stroke-width="{w}" stroke-linecap="round"/>']
    def poly(pts, fill):
        s.append('<polygon points="' + " ".join(f"{ox + x:.2f},{oy + y:.2f}" for x, y in pts) +
                 f'" fill="{fill}"/>')

    poly(EAR_L_OUTER, HEX(DARK_FUR))
    poly(EAR_R_OUTER, HEX(DARK_FUR))
    poly(EAR_L_INNER, HEX(FUR))
    poly(EAR_R_INNER, HEX(FUR))
    poly(HEAD_TOP, HEX(DARK_FUR))
    poly(HEAD_LEFT, HEX(FUR))
    poly(HEAD_RIGHT, HEX(FUR))
    poly(CHEEK_L, HEX(LIGHT_FUR))
    poly(CHEEK_R, HEX(LIGHT_FUR))
    poly(DIAMOND, HEX(YELLOW))
    poly(DIAMOND_SHINE, HEX(WHITE))
    poly(MUZZLE_TOP, HEX(LIGHT_FUR))
    poly(MUZZLE_L, HEX(WHITE))
    poly(MUZZLE_R, HEX(WHITE))
    poly(CHIN, HEX(WHITE))
    poly(NOSE, HEX(DARK))
    for (x0, y0), (x1, y1) in (EYE_L_SLOPE, EYE_R_SLOPE):
        s.append(f'<line x1="{ox + x0:.2f}" y1="{oy + y0:.2f}" x2="{ox + x1:.2f}" y2="{oy + y1:.2f}" '
                 f'stroke="{HEX(DARK)}" stroke-width="2" stroke-linecap="round"/>')
    return s


def svg_word(ox, oy):
    # oy: top of the wordmark box (as in draw_word); the baseline sits ~64 units below it.
    # First X red, second X orange, Y yellow, the rest white.
    fills = {2: HEX(RED), 3: HEX(FUR), 4: HEX(YELLOW)}
    out = []
    for i, ch in enumerate(WORD):
        out.append(f'<tspan fill="{fills[i]}">{ch}</tspan>' if i in fills else ch)
    return [f'<text x="{ox:.2f}" y="{oy + 64:.2f}" font-family="\'Arial Rounded MT Bold\', \'Arial Bold\', Arial, sans-serif" '
            f'font-size="84" font-weight="bold" letter-spacing="1" fill="{HEX(WHITE)}">{"".join(out)}</text>']


def svg(kind):
    if kind == "h":
        W, H = 760, 260
        body = svg_icon(10, 10) + svg_word(270, H / 2 - 36)
    else:
        W, H = 240, 240
        body = svg_icon(0, 0)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" '
            f'aria-label="Foxxy FM">\n<rect width="{W}" height="{H}" fill="#000"/>\n' + "\n".join(body) + "\n</svg>\n")


# ---- firmware splash ---------------------------------------------------------------------------
SPLASH_W, SPLASH_H = 240, 159
# the scale: the icon (240) over the "FOXXY FM" wordmark (~60 tall at 0.5).
# At 0.44 the wordmark stays inside the 159 rows with room for the version line.
# The splash was 240x188 at 0.5 (4944 B RLE); the image had no flash left for it.
SPLASH_K = 0.44
assert 262 * SPLASH_K + 84 * SPLASH_K + 6 <= SPLASH_H, "the wordmark must fit the splash"


def rgb565(c):
    r, g, b = c
    return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)


def splash_header(path):
    im = render("v", SPLASH_W, SPLASH_H, SPLASH_K)
    # a fixed palette: black, the logo whites/furs/yellows at 1/3, 2/3 and full
    # (the anti-aliased edges), then the flat dark/shading tones and the wordmark red
    cols = [BLACK]
    for c in (WHITE, FUR, YELLOW):
        cols += [tuple(round(v * f) for v in c) for f in (1 / 3, 2 / 3, 1.0)]
    cols += [DARK_FUR, LIGHT_FUR, CHEST, DARK,
             tuple(round(v * 2 / 3) for v in RED), RED]
    src = im.tobytes()
    px = []
    cache = {}
    for i in range(0, len(src), 3):
        p = (src[i], src[i + 1], src[i + 2])
        if p not in cache:
            cache[p] = min(range(16), key=lambda k: sum((p[j] - cols[k][j]) ** 2 for j in range(3)))
        px.append(cache[p])
    rle = bytearray()                                 # (run - 1) << 4 | index, runs of 1..16
    i = 0
    while i < len(px):
        j = i
        while j < len(px) and px[j] == px[i] and j - i < 16:
            j += 1
        rle.append(((j - i - 1) << 4) | px[i])
        i = j
    L = ["/* generated by tools/gen_logo.py: the Foxxy FM boot splash */", "#pragma once", "#include <stdint.h>",
         f"#define FOXXY_SPLASH_W {SPLASH_W}", f"#define FOXXY_SPLASH_H {SPLASH_H}",
         "static const uint16_t FOXXY_SPLASH_PAL[16] = {" + ", ".join(f"0x{rgb565(c):04X}" for c in cols) + "};",
         f"static const uint8_t FOXXY_SPLASH_RLE[{len(rle)}] = {{"]
    for k in range(0, len(rle), 24):
        L.append("    " + ", ".join(str(b) for b in rle[k:k + 24]) + ",")
    L.append("};")
    Path(path).write_text("\n".join(L) + "\n")
    print(f"logo: splash {SPLASH_W}x{SPLASH_H}, {len(rle)} B RLE -> {path}")


def assets(out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "foxxy-logo.svg").write_text(svg("h"))
    (out / "foxxy-icon.svg").write_text(svg("i"))
    render("h", 1520, 520, 2.0).save(out / "foxxy-logo.png")
    render("i", 512, 512, 512 / 240).save(out / "foxxy-icon.png")
    render("v", SPLASH_W, SPLASH_H, SPLASH_K).resize((SPLASH_W * 2, SPLASH_H * 2), Image.NEAREST).save(out / "foxxy-splash.png")
    print(f"logo: assets in {out}")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--assets":
        assets(sys.argv[2])
    elif len(sys.argv) == 2:
        splash_header(sys.argv[1])
    else:
        sys.exit(__doc__)
