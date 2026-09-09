# 15 — PRODUCTION ROADMAP
## Volume maths, team, tooling, phasing, metrics and risks

---

## 1. What has to be built (recap from doc 11 §8)

| Asset | Count |
|-------|------:|
| Units / nodes / lesson plays | 168 / 1,344 / 4,032 |
| Unique exercise items | ~48,000 |
| Lexeme records | 12,000 (+ 3,500 collocations, 300 phrasal verbs, 800 idioms, 1,000 chunks) |
| Grammar points (full treatment) | 412 |
| Minimal-pair sets / items | 165 / ~3,300 |
| Reading texts | 1,400 |
| Listening items | 2,600 |
| Serialised story episodes | 168 |
| Graded readers | 400 (licensed or original) |
| Podcast episodes | 600 |
| Assessment items | 6,000 |
| Audio assets | ~180,000 |
| Images | ~14,000 |
| L1 gloss sets | 12 languages × ~17,600 entries |

---

## 2. Production rate assumptions and effort

| Task | Rate | Basis |
|------|------|-------|
| Exercise item, authored + reviewed | 12/hour | Experienced ELT author with a good tool and live gates |
| Lexeme record (full: IPA, audio brief, collocations, examples, gloss brief) | 9/hour | |
| Grammar point full treatment | 3 hours | Explanation, diagram, error list, 6 item templates |
| Reading text (level-controlled, with questions) | 3 hours | |
| Listening script + question set | 2.5 hours | |
| Story episode (400–900 words, serialised) | 5 hours | Includes continuity work |
| Audio recording | 90 items/studio-hour | Directed session, native voice |
| Audio QC + alignment | 300 items/hour | Semi-automated |
| Image sourcing/creation + alt text | 25/hour | |
| L1 gloss translation + review | 90 entries/hour | Two-pass |
| Assessment item (calibrated) | 6/hour | Higher bar than practice items |

### 2.1 Person-hour estimate

| Workstream | Hours |
|------------|------:|
| Exercise items (48,000 ÷ 12) | 4,000 |
| Lexeme records (17,600 ÷ 9) | 1,960 |
| Grammar points (412 × 3) | 1,240 |
| Reading texts (1,400 × 3) | 4,200 |
| Listening scripts (2,600 × 2.5) | 6,500 |
| Stories (168 × 5) | 840 |
| Assessment items (6,000 ÷ 6) | 1,000 |
| Audio recording (180,000 ÷ 90) | 2,000 |
| Audio QC/alignment | 600 |
| Images (14,000 ÷ 25) | 560 |
| L1 glosses (12 × 17,600 ÷ 90) | 2,350 |
| Curriculum design, review, calibration, QA (≈ 25% overhead) | 6,300 |
| **Total content** | **≈ 31,550 hours** |

At 1,600 productive hours/person-year: **≈ 20 person-years of content work** for the full A1→C2 course in 12 languages. This is the number that decides the phasing below. Anyone who tells you a full 0→C2 gamified course is a six-month project has not counted.

---

## 3. Team

### 3.1 Content
| Role | Count (steady state) | Responsibility |
|------|---------------------:|----------------|
| Curriculum director (CEFR specialist, DELTA/MA TESOL or equivalent) | 1 | Owns docs 01–06, level integrity |
| Level leads | 4 | A-levels, B1, B2, C-levels |
| ELT content authors | 10–14 | Items, texts, lessons |
| Assessment specialist (psychometrician) | 1–2 | Docs 12, IRT calibration, standard setting |
| Phonetician / pronunciation lead | 1 | Doc 02, GOP calibration |
| Corpus/computational linguist | 1 | Frequency lists, corpus checks, item analytics |
| Story/creative writer | 2 | Serialised narrative, readers |
| Audio director + voice talent pool | 1 + 24 voices | 6 voices per level minimum |
| Localisation manager + translator network | 1 + 24 | 12 L1s, two-pass |
| Content QA | 3 | Gate enforcement, spot-checking |

### 3.2 Product & engineering
Product lead · 2 designers (one specialising in motion/celebration, one in information design) · 4 mobile engineers (iOS/Android or cross-platform) · 3 backend · 1 data engineer · 2 ML (ASR/GOP, scoring, knowledge tracing) · 1 content-tooling engineer (the authoring tool is a product in itself) · 1 QA automation · 1 accessibility specialist (can be fractional).

### 3.3 The two hires that decide the outcome
1. **The curriculum director.** Without a real CEFR specialist owning level integrity, the course will drift and the levels will be meaningless.
2. **The content-tooling engineer.** With live validation gates, an author produces 12 items/hour. Without them, 4 — and the course fails QA anyway. This role pays for itself three times over.

---

## 4. Phasing

