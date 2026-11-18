/**
 * docs/09 §5 rule 4: accept **both** US and UK spellings, always (and docs/00 §2.1: never mark
 * the other variant wrong). The learner's `spelling_variant` setting chooses only which form the
 * app shows and the accent of the synthetic voice (DECISIONS F13, revised).
 *
 * The packed bundle drops the build's per-lexeme `spelling.{us,uk}` pairs (DECISIONS F12), so
 * the grader carries them itself:
 *
 *   ORTHOGRAPHIC — the same word spelt two ways. Accepted anywhere in an answer. Curated by hand;
 *   no spelling rule is applied to arbitrary words (a rule such as -or → -our would turn
 *   *doctor* into *doctour*). Homographs whose other spelling is a different word in some sense
 *   (check/cheque, tire/tyre, curb/kerb, draft/draught) are left out on purpose.
 *
 *   LEXICAL — different words the A1 build nevertheless records as a US/UK "spelling" pair
 *   (apartment/flat …). Content defect C16: sent to the content owner. Accepted only when the
 *   item targets that lexeme, and only as a whole word or phrase (DECISIONS F13).
 */

type Pair = readonly [us: string, uk: string];

const FAMILY_IZE = [
  'organiz', 'realiz', 'recogniz', 'apologiz', 'criticiz', 'emphasiz', 'summariz', 'memoriz',
  'prioritiz', 'specializ', 'standardiz', 'minimiz', 'maximiz', 'moderniz', 'characteriz',
  'categoriz', 'finaliz', 'stabiliz', 'authoriz', 'utiliz', 'visualiz', 'symboliz', 'legaliz',
  'generaliz', 'hospitaliz', 'mobiliz', 'neutraliz', 'normaliz', 'optimiz', 'privatiz',
  'publiciz', 'socializ', 'sympathiz', 'customiz', 'familiariz', 'jeopardiz', 'idealiz',
  'industrializ', 'globaliz', 'civiliz', 'coloniz', 'centraliz', 'decentraliz', 'fertiliz',
  'harmoniz', 'improviz', 'localiz', 'marginaliz', 'monetiz', 'motoriz', 'patroniz',
  'penaliz', 'polariz', 'rationaliz', 'revolutioniz', 'scrutiniz', 'subsidiz', 'terroriz',
  'theoriz', 'trivializ', 'urbaniz', 'vaporiz', 'agoniz', 'antagoniz', 'capitaliz',
  'commercializ', 'compartmentaliz', 'demoraliz', 'dramatiz', 'energiz', 'equaliz',
  'hypothesiz', 'immobiliz', 'institutionaliz', 'internaliz', 'legitimiz', 'metaboliz',
  'naturaliz', 'personaliz', 'radicaliz', 'sanitiz', 'sensitiz', 'stigmatiz',
];

function izeFamily(stem: string): Pair[] {
  if (!stem.endsWith('iz')) return [];
  const uk = `${stem.slice(0, -1)}s`; // organiz -> organis
  return [
    [`${stem}e`, `${uk}e`],
    [`${stem}es`, `${uk}es`],
    [`${stem}ed`, `${uk}ed`],
    [`${stem}ing`, `${uk}ing`],
    [`${stem}er`, `${uk}er`],
    [`${stem}ers`, `${uk}ers`],
    [`${stem}ation`, `${uk}ation`],
    [`${stem}ations`, `${uk}ations`],
    [`${stem}ational`, `${uk}ational`],
  ];
}

const YSE = ['analy', 'paraly', 'cataly'];
function yseFamily(stem: string): Pair[] {
  return ['e', 'es', 'ed', 'ing', 'er', 'ers'].map((s) => [`${stem}z${s}`, `${stem}s${s}`] as Pair);
}

const LL = [
  'travel', 'cancel', 'label', 'model', 'fuel', 'level', 'signal', 'total', 'marvel', 'quarrel',
  'channel', 'dial', 'duel', 'equal', 'funnel', 'jewel', 'kidnap', 'libel', 'panel', 'pedal',
  'rival', 'shovel', 'snorkel', 'tunnel', 'worship', 'counsel',
];
function llFamily(base: string): Pair[] {
  // kidnap/worship double the p in UK English; the rest double the l.
  const last = base.slice(-1);
  const doubled = `${base}${last}`;
  return [
    [`${base}ed`, `${doubled}ed`],
    [`${base}ing`, `${doubled}ing`],
    [`${base}er`, `${doubled}er`],
    [`${base}ers`, `${doubled}ers`],
    [`${base}or`, `${doubled}or`],
    [`${base}ors`, `${doubled}ors`],
  ];
}

