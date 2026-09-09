# 12 — ASSESSMENT SPECIFICATION
## Placement, checkpoints, level exams, rubrics, automatic scoring, external alignment

---

## 1. Assessment architecture

| Instrument | Purpose | Frequency | Stakes | Length |
|------------|---------|-----------|--------|--------|
| **Placement CAT** | Find the entry point | Once (repeatable after 6 months) | Low | 8–12 min |
| **Micro-checks** | Item-level mastery | Continuous (the SRS itself) | None | — |
| **Node tier gates** | Ready for the next tier | Per node | None | — |
| **Unit checkpoint** | Unit mastery | Per unit | Low | 4–6 min |
| **Section checkpoint** | Sub-level mastery, unlocks next section | Per section (10×) | Medium | 20–25 min |
| **Level Exam** | CEFR level attainment → certificate | 6× (A1, A2, B1, B2, C1, C2) | High | 90–150 min |
| **Retention audit** | Is our vocabulary number honest? | Monthly | None | 3 min |
| **Skills profile** | Balance across the four skills + mediation | Quarterly | Low | 30 min |
| **Vocabulary Size Test** | Total receptive size | Quarterly | Low | 8 min |
| **Diagnostic on demand** | "Why am I stuck?" | Learner-triggered | None | 15 min |

---

## 2. Placement CAT (computerised adaptive test)

### 2.1 Design
- **Model:** 2-parameter logistic IRT over a calibrated bank of ≥ 1,500 items spanning A1–C2, plus a short productive component.
- **Start:** at θ = 0 (≈ B1 boundary), or seeded from the learner's self-report and L1 prior.
- **Item selection:** maximum Fisher information at the current θ estimate, with exposure control (Sympson–Hetter) and content balancing (grammar 30% / lexis 30% / listening 25% / reading 15%).
- **Stop rule:** SE(θ) < 0.30 **or** 40 items **or** 12 minutes, whichever first.
- **Productive add-on (required, 3 min):** one 60-second spoken response and one 3-sentence written response, scored by rubric. Receptive-only placement systematically over-places learners by roughly one sub-level — they recognise far more than they can produce.
- **Output:** θ → CEFR sub-level, with a confidence band; plus a per-skill profile.

### 2.2 Placement policy
- Place at the **lower bound** of the confidence band, then let the test-out mechanism (doc 10 §4) move the learner up quickly. Under-placement costs a few easy sessions; over-placement costs the learner entirely.
- Always place at least 1 sub-level below the highest passed, and start the learner mid-section rather than at a section boundary if the profile is uneven.
- If the four-skill profile is uneven by ≥ 2 sub-levels (very common: strong reading, weak speaking), place by the **weakest productive skill** and open a targeted catch-up track for the lagging skills.

---

## 3. Unit and section checkpoints

**Unit checkpoint (4–6 min, 12–15 items):**
- 40% items from this unit's syllabus, 40% from the previous 3 units, 20% from anywhere earlier (interleaved retention check).
- Must include ≥ 3 production items and ≥ 2 listening items.
- Pass: ≥ 80%. Below 80%, the failed syllabus IDs get shortened SRS intervals and the unit's review node is re-queued; the learner is **not** blocked.

**Section checkpoint (20–25 min):**
- Mirrors the Level Exam structure in miniature: listening, reading, use of English, one writing task, one speaking task.
- Pass: ≥ 75% overall, no section < 60%.
- **This one gates progression** to the next section, together with the immersion volume requirement (doc 06 §7.2). Two attempts, 48 h apart; a third attempt requires completing the generated remediation plan first.

---

## 4. Level Exams

Six exams. Each produces a certificate stating the CEFR level, the date, the sub-scores, and — in plain language — that it is an internal assessment, not an accredited qualification.

### 4.1 Structure

| Paper | A1 | A2 | B1 | B2 | C1 | C2 |
|-------|----|----|----|----|----|----|
| **Listening** | 15 min, 12 items | 20 min, 16 | 25 min, 20 | 30 min, 25 | 35 min, 30 | 40 min, 35 |
| **Reading** | 20 min, 15 items | 25 min, 20 | 35 min, 25 | 45 min, 30 | 55 min, 35 | 60 min, 40 |
| **Use of English** | 10 min, 15 | 15 min, 20 | 20 min, 25 | 30 min, 30 | 35 min, 35 | 40 min, 40 |
| **Writing** | 1 task, 15 min | 1 task, 25 min | 2 tasks, 45 min | 2 tasks, 60 min | 2 tasks, 70 min | 3 tasks, 90 min |
| **Speaking** | 5 min | 8 min | 12 min | 15 min | 18 min | 22 min |
| **Mediation** | — | — | 1 task, 10 min | 1 task, 12 min | 2 tasks, 20 min | 2 tasks, 25 min |
| **Total** | ~55 min | ~75 min | ~2 h 05 | ~2 h 45 | ~3 h 15 | ~4 h |

