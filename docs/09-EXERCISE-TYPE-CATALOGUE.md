# 09 — EXERCISE TYPE CATALOGUE
## All 71 exercise types: inputs, outputs, scoring, competence, level range

Each type has an immutable `type_id`. The content model (doc 11) generates concrete items by binding a type to syllabus item IDs and content.

**Columns:** *Level* = the level range the type is used in. *Competence* = what it actually trains. *Scoring* = how it is graded. *Grade* = which SRS grade it can emit (doc 08 §2.3).

---

## Group A — Vocabulary, receptive (6)

| # | type_id | What the learner sees / does | Level | Competence | Scoring |
|---|---------|------------------------------|-------|-----------|---------|
| 1 | `tap_pairs` | Grid of 6–8 tiles: L2 words and images/L1 glosses; tap matching pairs | A1–A2 | form–meaning recognition | All pairs correct = Good; any mismatch = Again on that item |
| 2 | `mcq_image` | Hear/see a word; choose 1 of 4 images | A1–B1 | form–meaning, concrete lexis | Exact; distractors must be same semantic field |
| 3 | `mcq_meaning_l2` | See the word in a sentence; choose 1 of 4 L2 definitions | B1–C2 | depth of meaning | Exact |
| 4 | `mcq_word_from_definition` | See an L2 definition; choose 1 of 4 words | B1–C2 | retrieval, near-synonym discrimination | Exact |
| 5 | `odd_one_out` | 4–5 items; tap the one that doesn't belong; then state why | A2–C1 | semantic field, collocation | Exact + optional justification (LLM-scored) |
| 6 | `sort_bins` | Drag 8–12 items into 2–4 labelled bins (countable/uncountable, formal/informal, *make/do*) | A1–C2 | categorisation, colligation | Per-item; ≥ 90% = Good |

---

## Group B — Vocabulary, productive (7)

| # | type_id | Task | Level | Competence | Scoring |
|---|---------|------|-------|-----------|---------|
| 7 | `type_from_definition` | Read an L2 definition + first letter; type the word | B1–C2 | free recall | Exact after normalisation; 1 typo tolerated (Damerau–Levenshtein ≤ 1) with a "check your spelling" note |
| 8 | `type_from_l1` | See L1 gloss; type the L2 word | A1–B1 | recall via L1 | Exact; all accepted synonyms listed on the item |
| 9 | `spelling_bee` | Hear the word (+ optional sentence); type it | A1–C1 | sound→spelling | Exact; UK/US both accepted |
| 10 | `word_family_table` | Given a root, fill a 4-cell table (noun/verb/adj/adv) | B1–C2 | morphology | Per cell |
| 11 | `affix_builder` | Given a root + a meaning ("the opposite of"), build the word | B1–C2 | derivational morphology | Exact |
| 12 | `collocation_grid` | 4×4 grid of verbs × nouns; tap every legal combination | B1–C2 | collocation | F1 score vs the corpus-attested key; ≥ 0.85 = Good |
| 13 | `near_synonym_choice` | A sentence with a gap and 4 near-synonyms, only one of which collocates/fits register | B2–C2 | precision, connotation | Exact; explanation always shown |

---

## Group C — Sentence building & grammar (12)

| # | type_id | Task | Level | Competence | Scoring |
|---|---------|------|-------|-----------|---------|
| 14 | `word_bank_build` | Build the L2 sentence from shuffled word tiles (+ 2–4 distractor tiles) | A1–B1 | syntax with scaffolding | Exact word order; distractors are mandatory from A1.2 or the type is trivial |
| 15 | `type_translate_to_l2` | L1 sentence → type the L2 sentence | A1–B2 | full production | Multi-answer key + normaliser (see §12) |
| 16 | `sentence_reorder` | Reorder 4–6 chunks (not single words) into a sentence | A2–C1 | information structure, clause order | Exact |
| 17 | `gap_fill_bank` | Sentence with a gap; choose from a bank of 6 words | A1–B1 | form selection | Exact |
| 18 | `gap_fill_free` | Sentence with a gap; type anything that fits | A2–C2 | free production | Regex/answer-set + LLM fallback for open gaps |
| 19 | `verb_form_gap` | *She ___ (not/go) to work yesterday.* | A1–C1 | morphology + tense choice | Exact; partial credit for right tense wrong spelling |
| 20 | `transform_sentence` | Rewrite: active→passive, direct→reported, 1st→2nd conditional | A2–C2 | structural manipulation | Answer set + normaliser |
| 21 | `keyword_transformation` | Cambridge-style: rewrite using a given word, 2–5 words | B1–C2 | precise structural control | Exact within word limit; partial credit 0.5 for one error |
| 22 | `error_correct` | A sentence with 1 error (or "no error"); find and fix it | A2–C2 | monitoring, noticing | Position + correction both required |
| 23 | `grammaticality_judgement` | Is this sentence correct? (timed, 4 s) | B1–C2 | implicit knowledge under time pressure | Exact; RT recorded — this type measures *automaticity*, not knowledge |
| 24 | `open_cloze` | 150-word text, 8 gaps, no options, mostly function words | B1–C2 | grammatical cohesion | Per gap, answer sets |
| 25 | `banked_cloze` | 200-word text, 10 gaps, bank of 15 words | B1–C2 | lexis in discourse | Per gap |