const OUR = [
  'color', 'favor', 'honor', 'humor', 'labor', 'flavor', 'harbor', 'rumor', 'vapor', 'endeavor',
  'armor', 'odor', 'vigor', 'parlor', 'tumor', 'neighbor', 'behavior', 'savor', 'glamor',
  'splendor', 'rancor', 'valor', 'clamor', 'candor', 'demeanor', 'fervor',
];
function ourFamily(base: string): Pair[] {
  const uk = `${base.slice(0, -2)}our`;
  return [
    [base, uk],
    [`${base}s`, `${uk}s`],
    [`${base}ed`, `${uk}ed`],
    [`${base}ing`, `${uk}ing`],
    [`${base}ful`, `${uk}ful`],
    [`${base}less`, `${uk}less`],
    [`${base}able`, `${uk}able`],
    [`${base}ite`, `${uk}ite`],
    [`${base}ites`, `${uk}ites`],
    [`${base}hood`, `${uk}hood`],
    [`${base}hoods`, `${uk}hoods`],
    [`${base}al`, `${uk}al`],
  ];
}

const RE = ['center', 'theater', 'meter', 'kilometer', 'centimeter', 'millimeter', 'liter', 'fiber', 'caliber', 'somber', 'saber', 'specter', 'meager', 'luster', 'reconnoiter'];
function reFamily(base: string): Pair[] {
  const uk = `${base.slice(0, -2)}re`;
  return [
    [base, uk],
    [`${base}s`, `${uk}s`],
    [`${base}ed`, `${uk}d`],
  ];
}

const SINGLE: Pair[] = [
  ['gray', 'grey'], ['grays', 'greys'], ['grayish', 'greyish'],
  ['program', 'programme'], ['programs', 'programmes'],
  ['catalog', 'catalogue'], ['catalogs', 'catalogues'], ['dialog', 'dialogue'], ['dialogs', 'dialogues'],
  ['analog', 'analogue'], ['monolog', 'monologue'], ['prolog', 'prologue'], ['epilog', 'epilogue'],
  ['defense', 'defence'], ['defenses', 'defences'], ['offense', 'offence'], ['offenses', 'offences'],
  ['license', 'licence'], ['licenses', 'licences'], ['pretense', 'pretence'],
  ['practice', 'practise'], ['practiced', 'practised'], ['practices', 'practises'], ['practicing', 'practising'],
  ['jewelry', 'jewellery'], ['counselor', 'counsellor'], ['counselors', 'counsellors'],
  ['aluminum', 'aluminium'], ['pajamas', 'pyjamas'], ['plow', 'plough'], ['mold', 'mould'],
  ['moldy', 'mouldy'], ['smolder', 'smoulder'], ['molt', 'moult'],
  ['enroll', 'enrol'], ['enrollment', 'enrolment'], ['enrolls', 'enrols'],
  ['fulfill', 'fulfil'], ['fulfillment', 'fulfilment'], ['fulfills', 'fulfils'],
  ['skillful', 'skilful'], ['skillfully', 'skilfully'], ['willful', 'wilful'],
  ['instill', 'instil'], ['distill', 'distil'], ['installment', 'instalment'],
  ['anemia', 'anaemia'], ['anemic', 'anaemic'], ['encyclopedia', 'encyclopaedia'],
  ['pediatric', 'paediatric'], ['pediatrician', 'paediatrician'], ['maneuver', 'manoeuvre'],
  ['maneuvers', 'manoeuvres'], ['esthetic', 'aesthetic'], ['archeology', 'archaeology'],
  ['archeologist', 'archaeologist'], ['ax', 'axe'], ['mustache', 'moustache'],
  ['mustaches', 'moustaches'], ['omelet', 'omelette'], ['omelets', 'omelettes'],
  ['cozy', 'cosy'], ['judgment', 'judgement'], ['judgments', 'judgements'],
  ['acknowledgment', 'acknowledgement'], ['aging', 'ageing'], ['artifact', 'artefact'],
  ['artifacts', 'artefacts'], ['sulfur', 'sulphur'], ['yogurt', 'yoghurt'], ['donut', 'doughnut'],
  ['donuts', 'doughnuts'], ['skeptic', 'sceptic'], ['skeptics', 'sceptics'],
  ['skeptical', 'sceptical'], ['skepticism', 'scepticism'], ['woolen', 'woollen'],
  ['percent', 'per cent'], ['airplane', 'aeroplane'], ['airplanes', 'aeroplanes'],
];

