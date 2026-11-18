// zod/mini: the same schemas written as functions, a fraction of the web bundle (DECISIONS §28)
import * as z from 'zod/mini';

/**
 * The single definition of the content shapes (brief §3: "Zod schemas … one definition of the
 * item shapes, used by renderer, grader and store"). Every shape here was checked against all
 * 37,173 items of the packed bundle; tests/sweep parses every one of them.
 *
 * Two layers:
 *   * `Packed*` — the short-key JSON the app ships (`t`, `p`, `a`, `c`, `fb`, `tg`, `say`);
 *   * the envelope (`Item`, `Unit`) — docs/11 field names, what every screen and the grader use.
 *     content/adapter.ts converts the first into the second.
 */

// ---------------------------------------------------------------- enums
export const TYPE_IDS = [
  // Family 1 — Choice
  'mcq_word_from_definition',
  'pragmatics_choose',
  'minimal_pair_discrimination',
  'grammaticality_judgement',
  'gap_fill_bank',
  'stress_tap',
  'phoneme_id',
  'odd_one_out',
  'read_scan_detail',
  'read_gist_mcq',
  'listen_gist_mcq',
  'listen_detail_gap',
  // Family 2 — Text
  'type_from_l1',
  'dictation_word',
  'error_correct',
  'dictation_sentence',
  'spelling_bee',
  'gap_fill_free',
  'write_sentence',
  // Family 3 — Bank
  'word_bank_build',
  'sentence_reorder',
  // Family 4 — Order
  'listen_order_events',
  // Family 5 — Pairs
  'tap_pairs',
  'memory_match',
  'word_race',
  // Family 6 — Bins
  'sort_bins',
  // Family 7 — Speak
  'repeat_after',
  'speak_prompt',
  'read_aloud',
  'speak_roleplay',
  'speak_retell',
] as const;
export type TypeId = (typeof TYPE_IDS)[number];

export const NORMALISE_RULES = ['contraction', 'case', 'punct', 'spacing', 'spelling_variant', 'typo1'] as const;
export type NormaliseRule = (typeof NORMALISE_RULES)[number];

