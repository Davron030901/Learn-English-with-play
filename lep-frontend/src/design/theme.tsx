import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';

import { fontFamily, type FontRole, type UiFace } from './fonts';
import { colors, shadow, type ColorToken, type ThemeName } from './tokens.generated';

export type ThemePreference = 'system' | 'light' | 'dark';

/**
 * An app theme from the shop (docs/16 E17): it re-tints the primary role — buttons, links, the
 * selected state — with another hue of the palette. Only the primary role changes: semantic
 * colours (success, danger), CEFR level colours, skills and the focus ring never do, and every
 * hue's own on- and ink tokens come with it, so text on it keeps its tested contrast.
 */
export type ThemeAccent = 'default' | 'lagoon' | 'orange' | 'purple';
export const THEME_ACCENTS: readonly ThemeAccent[] = ['default', 'lagoon', 'orange', 'purple'];

const PRIMARY_ROLE = ['', '-lip', '-soft', '-ink'] as const;

function accented(c: Readonly<Record<ColorToken, string>>, accent: ThemeAccent): Readonly<Record<ColorToken, string>> {
  if (accent === 'default') return c;
  const out: Record<ColorToken, string> = { ...c };
  for (const suffix of PRIMARY_ROLE) out[`primary${suffix}` as ColorToken] = c[`${accent}${suffix}` as ColorToken];
  out['on-primary'] = c[`on-${accent}` as ColorToken];
  return out;
}

export interface Theme {
  name: ThemeName;
  accent: ThemeAccent;
  c: Readonly<Record<ColorToken, string>>;
  face: UiFace;
  font: (role: FontRole, weight: number) => string;
  reduceMotion: boolean;
  /** The design system's solid "lip" under pressable things (0 Npx 0 colour, no blur). */
  lip: (color: string, y: number) => string;
  /** Keyboard focus: a page-colour gap, then solid focus blue (token focus-ring). */
  focusRing: string;
  cardShadow: string;
  floatShadow: string;
}

type ShadowPart = { x: number; y: number; blur: number; spread: number; color: string };
const css = (parts: readonly ShadowPart[]) =>
  parts.map((p) => `${p.x}px ${p.y}px ${p.blur}px ${p.spread}px ${p.color}`).join(', ');

export function buildTheme(name: ThemeName, face: UiFace, reduceMotion: boolean, accent: ThemeAccent = 'default'): Theme {
  return {
    name,
    accent,
    c: accented(colors[name], accent),
    face,
    font: (role, weight) => fontFamily(role, weight, face),
    reduceMotion,
    lip: (color, y) => `0px ${y}px 0px 0px ${color}`,
    focusRing: css(shadow['focus-ring'][name]),
    cardShadow: css(shadow['shadow-card'][name]),
    floatShadow: css(shadow['shadow-float'][name]),
  };
}

const ThemeContext = createContext<Theme>(buildTheme('light', 'nunito', false));

export function ThemeProvider(props: {
  preference: ThemePreference;
  face: UiFace;
  reduceMotionPreference: boolean;
  /** The app theme the learner chose in the shop; the default blue when absent. */
  accent?: ThemeAccent;
  children: ReactNode;
}) {
  const system = useColorScheme();
  const [systemReduceMotion, setSystemReduceMotion] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setSystemReduceMotion(v))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setSystemReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  const name: ThemeName =
    props.preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : props.preference;
  const accent = props.accent ?? 'default';
  const theme = useMemo(
    () => buildTheme(name, props.face, props.reduceMotionPreference || systemReduceMotion, accent),
    [name, props.face, props.reduceMotionPreference, systemReduceMotion, accent],
  );
  return <ThemeContext.Provider value={theme}>{props.children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

// ---------------------------------------------------------------- tones
type Hue = 'blue' | 'green' | 'red' | 'orange' | 'yellow' | 'pink' | 'purple' | 'lagoon';
type Role = 'primary' | 'success' | 'danger' | 'streak' | 'xp' | 'gem';
const SKILLS: Record<string, Hue> = {
  read: 'blue',
  listen: 'lagoon',
  speak: 'purple',
  write: 'pink',
  mediate: 'orange',
};

export type Tone =
  | Hue
  | Role
  | 'level-a1'
  | 'level-a2'
  | 'level-b1'
  | 'level-b2'
  | 'level-c1'
  | 'level-c2'
  | 'skill-read'
  | 'skill-listen'
  | 'skill-speak'
  | 'skill-write'
  | 'skill-mediate';

export interface ToneColors {
  c: string;
  lip: string;
  soft: string;
  ink: string;
  on: string;
}

/** The design system's toneVars(): a tone name → its fill, lip, soft, ink and on-colour tokens. */
export function tone(theme: Theme, t: Tone): ToneColors {
  let prefix: string = t;
  if (t.startsWith('skill-')) prefix = SKILLS[t.slice(6)] ?? 'blue';
  const get = (name: string) => theme.c[name as ColorToken];
  return {
    c: get(prefix),
    lip: get(`${prefix}-lip`),
    soft: get(`${prefix}-soft`),
    ink: get(`${prefix}-ink`),
    on: get(`on-${prefix}`),
  };
}

/** CEFR colour is data (brief §13): A1 blue · A2 green · B1 orange · B2 pink · C1 purple · C2 yellow. */
export function levelTone(cefr: string): Tone {
  const m = cefr.toLowerCase().match(/[abc][12]/);
  const key = (m ? m[0] : 'a1') as 'a1' | 'a2' | 'b1' | 'b2' | 'c1' | 'c2';
  return `level-${key}`;
}