---

## Group D — Pronunciation & phonology (7)

| # | type_id | Task | Level | Competence | Scoring |
|---|---------|------|-------|-----------|---------|
| 26 | `minimal_pair_discrimination` | Hear one word; tap which of 2 you heard | A1–C1 | perception | Block of 10; ≥ 90% required before production is unlocked |
| 27 | `phoneme_id` | Hear 4 words; tap the one containing the target sound | A1–B1 | phonemic awareness | Exact |
| 28 | `stress_tap` | See a word split into syllables; tap the stressed one (audio after) | A1–C1 | word stress | Exact |
| 29 | `intonation_match` | Hear a sentence; choose the meaning/attitude it conveys | B1–C2 | prosody→meaning | Exact |
| 30 | `repeat_after` | Hear then record a word/phrase | A1–C2 | articulation | GOP per phone + word score (doc 02 §10) |
| 31 | `read_aloud` | Read a sentence/short text aloud | A1–C2 | grapheme→phoneme, prosody | GOP + fluency (rate, pauses) + stress accuracy |
| 32 | `shadowing` | Speak simultaneously with the audio, 20–60 s | A2–C2 | rhythm, speed, prosody | Alignment score (DTW on F0 + energy envelope) + intelligibility |

---

## Group E — Listening (10)

| # | type_id | Task | Level | Competence | Scoring |
|---|---------|------|-------|-----------|---------|
| 33 | `listen_choose_image` | Hear a sentence; choose 1 of 4 images | A1–A2 | global comprehension | Exact |
| 34 | `listen_gist_mcq` | Hear a passage; answer 1 gist question | A2–C2 | gist | Exact |
| 35 | `listen_detail_gap` | Hear a passage; fill a form/table with specific details | A2–C2 | selective listening | Per gap |
| 36 | `dictation_word` | Hear a word in a carrier phrase; type it | A1–B1 | decoding | Exact |
| 37 | `dictation_sentence` | Hear a full sentence (2 plays); type it | A2–C2 | full decoding — **the most diagnostic listening type** | Per-word alignment; report which words were mis-decoded and their phonetic cause |
| 38 | `dictation_connected` | Hear a *fast, natural* clip; type what was said; then compare with the "decoded" transcript | B1–C2 | connected-speech decoding | Per word; errors classified by process (elision, assimilation, weak form) |
| 39 | `listen_order_events` | Hear a narrative; drag 5–7 events into order | A2–B2 | discourse structure | Kendall's tau ≥ 0.8 = Good |
| 40 | `listen_speaker_match` | 4 short monologues, 6 statements; match | B1–C2 | multiple-matching, inference | Per match |
| 41 | `listen_inference` | Hear a dialogue; answer about attitude/implication/relationship | B2–C2 | pragmatic listening | Exact |
| 42 | `note_taking` | Hear a 3–8 min talk; complete structured notes; then reconstruct | B2–C2 | simultaneous processing, mediation | Rubric: key points captured, structure, accuracy (LLM + rubric) |

---

## Group F — Reading (8)

| # | type_id | Task | Level | Competence | Scoring |
|---|---------|------|-------|-----------|---------|
| 43 | `read_gist_mcq` | Read; answer main-idea question | A2–C2 | skimming | Exact |
| 44 | `read_scan_detail` | Find a specific fact against a timer | A2–C2 | scanning | Exact + time |
| 45 | `read_gapped_text` | 6 sentences/paragraphs removed; slot them back (+1 distractor) | B1–C2 | cohesion & coherence | Per gap |
| 46 | `read_multiple_matching` | Match 8–10 statements to 4–6 text sections | B1–C2 | scanning + paraphrase recognition | Per match |
| 47 | `read_true_false_ng` | True / False / Not Given | B1–C2 | precise inference control | Exact — teaches the crucial distinction between *contradicted* and *unstated* |
| 48 | `read_heading_match` | Match headings to paragraphs | B1–C2 | main idea per paragraph | Per match |
| 49 | `read_speed_drill` | Timed read + comprehension check; reports wpm and comprehension | B1–C2 | reading rate | wpm × comprehension% |
| 50 | `read_reference_resolution` | Highlighted *it / this / the former*; what does it refer to? | B1–C2 | cohesion | Exact |

