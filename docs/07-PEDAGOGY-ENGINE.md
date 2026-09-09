# 07 — PEDAGOGY ENGINE
## The learning science the product is obliged to implement

Every principle here is stated as a **product requirement**, not as background reading. If a requirement is not implemented, the corresponding claim about learning outcomes must be removed from the marketing.

---

## 1. The six conditions for language acquisition

No language is acquired without all six. The app must be able to point to the feature that delivers each.

| # | Condition | Source idea | Delivered by |
|---|-----------|-------------|--------------|
| 1 | **Comprehensible input** in volume | Krashen's input hypothesis | Immersion Engine + the +1 rule (doc 00 §4.2) |
| 2 | **Noticing** of form | Schmidt's noticing hypothesis | Noticing tasks, input flooding, textual enhancement, dictation |
| 3 | **Pushed output** | Swain's output hypothesis | Free production tasks that force the target structure |
| 4 | **Interaction** and negotiation of meaning | Long's interaction hypothesis | AI roleplay, live human practice, information-gap tasks |
| 5 | **Feedback** on form | Focus-on-form research | Typed error feedback, recasts, coded correction |
| 6 | **Practice to automaticity** | Skill acquisition theory (DeKeyser), ACT-R | SRS, 4/3/2, timed retrieval, fluency drills |

**Design rule:** every unit must contain at least one activity for each of 1, 2, 3, 5, 6, and every *section* must contain at least four instances of 4.

---

## 2. The memory principles

### 2.1 Retrieval practice (the testing effect)
Trying to recall strengthens memory far more than re-reading or re-hearing. **Requirement:** the ratio of retrieval events to presentation events across a learner's session must be ≥ 3:1. A lesson that mostly *shows* the learner things is misdesigned.

### 2.2 Spacing
Distributed practice beats massed practice at every interval tested. **Requirement:** no item may be reviewed more than twice within a single session, and the SRS (doc 08) governs all subsequent exposure. "Practice this unit 10 times today" is an anti-feature.

### 2.3 Expanding retrieval
Intervals grow as the item strengthens; the first interval is short (minutes), later intervals are months. **Requirement:** implemented by FSRS-6 (doc 08).

### 2.4 Interleaving
Mixing item types and topics beats blocking them, despite feeling harder and producing worse in-session performance. **Requirement:** within any lesson, no more than 3 consecutive items may share the same target structure; review sessions must interleave grammar, lexis and phonology items.

### 2.5 Desirable difficulties
Conditions that slow acquisition but improve retention: spacing, interleaving, generation, varied contexts, testing. **Requirement:** the difficulty target for practice items is **p(correct) ≈ 0.85**, not 0.95. Success rates that are too high mean the learner is wasting time.

### 2.6 Generation effect
Producing the answer beats selecting it. **Requirement:** the proportion of *production* items (type, speak, transform) must rise with level: A1 ≥ 25%, A2 ≥ 35%, B1 ≥ 50%, B2 ≥ 60%, C1 ≥ 70%, C2 ≥ 80%. Multiple-choice and word-bank items are scaffolds to be removed, not the product.

### 2.7 Variability of context
Items met in a single context become context-bound. **Requirement:** ≥ 8 distinct contexts per lexeme before mastery (doc 04 §12.1); distinct speakers, distinct sentence frames, distinct topics.

### 2.8 Elaborative encoding
Meaning-rich, personally connected, multi-modal encoding outperforms rote. **Requirement:** every new lexeme has an image or a scene; from B1 the learner is regularly prompted to write one personal sentence using the item ("When did *you* last…?"). Personalised items show measurably better retention and must be prioritised by the scheduler.

### 2.9 Dual coding
Verbal + visual encoding is stronger than either alone. **Requirement:** images for concrete lexis; timelines for tense; diagrams for prepositions; colour-coding for sentence constituents (consistent across the product: subject / verb / object / adverbial).

### 2.10 Sleep and consolidation
Overnight consolidation is when durable memory forms. **Requirement:** the scheduler's first interval for new items is *always* ≥ 1 day for the second exposure; a "learn before bed" nudge is offered, opt-in; the app never optimises for cramming.

