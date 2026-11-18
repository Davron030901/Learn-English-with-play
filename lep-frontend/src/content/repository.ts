import { log } from '@/lib/log';

import { adaptOutline, adaptUnit, bandOf, sectionIdOf } from './adapter';
import type { Course, Lexeme, Section, Unit, UnitOutline } from './model';
import { courseIndexSchema, courseOutlineSchema } from './schemas';

/**
 * Where content comes from. Today: the data assets packed into the app
 * (content/source.app.ts), or files on disk in tests (tests/support/fsSource.ts). Tomorrow:
 * `GET /v1/course`, `GET /v1/units/{id}` and the offline bundle — the repository does not care.
 */
export interface ContentSource {
  read(name: 'index' | 'course' | 'words' | 'lexicon'): Promise<unknown>;
  readUnit(unitId: string): Promise<unknown>;
}

export interface LexiconEntry {
  id: string;
  lemma: string;
  pos: string;
  ipa: string;
  gloss: Readonly<Record<string, string>>;
  example: string | null;
  unitId: string;
}

export interface StartupChecks {
  units: number;
  nodes: number;
  populatedTiers: number;
  items: number;
  instructionKeys: number;
  /** Brief §17.1: items whose `cefr` disagrees with their unit. The packed bundle drops the
   *  field entirely, so this counts items that carry it at all. */
  itemsCarryingCefr: number;
  ok: boolean;
}

const UNIT_CACHE_SIZE = 12;

export class ContentRepository {
  private readonly source: ContentSource;
  private course: Promise<Course> | null = null;
  private words: Promise<ReadonlySet<string>> | null = null;
  private lexicon: Promise<LexiconIndex> | null = null;
  private readonly units = new Map<string, Promise<Unit>>();

  constructor(source: ContentSource) {
    this.source = source;
  }

  loadCourse(): Promise<Course> {
    this.course ??= this.buildCourse().catch((e: unknown) => {
      this.course = null;
      throw e;
    });
    return this.course;
  }

  private async buildCourse(): Promise<Course> {
    const [indexRaw, outlineRaw] = await Promise.all([this.source.read('index'), this.source.read('course')]);
    const index = courseIndexSchema.parse(indexRaw);
    const outline = courseOutlineSchema.parse(outlineRaw);
    const byId = new Map<string, UnitOutline>();
    for (const u of outline.units) byId.set(u.id, adaptOutline(u));
    const sections: Section[] = index.sections.map((s) => ({
      id: s.id,
      cefr: s.cefr,
      band: bandOf(s.cefr),
      units: s.units.map((u) => {
        const o = byId.get(u.id);
        if (!o) throw new Error(`course outline is missing ${u.id}`);
        return o;
      }),
    }));
    return { sections, unitsById: byId, instructions: index.instr, totals: index.totals };
  }

  loadUnit(unitId: string): Promise<Unit> {
    const hit = this.units.get(unitId);
    if (hit) {
      // Refresh recency.
      this.units.delete(unitId);
      this.units.set(unitId, hit);
      return hit;
    }
    const p = this.source
      .readUnit(unitId)
      .then((raw) => {
        const unit = adaptUnit(raw);
        if (unit.defects.length > 0) {
          log.info('content.unit_defects', {
            unit: unitId,
            counts: unit.defects.reduce<Record<string, number>>((acc, d) => {
              acc[d.code] = (acc[d.code] ?? 0) + 1;
              return acc;
            }, {}),
          });
        }
        return unit;
      })
      .catch((e: unknown) => {
        this.units.delete(unitId);
        throw e;
      });
    this.units.set(unitId, p);
    while (this.units.size > UNIT_CACHE_SIZE) {
      const oldest = this.units.keys().next().value;
      if (oldest === undefined) break;
      this.units.delete(oldest);
    }
    return p;
  }

  /** The course's own English word list — the "real word" test of docs/09 §5 rule 7. */
  loadWords(): Promise<ReadonlySet<string>> {
    this.words ??= this.source
      .read('words')
      .then((raw) => {
        if (!Array.isArray(raw)) throw new Error('words asset is not a list');
        return new Set(raw.filter((w): w is string => typeof w === 'string'));
      })
      .catch((e: unknown) => {
        // A failed load is forgotten, so Retry can succeed (on the web the asset is fetched).
        this.words = null;
        throw e;
      });
    return this.words;
  }

