#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 Leo Kuroshita (@kurogedelic), Hügelton Instruments
# Build the editor's dev-screen window: the real firmware UI (tests/devscreen.c, which includes the
# whole of tests/ui_pages_test.c's host harness) compiled to WebAssembly, so the pixels are the
# firmware's own. Runs emcc in the emscripten/emsdk image, as build.sh runs the firmware tools in Docker.
#   tools/build_devscreen.sh
# writes web/devscreen.core.mjs + web/devscreen.core.wasm (ES module: web/ is "type": "module").
set -e
cd "$(dirname "$0")/.."
ROOT="$PWD"
GEN="$ROOT/build/gen"
mkdir -p "$GEN"

# the generated headers the UI sources include (no Pillow needed for tables / fm6; the font, icons and
# logo headers are checked in with the firmware build, so require them)
[ -f "$GEN/felucca_tables.h" ] || python3 tools/gen_tables.py "$GEN/felucca_tables.h"
[ "$GEN/felucca_fm6.h" -nt tools/gen_fm6_patches.py ] || python3 tools/gen_fm6_patches.py "$GEN/felucca_fm6.h"
for h in felucca_font.h felucca_icons.h sloop_logo.h; do
    [ -f "$GEN/$h" ] || { echo "missing build/gen/$h (run ./build.sh once, or the tools/gen_*.py)" >&2; exit 1; }
done

EXPORTS='["_ds_init","_ds_screen","_ds_width","_ds_height","_ds_ms","_ds_frame","_ds_frames","_ds_press","_ds_release","_ds_tap","_ds_key","_ds_turn","_ds_home","_ds_open_family","_ds_set_page","_ds_cur_page","_ds_page_count","_ds_page_title","_ds_page_family","_ds_family_count","_ds_family_title","_ds_select_track","_ds_selected_track","_ds_play","_ds_playing","_ds_set_bpm","_ds_set_engine","_ds_set_preset","_ds_out","_ds_audio_enable","_ds_master","_ds_audio","_malloc","_free"]'

docker run --rm -v "$ROOT":/src -w /src emscripten/emsdk:latest \
    emcc tests/devscreen.c -Ibuild/gen -Ifirmware/src -Ifirmware/hal \
    -O2 -w -lm --no-entry \
    -sMODULARIZE=1 -sEXPORT_NAME=createDevScreen -sEXPORT_ES6=1 \
    -sENVIRONMENT=web,node \
    -sALLOW_MEMORY_GROWTH=1 \
    -sEXPORTED_FUNCTIONS="$EXPORTS" \
    -sEXPORTED_RUNTIME_METHODS='["HEAPU16","HEAPU8","UTF8ToString","ccall","cwrap"]' \
    -o web/devscreen.core.mjs

# emcc runs as root in the container: hand the artifacts back to the invoking user
[ "$(id -u)" = 0 ] || chown "$(id -u):$(id -g)" web/devscreen.core.mjs web/devscreen.core.wasm 2>/dev/null || true
rm -f web/devscreen.core.js
ls -la web/devscreen.core.mjs web/devscreen.core.wasm
echo "dev screen built"