export const NODE_KINDS = ['lesson', 'story', 'speak', 'immersion', 'review', 'clinic', 'checkpoint'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const CEFR = ['A1.1', 'A1.2', 'A2.1', 'A2.2', 'B1.1', 'B1.2', 'B2.1', 'B2.2', 'C1', 'C2'] as const;
export type CefrLevel = (typeof CEFR)[number];

// ---------------------------------------------------------------- shared parts
const str = z.string();
const strList = z.array(z.string());
const normalise = z._default(z.array(z.enum(NORMALISE_RULES)), []);
const count = z.int().check(z.nonnegative());

export const constraintsSchema = z._default(
  z.object({
    plays_allowed: z.optional(z.int().check(z.positive())),
    max_seconds: z.optional(z.number().check(z.positive())),
    hints_allowed: z.optional(count),
  }),
  {},
);
export type Constraints = z.infer<typeof constraintsSchema>;

export const feedbackSchema = z._default(
  z.object({
    correct: z.optional(str),
    incorrect_default: z.optional(str),
    explain_ref: z.optional(str),
  }),
  {},
);
export type ItemFeedback = z.infer<typeof feedbackSchema>;

export const targetsSchema = z._default(
  z.object({
    lexis: z.optional(strList),
    grammar: z.optional(strList),
    phonology: z.optional(strList),
    functions: z.optional(strList),
  }),
  {},
);
export type Targets = z.infer<typeof targetsSchema>;

const indexAnswer = z.object({ index: count });
const textAnswer = z.object({ key: strList, accepted: z.optional(strList), normalise });
const rejected = z.object({ pattern: str, feedback: str, error_code: str });
const noAudio = z.optional(z.null());
const mapping = z.object({ mapping: z.record(str, str) });
const spoken = z.object({ key: strList });

const pair = z.tuple([str, str]);

// ---------------------------------------------------------------- per-type prompt/answer
// One entry per type_id. `prompt` and `answer` use the build's own keys.
const shapes = {
  mcq_word_from_definition: { prompt: z.object({ text_uz: str, options: strList }), answer: indexAnswer },
  pragmatics_choose: { prompt: z.object({ text: str, options: strList }), answer: indexAnswer },
  minimal_pair_discrimination: { prompt: z.object({ audio: str, options: strList }), answer: indexAnswer },
  grammaticality_judgement: { prompt: z.object({ text: str, options: strList }), answer: indexAnswer },
  gap_fill_bank: { prompt: z.object({ text: str, bank: strList }), answer: textAnswer },
  stress_tap: { prompt: z.object({ text: str, audio: str, syllables: strList }), answer: indexAnswer },
  phoneme_id: {
    prompt: z.object({ text: str, options: strList, option_audio: strList }),
    answer: indexAnswer,
  },
  odd_one_out: { prompt: z.object({ options: strList }), answer: indexAnswer },
  read_scan_detail: { prompt: z.object({ text: str, options: strList, audio: noAudio }), answer: indexAnswer },
  read_gist_mcq: { prompt: z.object({ text: str, options: strList, audio: noAudio }), answer: indexAnswer },
  listen_gist_mcq: { prompt: z.object({ text: str, options: strList, audio: str }), answer: indexAnswer },
  listen_detail_gap: { prompt: z.object({ text: str, options: strList, audio: str }), answer: indexAnswer },

  type_from_l1: { prompt: z.object({ text_uz: str, audio: noAudio }), answer: textAnswer },
  dictation_word: { prompt: z.object({ audio: str }), answer: textAnswer },
  error_correct: {
    prompt: z.object({ text: str }),
    answer: z.extend(textAnswer, { rejected_with_feedback: z._default(z.array(rejected), []) }),
  },
  dictation_sentence: { prompt: z.object({ audio: str }), answer: textAnswer },
  spelling_bee: { prompt: z.object({ audio: str }), answer: textAnswer },
  gap_fill_free: { prompt: z.object({ text: str }), answer: textAnswer },
  write_sentence: { prompt: z.object({ text: str }), answer: textAnswer },

  word_bank_build: { prompt: z.object({ text_uz: str, bank: strList, audio: noAudio }), answer: textAnswer },
  sentence_reorder: { prompt: z.object({ bank: strList }), answer: textAnswer },

  listen_order_events: { prompt: z.object({ audio: str, options: strList }), answer: spoken },

  tap_pairs: { prompt: z.object({ pairs: z.array(pair) }), answer: mapping },
  memory_match: { prompt: z.object({ pairs: z.array(pair) }), answer: mapping },
  word_race: { prompt: z.object({ pairs: z.array(pair) }), answer: mapping },

  sort_bins: { prompt: z.object({ options: strList, bins: strList }), answer: mapping },

  repeat_after: { prompt: z.object({ text: str, audio: str }), answer: spoken },
  speak_prompt: { prompt: z.object({ text: str }), answer: spoken },
  read_aloud: { prompt: z.object({ text: str }), answer: spoken },
  speak_roleplay: { prompt: z.object({ text: str }), answer: spoken },
  speak_retell: { prompt: z.object({ text: str }), answer: spoken },
} as const satisfies Record<TypeId, { prompt: z.ZodMiniType; answer: z.ZodMiniType }>;

const tier = z.union([z.literal(1), z.literal(2), z.literal(3)]);

const common = {
  id: str,
  node: str,
  unit: str,
  tier,
  instruction_key: str,
  targets: targetsSchema,
  constraints: constraintsSchema,
  feedback: feedbackSchema,
  /** The text a missing audio asset should speak (resolved by the packer; brief §7.4). */
  say: z.nullable(str),
};

function itemVariant<T extends TypeId>(type: T) {
  return z.object({
    ...common,
    type_id: z.literal(type),
    prompt: shapes[type].prompt as (typeof shapes)[T]['prompt'],
    answer: shapes[type].answer as (typeof shapes)[T]['answer'],
  });
}

export const itemSchema = z.discriminatedUnion('type_id', [
  itemVariant('mcq_word_from_definition'),
  itemVariant('pragmatics_choose'),
  itemVariant('minimal_pair_discrimination'),
  itemVariant('grammaticality_judgement'),
  itemVariant('gap_fill_bank'),
  itemVariant('stress_tap'),
  itemVariant('phoneme_id'),
  itemVariant('odd_one_out'),
  itemVariant('read_scan_detail'),
  itemVariant('read_gist_mcq'),
  itemVariant('listen_gist_mcq'),
  itemVariant('listen_detail_gap'),
  itemVariant('type_from_l1'),
  itemVariant('dictation_word'),
  itemVariant('error_correct'),
  itemVariant('dictation_sentence'),
  itemVariant('spelling_bee'),
  itemVariant('gap_fill_free'),
  itemVariant('write_sentence'),
  itemVariant('word_bank_build'),
  itemVariant('sentence_reorder'),
  itemVariant('listen_order_events'),
  itemVariant('tap_pairs'),
  itemVariant('memory_match'),
  itemVariant('word_race'),
  itemVariant('sort_bins'),
  itemVariant('repeat_after'),
  itemVariant('speak_prompt'),
  itemVariant('read_aloud'),
  itemVariant('speak_roleplay'),
  itemVariant('speak_retell'),
]);

export type Item = z.infer<typeof itemSchema>;
export type ItemOf<T extends TypeId> = Extract<Item, { type_id: T }>;

// ---------------------------------------------------------------- packed (shipped) shapes
const loose = z.record(str, z.unknown());

export const packedItemSchema = z.object({
  id: str,
  t: z.enum(TYPE_IDS),
  tier,
  p: loose,
  a: loose,
  c: z.optional(loose),
  fb: z.optional(loose),
  tg: z.optional(loose),
  say: z.optional(str),
});
export type PackedItem = z.infer<typeof packedItemSchema>;

export const lexemeSchema = z.object({
  id: str,
  w: str,
  pos: str,
  ipa: str,
  uz: str,
  ru: str,
  ex: strList,
});
export type PackedLexeme = z.infer<typeof lexemeSchema>;

/** English, Uzbek where written, and any other language the content adds. */
const localised = z.catchall(z.object({ en: str, uz: z.optional(str) }), str);

export const grammarPointSchema = z.object({
  id: str,
  label: str,
  form: str,
  meaning: str,
  explanation: localised,
  positive_example: str,
  negative_example: str,
  l1_notes: z._default(z.record(str, str), {}),
});
export type GrammarPoint = z.infer<typeof grammarPointSchema>;

export const phonologyPointSchema = z.object({ id: str, label: str });
export type PhonologyPoint = z.infer<typeof phonologyPointSchema>;

export const functionSchema = z.object({
  id: str,
  label: str,
  exponents: z.array(z.object({ text: str, formality: z.optional(str), notes: z.optional(str) })),
});
export type FunctionPoint = z.infer<typeof functionSchema>;

export const storyLineSchema = z.object({ speaker: str, text: str, chunk_note: z.optional(str) });
export const storySchema = z.object({ id: str, title: str, body: z.array(storyLineSchema) });
export type Story = z.infer<typeof storySchema>;
export type StoryLine = z.infer<typeof storyLineSchema>;

const minutes = z.object({ t1: z.number(), t2: z.number(), t3: z.number() });
const tierKey = z.enum(['1', '2', '3']);

export const packedUnitSchema = z.object({
  id: str,
  n: z.int(),
  cefr: z.enum(CEFR),
  title: localised,
  can_do: strList,
  minutes,
  lex: z.array(lexemeSchema),
  nodes: z.array(
    z.object({
      id: str,
      focus: str,
      title: str,
      tiers: z.partialRecord(tierKey, z.array(packedItemSchema)),
    }),
  ),
  grammar: z.array(grammarPointSchema),
  phonology: z.array(phonologyPointSchema),
  functions: z.array(functionSchema),
  story: storySchema,
});
export type PackedUnit = z.infer<typeof packedUnitSchema>;

export const courseIndexSchema = z.object({
  sections: z.array(
    z.object({
      id: str,
      cefr: z.enum(CEFR),
      units: z.array(
        z.object({
          id: str,
          n: z.int(),
          cells: z.int(),
          title: str,
          title_uz: z.optional(str),
          lex: z.int(),
          gram: z.int(),
          items: z.int(),
          min: z.number(),
        }),
      ),
    }),
  ),
  /** 31 instruction keys → [English, Uzbek]. */
  instr: z.record(str, z.tuple([str, str])),
  totals: z.object({ units: z.number(), items: z.number(), lexemes: z.number(), stories: z.number() }),
});
export type CourseIndex = z.infer<typeof courseIndexSchema>;

export const courseOutlineSchema = z.object({
  units: z.array(
    z.object({
      id: str,
      n: z.int(),
      cefr: z.enum(CEFR),
      title: localised,
      can_do: strList,
      minutes,
      story: z.nullable(z.object({ id: str, title: str })),
      nodes: z.array(
        z.object({
          id: str,
          focus: str,
          title: str,
          tiers: z.partialRecord(tierKey, z.int()),
        }),
      ),
    }),
  ),
});
export type CourseOutline = z.infer<typeof courseOutlineSchema>;
