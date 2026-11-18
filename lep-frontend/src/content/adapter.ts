import type { ContentDefect, Lexeme, Tier, Unit, UnitNode, UnitOutline } from './model';
import { notationKind } from './notation';
import {
  itemSchema,
  packedUnitSchema,
  type CefrLevel,
  type CourseOutline,
  type Item,
  type NodeKind,
  type PackedItem,
  type TypeId,
} from './schemas';

/**
 * Packed bundle → envelope. The packed prototype data drops fields the build carries (node
 * `kind`, `instruction_key`, `memory_items`, lexeme `spelling`/`definition_en`); this adapter
 * restores the ones that can be derived without inventing anything (DECISIONS F12):
 *   * node kind from its fixed position (N1–N3 and N5 lesson, N4 story, N6 speak,
 *     N7 immersion, N8 review — verified on all 168 units);
 *   * instruction_key from the type, with the build's two exceptions (brief §5.3).
 * `item.cefr` is never read (brief §17.1); the level always comes from the unit.
 */

export function nodeKindAt(position: number): NodeKind {
  switch (position) {
    case 4:
      return 'story';
    case 6:
      return 'speak';
    case 7:
      return 'immersion';
    case 8:
      return 'review';
    default:
      return 'lesson';
  }
}

export function instructionKeyFor(type: TypeId): string {
  if (type === 'mcq_word_from_definition') return 'instr.mcq_word';
  if (type === 'minimal_pair_discrimination') return 'instr.minimal_pair';
  return `instr.${type}`;
}

export function sectionIdOf(unitId: string): string {
  return unitId.slice(0, 3);
}

export function bandOf(cefr: CefrLevel): 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' {
  return cefr.slice(0, 2) as 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
}

const TIER_KEYS = ['1', '2', '3'] as const;

export function adaptItem(p: PackedItem, unitId: string, nodeId: string): Item {
  return itemSchema.parse({
    id: p.id,
    type_id: p.t,
    node: nodeId,
    unit: unitId,
    tier: p.tier,
    instruction_key: instructionKeyFor(p.t),
    targets: p.tg ?? {},
    constraints: p.c ?? {},
    feedback: p.fb ?? {},
    say: p.say ?? null,
    prompt: p.p,
    answer: p.a,
  });
}

/** stress_tap syllables should spell the word (content defect C2: 380 of 906 do not). */
export function stressSyllablesSpellWord(item: Item): boolean {
  if (item.type_id !== 'stress_tap') return true;
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  return squash(item.prompt.syllables.join('')) === squash(item.prompt.text);
}

export function adaptUnit(raw: unknown): Unit {
  const packed = packedUnitSchema.parse(raw);
  const defects: ContentDefect[] = [];

  const nodes: UnitNode[] = packed.nodes.map((n, i) => {
    const position = i + 1;
    const kind = nodeKindAt(position);
    const tiers: Partial<Record<Tier, Item[]>> = {};
    const populatedTiers: Tier[] = [];
    for (const key of TIER_KEYS) {
      const list = n.tiers[key];
      if (!list || list.length === 0) continue;
      const tier = Number(key) as Tier;
      const items: Item[] = [];
      for (const p of list) {
        try {
          const item = adaptItem(p, packed.id, n.id);
          if (!stressSyllablesSpellWord(item)) {
            defects.push({ code: 'stress_syllables', itemId: item.id, nodeId: n.id });
          }
          if (
            (item.type_id === 'mcq_word_from_definition' || item.type_id === 'gap_fill_bank') &&
            ('options' in item.prompt ? item.prompt.options : item.prompt.bank).length < 2
          ) {
            defects.push({ code: 'single_option', itemId: item.id, nodeId: n.id });
          }
          if (item.type_id === 'minimal_pair_discrimination' && item.say && notationKind(item.say)) {
            defects.push({ code: 'minimal_pair_notation', itemId: item.id, nodeId: n.id });
          }
          items.push(item);
        } catch (e) {
          defects.push({ code: 'item_shape', itemId: p.id, nodeId: n.id, detail: String(e).slice(0, 200) });
        }
      }
      if (items.length > 0) {
        tiers[tier] = items;
        populatedTiers.push(tier);
      }
    }
    const itemBearing = kind === 'lesson' || kind === 'story' || kind === 'speak';
    if (itemBearing && populatedTiers.length > 0 && populatedTiers.length < 3) {
      defects.push({ code: 'missing_tier', nodeId: n.id, detail: `tiers ${populatedTiers.join(',')}` });
    }
    return { id: n.id, position, kind, focus: n.focus, title: n.title, tiers, populatedTiers };
  });

  const lexemes: Lexeme[] = packed.lex.map((l) => ({
    id: l.id,
    lemma: l.w,
    pos: l.pos,
    ipa: l.ipa,
    gloss: { uz: l.uz, ru: l.ru },
    examples: l.ex,
    definitionEn: null,
  }));

  return {
    id: packed.id,
    sectionId: sectionIdOf(packed.id),
    index: packed.n,
    cefr: packed.cefr,
    title: packed.title,
    canDo: packed.can_do,
    minutes: packed.minutes,
    lexemes,
    nodes,
    grammar: packed.grammar,
    phonology: packed.phonology,
    functions: packed.functions,
    story: packed.story,
    defects,
  };
}

export function adaptOutline(outline: CourseOutline['units'][number]): UnitOutline {
  return {
    id: outline.id,
    sectionId: sectionIdOf(outline.id),
    index: outline.n,
    cefr: outline.cefr,
    title: outline.title,
    canDo: outline.can_do,
    minutes: outline.minutes,
    story: outline.story,
    nodes: outline.nodes.map((n, i) => {
      const itemCounts: Partial<Record<Tier, number>> = {};
      const populatedTiers: Tier[] = [];
      for (const key of TIER_KEYS) {
        const count = n.tiers[key];
        if (count && count > 0) {
          itemCounts[Number(key) as Tier] = count;
          populatedTiers.push(Number(key) as Tier);
        }
      }
      return {
        id: n.id,
        position: i + 1,
        kind: nodeKindAt(i + 1),
        focus: n.focus,
        title: n.title,
        itemCounts,
        populatedTiers,
      };
    }),
  };
}
