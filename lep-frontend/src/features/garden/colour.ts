/**
 * Blends two design-token colours (the garden tints leaves toward the dry-leaf token as a plant
 * gets thirsty). Inputs are token values; nothing here names a colour of its own.
 */
function parse(hex: string): [number, number, number, number] | null {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex);
  if (!m) return null;
  const v = m[1] as string;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16), m[2] ? parseInt(m[2], 16) : 255];
}

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');

/** `t` = 0 gives `a`, 1 gives `b`. Falls back to `a` for anything that is not #rrggbb(aa). */
export function mix(a: string, b: string, t: number): string {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return a;
  const k = Math.max(0, Math.min(1, t));
  const out = x.map((v, i) => v + ((y[i] as number) - v) * k);
  const alpha = out[3] as number;
  return `#${hex2(out[0] as number)}${hex2(out[1] as number)}${hex2(out[2] as number)}${alpha >= 254.5 ? '' : hex2(alpha)}`;
}

/** FNV-1a: a small stable hash, so a word's plant looks the same on every visit and device. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
