import { memo } from 'react';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

import type { Plant } from '@/api/types';
import type { Theme } from '@/design';

import { hash, mix } from './colour';

/**
 * The Word Garden's plants (docs/16 E09, art plan): one word = one plant, drawn in SVG from the
 * design tokens. Stage is the server's mastery state of the word's weakest side; health is the
 * server's due date. A thirsty plant bends and its leaves dry toward the dry-leaf tint, with a
 * water-drop badge; it never dies, wilts away or disappears (forgetting is gradual and
 * recoverable, so showing death would be both loss-framing and false).
 *
 * Cells are 44 × 56 (viewBox units); the stem stands on (22, 47).
 */

export type PlantStage = Plant['stage'];
export type Thirst = 'fresh' | 'thirsty' | 'dry';

export const GROWTH_STAGES = ['seed', 'sprout', 'bush', 'bloom', 'tree'] as const satisfies readonly PlantStage[];

/** Degrees the stem leans when a plant is due (thirsty) or long overdue (dry, R < 0.70). */
export const BEND: Readonly<Record<Thirst, number>> = { fresh: 0, thirsty: 18, dry: 28 };
const DRY_TINT: Readonly<Record<Thirst, number>> = { fresh: 0, thirsty: 0.4, dry: 0.8 };

/** Below this recall probability a thirsty plant is drawn dry (docs/16 E09: dry_at = R 0.70). */
export const DRY_BELOW = 0.7;

export function thirstOf(plant: Pick<Plant, 'thirsty' | 'health'>): Thirst {
  if (!plant.thirsty) return 'fresh';
  return plant.health < DRY_BELOW ? 'dry' : 'thirsty';
}

const SPECIES = ['tulip', 'cotton', 'pomegranate', 'mint', 'sunflower', 'rose'] as const;
type Species = (typeof SPECIES)[number];

export interface PlantPalette {
  leaf: string;
  leaf2: string;
  dry: string;
  stem: string;
  soil: string;
  soilLight: string;
  bark: string;
  pot: string;
  rim: string;
  water: string;
  shine: string;
  petals: Readonly<Record<Species, string>>;
  centre: string;
  deep: string;
  outline: string;
  vine: string;
  bug: string;
  bugInk: string;
  tag: string;
  tagLine: string;
  tagInk: string;
}

/** Token colours only (theme.c); blends are computed from them, never written out. */
export function plantPalette(theme: Theme): PlantPalette {
  const c = theme.c;
  return {
    leaf: c.green,
    leaf2: c['green-lip'],
    dry: c['yellow-lip'],
    stem: c['green-lip'],
    soil: c['orange-lip'],
    soilLight: mix(c['orange-lip'], c.white, 0.3),
    bark: mix(c['orange-lip'], c.navy, 0.35),
    pot: c.orange,
    rim: c.yellow,
    water: c.lagoon,
    shine: c.white,
    petals: { tulip: c.red, cotton: c.white, pomegranate: c.red, mint: c.purple, sunflower: c.yellow, rose: c.pink },
    centre: c['orange-lip'],
    deep: mix(c.pink, c.navy, 0.3),
    outline: c['line-2'],
    vine: c.purple,
    bug: c.red,
    bugInk: c.navy,
    tag: c.surface,
    tagLine: c['line-2'],
    tagInk: c['ink-3'],
  };
}

/** Procedural variety, seeded by the lexeme id: species, leaf count ±1, height ±8 %, leaf hue. */
export function varietyOf(key: string) {
  const h = hash(key);
  return {
    species: SPECIES[h % SPECIES.length] as Species,
    leafDelta: ((h >>> 3) % 3) - 1,
    height: 1 + (((h >>> 5) % 17) - 8) / 100,
    hue: ((h >>> 9) % 100) / 100,
    lean: (h >>> 12) & 1 ? 1 : -1,
  };
}

const n2 = (v: number) => Math.round(v * 100) / 100;