### Phase 0 — Foundations (months 1–4)
- Finalise docs 01–14; sign off the syllabus item inventory.
- Build the authoring tool with gates 1–8 (doc 11 §5).
- Build the content schema, bundle pipeline, and CDN delivery.
- Implement the FSRS-6 scheduler and the review log.
- Ship an internal-only client that can play 6 exercise types.
- Record the A1 voice set.
**Exit:** an author can produce a validated unit end-to-end and play it on a device.

### Phase 1 — MVP: A1 complete (months 4–9)
- Sections 1–2 (24 units, 192 nodes, ~5,500 items).
- 20 exercise types (groups A, B, C core, D core, E core).
- Uzbek + Russian + English UI and glosses.
- Streak, XP, daily goal, path, review node.
- Placement CAT v1 (A1–B1 range only).
- Story: episodes 1–24.
**Exit criteria:** 500 external testers; D7 retention ≥ 35%; A1 exam produces a defensible level judgement; retention audit within 8 points of predicted.

### Phase 2 — A2 + the Immersion Engine seed (months 9–15)
- Sections 3–4 (28 units).
- Speaking with ASR/GOP; pronunciation clinic; minimal-pair gate.
- Graded Library v1 (80 readers, A1–A2 bands) + coverage estimator.
- AI conversation partner v1 (scripted-scenario roleplay).
- 5 more L1s.
**Exit:** A2 exam validated; ≥ 25% of active learners using immersion features weekly.

### Phase 3 — B1 (months 15–24)
- Sections 5–6 (32 units) — the largest content block.
- Listening-cliff protocol; connected-speech module.
- Writing Studio with multi-draft process feedback.
- Mediation task types.
- Immersion gating turned on.
- Podcast feed; News Digest (multi-level rewrites).
- Full 12 L1s.
**Exit:** B1 exam externally correlated (criterion-validity study, doc 12 §7); learners demonstrably reaching B1 from zero within the modelled hours.

### Phase 4 — B2 (months 24–33)
- Sections 7–8 (36 units).
- Advanced speaking assessment (rubric raters at QWK ≥ 0.75).
- Book Club; live human conversation matching.
- Exam-prep modules (IELTS, Cambridge B2 First).

### Phase 5 — C1–C2 (months 33–48)
- Sections 9–10 (48 units).
- Register and stylistics modules; editing tasks.
- Domain packs (medicine, law, business, engineering, IT).
- Full mediation assessment; C2 portfolio system.

### Parallel tracks (continuous from Phase 1)
Accessibility · item calibration and bank health · retention audits · scheduler parameter fitting · content refresh (idiom currency, cultural references, news content).

**Reality check:** a defensible full 0→C2 course is a **3–4 year** build. The MVP that proves the model is A1 in ~9 months. Any plan that promises the whole thing in a year will ship 168 units of unvalidated content, and the levels will be decoration.

---

## 5. Build/buy/licence decisions

| Component | Recommendation |
|-----------|----------------|
| SRS scheduler | **Build** on the open FSRS reference implementation — it is the core competence |
| ASR | **Buy** a commercial or open ASR (Whisper-class) for transcription; **build** the GOP/forced-alignment layer, because commercial ASR is tuned to *understand* accents, not to *score* them |
| TTS | **Buy** for authoring previews only; **all shipped audio is human** below C1. TTS audio teaches TTS prosody |
| Rubric raters | **Buy** an LLM, **build** the rubric, anchors, calibration harness and audit pipeline |
| Graded readers | **Licence** where possible (established series), **write** originals for the story spine |
| Corpora | **Licence** COCA/BNC access; use open SUBTLEX, NGSL, AWL |
| CEFR inventories | Use English Vocabulary Profile / English Grammar Profile under licence as a cross-check, not as the syllabus itself |
| Authoring tool | **Build** — no off-the-shelf tool enforces the gates in doc 11 §5 |
| Images | Mixed: licensed stock + commissioned illustration for a consistent style |

---

## 6. Cost drivers to watch

1. **Audio.** 180,000 assets is the single largest line item. Mitigations: record sentences in themed sessions, script for reuse, never concatenate words into sentences, and accept that A1–B1 audio quality matters more than C1–C2 quantity.
2. **Localisation.** 12 languages × 17,600 glosses, twice-reviewed. Mitigation: launch with 3, add on demand, and keep the L2 content 100% L1-independent so adding a language is a translation job, not a content job.
3. **Human rating.** The 10% audit on certification scoring is non-negotiable but should be concentrated on borderline cases.
4. **Item bank churn.** Expect to retire and replace ~8% of items a year after calibration.

---

## 7. Metrics

### 7.1 Learning metrics (primary — these decide whether the product works)