---

## 3. Attention, load and session design

### 3.1 Cognitive load
- **Intrinsic load** (the difficulty of the material itself) is managed by sequencing and the +1 rule.
- **Extraneous load** (interface, unclear instructions, split attention) must be minimised: no exercise may require reading instructions longer than 12 words; audio and its transcript must not be spatially separated; animations must never run during a comprehension task.
- **Germane load** (effort that builds schemas) is what we want: pattern-finding, self-explanation, error analysis.

### 3.2 Session architecture (the mandatory shape of a lesson)

```
1. WARM-UP        60–90 s   Easy items, p≈0.95. Rebuilds confidence and context.
2. REVIEW         2–3 min   Due SRS items, interleaved.
3. NEW INPUT      1–2 min   Encounter + noticing. No testing yet.
4. GUIDED         2–3 min   Controlled practice of the new item. p≈0.85.
5. INTEGRATION    1–2 min   New item mixed with old items. Interleaved.
6. PRODUCTION     1–2 min   Free-ish output: speak or type a sentence.
7. CLOSE          20 s      What you learned; what's next; one honest stat.
```
Total 8–12 minutes. **Never** open a session with the hardest content, and never close on a failure.

### 3.3 Attention span and micro-breaks
- Uninterrupted single-task attention degrades after ~10 minutes for most adults. Sessions are 5–12 min; longer sessions insert a 15-second break screen with a stretch/breathe prompt every 12 minutes.
- The app must **encourage stopping**. A gentle "good place to stop" appears after each node. Products that maximise session length maximise burnout.

### 3.4 The primacy–recency effect
The first and last items of a session are best remembered. **Requirement:** place the most important new item early, and the item with the weakest current stability last.

---

## 4. Motivation architecture

### 4.1 Self-determination theory — the three needs

| Need | What kills it | What the app must do |
|------|---------------|----------------------|
| **Autonomy** | Forced paths, no choices, guilt-based nudges | Choose topics, choose next unit among 2–3, choose session length, choose voice/accent, skip-ahead tests, editable goals, easy pause without punishment |
| **Competence** | Constant failure, or constant trivial success | Difficulty targeted at p≈0.85; visible mastery of *specific* things ("you can now talk about the past"); honest, granular progress |
| **Relatedness** | Isolation, anonymous leaderboards | Named cohorts, shared reading, human conversation, a recurring cast of characters, teacher/tutor presence |

### 4.2 Goal setting
- Learners set a **why** at onboarding (travel / work / exam / family / migration / study) and this **actually changes content selection**, not just a badge. A learner whose goal is nursing gets healthcare-weighted vocabulary in the optional slots.
- Goals are SMART, revisable, and split into daily (minutes), weekly (nodes + immersion), and level (exam).
- **Implementation intentions** beat goals: the app asks "When and where will you study?" and schedules a reminder for that exact context. This is one of the highest-effect-size, lowest-cost interventions in behaviour change.

### 4.3 The motivation curve and where learners quit

| Point | Risk | Mitigation |
|-------|------|------------|
| Day 1–3 | Onboarding friction, unclear value | Value in the first 90 seconds: the learner says a real sentence in minute one |
| Day 7 | Novelty gone | First "you can now do X" milestone; first story episode cliffhanger |
| Day 21–30 | Habit not yet formed | Streak insurance, adjusted goals, a check-in that asks *why* not *when* |
| A2→B1 | "I've learned a lot and still can't talk" | Immersion Engine introduction; conversation practice; the listening-cliff protocol |
| **B1 plateau** | **The biggest churn point in language learning.** Progress becomes invisible because gains are now in fluency and range, not new structures. | Explicit plateau education ("this is normal, here's what's actually improving"); switch primary metric from "new items" to "coverage, speed, and volume"; increase immersion share; celebrate first unassisted book/film |
| B2→C1 | Diminishing returns, no external need | Personalised domain content; real-world projects; certification goals |
| C1→C2 | Very long haul | Community, teaching others, creative production, professional application |

