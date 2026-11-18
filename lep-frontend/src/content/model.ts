import type {
  CefrLevel,
  FunctionPoint,
  GrammarPoint,
  Item,
  NodeKind,
  PhonologyPoint,
  Story,
  TypeId,
} from './schemas';

export type Tier = 1 | 2 | 3;
export const TIERS: readonly Tier[] = [1, 2, 3];

export interface Lexeme {
  id: string;
  lemma: string;
  pos: string;
  ipa: string;
  /** L1 glosses by language tag (the bundle carries uz and ru). */
  gloss: Readonly<Record<string, string>>;
  examples: readonly string[];
  /** docs/00 §4.1 rule 7. Absent from the packed bundle; nullable everywhere (brief §17.4). */
  definitionEn: string | null;
}

export interface UnitNode {
  id: string;
  /** 1…8, the build's fixed order within the unit. */
  position: number;
  kind: NodeKind;
  focus: string;
  title: string;
  tiers: Partial<Record<Tier, Item[]>>;
  /** Tiers that carry items. Progress counts these, never `nodes × 3` (brief §2.1). */
  populatedTiers: Tier[];
}

export interface Unit {
  id: string;
  sectionId: string;
  index: number;
  cefr: CefrLevel;
  title: Readonly<Record<string, string>> & { en: string };
  canDo: readonly string[];
  minutes: { t1: number; t2: number; t3: number };
  lexemes: readonly Lexeme[];
  nodes: readonly UnitNode[];
  grammar: readonly GrammarPoint[];
  phonology: readonly PhonologyPoint[];
  functions: readonly FunctionPoint[];
  story: Story;
  /** Content defects found while loading this unit (brief §17 — absorbed and reported). */
  defects: readonly ContentDefect[];
}

export type ContentDefectCode =
  | 'item_shape' // an item failed its schema: excluded from sessions
  | 'stress_syllables' // C2: syllables do not spell the word
  | 'single_option' // C7
  | 'missing_tier' // C18
  | 'minimal_pair_notation'; // C3/F24: spoken text is notation; withheld until recorded

export interface ContentDefect {
  code: ContentDefectCode;
  itemId?: string;
  nodeId?: string;
  detail?: string;
}

export interface UnitOutline {
  id: string;
  sectionId: string;
  index: number;
  cefr: CefrLevel;
  title: Readonly<Record<string, string>> & { en: string };
  canDo: readonly string[];
  minutes: { t1: number; t2: number; t3: number };
  story: { id: string; title: string } | null;
  nodes: readonly {
    id: string;
    position: number;
    kind: NodeKind;
    focus: string;
    title: string;
    itemCounts: Partial<Record<Tier, number>>;
    populatedTiers: Tier[];
  }[];
}

export interface Section {
  id: string;
  cefr: CefrLevel;
  /** "A1" … "C2": the colour family (brief §13: A1 blue · A2 green · B1 orange · B2 pink · C1 purple · C2 yellow). */
  band: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  units: UnitOutline[];
}

export interface Course {
  sections: Section[];
  unitsById: ReadonlyMap<string, UnitOutline>;
  /** Instruction key → [English, Uzbek] (brief §5.3: resolved per interface language). */
  instructions: Readonly<Record<string, readonly [string, string]>>;
  totals: { units: number; items: number; lexemes: number; stories: number };
}

export type { Item, TypeId };
