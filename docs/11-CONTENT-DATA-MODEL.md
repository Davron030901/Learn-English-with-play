# 11 — CONTENT DATA MODEL & PRODUCTION PIPELINE
## Schemas, identifiers, storage, validation and QA gates

---

## 1. Identifier conventions

All IDs are **immutable once published** (doc 00 §9).

| Entity | Pattern | Example |
|--------|---------|---------|
| Course | `course.{lang_pair}.{version}` | `course.en.v1` |
| Section | `S{nn}` | `S06` |
| Unit | `S{nn}U{nn}` | `S05U12` |
| Node | `S{nn}U{nn}N{n}` | `S05U12N2` |
| Lesson play (tier) | `S{nn}U{nn}N{n}T{t}` | `S05U12N2T1` |
| Grammar point | `G-{nnn}` | `G-107` |
| Lexeme | `lex.{nnnnn}` | `lex.03421` |
| Collocation | `lex.col.{nnnn}` | `lex.col.0881` |
| Phrasal verb | `lex.pv.{nnnn}` | `lex.pv.0043` |
| Idiom / chunk | `lex.idm.{nnnn}` / `lex.chk.{nnnn}` | |
| Phonology point | `P-{nnn}` | `P-014` |
| Function | `F-{nnn}` | `F-023` |
| Notion | `N-{nnn}` | |
| Exercise item | `item.{nnnnnnn}` | `item.0184223` |
| Memory item | `{syllabus_id}.{aspect}` | `lex.03421.recall` |
| Text (reading/listening) | `txt.{nnnnn}` / `aud.{nnnnn}` | |
| Media asset | `{type}/{hash}.{ext}` | `a/9f3c…opus` |
| Rubric | `rub.{name}.{level}` | `rub.writing.b2` |

---

## 2. Core schemas

### 2.1 Course / Section / Unit / Node

```json
{
  "id": "S05U12",
  "type": "unit",
  "section": "S05",
  "cefr": "B1.1",
  "title": { "en": "Getting it done", "uz": "Ishni bajartirish" },
  "theme": "work_and_services",
  "can_do": [
    "Can explain a problem with a service and ask for it to be fixed.",
    "Can talk about arranging for other people to do things for me."
  ],
  "syllabus": {
    "grammar": ["G-173", "G-174"],
    "lexis": ["lex.03421", "lex.03422", "..."],
    "phonology": ["P-041"],
    "functions": ["F-088", "F-091"],
    "collocations": ["lex.col.0881", "..."]
  },
  "prerequisites": ["S05U11"],
  "nodes": [
    { "id": "S05U12N1", "kind": "lesson",    "focus": "lexis" },
    { "id": "S05U12N2", "kind": "lesson",    "focus": "grammar" },
    { "id": "S05U12N3", "kind": "lesson",    "focus": "mixed" },
    { "id": "S05U12N4", "kind": "story",     "text_ref": "txt.02210" },
    { "id": "S05U12N5", "kind": "lesson",    "focus": "mixed" },
    { "id": "S05U12N6", "kind": "speak",     "task_ref": "task.00913" },
    { "id": "S05U12N7", "kind": "immersion", "feed": "podcast_b1" },
    { "id": "S05U12N8", "kind": "review",    "source": "srs" }
  ],
  "estimated_minutes": { "t1": 26, "t2": 22, "t3": 18 },
  "syllabus_version": "1.0",
  "status": "published"
}
```

### 2.2 Exercise item

```json
{
  "id": "item.0184223",
  "type_id": "verb_form_gap",
  "targets": { "grammar": ["G-173"], "lexis": ["lex.03421"], "phonology": [] },
  "cefr": "B1.1",
  "difficulty": { "irt_b": 0.42, "irt_a": 0.88, "p_correct_obs": 0.79, "n_obs": 14203 },
  "prompt": {
    "text": "I ___ (have / my car / repair) last week.",
    "audio": null,
    "image": null,
    "instruction_key": "instr.verb_form_gap"
  },
  "answer": {
    "key": ["had my car repaired"],
    "accepted": ["had my car repaired", "got my car repaired"],
    "rejected_with_feedback": [
      { "pattern": "had repaired my car",
        "feedback_key": "fb.causative_word_order" },
      { "pattern": "had my car repair",
        "feedback_key": "fb.causative_participle" }
    ],
    "normalise": ["case", "punct", "spacing", "spelling_variant"]
  },
  "feedback": {
    "correct": "Right — the thing done goes before the past participle.",
    "incorrect_default": "Use *have* + object + past participle: *have something done*.",
    "explain_ref": "G-173"
  },
  "media": { "audio_ga": "a/1f22….opus", "audio_sbe": "a/9c01….opus" },
  "constraints": { "max_seconds": 20, "hints_allowed": 1 },
  "authoring": { "author": "cw-014", "reviewed_by": "cw-002",
                 "corpus_checked": true, "created": "2026-03-11" },
  "status": "published",
  "syllabus_version": "1.0"
}
```

### 2.3 Text (reading or listening source)