function buildOrthographic(): ReadonlyMap<string, string> {
  const pairs: Pair[] = [];
  for (const s of FAMILY_IZE) pairs.push(...izeFamily(s));
  for (const s of YSE) pairs.push(...yseFamily(s));
  for (const b of LL) pairs.push(...llFamily(b));
  for (const b of OUR) pairs.push(...ourFamily(b));
  for (const b of RE) pairs.push(...reFamily(b));
  pairs.push(...SINGLE);
  // canonical = the US form; both spellings map to it.
  const canon = new Map<string, string>();
  for (const [us, uk] of pairs) {
    if (!us || !uk || us === uk) continue;
    canon.set(us, us);
    canon.set(uk, us);
  }
  return canon;
}

/** Word → canonical (US) spelling, for words that have a US/UK orthographic pair. */
export const ORTHOGRAPHIC_CANON: ReadonlyMap<string, string> = buildOrthographic();

/**
 * The A1 build's lexical "spelling" pairs (build/lexemes.json, spelling.us / spelling.uk),
 * keyed by the packed lemma. Content defect C16.
 */
export const LEXICAL_PAIRS: readonly { lemma: string; us: string; uk: string }[] = [
  { lemma: 'flat', us: 'apartment', uk: 'flat' },
  { lemma: 'shop assistant', us: 'sales assistant', uk: 'shop assistant' },
  { lemma: 'shop', us: 'store', uk: 'shop' },
  { lemma: 'autumn', us: 'fall', uk: 'autumn' },
  { lemma: 'film', us: 'movie', uk: 'film' },
  { lemma: 'holiday', us: 'vacation', uk: 'holiday' },
  { lemma: 'bill', us: 'check', uk: 'bill' },
  { lemma: 'trousers', us: 'pants', uk: 'trousers' },
  { lemma: 'cinema', us: 'movie theater', uk: 'cinema' },
  { lemma: 'pharmacy', us: 'pharmacy', uk: "chemist's" },
  { lemma: 'clever', us: 'smart', uk: 'clever' },
  { lemma: 'metro', us: 'subway', uk: 'metro' },
  { lemma: 'ill', us: 'sick', uk: 'ill' },
];

/** Canonicalises every orthographic US/UK variant in an already case-folded, tokenised string. */
export function canonicalSpelling(text: string): string {
  return text
    .split(' ')
    .map((token) => {
      const m = token.match(/^([^a-z]*)([a-z][a-z'-]*[a-z]|[a-z])([^a-z]*)$/);
      if (!m) return token;
      const [, lead = '', core = '', trail = ''] = m;
      const c = ORTHOGRAPHIC_CANON.get(core);
      return c ? `${lead}${c}${trail}` : token;
    })
    .join(' ');
}

/**
 * Alternatives of a key produced by the lexical pairs of the lexemes an item targets: whole
 * words or phrases only, on word boundaries ("check" never becomes "bill" inside "checked").
 */
export function lexicalAlternatives(key: string, targetLemmas: readonly string[]): string[] {
  const out: string[] = [];
  for (const lemma of targetLemmas) {
    const pair = LEXICAL_PAIRS.find((p) => p.lemma === lemma.toLowerCase());
    if (!pair) continue;
    for (const [from, to] of [
      [pair.uk, pair.us],
      [pair.us, pair.uk],
    ] as const) {
      if (from === to) continue;
      const re = new RegExp(`(^|[^A-Za-z'])(${escapeRe(from)})(?=$|[^A-Za-z'])`, 'gi');
      if (re.test(key)) out.push(key.replace(re, (_m, pre: string) => `${pre}${to}`));
    }
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