---

## Group G — Speaking (6)

| # | type_id | Task | Level | Competence | Scoring |
|---|---------|------|-------|-----------|---------|
| 51 | `speak_prompt` | Answer an open question in 20–60 s | A1–C2 | free production | ASR transcript → rubric (content, range, accuracy, fluency, pronunciation) |
| 52 | `speak_picture_describe` | Describe/compare images for 60–90 s | A2–C1 | lexical retrieval under pressure | Rubric + required-vocabulary coverage |
| 53 | `speak_roleplay` | Multi-turn conversation with an AI persona in a defined scenario with a goal | A1–C2 | interaction, pragmatics | Task completion + turn count + repair + rubric; **recasts** used as feedback |
| 54 | `speak_4_3_2` | Same 4-min talk repeated in 4 / 3 / 2 min | B1–C1 | automaticity | wpm improvement across the three runs; ≥ +25% expected |
| 55 | `speak_impromptu` | 60-second talk on a random topic, no preparation | B1–C2 | spontaneous fluency | Rubric + pause ratio |
| 56 | `speak_retell` | Watch/read something, then retell it in your own words | A2–C2 | mediation + production | Content coverage + paraphrase rate (penalise verbatim copying) |

---

## Group H — Writing (5)

| # | type_id | Task | Level | Competence | Scoring |
|---|---------|------|-------|-----------|---------|
| 57 | `write_sentence` | Write one sentence to a spec ("using *although*, about your weekend") | A1–C1 | controlled production | Constraint check + grammar check + LLM acceptability |
| 58 | `write_paragraph` | 60–120 words to a prompt | A2–B2 | paragraph structure | Rubric (task, organisation, range, accuracy) |
| 59 | `write_extended_process` | Multi-draft: plan → draft → feedback → revise → edit | B1–C2 | full writing competence | Stage-appropriate feedback (doc 06 §5.3); final rubric |
| 60 | `write_register_shift` | Rewrite a given text at a different register / for a different reader | B1–C2 | sociolinguistic competence | Rubric + register classifier |
| 61 | `write_email_task` | Respond to an input email with 4 required content points | A2–C1 | transactional writing | Content-point coverage + register + accuracy |

---

## Group I — Pragmatics & mediation (6)

| # | type_id | Task | Level | Competence | Scoring |
|---|---------|------|-------|-----------|---------|
| 62 | `pragmatics_choose` | A situation is described; choose the most appropriate of 4 utterances (all grammatical) | A2–C2 | appropriacy | Exact + explanation of *why* the others fail |
| 63 | `conversation_repair` | The AI says something you didn't understand; you must repair the breakdown | A2–C2 | repair strategies | Strategy used + success |
| 64 | `summarise_text` | Summarise 400–2,000 words in a word limit | B1–C2 | mediation | Rubric: coverage of key points, accuracy, concision, own words |
| 65 | `explain_chart` | Describe/interpret a chart or table in speech or writing | B1–C2 | mediation, data language | Rubric: trend language, accuracy, no over-claiming |
| 66 | `relay_message` | You receive information in one register/language and must relay it appropriately to a third party | A2–C2 | mediation | Content fidelity + register appropriateness |
| 67 | `reconcile_sources` | 3–4 short conflicting accounts; produce one coherent, neutral account | B2–C2 | synthesis, critical reading | Rubric: conflict identification, neutrality, completeness |

---

## Group J — Games and fluency drills (4)

| # | type_id | Task | Level | Competence | Scoring |
|---|---------|------|-------|-----------|---------|
| 68 | `memory_match` | Concentration-style pair-matching under a timer | A1–B1 | form–meaning speed | Time + errors |
| 69 | `word_race` | 60 s: answer as many recognition items as possible | A1–C2 | retrieval speed / automaticity | Items/minute; tracks **speed of access**, which conventional accuracy scoring misses entirely |
| 70 | `story_branch` | Choose-your-own-adventure dialogue; each choice is a real utterance with real consequences | A1–C2 | interaction, pragmatics, engagement | Path outcome + language used |
| 71 | `team_challenge` | Cohort-based cooperative goal (e.g. "together, read 100,000 words this month") | A2–C2 | motivation, immersion volume | Aggregate; **cooperative, not competitive** |

---

## 2. Type usage by level (share of items)

| Type group | A1 | A2 | B1 | B2 | C1 | C2 |
|------------|---:|---:|---:|---:|---:|---:|
| A Vocab receptive | 22% | 15% | 8% | 5% | 3% | 2% |
| B Vocab productive | 10% | 12% | 12% | 12% | 12% | 10% |
| C Grammar/sentence | 25% | 26% | 22% | 18% | 12% | 8% |
| D Pronunciation | 15% | 10% | 8% | 6% | 5% | 4% |
| E Listening | 12% | 14% | 16% | 18% | 20% | 22% |
| F Reading | 5% | 8% | 12% | 14% | 16% | 16% |
| G Speaking | 8% | 10% | 12% | 14% | 16% | 18% |
| H Writing | 1% | 3% | 6% | 9% | 11% | 12% |
| I Pragmatics/mediation | 0% | 1% | 3% | 4% | 5% | 8% |
| J Games | 2% | 1% | 1% | 0% | 0% | 0% |

