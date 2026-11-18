import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The brief's non-negotiables (§0, §8.4) as tests over the source, the locales and — when it has
 * been built — the exported web bundle. These are the guardrails a later change must not erode;
 * each failure names the file and line.
 */

const ROOT = join(__dirname, '../..');
const SRC = join(ROOT, 'src');

function walk(dir: string, exts: readonly string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (exts.includes(extname(name))) out.push(p);
  }
  return out;
}

const read = (p: string) => readFileSync(p, 'utf8');
/** Source with comments removed, so a rule can be *explained* in a comment without tripping it. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const SOURCE_FILES = walk(SRC, ['.ts', '.tsx']).filter((f) => !f.endsWith('.generated.ts'));
const CONFIG_FILES = ['app.json', 'package.json', 'metro.config.js', 'eslint.config.js'].map((f) =>
  join(ROOT, f),
);

function hits(files: readonly string[], re: RegExp, text: (f: string) => string = code): string[] {
  const out: string[] = [];
  for (const f of files) {
    text(f)
      .split('\n')
      .forEach((line, i) => {
        if (re.test(line)) out.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
  }
  return out;
}

type Catalogue = Record<string, unknown>;
const flat = (o: Catalogue, p = ''): [string, string][] =>
  Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object'
      ? flat(v as Catalogue, p ? `${p}.${k}` : k)
      : [[p ? `${p}.${k}` : k, String(v)] as [string, string]],
  );
const LOCALES = Object.fromEntries(
  ['en', 'uz', 'ru'].map((l) => [
    l,
    new Map(flat(JSON.parse(read(join(SRC, 'i18n/locales', `${l}.json`))) as Catalogue)),
  ]),
) as Record<'en' | 'uz' | 'ru', Map<string, string>>;

// ---------------------------------------------------------------- §0: never hold a provider key
const KEY_PATTERNS: [string, RegExp][] = [
  ['OpenAI-style key', /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
];
const PROVIDER_HOSTS =
  /api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|texttospeech\.googleapis\.com|speech\.googleapis\.com|cognitiveservices\.azure\.com|api\.elevenlabs\.io|api\.deepgram\.com|api\.assemblyai\.com|polly\.[a-z0-9-]+\.amazonaws\.com|api\.cartesia\.ai|api\.play\.ht/i;

describe('§0 — no TTS, ASR or LLM provider key or endpoint in the app', () => {
  it('source and config hold no key-shaped secret', () => {
    for (const [name, re] of KEY_PATTERNS)
      expect(hits([...SOURCE_FILES, ...CONFIG_FILES], re, read), name).toEqual([]);
  });
  it('the scanner itself fires on a planted key (so a clean result means something)', () => {
    const planted = [
      'const k = "sk-proj-AbCdEfGhIjKlMnOpQrStUvWx1234";',
      'fetch("https://api.openai.com/v1/audio/speech")',
      'key=AIzaSyA1234567890abcdefghijklmnopqrstuv',
    ];
    expect(KEY_PATTERNS.some(([, re]) => re.test(planted[0] as string))).toBe(true);
    expect(PROVIDER_HOSTS.test(planted[1] as string)).toBe(true);
    expect(KEY_PATTERNS.some(([, re]) => re.test(planted[2] as string))).toBe(true);
  });
  it('no provider API host is called from the client', () => {
    expect(hits([...SOURCE_FILES, ...CONFIG_FILES], PROVIDER_HOSTS, read)).toEqual([]);
  });
  it('the only public env variables are the API and audio base URLs — never a key, secret or token', () => {
    const vars = new Set(
      SOURCE_FILES.flatMap((f) =>
        [...read(f).matchAll(/EXPO_PUBLIC_[A-Z0-9_]+/g)].map((m) => m[0]),
      ),
    );
    expect([...vars].sort()).toEqual(['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_AUDIO_BASE_URL']);
    for (const v of vars) expect(v).not.toMatch(/KEY|SECRET|TOKEN|PASSWORD/);
  });
  it('the exported web bundle (when built) contains no key or provider host', () => {
    const dist = join(ROOT, 'dist');
    if (!existsSync(dist)) return;
    const bundles = walk(dist, ['.js']);
    for (const b of bundles) {
      const text = read(b);
      for (const [name, re] of KEY_PATTERNS)
        expect(re.test(text), `${name} in ${relative(ROOT, b)}`).toBe(false);
      expect(PROVIDER_HOSTS.test(text), `provider host in ${relative(ROOT, b)}`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------- §4.1 token storage
describe('§4.1 — the refresh token lives only in the platform keystore (or memory on the web)', () => {
  it('no code touches localStorage, sessionStorage or IndexedDB', () => {
    expect(hits(SOURCE_FILES, /\b(localStorage|sessionStorage|indexedDB)\b/)).toEqual([]);
  });
  it('the native token store is expo-secure-store and the web one is memory', () => {
    expect(read(join(SRC, 'api/tokenStorage.native.ts'))).toMatch(/expo-secure-store/);
    const web = code(join(SRC, 'api/tokenStorage.ts'));
    expect(web).not.toMatch(/AsyncStorage|SecureStore/);
    expect(web).toMatch(/persistent: false/);
  });
  it('AsyncStorage is reached only through the device stores, never for a token', () => {
    const users = SOURCE_FILES.filter((f) => /@react-native-async-storage/.test(read(f)))
      .map((f) => relative(SRC, f).split(sep).join('/'))
      .sort();
    expect(users).toEqual(['state/prefs.ts', 'state/storage.ts']);
    expect(hits(SOURCE_FILES, /(writeJson|setItem)\([^)]*token/i)).toEqual([]);
  });
});

// ---------------------------------------------------------------- §4.1, §9 minors
describe('§4.1, §9 — age data', () => {
  it('is_minor is never persisted: it is read from the live /v1/me response only', () => {
    expect(hits(SOURCE_FILES, /(writeJson|setItem|update\(|persist).*is_?minor/i)).toEqual([]);
    const learner = code(join(SRC, 'state/learner.ts'));
    expect(learner).not.toMatch(/is_?minor|birth/i);
  });
  it('the birth year lives in a memory-only store and is never logged', () => {
    const onboarding = code(join(SRC, 'state/onboarding.ts'));
    expect(onboarding).not.toMatch(/persist|AsyncStorage|writeJson/);
    expect(hits(SOURCE_FILES, /log\.(debug|info|warn|error)\([^)]*birth/i)).toEqual([]);
  });
});

// ---------------------------------------------------------------- §8.4 guardrails
describe('§8.4 — gamification guardrails', () => {
  const en = [...LOCALES.en.entries()];
  it('no hearts, lives or energy: mistakes never cost the learner anything', () => {
    expect(en.filter(([, v]) => /\b(hearts?|energy|refill)\b/i.test(v))).toEqual([]);
    expect(hits(SOURCE_FILES, /\b(hearts|energy|livesLeft|refill)\b/i)).toEqual([]);
  });
  it('no guilt, loss-framing or fake urgency in any interface string', () => {
    const banned =
      /you'?ll lose|lose your|break your streak|don'?t break|we miss you|miss you|disappoint|ashamed|lazy|last chance|hurry|before it'?s too late|only \d+ left|sad (pip|owl)/i;
    for (const lng of ['en', 'uz', 'ru'] as const) {
      expect([...LOCALES[lng].entries()].filter(([, v]) => banned.test(v))).toEqual([]);
    }
  });
  it('the feedback sheet has no celebration, haptics or rewards', () => {
    const fb = [join(SRC, 'design/Exercise.tsx'), join(SRC, 'features/lesson/FeedbackPanel.tsx')];
    expect(hits(fb, /confetti|lottie|haptic|fireworks|celebrat|\bxp\b|\bgems?\b/i)).toEqual([]);
    // Haptics exist only behind the sfx layer (a device preference, off with noAudio), never in
    // the feedback sheet itself.
    expect(
      hits(
        SOURCE_FILES.filter((f) => !f.endsWith(join('audio', 'sfx.ts'))),
        /expo-haptics/,
      ),
    ).toEqual([]);
  });
  it('the client never opts a learner into leagues: only their own tap on Join does', () => {
    // docs/16 E23: off by default and never auto-enabled. One request may join, and it is sent
    // only from the join card's button, after the learner has read the explainer.
    const file = (h: string) => h.slice(0, h.indexOf(':'));
    expect(hits(SOURCE_FILES, /leagues_opt_in\s*[:=]\s*true/).map(file)).toEqual([
      join('src', 'api', 'queries', 'leagues.ts'),
    ]);
    expect(
      hits(SOURCE_FILES, /useJoinLeagues\(/)
        .map(file)
        .sort(),
    ).toEqual(
      [
        join('src', 'api', 'queries', 'leagues.ts'),
        join('src', 'features', 'leagues', 'LeagueScreen.tsx'),
      ].sort(),
    );
    const screen = code(join(SRC, 'features/leagues/LeagueScreen.tsx'));
    expect(screen.match(/join\.mutate\(/g)).toHaveLength(1);
    expect(screen).toMatch(/onPress=\{submit\}/);
  });
  it('honest numbers: no XP, streak, level or mastery is kept or computed on the device', () => {
    // What the device keeps about the learner is facts, field by field — no derived statistic.
    const learner = code(join(SRC, 'state/learner.ts'));
    const body = /export interface LearnerData \{([\s\S]*?)\n\}/.exec(learner)?.[1] ?? '';
    const fields = [...body.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]).sort();
    expect(fields).toEqual([
      'completed',
      'lastSessionId',
      'onboarding',
      'profile',
      'savedWords',
      'startSection',
    ]);
    // Progress shows the server's figures (GET /v1/progress, /v1/gamification/summary) and, when
    // they cannot be had, "Not available yet" — never a number made here in their place.
    const progress = code(join(SRC, 'app/(tabs)/progress.tsx'));
    expect(progress).toMatch(/from '@\/api\/queries\/gamification'/);
    expect(progress).toMatch(/<PendingStat/);
    expect(progress).not.toMatch(
      /Math\.(round|floor|ceil)|\.reduce\(|xp_today\s*\+|\bcompleted\.(size|length)\b/,
    );
  });
  it('the data exit is three taps from Me: Me → Privacy and data → Export / Delete', () => {
    expect(read(join(SRC, 'app/(tabs)/profile.tsx'))).toMatch(/page: 'privacy'/);
    const privacy = read(join(SRC, 'features/settings/SettingsPages.tsx'));
    expect(privacy).toMatch(/testID="export-data"/);
    expect(privacy).toMatch(/testID="delete-device"/);
  });
  it('reminders: quiet hours and the hard cap are fixed in code', () => {
    const r = read(join(SRC, 'notifications/reminders.ts'));
    expect(r).toMatch(/QUIET_FROM_HOUR = 21/);
    expect(r).toMatch(/QUIET_TO_HOUR = 8/);
    expect(r).toMatch(/HARD_CAP_PER_DAY = 3/);
  });
});

// ---------------------------------------------------------------- §4.2, §5, §17 contracts
describe('client contracts', () => {
  it('errors are chosen by type: no code reads a problem title or detail', () => {
    expect(hits(SOURCE_FILES, /\b(problem|err|error|e|body|obj|p)\??\.(title|detail)\b/)).toEqual(
      [],
    );
  });
  it('the item cefr is never read: the level comes from the unit (brief §17.1)', () => {
    expect(hits(SOURCE_FILES, /\b(item|it|step\.item)\.cefr\b/)).toEqual([]);
  });
  it('recordings are never uploaded', () => {
    expect(hits(SOURCE_FILES, /FormData|createUploadTask|uploadAsync|multipart/)).toEqual([]);
  });
  it('nothing logs through console except the redacting logger', () => {
    expect(
      hits(
        SOURCE_FILES.filter((f) => !f.endsWith('lib/log.ts')),
        /\bconsole\.(log|warn|error|info|debug)\(/,
      ),
    ).toEqual([]);
  });
  it('no raw HTML injection', () => {
    expect(hits(SOURCE_FILES, /dangerouslySetInnerHTML|\beval\(|new Function\(/)).toEqual([]);
  });
});

// ---------------------------------------------------------------- i18n completeness
describe('interface strings', () => {
  const used = new Set<string>();
  for (const f of SOURCE_FILES) {
    for (const m of read(f).matchAll(/\bt\(\s*['"]([a-zA-Z0-9_./-]+)['"]/g))
      if (m[1]) used.add(m[1]);
    for (const m of read(f).matchAll(/label:\s*['"]((?:me|tabs)\.[a-zA-Z0-9_.]+)['"]/g))
      if (m[1]) used.add(m[1]);
  }

  it.each(['en', 'uz', 'ru'] as const)('every key the code uses exists in %s', (lng) => {
    expect([...used].filter((k) => !LOCALES[lng].has(k))).toEqual([]);
  });

  it.each(['uz', 'ru'] as const)('%s has every English key, with the same placeholders', (lng) => {
    const missing: string[] = [];
    const mismatched: string[] = [];
    const placeholders = (s: string) =>
      [...new Set([...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]))].sort().join(',');
    for (const [k, v] of LOCALES.en) {
      const other = LOCALES[lng].get(k);
      if (other === undefined) missing.push(k);
      else if (placeholders(v) !== placeholders(other))
        mismatched.push(`${k}: {${placeholders(v)}} vs {${placeholders(other)}}`);
    }
    expect(missing).toEqual([]);
    expect(mismatched).toEqual([]);
  });

  it('dynamic key families are complete in English', () => {
    for (const p of [
      'warmup',
      'review',
      'new_input',
      'guided',
      'integration',
      'production',
      'close',
    ])
      expect(LOCALES.en.has(`lesson.phase.${p}`)).toBe(true);
    for (const k of ['lesson', 'story', 'speak', 'immersion', 'review', 'clinic', 'checkpoint'])
      expect(LOCALES.en.has(`path.nodeKind.${k}`)).toBe(true);
    for (const c of [
      'ART',
      'TNS',
      'PREP',
      'WO',
      'L1',
      'SV',
      'WF',
      'WW',
      'SP',
      'PL',
      'AUX',
      'NEG',
      'Q',
      'COLL',
      'REG',
    ])
      expect(LOCALES.en.has(`feedback.code.${c}`)).toBe(true);
    for (const c of ['afterBreakfast', 'commute', 'lunch', 'work', 'dinner'])
      expect(LOCALES.en.has(`onboarding.plan.${c}`)).toBe(true);
  });
});