```json
{
  "id": "txt.02210",
  "kind": "story",
  "cefr": "B1.1",
  "title": "The landlord who never called back",
  "word_count": 486,
  "readability": { "fk_grade": 6.4, "mean_sentence_len": 14.2,
                   "type_token_ratio": 0.52, "mtld": 61 },
  "coverage": { "band_1000": 0.83, "band_2000": 0.10,
                "band_3000": 0.04, "beyond": 0.03 },
  "new_lexemes": ["lex.03421", "lex.03498"],
  "structures_used": ["G-173", "G-152", "G-190"],
  "body": "…",
  "audio": { "ga": { "file": "a/…opus", "wpm": 148, "voice": "v_ga_f_02" },
             "sbe": { "file": "a/…opus", "wpm": 145, "voice": "v_sbe_m_01" },
             "slow": { "file": "a/…opus", "wpm": 110 } },
  "transcript_aligned": "align/txt02210.json",
  "decoded_transcript": "Whaddaya wanna do about it?  ← What do you want to do about it?",
  "questions": ["item.0184301", "item.0184302", "…"],
  "images": ["img/…webp"],
  "content_flags": { "sensitive_topics": [], "culture_specific": false },
  "status": "published"
}
```

### 2.4 Learner memory record (server-side)

```json
{
  "learner_id": "u_8812…",
  "memory_item_id": "lex.03421.recall",
  "state": "young",
  "fsrs": { "S": 12.4, "D": 5.81, "last_review": "2026-08-30T07:12:04Z",
            "due": "2026-09-11T07:12:04Z", "reps": 6, "lapses": 1,
            "params_version": "u_fitted_2026-08" },
  "history_ref": "reviewlog/u_8812/lex.03421.recall",
  "contexts_seen": 5,
  "productive_uses": 1,
  "leech": false
}
```

### 2.5 Review log entry (append-only, immutable — the source of truth)

```json
{ "learner_id": "u_8812…", "memory_item_id": "lex.03421.recall",
  "item_id": "item.0184223", "ts": "2026-09-08T06:41:22Z",
  "grade": 3, "rt_ms": 4210, "hints": 0, "answer_raw": "had my car repaired",
  "correct": true, "session_id": "s_991…", "offline": false,
  "client_version": "3.4.1", "scheduler_version": "fsrs6-2026.07" }
```

---

## 3. Storage and delivery

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Authoring source of truth | Git repo of JSON/YAML, one file per unit, reviewed by PR | Diffable, versioned, revertible; content is code |
| Build artefact | Signed, compressed content bundles per section, per L1 | Cache-friendly; a learner downloads only what they need |
| Delivery | CDN, immutable URLs keyed by content hash | Instant global reads, no cache invalidation problems |
| Client cache | SQLite; next 5 units + 7 days of SRS items | Offline (doc 00 §6) |
| Learner state | Row store, learner-partitioned; review log in an append-only store | Replayable, auditable |
| Media | Object storage; Opus 24 kbps mono for audio, WebP/AVIF for images | ≤ 60 kB per short audio item |
| Analytics | Event stream → warehouse; item-response data feeds the IRT refit | Weekly item calibration (doc 08 §6.2) |

**Bundle sizes (target):** one section ≈ 40–70 MB with audio, ≈ 6 MB without. The full course ≈ 550 MB with audio; the app ships with Section 1 embedded.

---

## 4. The content pipeline

```
 1. SYLLABUS PLAN        Curriculum lead assigns syllabus items to units (doc 13)
 2. CORPUS RESEARCH      Author pulls real examples from COCA/BNC/subtitle corpora
 3. DRAFT                Author writes texts, dialogues, items in the authoring tool
 4. AUTOMATED VALIDATION Schema + linguistic checks (§5). Fails block the PR
 5. LINGUISTIC REVIEW    A second qualified author reviews for naturalness & accuracy
 6. LEVEL REVIEW         CEFR specialist confirms level fit (EVP/EGP cross-check)
 7. L1 ADAPTATION        Gloss translation + L1 trap flags per supported language
 8. AUDIO                Voice recording (native speakers, directed), QC, normalisation,
                         forced alignment for word timings
 9. IMAGES               Sourcing/creation, licence check, alt-text, inclusion quota check
10. PILOT                Ship to 2% of learners; collect ≥ 300 responses per item
11. CALIBRATE            IRT fit; flag items with a<0.4, p>0.97, p<0.25, or high report rate
12. PUBLISH              Bundle build, sign, CDN
13. MONITOR              Weekly item health report; quarterly syllabus review
```

---

## 5. Automated validation gates (CI — a failure blocks merge)