### 4.2 Task types per paper

- **Listening:** multiple choice (short + long), gap-fill/form completion, multiple matching (speakers→statements), true/false/not given, note-taking (B2+), inference (B2+), attitude identification (C1+). Two plays at A1–B1; **one play** from B2 (matching real-life conditions).
- **Reading:** multiple choice, gapped text (sentence insertion), multiple matching, heading matching, true/false/not given, reference resolution, timed speed section (B1+), cross-text synthesis (C1+).
- **Use of English:** open cloze, banked cloze, word formation, key-word transformation, error correction, collocation choice.
- **Writing:** per the genre table (doc 05 §6), matched to level.
- **Speaking:** (1) interview/warm-up, (2) long turn (monologue on a prompt), (3) collaborative task with an AI or human partner, (4) discussion/follow-up. From B2, one section is unprepared and adversarial (the examiner disagrees).
- **Mediation:** summarise, explain data, relay, reconcile sources.

### 4.3 Pass standard
- **A1–C1:** ≥ 75% overall, no paper below 60%.
- **C2:** ≥ 80% overall, no paper below 70%.
- Additionally, the four conditions in doc 00 §7 must all hold. A learner who passes the exam but has only 60% of the level's items in `retained` state gets the honest message: *"You passed the test, but a lot of this is still fragile. Let's consolidate for two weeks and then certify."*

### 4.4 Security
- Item bank ≥ 8× exam length per level; randomised forms; exposure control.
- No item reused for the same learner within 12 months.
- Optional proctored mode (camera + screen + ID) for learners who want a shareable result; unproctored results are labelled as such.

---

## 5. Rubrics

### 5.1 Writing — analytic, 5 criteria × 6 bands

| Band | **Task achievement** | **Coherence & cohesion** | **Lexical range & accuracy** | **Grammatical range & accuracy** | **Register & audience** |
|------|---------------------|--------------------------|------------------------------|----------------------------------|-------------------------|
| **6 (C2)** | Fully addresses all parts with sophistication; content is insightful and well-selected | Effortless flow; organisation serves the argument; cohesion invisible | Precise, idiomatic, wide; connotation and collocation consistently apt | Full range used naturally; errors are rare slips only | Register precisely calibrated and sustained; voice appropriate to reader |
| **5 (C1)** | Addresses all parts fully; well-developed with relevant support | Well-organised with controlled use of organisational patterns; clear progression | Wide and mostly precise; occasional imprecision in low-frequency items | Wide range; consistent accuracy; occasional slips do not impede | Register appropriate and consistent |
| **4 (B2)** | Addresses all parts; development adequate, some points underdeveloped | Clear overall progression; paragraphing logical; some mechanical linking | Sufficient range for the topic; some collocation errors; some repetition | Good control of complex forms; errors do not impede communication | Register broadly appropriate with occasional lapses |
| **3 (B1)** | Addresses the main parts; some irrelevance or repetition | Linear organisation; simple linkers used, sometimes over/under-used | Adequate for familiar topics; noticeable circumlocution | Reasonable control of simple forms; complex forms attempted with errors | Some awareness of register; inconsistent |
| **2 (A2)** | Addresses parts of the task; content limited | Sentences linked with basic connectors; organisation minimal | Basic; frequent repetition; L1 influence | Simple structures with systematic errors; meaning generally clear | Little register awareness |
| **1 (A1)** | Attempts the task; very limited content | Isolated sentences; little linking | Very limited; memorised phrases | Very limited control; meaning often obscured | None |

### 5.2 Speaking — analytic, 6 criteria × 6 bands
The six CEFR qualitative parameters (doc 01 §2) become the criteria: **Range · Accuracy · Fluency · Interaction · Coherence · Phonology**, each banded 1–6 with the descriptors in that table.

Additional measured (not rubric-scored) indicators reported to the learner: words per minute, pause ratio, mean length of run, filled-pause rate, type-token ratio, self-repair count, and independent-ASR intelligibility.

### 5.3 Mediation rubric (4 criteria)
**Completeness** (were the key points captured?) · **Accuracy** (nothing distorted or invented) · **Appropriacy** (right register and detail level for the target audience) · **Independence** (own words, not lifted phrasing).

### 5.4 Rubric application
- Every rubric ships with **3 anchored sample performances per band** (benchmark scripts and recordings). Raters — human or machine — are calibrated against these.
- Bands may be awarded in half-steps.
- The **overall level is the median of criteria, not the mean**, and a single criterion two bands below the median caps the overall at one band above that criterion. This prevents a learner with beautiful vocabulary and unintelligible pronunciation from being certified at C1.

---

## 6. Automatic scoring

