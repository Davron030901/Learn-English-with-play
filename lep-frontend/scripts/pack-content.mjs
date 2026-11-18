#!/usr/bin/env node
// Packs the course content into data assets the app ships with (DECISIONS F26 / "Content
// source"). Nothing here edits the content: files are copied byte for byte, and the only
// derived files are indexes computed from them.
//
//   source   LEP_CONTENT_SRC, default ../Claude outputs/new-in-tashkent/data
//            (the packed prototype bundle: index.json + u001.json … u168.json)
//   output   assets/content/index.lep, u001.lep … u168.lep   verbatim copies
//            assets/content/course.lep   per-unit node outline for the path screen
//            assets/content/words.lep    the course's own English word list (typo1 rule 7)
//            assets/content/lexicon.lep  every lexeme once, with the unit that teaches it (tap-gloss)
//            src/content/assets.generated.ts   static require() map for Metro
//            src/content/version.generated.ts  content hash sent with every answer
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, process.env.LEP_CONTENT_SRC ?? '../Claude outputs/new-in-tashkent/data');
// Everything is written to a staging folder and swapped in only after every check passed, so a
// failed run never leaves the app with half a course (audit, 2026-10-03).
const finalOut = join(root, 'assets/content');
const out = join(root, 'assets/.content-staging');