| Metric | Definition | Target |
|--------|-----------|--------|
| **True retention** | Surprise-audit recall vs predicted (doc 08 §9) | Within ±5 points of `R_d` |
| **Level attainment rate** | % of learners reaching level N within 1.3× the modelled hours | ≥ 60% |
| **Coverage growth** | Estimated text coverage per 10 hours studied | Monotone, on model |
| **Production gap** | Receptive size ÷ productive size | ≤ 2.0 (a widening gap means too much recognition practice) |
| **Error density trend** | Errors/100 words in free writing, by level | Falling toward the level target (doc 06 §1.4) |
| **Speech rate & pause ratio** | Per level target (doc 06 §1.3) | On target |
| **Immersion volume** | Words read, hours listened per learner per month | On the doc 00 §3.3 curve |
| **Exam validity** | Correlation with an external CEFR-linked anchor | r ≥ 0.80 |
| **Item health** | % of bank with a ≥ 0.4 and 0.25 ≤ p ≤ 0.97 | ≥ 90% |

### 7.2 Engagement metrics (secondary — never optimised at the expense of §7.1)
D1/D7/D30 retention · sessions per week · minutes per session · streak length distribution · immersion feature adoption · speaking-feature adoption · % of learners who have ever spoken aloud in the app (a critical and usually terrible number) · churn reason survey.

### 7.3 Trust metrics
Answer-dispute rate per 1,000 items (target < 2) · dispute resolution time · appeal overturn rate · notification opt-out rate · subscription cancellation friction score (audited quarterly) · % of learners who say the app's level estimate matched their real-world experience.

### 7.4 The one metric that matters most
**Hours studied → CEFR levels gained, measured externally.** If a cohort of learners who study 400 hours in the app cannot pass an independent B1 test, nothing else in this document matters. Commission that study by the end of Phase 3 and publish the result honestly, whatever it says.

---

## 8. Risk register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------:|------------|
| Content volume underestimated | Schedule slips 12+ months | High | Phase strictly; validated gates; measure author throughput from week 1 and re-plan monthly |
| Level drift (units labelled B1 that are really A2) | The whole CEFR claim collapses | High | Curriculum director with veto; EVP/EGP cross-check in CI; external audit at each level exam |
| Recognition-only learning | Learners plateau at A2/B1 and churn | High | Production quotas per level (doc 09 §2); production-gap metric; immersion gating |
| ASR under-scores accented speech | Learners feel punished for their accent; abandonment | High | L2-trained models; bias audit by L1; intelligibility-based scoring, not native-likeness |
| LLM rater drift or inconsistency | Unfair scores, lost trust | Medium | Fixed prompt versions, temperature 0, anchored benchmarks, 10% human audit, appeals |
| Gamification cannibalises learning | Engagement up, learning flat | Medium | XP novelty multiplier; scheduler independent of engagement metrics; §7.1 governs |
| Streak distress / dark-pattern reputation | Brand damage | Medium | Doc 10 §8 guardrails, published as a public commitment |
| Immersion gating unpopular | Some churn at B1 | Medium | Generous thresholds, automatic tracking, clear explanation, opt-out with a labelled "unverified level" |
| Licensing costs for readers/corpora | Budget | Medium | Original story spine reduces dependence |
| Audio production bottleneck | Schedule | Medium | Parallel studios; reuse; strict scripting discipline |
| Privacy incident with voice data | Severe | Low | Minimise retention, encrypt, no training without opt-in, delete on request |
| Key-person dependency on the curriculum director | Severe | Medium | Everything in these docs, not in one head; documented decisions; deputy level leads |

---

## 9. Definition of done, per level

A level ships when **all** of these hold:

1. All units authored, reviewed and passing all 20 CI gates.
2. All audio recorded by human native speakers, QC'd and force-aligned.
3. Item bank piloted with ≥ 300 responses per item and IRT-calibrated; ≥ 90% item health.
4. Level exam blueprinted, standard-set by an Angoff panel, and α ≥ 0.85.
5. Rubric raters at QWK ≥ 0.75 against human raters for that level.
6. L1 glosses complete and second-reviewed for every launch language.
7. Accessibility audit passed (WCAG 2.2 AA + alternative paths).
8. A cohort of ≥ 100 pilot learners has completed the level and their retention audit is within tolerance.
9. The contrastive weighting (doc 14 §7) is applied and the L1 clinics exist.
10. The learner-facing claims about the level are true.

---

## 10. First 30 days — concrete next steps

1. Freeze the syllabus item inventory: enter all 412 grammar points, 165 phonology sets and the A1 lexeme list (800) into the content repo as data, not prose.
2. Write the JSON Schemas for unit, node, item, lexeme, text; stand up CI with gates 1–4.
3. Build a throwaway authoring prototype and have one author produce **one complete unit** (8 nodes, 3 tiers, ~112 items). Time it. That single measurement re-plans the whole project.
4. Implement FSRS-6 with the reference parameters and a replayable review log; write property tests (monotonicity of intervals, stability never decreasing on success, post-lapse stability ≤ prior stability).
5. Record 200 audio assets to establish the studio pipeline and per-item cost.
6. Recruit the curriculum director and the content-tooling engineer.
7. Run the placement CAT design on paper against 30 volunteers to check the item bank's spread.
8. Draft the public "how long this really takes" page — and make the product tell the truth from day one.
