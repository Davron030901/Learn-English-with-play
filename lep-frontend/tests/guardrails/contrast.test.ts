import { describe, expect, it } from 'vitest';

import { colors } from '@/design/tokens.generated';

/**
 * DECISIONS §7.7 / acceptance A10: every text-on-background pair the app uses reaches 4.5 : 1
 * (WCAG 1.4.3) in both themes — the ink ramp on every surface, each tone's ink on its soft fill
 * and on the surface, and each "on-" colour on its fill (button labels).
 */
function luminance(hex: string): number {
  const h = hex.replace('#', '').slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe.each(['light', 'dark'] as const)('%s theme', (theme) => {
  const c = colors[theme] as Record<string, string>;
  const pairs: [string, string][] = [];
  for (const text of ['ink', 'ink-2', 'ink-3']) for (const bg of ['bg', 'bg-soft', 'surface', 'surface-2']) pairs.push([text, bg]);
  for (const k of Object.keys(c).filter((x) => x.endsWith('-ink'))) {
    const hue = k.slice(0, -4);
    for (const bg of [`${hue}-soft`, 'surface', 'bg']) if (c[bg]) pairs.push([k, bg]);
  }
  for (const k of Object.keys(c).filter((x) => x.startsWith('on-'))) if (c[k.slice(3)]) pairs.push([k, k.slice(3)]);

  it('has the pairs to check', () => {
    expect(pairs.length).toBeGreaterThan(50);
  });

  it.each(pairs)('%s on %s ≥ 4.5 : 1', (fg, bg) => {
    expect(contrast(c[fg] as string, c[bg] as string)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the measure itself', () => {
  it('matches WCAG reference values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 1);
  });
});