if (!existsSync(join(src, 'index.json'))) {
  console.error(`content: no index.json in ${src}. Set LEP_CONTENT_SRC to the packed data folder.`);
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const index = JSON.parse(readFileSync(join(src, 'index.json'), 'utf8'));
const unitFiles = readdirSync(src).filter((f) => /^u\d{3}\.json$/.test(f)).sort();

const hash = createHash('sha256');
const fail = (msg) => {
  console.error(`content: ${msg}`);
  process.exit(1);
};

// ---------------------------------------------------------------- checks against the brief's
// asserted figures (brief §2.1). The packer refuses to ship content that does not match.
const indexUnits = index.sections.flatMap((s) => s.units.map((u) => ({ ...u, section: s.id, cefr: s.cefr })));
if (indexUnits.length !== 168) fail(`index lists ${indexUnits.length} units, expected 168`);
if (unitFiles.length !== 168) fail(`found ${unitFiles.length} unit files, expected 168`);

const words = new Set();
const addWords = (text) => {
  if (typeof text !== 'string') return;
  for (const m of text.toLowerCase().matchAll(/[a-z]+(?:['’][a-z]+)?/g)) {
    words.add(m[0].replace('’', "'"));
  }
};

const course = [];
const lexicon = [];
const glossLanguages = new Set();
let nodes = 0;
let items = 0;
let populatedTiers = 0;
const itemIds = new Set();
const unitIdToFile = {};
const instrKeys = new Set(Object.keys(index.instr));

for (const file of unitFiles) {
  const buf = readFileSync(join(src, file));
  hash.update(file).update(buf);
  const unit = JSON.parse(buf.toString('utf8'));
  const n = Number(file.slice(1, 4));
  if (unit.n !== n) fail(`${file}: n=${unit.n}`);
  unitIdToFile[unit.id] = file.replace('.json', '');
  copyFileSync(join(src, file), join(out, file.replace('.json', '.lep')));
  if (unit.nodes.length !== 8) fail(`${unit.id}: ${unit.nodes.length} nodes`);

  const outline = {
    id: unit.id,
    n: unit.n,
    cefr: unit.cefr,
    title: unit.title,
    can_do: unit.can_do,
    minutes: unit.minutes,
    story: unit.story ? { id: unit.story.id, title: unit.story.title } : null,
    nodes: unit.nodes.map((node) => {
      const tiers = {};
      for (const [tier, list] of Object.entries(node.tiers)) {
        if (list.length > 0) {
          tiers[tier] = list.length;
          populatedTiers += 1;
        }
        for (const item of list) {
          if (itemIds.has(item.id)) fail(`duplicate item id ${item.id}`);
          itemIds.add(item.id);
          items += 1;
          // Only strings that are correct English feed the real-word list: keys and accepted
          // answers, never prompts (error_correct and grammaticality_judgement prompts are
          // wrong on purpose) and never feedback (often Uzbek).
          for (const k of item.a?.key ?? []) addWords(k);
          for (const k of item.a?.accepted ?? []) addWords(k);
        }
      }
      return { id: node.id, focus: node.focus, title: node.title, tiers };
    }),
  };
  nodes += unit.nodes.length;
  course.push(outline);

  for (const lex of unit.lex) {
    for (const k of Object.keys(lex)) if (!['id', 'w', 'pos', 'ipa', 'ex'].includes(k)) glossLanguages.add(k);
    lexicon.push({ id: lex.id, w: lex.w, pos: lex.pos, ipa: lex.ipa, uz: lex.uz, ru: lex.ru, ex: lex.ex.slice(0, 1), u: unit.id });
    addWords(lex.w);
    for (const ex of lex.ex ?? []) addWords(ex);
  }
  for (const line of unit.story?.body ?? []) addWords(line.text);
  for (const f of unit.functions ?? []) for (const e of f.exponents ?? []) addWords(e.text);
  for (const g of unit.grammar ?? []) addWords(g.positive_example);
  for (const c of unit.can_do ?? []) addWords(c);
}

if (nodes !== 1344) fail(`${nodes} nodes, expected 1,344`);
if (items !== 37173) fail(`${items} items, expected 37,173`);
if (populatedTiers !== 3019) fail(`${populatedTiers} populated node-tiers, expected 3,019`);
if (instrKeys.size !== 31) fail(`${instrKeys.size} instruction keys, expected 31`);

hash.update('index.json').update(readFileSync(join(src, 'index.json')));
copyFileSync(join(src, 'index.json'), join(out, 'index.lep'));
writeFileSync(join(out, 'course.lep'), JSON.stringify({ units: course }));
if (lexicon.length !== 5948) fail(`${lexicon.length} lexemes, expected 5,948`);
writeFileSync(join(out, 'lexicon.lep'), JSON.stringify(lexicon));
const wordList = [...words].filter((w) => w.length > 1 || w === 'a' || w === 'i').sort();
writeFileSync(join(out, 'words.lep'), JSON.stringify(wordList));

const version = `sha256:${hash.digest('hex').slice(0, 16)}`;

rmSync(finalOut, { recursive: true, force: true });
renameSync(out, finalOut);

// ---------------------------------------------------------------- generated modules
const banner = '// GENERATED by scripts/pack-content.mjs. Do not edit by hand.\n\n';
const unitLines = Object.entries(unitIdToFile)
  .map(([id, file]) => `    ${id}: require('../../assets/content/${file}.lep'),`)
  .join('\n');
writeFileSync(
  join(root, 'src/content/assets.generated.ts'),
  banner +
    '/* eslint-disable @typescript-eslint/no-require-imports */\n' +
    '/** Metro asset modules for the content files (see metro.config.js: `.lep` is an asset). */\n' +
    'export const contentAssets = {\n' +
    "  index: require('../../assets/content/index.lep'),\n" +
    "  course: require('../../assets/content/course.lep'),\n" +
    "  words: require('../../assets/content/words.lep'),\n" +
    "  lexicon: require('../../assets/content/lexicon.lep'),\n" +
    '  units: {\n' +
    unitLines +
    '\n  },\n} as const;\n',
);
writeFileSync(
  join(root, 'src/content/version.generated.ts'),
  banner +
    '/** Hash of the packed content this build ships. Sent with every answer (brief §11). */\n' +
    `export const contentVersion = ${JSON.stringify(version)};\n\n` +
    `/** Languages the lexicon carries glosses in — the L1s the course can serve today. */\n` +
    `export const glossLanguages = ${JSON.stringify([...glossLanguages].sort())} as const;\n\n` +
    `/** Unit id -> asset file stem, in course order. */\n` +
    `export const unitFiles = ${JSON.stringify(unitIdToFile, null, 2)} as const;\n`,
);

console.log(
  `content: ${indexUnits.length} units · ${nodes} nodes · ${populatedTiers} populated node-tiers · ` +
    `${items} items · ${lexicon.length} lexemes · ${wordList.length} words · ${version}`,
);