**Read this table as a design contract.** The shift from recognition to production, and from single-sentence to discourse-level work, is the difference between a course that reaches B1 and one that reaches C2.

---

## 3. Scaffolding ladder (removed as mastery grows)

| Scaffold | Removed at |
|----------|-----------|
| L1 glosses on every word | A2.2 |
| Images on every item | B1.1 |
| Word bank for sentence building | B1.1 |
| Audio replay unlimited | B2.1 (limited to 2 in tests) |
| Transcript before the task | A2.2 |
| Hint button | B1.2 (still available, but costs the "no-hint" tier) |
| Multiple choice as a default | B1.2 |
| Untimed responses | B2.1 (timed variants introduced) |
| Model answer shown before production | A2.1 |

---

## 4. Item-authoring rules by type

### 4.1 Distractor rules (MCQ family)
- Exactly one unambiguously correct option.
- Distractors must be **plausible and diagnostic**: each should correspond to a specific misunderstanding (an L1 calque, a confusable near-synonym, a wrong tense, a wrong preposition). Random distractors teach nothing and inflate scores.
- No "all/none of the above". No negative stems ("Which is NOT…") below B2.
- Distractors must be of similar length and register to the key.
- Distractor position randomised per presentation; no positional bias > 30% for any slot across the bank.

### 4.2 Gap rules
- One gap tests one thing. Never a gap that requires both a tense choice and a vocabulary choice unless that is the explicit target.
- Gaps at least 5 words apart in a cloze; never in the first sentence of a text.
- For `open_cloze`, ≥ 70% of keys must be function words (that is what makes it a grammar test rather than a vocabulary lottery).

### 4.3 Sentence rules
- Every sentence must be corpus-plausible, natural, and useful (doc 00 §4.1).
- Maximum length by level: A1 ≤ 8 words, A2 ≤ 12, B1 ≤ 18, B2 ≤ 25, C1 ≤ 35, C2 unrestricted.
- The target structure must be **necessary** — if the learner can answer correctly without understanding the target, the item is invalid.

### 4.4 Audio rules
- Every item with text has audio. Sentence audio is recorded as a whole utterance with natural prosody, never concatenated from word recordings.
- ≥ 6 distinct voices per level, balanced for gender and age; accents per doc 06 §1.1.

---

## 5. Answer normalisation and grading (`type_*` families)

The single biggest source of learner rage in language apps is a correct answer marked wrong. The normaliser must:

1. Trim and collapse whitespace; normalise Unicode (NFKC); normalise curly/straight quotes and dashes.
2. Case-insensitive except where case is the target (proper nouns, sentence-initial in punctuation tasks).
3. Accept and ignore terminal punctuation unless punctuation is the target.
4. Accept **both** US and UK spellings, always.
5. Accept contracted and full forms interchangeably (*I'm / I am*) unless contraction is the target.
6. Accept every listed alternative answer. Authors must supply alternatives; the system additionally auto-generates them (article variation where legal, contraction variants, synonym substitution from the lexeme's accepted-synonym list, both dative orders where both are grammatical).
7. Apply typo tolerance: Damerau–Levenshtein distance ≤ 1 for words ≥ 4 characters accepted with a "watch the spelling" note, **except** in `spelling_bee` and when the edit produces another real word that is also a valid English word (*form/from*, *quiet/quite*, *desert/dessert*) — those are marked wrong, because they are the error.
8. For free-response items, fall back to an LLM grader with a strict rubric and a cached decision, and log every LLM decision for human audit.
9. **Always provide an "I think my answer was right" button.** Report it, review it weekly, and add accepted answers. This feedback loop is how the answer keys become good; there is no substitute for it.

---

## 6. Timing

| Type family | Default time limit | Timeout behaviour |
|-------------|-------------------|-------------------|
| Recognition (A, E33–35, F43) | none by default; 8 s in timed mode | Grade = Again |
| Recall (B, C) | none; 20 s in timed mode | Grade = Again |
| `grammaticality_judgement` | 4 s (the point of the type) | Grade = Again |
| `word_race` | 60 s total | — |
| Speaking | 3× the model duration | Submit what exists |
| Writing | per doc 06 §1.4 | Autosave, allow overrun with a flag |

Timed modes are opt-in below B2 and default from B2, because automaticity — not just accuracy — is what the upper levels require.