### 4.4 Intrinsic over extrinsic
Extrinsic rewards (points, gems) reliably **undermine** intrinsic motivation when they are the *reason* for the behaviour (overjustification effect). Therefore:
- Rewards are **informational** ("you kept a 30-day habit") not **controlling** ("earn 50 gems to unlock").
- Content is never gated behind a currency. Cosmetics and conveniences may be.
- The story, the books, the conversations are the reward. See doc 10 §8 for the ethical guardrails.

---

## 5. Individual differences the engine must accommodate

| Difference | Implication | Feature |
|------------|-------------|---------|
| **Aptitude** (phonemic coding, associative memory, inductive ability) | Rate varies 3–5× between learners | Adaptive pacing; never show comparative "you're behind" messaging |
| **Working memory** | Affects tolerance of long input and complex tasks | Adjustable input length; replay always available; chunked instructions |
| **Age** | Adults learn grammar/vocabulary faster; children get better ultimate pronunciation | Adult track emphasises explicit rules and analogy; Kids track emphasises input and play |
| **L1** | Determines the error profile (doc 14) | L1-specific difficulty weighting, contrast sets, false-friend flags |
| **Prior languages** | A learner who knows Russian and Uzbek has transferable metalinguistic skill | Onboarding asks; content leverages known cognates |
| **Learning goal** | Determines register and topic priorities | Goal-driven content weighting |
| **Anxiety** | The strongest affective predictor of speaking avoidance | Private practice, retakes, non-judgemental copy, text fallback |
| **Time available** | 5 min/day vs 2 h/day | Session length presets; the scheduler must degrade gracefully — with 5 min, do **reviews only**, never new material |
| **Literacy in L1 / Latin script familiarity** | Some learners need script training first | Optional Script Foundations module before Section 1 |
| **Accessibility needs** | | Full non-audio and non-visual paths (doc 00 §6) |

**"Learning styles" (visual/auditory/kinaesthetic) are not implemented**, because the matching hypothesis has failed every controlled test. Multi-modal presentation for *everyone* is implemented instead — which is what the evidence supports.

---

## 6. Error treatment

### 6.1 Error taxonomy (used for logging, feedback and remediation)