| Paper | Method | Human involvement |
|-------|--------|-------------------|
| Listening, Reading, Use of English | Deterministic keys + normaliser (doc 09 §5) | Answer-dispute review |
| Pronunciation sub-scores | GOP + prosody + independent-ASR WER (doc 02 §10) | Quarterly calibration against human raters |
| Speaking rubric | ASR transcript + acoustic features + LLM rater with anchored rubric and few-shot benchmark samples | **Mandatory human audit on 10% of all certification-level scores, 100% of borderline cases (within 5% of a boundary), and 100% of appeals** |
| Writing rubric | Feature extraction (error density by type, lexical band profile, MTLD, cohesion metrics, sentence variety) + LLM rater with anchored rubric | Same audit policy |
| Mediation | LLM rater with rubric + source-fidelity check | Same |

### 6.1 Rater quality requirements
- **Agreement:** the automatic rater must reach **quadratic weighted κ ≥ 0.75** against a panel of two trained human raters on a held-out set, per level, per task type, before it may be used for certification. Below that, it may only give formative feedback.
- **Bias auditing:** score distributions are checked by L1, accent group, gender and age band. Any group difference > 0.3 bands that is not explained by an independent proficiency measure triggers a model review. This is not optional; automatic speech scoring has a documented history of penalising non-native accents that are perfectly intelligible.
- **Determinism:** the same submission must receive the same score. LLM raters run at temperature 0 with a fixed prompt version recorded on the score.
- **Explainability:** every score returns the specific evidence (the sentences that anchored each band). "7/10" with no evidence is not feedback.

### 6.2 Appeals
Any learner may appeal any certification-level score once. Appeals go to a human rater who does not see the machine score. If the human differs by ≥ 1 band, the case enters the calibration set.

---

## 7. Validity, reliability and fairness

| Property | Target | How it is checked |
|----------|--------|-------------------|
| **Internal consistency** | Cronbach's α ≥ 0.85 per paper | Per exam form, per cohort |
| **Rater reliability** | QWK ≥ 0.75 machine–human; ≥ 0.80 human–human | Continuous audit sample |
| **Test–retest** | r ≥ 0.85 within 2 weeks with no study | Volunteer panel, annually |
| **Content validity** | 100% of items map to a syllabus ID; blueprint coverage verified | CI gate |
| **Construct validity** | Factor structure matches the four-skills + mediation model | Annual analysis |
| **Criterion validity** | Correlation with an external anchor (a public CEFR-linked test) r ≥ 0.80 on a volunteer sample of ≥ 400 learners spanning A2–C1 | Annual external study |
| **Differential item functioning** | No item with |DIF| above Mantel–Haenszel "C" across L1 groups | Quarterly |
| **Standard setting** | Cut scores set by a modified Angoff panel of ≥ 8 qualified CEFR-trained examiners, re-run when the syllabus version changes | On each major version |
| **Accessibility** | Every paper has an accessible alternative form (non-audio for the deaf; non-visual for the blind; extra time; keyboard-only) | Per release |

**Honesty requirement:** until the criterion-validity study exists, the app must not claim its levels are "equivalent to" IELTS/TOEFL/Cambridge bands. It may say "our estimate of your CEFR level" and show the indicative mapping (doc 01 §5) clearly labelled as indicative.

---

## 8. External exam preparation modules (optional add-ons, post-v1)

For learners whose goal is a specific qualification, thin preparation layers over the same syllabus:

| Exam | What the module adds |
|------|----------------------|
| **IELTS Academic / General** | Task 1 & 2 writing genres, the 9-band descriptors, Part 1/2/3 speaking format, the specific reading task types, band-score strategy |
| **TOEFL iBT** | Integrated speaking/writing tasks, note-taking under the specific format, the 30-point scales |
| **Cambridge B2 First / C1 Advanced / C2 Proficiency** | Use of English parts 1–4, the specific writing genres, the paired speaking format |
| **Duolingo English Test** | Adaptive format familiarity, the specific task types |
| **PTE Academic** | Integrated skills tasks, the automated scoring quirks |
| **OET / occupational** | Domain-specific for healthcare |

**Position taken with learners:** exam preparation improves your *score*; it barely improves your *English*. Do the syllabus for the English, then 4–8 weeks of exam preparation for the score. Saying this loses some exam-prep revenue and earns the trust that keeps learners for years.

---

## 9. Feedback reports

### 9.1 After every checkpoint
One screen: what you can now do (can-do statements newly earned) · what needs work (max 3, specific and actionable) · the one thing to do next (a single tap to start it).

### 9.2 After every level exam
A full report: per-paper scores with band descriptors · the four-skills radar with the CEFR profile · error-type frequency vs level norms · vocabulary size and coverage · fluency metrics vs level targets · the top 5 items to work on · an estimated timeline to the next level at the learner's actual pace.

### 9.3 What is never shown
Comparison against other named learners · a single "score" with no explanation · a predicted IELTS band presented as a promise · any number the retention audit doesn't support.