| # | Check | Rule |
|---|-------|------|
| 1 | Schema | Validates against the JSON Schema for its type |
| 2 | ID integrity | All referenced IDs exist; no orphan items (doc 00 §4.1) |
| 3 | **Vocabulary gate** | Every lemma in the item is introduced at or before this unit, or is the ≤ 1 permitted new lemma and is glossed |
| 4 | **Grammar gate** | Every structure used is at or before this unit, or tagged `chunk: true` |
| 5 | Level fit | Mean word frequency band, sentence length and FK grade within the level's range (doc 06 §1.2) |
| 6 | Answer key sanity | ≥ 1 key; all keys pass the normaliser; no key is also a listed distractor |
| 7 | Distractor quality | Every MCQ distractor maps to a documented misconception; no duplicate distractors; length variance < 40% |
| 8 | Position bias | Across the bank, no answer position exceeds 30% frequency |
| 9 | Audio presence | Every L2 text string has an audio asset; duration plausible for word count |
| 10 | Audio quality | −16 LUFS ±1, no clipping, silence trimmed, ≥ 44.1 kHz source |
| 11 | Alignment | Forced alignment confidence ≥ 0.9 for every word |
| 12 | Corpus plausibility | Every sentence's n-grams found in the reference corpus, or flagged for human sign-off |
| 13 | Duplicate detection | No near-duplicate items (cosine > 0.95) within a section |
| 14 | Interference check | No two interfering items introduced in the same node (doc 08 §8) |
| 15 | Inclusion quota | Name/gender/region distribution within the style guide's bands per section |
| 16 | Safety | Content classifier for age-appropriateness and sensitive topics |
| 17 | Localisation completeness | Gloss present for every supported L1 |
| 18 | Accessibility | Alt-text for every image; no item that requires audio with no visual alternative and vice versa |
| 19 | Licence | Every media asset has a recorded licence and expiry |
| 20 | Timing | `estimated_minutes` within 20% of the sum of the item time model |

---

## 6. Authoring tool requirements

- Writes the JSON directly; authors never hand-edit raw files.
- **Live gates** — the vocabulary and grammar gates run as the author types, showing which words are not yet available. This is what makes a 168-unit syllabus authorable at all.
- Corpus lookup panel (concordance for any word/phrase) inline.
- One-click TTS preview before human recording.
- Diff and review workflow with per-item comments.
- Bulk operations: retag, relevel, regenerate distractors.
- Per-item preview in the actual client renderer.

---

## 7. Localisation model

- **L1-dependent content:** glosses, instructions, grammar explanations (A1–A2 only), false-friend flags, contrastive notes.
- **L1-independent content:** all English text, audio, images, item structure.
- Storage: `strings/{lang}/…json`, keyed; never inline in items.
- Supported at v1: Uzbek, Russian, Turkish, Kazakh, Spanish, Portuguese, Arabic, Hindi, Indonesian, Vietnamese, French, Chinese (Simplified).
- Right-to-left support required for Arabic UI.
- Glosses are **translated by humans and reviewed by a second human**; machine translation is a draft aid only. A wrong gloss teaches a wrong word to every learner who sees it.

---

## 8. Content volume (what has to be built)

| Asset | Count | Notes |
|-------|------:|------:|
| Sections | 10 | |
| Units | 168 | |
| Nodes | 1,344 | |
| Lesson plays (node × tier) | 4,032 | |
| Unique exercise items | ~48,000 | ~14 per lesson play with ~30% reuse across tiers |
| Lexeme records | 12,000 | + 3,500 collocations, 300 phrasal verbs, 800 idioms, 1,000 chunks |
| Grammar points | 412 | each with explanation, diagram, 6+ item types |
| Phonology points | 165 minimal-pair sets | ~3,300 pair items |
| Reading texts | 1,400 | across all levels |
| Listening items | 2,600 | |
| Stories (serialised) | 168 | one per unit, continuous narrative |
| Graded readers | 400 | licensed or original |
| Podcast episodes | 600 | |
| Assessment items | 6,000 | placement bank + checkpoints + level exams |
| Audio assets | ~180,000 | words, sentences, texts, at 2 accents + slow |
| Images | ~14,000 | |
| Rubrics | 60 | |
| L1 gloss sets | 12 × 17,600 | |

---

## 9. Versioning and migration

- `syllabus_version` on every content object and on every learner record.
- A learner keeps the syllabus version they started a *section* under, and migrates at section boundaries.
- Item edits that do not change the answer key are hot-patched. Edits that change the key create a **new item ID**; the old item is deprecated, and memory records pointing at it are remapped to the new item under the same memory-item ID.
- Scheduler upgrades are safe because state is re-derived from the immutable review log (doc 08 §10).

---

## 10. Privacy and data classification

| Data | Class | Retention | Notes |
|------|-------|-----------|-------|
| Review log | Learning | Life of account | Required for scheduling |
| Voice recordings | **Sensitive** | 30 days default, learner-controlled | Never used for training without separate opt-in |
| Writing samples | **Sensitive** | Learner-controlled | Same |
| Error log | Learning | Life of account | Exportable |
| Contact data | PII | Life of account | |
| Analytics events | Pseudonymous | 24 months | No raw text |
| Under-18 accounts | Restricted | | No social matching, no ad personalisation |

Learner-facing controls: export everything (JSON + media), delete everything, delete recordings only, pause data collection.