| Code | Type | Example |
|------|------|---------|
| `PHON` | Pronunciation — phoneme | */sɪp/* for *ship* |
| `STRS` | Word stress | *deVElop* → *DEvelop* |
| `PROS` | Intonation / nucleus placement | |
| `SPEL` | Spelling | *recieve* |
| `PUNC` | Punctuation | comma splice |
| `ART` | Article | *I went to the school yesterday* (meaning the institution) |
| `NUM` | Number/agreement | *three childs*, *he go* |
| `TNS` | Tense/aspect choice | *I have seen him yesterday* |
| `VF` | Verb form | *He didn't went* |
| `MOD` | Modality | *You must to go* |
| `PREP` | Preposition | *depend of* |
| `WO` | Word order | *I like very much it* |
| `WF` | Word form | *He is very success* |
| `WW` | Wrong word | *I made a photo* |
| `COLL` | Collocation | *strong rain* |
| `PV` | Phrasal verb form/separability | *turn on it* |
| `PRON` | Pronoun/reference | ambiguous *it* |
| `CONJ` | Connector choice | *Although… but…* |
| `REG` | Register mismatch | slang in a formal report |
| `PRAG` | Pragmatic failure | bare imperative request |
| `COH` | Cohesion/coherence | unlinked paragraphs |
| `FRAG` / `RO` | Fragment / run-on | |
| `L1` | L1 transfer / calque | *I have 20 years* |
| `OVG` | Overgeneralisation | *goed*, *sheeps* |
| `AVOID` | Avoidance (a hidden error) | never using relative clauses |

### 6.2 Correction policy by mode

| Situation | Correction | Technique |
|-----------|-----------|-----------|
| Accuracy drill | Immediate, explicit | Show correct form + 1-line why |
| Guided practice | Immediate, elicited first | "Try again" with a hint before revealing |
| Fluency speaking | **None during the task** | Log silently; deliver 2 items after |
| Free writing draft 1 | Content only | |
| Free writing draft 2 | Indirect, coded | |
| Roleplay with AI | Recast (reformulate correctly in the reply) + optional end-of-session summary | *Learner: "I go yesterday." → AI: "Oh, you **went** yesterday? What did you do?"* |
| Repeated error (3rd instance of a type) | Escalate to a Focus Clinic | |

### 6.3 What is *not* corrected
- Developmental errors that are ahead of the learner's stage (3rd-person -s at A1; article subtleties at A2) — flagged internally, surfaced later.
- Accent features that do not impede intelligibility.
- Regional variation the learner has chosen (UK vs US spelling, *have got* vs *have*).
- Anything in an unlabelled fluency task.

---

## 7. Focus Clinics (targeted remediation)

Triggered automatically when the error log shows a persistent pattern:
- **Trigger:** ≥ 5 instances of one error code within 14 days, **or** an SRS item with stability < 5 days after 6+ reviews (a *leech*), **or** a diagnostic sub-score < 60%.
- **Structure (7–10 min):** (1) show the learner their *own* three errors; (2) contrast with the correct forms; (3) the rule in ≤ 40 words; (4) discrimination task to 90%; (5) controlled production; (6) free production; (7) re-schedule with a shortened interval and a changed exercise type.
- **Changed exercise type is essential.** An item that is failing under `mcq` must be re-presented under `type_answer` or `dictation` — the failure is often of the presentation, not the memory.

---

## 8. Fossilisation prevention

Fossilisation happens when an incorrect form becomes automatic because it communicated successfully enough. The countermeasures, all required:

1. **Early accuracy on high-frequency forms.** Errors in *be*, plurals, questions and basic word order are corrected hard at A1–A2, when they are still malleable.
2. **Noticing the gap.** Learners compare their own recorded output against a model of the same content — the strongest known intervention. Implemented as: record → auto-transcribe → show model version → diff → re-record.
3. **Pushed output.** Tasks that cannot be completed with the learner's current simplified grammar.
4. **Avoidance detection.** The system tracks structures the learner has been taught but never uses in free production and creates tasks that require them. Avoidance is invisible to conventional scoring and is a major cause of the intermediate plateau.
5. **Periodic accuracy audits.** Every 8 weeks, a free-production sample is analysed for error density and error types, and the trend is shown to the learner.
6. **The fossilisation watchlist** (doc 01 §4) is monitored per learner with dedicated interventions.

---

## 9. Metacognition and learner training

Explicitly taught, in-app, as short "How to learn" modules:

| Module | Level | Content |
|--------|-------|---------|
| How memory works | A1 | Forgetting curve, why reviews are spaced, why cramming fails |
| How to set a habit | A1 | Implementation intentions, cue-routine-reward, restarting after a break |
| How to learn a word properly | A2 | The 18 aspects, why translation pairs are not enough |
| How to listen | A2 | Tolerating ambiguity, not stopping at an unknown word |
| How to read extensively | A2 | Choosing easy books, not looking words up |
| How to practise speaking alone | B1 | Shadowing, self-talk, recording |
| How to notice your own errors | B1 | Self-transcription |
| Understanding the plateau | B1 | What is actually improving when nothing seems to |
| How to use feedback | B1 | Self-correction before reading the answer |
| How to build a personal corpus | B2 | Harvesting from your own reading |
| How to study for an exam | B2 | Task familiarity vs language gain |
| How to keep a language for life | C1 | Maintenance regimes, attrition, re-activation |

---

## 10. What this engine explicitly refuses to do

- **No grammar-translation as the primary method.** L1 is a scaffold at A1–A2 and a mediation *skill* at B1+, never the medium of instruction.
- **No silent decontextualised word lists.** Every item is met in use.
- **No progress that is not earned.** Skipping is allowed via a test-out, never via payment.
- **No "learn a language in 15 minutes a day to fluency" claim.** 15 minutes a day for 5 years is ~450 hours — B1/B2, not C2. The app says so.
- **No punishment-driven engagement.** See doc 10 §8.
- **No learning-styles matching, no "photographic memory" claims, no neuro-myths** (left/right brain, 10% of the brain, critical period as an absolute bar for adults).
