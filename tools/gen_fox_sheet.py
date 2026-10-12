#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Convert the hand-drawn fox sprite sheet into firmware/src/fox_tamagotchi_assets.h.

  python3 tools/gen_fox_sheet.py [assets/fox/fox_spritesheet.png [firmware/src/fox_tamagotchi_assets.h]]

The sheet must be a clean grid (no section labels inside it): 6 columns x 4 rows
of 24x24 frames, row order SLEEP, PLAY, IDLE, EAT. Near-black background pixels
become transparent 0x0000. Emits flat fox_frame_00..23 arrays plus the master
all_fox_frames table and per-state sequences the pet screen (ui_fox.c) uses.
"""
import sys
from pathlib import Path

from PIL import Image

FRAME_WIDTH = 24
FRAME_HEIGHT = 24
STATES = ("sleep", "play", "idle", "eat")  # one sheet row each, 6 frames apiece


def rgb888_to_rgb565(r, g, b):
    """Converts 24-bit RGB to 16-bit RGB565 integer format."""
    return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)


def process_spritesheet(image_path, output_file):
    img = Image.open(image_path).convert("RGB")
    sheet_width, sheet_height = img.size

    cols = sheet_width // FRAME_WIDTH
    rows = sheet_height // FRAME_HEIGHT
    if (cols, rows) != (6, 4):
        raise SystemExit(f"{image_path}: want a 6x4 grid of 24x24 frames, got {sheet_width}x{sheet_height}")

    frames = []
    for r in range(rows):
        for c in range(cols):
            box = (c * FRAME_WIDTH, r * FRAME_HEIGHT, (c + 1) * FRAME_WIDTH, (r + 1) * FRAME_HEIGHT)
            frame_img = img.crop(box)
            px = frame_img.load()
            data = []
            for y in range(FRAME_HEIGHT):
                for x in range(FRAME_WIDTH):
                    r_val, g_val, b_val = px[x, y]
                    # Treat pure black or near-black background as 0x0000
                    if r_val < 15 and g_val < 15 and b_val < 15:
                        data.append(0x0000)
                    else:
                        data.append(rgb888_to_rgb565(r_val, g_val, b_val))
            frames.append(data)

    with open(output_file, "w") as f:
        f.write("/**\n * @file fox_tamagotchi_assets.h\n")
        f.write(" * @brief Tamagotchi Fox Animation Sprite Sheets (RGB565 16-bit color format)\n")
        f.write(" * Auto-generated from %s by tools/gen_fox_sheet.py - do not edit by hand.\n" % Path(image_path).name)
        f.write(" * Target: M-VAVE FM-1 1.54-inch TFT Display\n */\n\n")
        f.write("#ifndef FOX_TAMAGOTCHI_ASSETS_H\n#define FOX_TAMAGOTCHI_ASSETS_H\n\n")
        f.write("#include <stdint.h>\n\n")
        f.write("/* --- Fox palette (RGB565), shared with the pet screen --- */\n")
        f.write("#define FOX_COLOR_BG_BLACK   0x0000  /* #000000 - background / transparent */\n")
        f.write("#define FOX_COLOR_OUTLINE    0x18C5  /* #1A1828 - Dark Shadow / Outline */\n")
        f.write("#define FOX_COLOR_FUR_ORANGE 0xFBA0  /* #FF7700 - Bright Retro Orange */\n")
        f.write("#define FOX_COLOR_HIGHLIGHT  0xFFE0  /* #FFFF00 - Crisp Yellow Highlight / Details */\n\n")
        f.write("/* --- Frame Dimensions --- */\n")
        f.write("#define FOX_FRAME_WIDTH  24\n#define FOX_FRAME_HEIGHT 24\n")
        f.write("#define FOX_FRAME_PIXELS (FOX_FRAME_WIDTH * FOX_FRAME_HEIGHT)\n\n")

        for i, data in enumerate(frames):
            f.write(f"static const uint16_t fox_frame_{i:02d}[FOX_FRAME_PIXELS] = {{\n    ")
            for n, v in enumerate(data, 1):
                f.write(f"0x{v:04X}, ")
                if n % 12 == 0:
                    f.write("\n    ")
            f.write("\n};\n\n")

        # Write master lookup table grouping all frames
        f.write(f"static const uint16_t* const all_fox_frames[{len(frames)}] = {{\n")
        for i in range(len(frames)):
            f.write(f"    fox_frame_{i:02d},\n")
        f.write("};\n\n")

        # Per-state sequences the pet screen animates (one sheet row each)
        for s, state in enumerate(STATES):
            names = [f"fox_frame_{s * 6 + i:02d}" for i in range(6)]
            f.write(f"/* {state} sequence: sheet row {s + 1} */\n")
            f.write(f"static const uint16_t* const fox_{state}_sequence[] = {{\n")
            for name in names:
                f.write(f"    {name},\n")
            f.write("};\n")
            f.write(f"#define FOX_{state.upper()}_FRAMES 6u\n\n")

        f.write("#endif // FOX_TAMAGOTCHI_ASSETS_H\n")

    print(f"Successfully processed {len(frames)} frames into {output_file}!")


if __name__ == "__main__":
    args = sys.argv[1:]
    src = args[0] if len(args) > 0 else "assets/fox/fox_spritesheet.png"
    dst = args[1] if len(args) > 1 else "firmware/src/fox_tamagotchi_assets.h"
    if not Path(src).exists():
        sys.exit(f"{src}: not found - save the sprite sheet there (clean 6x4 grid, rows SLEEP PLAY IDLE EAT)")
    process_spritesheet(src, dst)