/** A leaf from (x, y) pointing at `angle` degrees (0 = right, -90 = up). */
function leafPath(x: number, y: number, angle: number, len: number, width: number): string {
  const r = (angle * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const P = (lx: number, ly: number) => `${n2(x + lx * c - ly * s)} ${n2(y + lx * s + ly * c)}`;
  return `M${P(0, 0)} Q${P(len * 0.45, -width)} ${P(len, 0)} Q${P(len * 0.45, width)} ${P(0, 0)} Z`;
}

const BASE_X = 22;
const BASE_Y = 47;

function Soil({ p }: { p: PlantPalette }) {
  return (
    <G>
      <Ellipse cx={BASE_X} cy={49.5} rx={13} ry={4.6} fill={p.soil} />
      <Ellipse cx={19} cy={48.4} rx={5} ry={1.3} fill={p.soilLight} opacity={0.55} />
    </G>
  );
}

function Pot({ p }: { p: PlantPalette }) {
  return (
    <G>
      <Ellipse cx={BASE_X} cy={52.6} rx={9} ry={1.6} fill={p.soil} opacity={0.5} />
      <Path d="M15 41 L29 41 L27.4 52 L16.6 52 Z" fill={p.pot} />
      <Rect x={13.5} y={38.4} width={17} height={3.8} rx={1.4} fill={p.rim} />
    </G>
  );
}

function Flower({ species, cx, cy, p, petal }: { species: Species; cx: number; cy: number; p: PlantPalette; petal: string }) {
  switch (species) {
    case 'tulip':
      return <Path d={`M${cx - 6} ${cy - 4} Q${cx - 6} ${cy + 5} ${cx} ${cy + 5} Q${cx + 6} ${cy + 5} ${cx + 6} ${cy - 4} L${cx + 3} ${cy - 1} L${cx} ${cy - 5} L${cx - 3} ${cy - 1} Z`} fill={petal} />;
    case 'sunflower':
      return (
        <G>
          {Array.from({ length: 10 }, (_, k) => (
            <Ellipse key={k} cx={cx + 5} cy={cy} rx={2.8} ry={1.5} fill={petal} transform={`rotate(${k * 36} ${cx} ${cy})`} />
          ))}
          <Circle cx={cx} cy={cy} r={3.4} fill={p.centre} />
        </G>
      );
    case 'rose':
      return (
        <G>
          <Circle cx={cx} cy={cy} r={5.6} fill={petal} />
          <Path d={`M${cx} ${cy} m-1 0 a1.6 1.6 0 1 1 2 1.4 a3 3 0 1 1 -4.2 -3`} stroke={p.deep} strokeWidth={1} fill="none" strokeLinecap="round" />
        </G>
      );
    case 'cotton':
      return (
        <G>
          <Path d={`M${cx - 4} ${cy + 3} L${cx} ${cy + 6} L${cx + 4} ${cy + 3}`} stroke={p.bark} strokeWidth={1.2} fill="none" strokeLinecap="round" />
          {[
            [cx - 3, cy + 0.5],
            [cx + 3, cy + 0.5],
            [cx, cy - 2.6],
          ].map(([x, y]) => (
            <Circle key={`${x}-${y}`} cx={x} cy={y} r={3.3} fill={petal} stroke={p.outline} strokeWidth={0.8} />
          ))}
        </G>
      );
    case 'pomegranate':
      return (
        <G>
          <Circle cx={cx} cy={cy + 1} r={5.2} fill={petal} />
          <Path d={`M${cx - 2} ${cy - 3.6} L${cx - 1.2} ${cy - 6} L${cx} ${cy - 4.2} L${cx + 1.2} ${cy - 6} L${cx + 2} ${cy - 3.6} Z`} fill={petal} />
          <Circle cx={cx - 1.8} cy={cy - 0.6} r={1.2} fill={p.shine} opacity={0.35} />
        </G>
      );
    case 'mint':
      return (
        <G>
          {[
            [cx - 3.2, cy + 1],
            [cx, cy - 2],
            [cx + 3.2, cy + 1],
          ].map(([x, y]) => (
            <Ellipse key={`${x}-${y}`} cx={x} cy={y} rx={1.6} ry={3.2} fill={petal} />
          ))}
        </G>
      );
  }
}

interface ArtProps {
  stage: PlantStage;
  thirst?: Thirst;
  /** The lexeme id: the same word always grows the same plant. */
  seedKey: string;
  palette: PlantPalette;
  /** Width in px; height follows the 44 × 56 cell. */
  size?: number;
  /** 'plant' draws only what grows (for the watering animation, which bends it itself). */
  layer?: 'all' | 'ground' | 'plant';
  /** The water-drop badge on a thirsty plant (off in small icons). */
  badge?: boolean;
}

function Growth({ stage, thirst, seedKey, p }: { stage: PlantStage; thirst: Thirst; seedKey: string; p: PlantPalette }) {
  const v = varietyOf(seedKey);
  const tint = DRY_TINT[thirst];
  const leaf = mix(mix(p.leaf, p.leaf2, v.hue * 0.6), p.dry, tint);
  const stem = mix(p.stem, p.dry, tint * 0.8);
  const petal = mix(p.petals[v.species], p.dry, tint * 0.35);
  const hs = v.height;

  const stemTo = (top: number, width = 1.8) => (
    <Path d={`M${BASE_X} ${BASE_Y} Q${n2(BASE_X + v.lean * 1.5)} ${n2((BASE_Y + top) / 2)} ${BASE_X} ${n2(top)}`} stroke={stem} strokeWidth={width} fill="none" strokeLinecap="round" />
  );
  const leaves = (top: number, count: number) =>
    Array.from({ length: count }, (_, i) => {
      const t = 0.22 + (0.56 * i) / Math.max(1, count - 1);
      const y = BASE_Y - (BASE_Y - top) * t;
      const side = (i + (v.lean > 0 ? 0 : 1)) % 2 === 0 ? -1 : 1;
      const angle = side < 0 ? -150 + i * 7 : -30 - i * 7;
      return <Path key={i} d={leafPath(BASE_X, y, angle, 9.5 - i * 0.8, 3.4)} fill={leaf} />;
    });

  switch (stage) {
    case 'seed':
      return (
        <G>
          <Ellipse cx={BASE_X} cy={46} rx={3.2} ry={2.2} fill={p.bark} />
          <Path d="M22 45 Q21 41 23 38" stroke={stem} strokeWidth={1.2} fill="none" strokeLinecap="round" />
          <Path d={leafPath(23, 38.2, -55, 4.5, 1.6)} fill={leaf} />
        </G>
      );
    case 'sprout': {
      const top = BASE_Y - 12 * hs;
      return (
        <G>
          {stemTo(top)}
          <Path d={leafPath(BASE_X, top + 2, -152, 9.5, 3.8)} fill={leaf} />
          <Path d={leafPath(BASE_X, top + 1, -28, 9.5, 3.8)} fill={leaf} />
        </G>
      );
    }
    case 'bush': {
      const top = BASE_Y - 24 * hs;
      return (
        <G>
          {stemTo(top)}
          {leaves(top, 4 + v.leafDelta)}
          <Path d={leafPath(BASE_X, top + 1.6, -122, 3.6, 1.4)} fill={leaf} />
          <Path d={leafPath(BASE_X, top + 1.6, -58, 3.6, 1.4)} fill={leaf} />
          <Ellipse cx={BASE_X} cy={top - 1.4} rx={2.4} ry={3.4} fill={petal} />
        </G>
      );
    }
    case 'bloom': {
      const top = BASE_Y - 28 * hs;
      return (
        <G>
          {stemTo(top, 2)}
          {leaves(top + 4, 4 + v.leafDelta)}
          <Flower species={v.species} cx={BASE_X} cy={top - 2} p={p} petal={petal} />
        </G>
      );
    }
    case 'tree': {
      const top = BASE_Y - 30 * hs;
      return (
        <G>
          <Path d={`M${BASE_X} 39 L${BASE_X} ${n2(top + 8)}`} stroke={p.bark} strokeWidth={2.6} strokeLinecap="round" />
          <Path d={`M${BASE_X} ${n2(top + 12)} L18 ${n2(top + 7)} M${BASE_X} ${n2(top + 10)} L26.5 ${n2(top + 6)}`} stroke={p.bark} strokeWidth={1.6} strokeLinecap="round" />
          <Circle cx={16.5} cy={top + 6} r={6.5} fill={leaf} />
          <Circle cx={27.5} cy={top + 6} r={6.5} fill={leaf} />
          <Circle cx={BASE_X} cy={top + 1} r={7.5} fill={leaf} />
          <Circle cx={24.5} cy={top + 7} r={4} fill={p.leaf2} opacity={0.45} />
          {[
            [17, top + 5],
            [26, top + 3],
            [21, top + 8],
            [28.5, top + 8.5],
          ].map(([x, y]) => (
            <Circle key={`${x}`} cx={x} cy={y} r={1.4} fill={v.species === 'cotton' ? p.outline : petal} />
          ))}
        </G>
      );
    }
    case 'leech': {
      // A friendly ladybug on a vine-wrapped sprout: this word needs a different approach — it
      // is not sick, and nothing here is alarming.
      const top = BASE_Y - 17 * hs;
      return (
        <G>
          {stemTo(top)}
          <Path d={leafPath(BASE_X, top + 3, -150, 9, 3.6)} fill={leaf} />
          <Path d={leafPath(BASE_X, top + 2, -25, 10, 3.8)} fill={leaf} />
          <Path d={`M22 46 C27 43 17 40 22 37 C27 34 17 31 22 ${n2(top)}`} stroke={p.vine} strokeWidth={1.4} fill="none" strokeLinecap="round" />
          <Path d={leafPath(24.6, 42.6, -15, 3.4, 1.3)} fill={p.vine} />
          <Path d={leafPath(19.4, 34.2, -165, 3.4, 1.3)} fill={p.vine} />
          <Circle cx={29} cy={top - 0.6} r={2.4} fill={p.bug} />
          <Path d={`M29 ${n2(top - 3)} L29 ${n2(top + 1.8)}`} stroke={p.bugInk} strokeWidth={0.6} />
          <Circle cx={29} cy={top - 3.1} r={0.95} fill={p.bugInk} />
          <Circle cx={28.1} cy={top - 0.9} r={0.5} fill={p.bugInk} />
          <Circle cx={29.9} cy={top + 0.2} r={0.5} fill={p.bugInk} />
        </G>
      );
    }
    case 'paused':
      return (
        <G>
          <Ellipse cx={BASE_X} cy={46} rx={3.2} ry={2.2} fill={p.bark} />
          <Path d="M31 47 L31 37" stroke={p.bark} strokeWidth={1.2} strokeLinecap="round" />
          <Rect x={26.5} y={28.5} width={9} height={8.5} rx={1.6} fill={p.tag} stroke={p.tagLine} strokeWidth={1} />
          <Rect x={29.2} y={30.5} width={1.4} height={4.5} rx={0.5} fill={p.tagInk} />
          <Rect x={31.6} y={30.5} width={1.4} height={4.5} rx={0.5} fill={p.tagInk} />
        </G>
      );
  }
}

function DropBadge({ p }: { p: PlantPalette }) {
  return (
    <G>
      <Path d="M37 2.5 C37 2.5 32.5 8 32.5 10.6 A4.5 4.5 0 0 0 41.5 10.6 C41.5 8 37 2.5 37 2.5 Z" fill={p.water} />
      <Ellipse cx={35.4} cy={10} rx={0.9} ry={1.4} fill={p.shine} opacity={0.75} />
    </G>
  );
}

/** One plant. Decorative: the cell around it carries the word, stage and status as text. */
export const PlantArt = memo(function PlantArt({ stage, thirst = 'fresh', seedKey, palette, size = 44, layer = 'all', badge = true }: ArtProps) {
  const v = varietyOf(seedKey);
  const bend = layer === 'plant' ? 0 : BEND[thirst] * v.lean * (stage === 'tree' ? 0.5 : 1);
  const pivotY = stage === 'tree' ? 39 : BASE_Y;
  const ground = stage === 'tree' ? <Pot p={palette} /> : <Soil p={palette} />;
  return (
    <Svg width={size} height={(size * 56) / 44} viewBox="0 0 44 56">
      {layer !== 'plant' ? ground : null}
      {layer !== 'ground' ? (
        <G transform={bend ? `rotate(${n2(bend)} ${BASE_X} ${pivotY})` : undefined}>
          <Growth stage={stage} thirst={thirst} seedKey={seedKey} p={palette} />
        </G>
      ) : null}
      {layer === 'all' && badge && thirst !== 'fresh' ? <DropBadge p={palette} /> : null}
    </Svg>
  );
});
