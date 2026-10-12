/* SPDX-License-Identifier: GPL-3.0-only */
export const WHITE_KEYS = [0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23, 24, 26];
export const keyName = k => ['F','F♯','G','G♯','A','A♯','B','C','C♯','D','D♯','E'][(k % 12 + 12) % 12] + (3 + Math.floor((k + 5) / 12));
export function keyLayout(mode, controllerName, first = 0, count = 16) {
  const octave = mode === 'octave' || (mode === 'auto' && /circuit rhythm/i.test(controllerName));
  const start = octave ? 4 : mode === 'custom' ? Math.max(0, WHITE_KEYS.indexOf(Number(first))) : 0;
  const n = octave ? 8 : mode === 'custom' ? Math.max(1, Math.min(16 - start, Math.floor(Number(count)) || 1)) : 16;
  const whites = WHITE_KEYS.slice(start, start + n), low = whites[0], high = whites.at(-1);
  return {whites, low, high, count: high - low + 1};
}