  loadLexicon(): Promise<LexiconIndex> {
    this.lexicon ??= this.source
      .read('lexicon')
      .then((raw) => new LexiconIndex(raw))
      .catch((e: unknown) => {
        this.lexicon = null;
        throw e;
      });
    return this.lexicon;
  }

  async startupChecks(): Promise<StartupChecks> {
    const course = await this.loadCourse();
    let nodes = 0;
    let populatedTiers = 0;
    let units = 0;
    for (const s of course.sections) {
      for (const u of s.units) {
        units += 1;
        nodes += u.nodes.length;
        for (const n of u.nodes) populatedTiers += n.populatedTiers.length;
      }
    }
    const checks: StartupChecks = {
      units,
      nodes,
      populatedTiers,
      items: course.totals.items,
      instructionKeys: Object.keys(course.instructions).length,
      itemsCarryingCefr: 0,
      ok: false,
    };
    // brief §2.1 (assert): 168 units, 1,344 nodes, 37,173 items; 3,019 populated node-tiers.
    checks.ok =
      units === 168 && nodes === 1344 && populatedTiers === 3019 && checks.items === 37173 && checks.instructionKeys === 31;
    log[checks.ok ? 'info' : 'error']('content.startup_checks', checks);
    return checks;
  }
}

/** Every lexeme once (5,948), for tap-gloss in stories and the reader. */
export class LexiconIndex {
  private readonly byLemma = new Map<string, LexiconEntry[]>();
  readonly size: number;

  constructor(raw: unknown) {
    if (!Array.isArray(raw)) throw new Error('lexicon asset is not a list');
    let n = 0;
    for (const r of raw as Record<string, unknown>[]) {
      if (typeof r.w !== 'string' || typeof r.id !== 'string') continue;
      const entry: LexiconEntry = {
        id: r.id,
        lemma: r.w,
        pos: String(r.pos ?? ''),
        ipa: String(r.ipa ?? ''),
        gloss: { uz: String(r.uz ?? ''), ru: String(r.ru ?? '') },
        example: Array.isArray(r.ex) && typeof r.ex[0] === 'string' ? r.ex[0] : null,
        unitId: String(r.u ?? ''),
      };
      const key = r.w.toLowerCase();
      const list = this.byLemma.get(key) ?? [];
      list.push(entry);
      this.byLemma.set(key, list);
      n += 1;
    }
    this.size = n;
  }

  /**
   * Finds the lexeme a word in running text belongs to. Exact match first, then a small set of
   * regular inflections (-s, -es, -ies, -ed, -d, -ing, 's). No match returns [] — the reader
   * then shows no gloss rather than a guessed one (brief §0 rule 9).
   */
  lookup(word: string): LexiconEntry[] {
    const w = word.toLowerCase().replace(/’/g, "'").replace(/^[^a-z']+|[^a-z']+$/g, '');
    if (!w) return [];
    const exact = this.byLemma.get(w);
    if (exact) return exact;
    // The shorter strip first, because an e-final stem keeps its e: "hates" is hate+s before
    // hat+es, "noted" note+d before not+ed, "caring" care+ing before car+ing. Stems that do not
    // end in e ("boxes", "wanted", "watching") only ever match the longer strip.
    const candidates: string[] = [];
    if (w.endsWith("'s")) candidates.push(w.slice(0, -2));
    if (w.endsWith('ies') && w.length > 4) candidates.push(`${w.slice(0, -3)}y`);
    if (w.endsWith('s') && w.length > 3) candidates.push(w.slice(0, -1));
    if (w.endsWith('es') && w.length > 4) candidates.push(w.slice(0, -2));
    if (w.endsWith('ed') && w.length > 4) candidates.push(w.slice(0, -1), w.slice(0, -2));
    if (w.endsWith('ing') && w.length > 5) candidates.push(`${w.slice(0, -3)}e`, w.slice(0, -3));
    for (const c of candidates) {
      const hit = this.byLemma.get(c);
      if (hit && c.length >= 3) return hit;
    }
    return [];
  }

  byUnitOrder(entries: LexiconEntry[]): LexiconEntry[] {
    return [...entries].sort((a, b) => a.unitId.localeCompare(b.unitId));
  }
}

export function unitSectionId(unitId: string): string {
  return sectionIdOf(unitId);
}

export type { Lexeme };
