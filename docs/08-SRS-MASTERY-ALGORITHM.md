# 08 — SPACED REPETITION & MASTERY ALGORITHM
## Memory model, scheduling maths, item states, session composition

---

## 1. Why this is the core of the product

The tree, the streak and the animations are the interface. **The scheduler is the product.** It decides what the learner sees, when, and therefore what they remember in five years. Everything else can be rebuilt; a badly designed memory model wastes every hour the learner spends.

---

## 2. The memory model: FSRS-6 (DSR)

The scheduler implements the **Free Spaced Repetition Scheduler**, currently at **FSRS-6** with 21 trainable parameters, based on the three-component DSR model.

| Component | Symbol | Range | Meaning |
|-----------|--------|-------|---------|
| **Difficulty** | `D` | [1, 10] | How hard this item is for this learner |
| **Stability** | `S` | days, > 0 | The interval at which recall probability has decayed to 90% |
| **Retrievability** | `R` | [0, 1] | Probability of successful recall right now |

### 2.1 Forgetting curve

FSRS-6 uses a power-law forgetting curve with a **trainable decay** parameter:

```
R(t, S) = (1 + FACTOR · t / S) ^ (−w₂₀)

where  FACTOR = 0.9^(−1/w₂₀) − 1
```

This construction guarantees `R(S, S) = 0.9` — i.e. stability is by definition the interval to 90% recall. The power law fits real review data substantially better than the classical exponential `R = e^(−t/S)`; forgetting slows down over time rather than decaying at a constant hazard.

### 2.2 Interval from desired retention

Solving the curve for `t`:

```
I(S, R_d) = (S / FACTOR) · (R_d^(−1/w₂₀) − 1)
```

`R_d` is the **desired retention** (default **0.90**). Lower `R_d` → longer intervals → fewer reviews but more forgetting. `R_d` is exposed per learner as three presets:

| Preset | R_d | Effect |
|--------|-----|--------|
| Relaxed | 0.85 | ~30% fewer reviews, more forgetting |
| Balanced (default) | 0.90 | |
| Thorough | 0.94 | ~50% more reviews, higher retention |

Exam mode temporarily raises `R_d` to 0.95 for items in the exam's scope.

### 2.3 Grades

Four grades, mapped from the app's interactions:

| Grade | G | Learner behaviour |
|-------|---|-------------------|
| Again | 1 | Wrong answer, or timed out |
| Hard | 2 | Correct but slow (RT > 2.5× median), or correct after using a hint |
| Good | 3 | Correct within normal time |
| Easy | 4 | Correct and fast (RT < 0.6× median), or explicitly marked "too easy" |

**RT normalisation is per exercise type and per learner** — a `type_answer` item legitimately takes longer than an `mcq`. Never compare raw times across types.

### 2.4 Initial state (first review)

```
S₀(G) = w_{G−1}                     # w₀..w₃ are the initial stabilities for grades 1..4
D₀(G) = w₄ − e^{w₅·(G−1)} + 1       # clamped to [1, 10]
```

### 2.5 Difficulty update

```
ΔD(G)  = −w₆ · (G − 3)
D'     = D + ΔD(G) · (10 − D) / 9            # linear damping: hard items resist further hardening
D''    = w₇ · D₀(4) + (1 − w₇) · D'          # mean reversion toward the "easy" anchor
D_next = clamp(D'', 1, 10)
```

### 2.6 Stability after a successful review (G ≥ 2)

```
S_next = S · ( 1
             + e^{w₈}
               · (11 − D)
               · S^{−w₉}
               · (e^{w₁₀·(1−R)} − 1)
               · h(G)                     # h = w₁₅ if G=2 (hard), else 1
               · b(G)                     # b = w₁₆ if G=4 (easy), else 1
             )
```

Three properties fall out of this and are the reasons FSRS beats SM-2:
- **Higher difficulty → smaller stability gain** (the `11 − D` term).
- **Higher current stability → smaller relative gain** (the `S^{−w₉}` term): memory saturates.
- **Lower retrievability at review time → larger gain** (the `e^{w₁₀(1−R)}` term): this is the *spacing effect*, formalised. Reviewing an item you almost forgot is worth far more than reviewing one you know cold.

### 2.7 Stability after a lapse (G = 1)

```
S_fail = min( w₁₁ · D^{−w₁₂} · ((S + 1)^{w₁₃} − 1) · e^{w₁₄·(1−R)} ,  S )
```
Post-lapse stability is *not* reset to zero — an item you have known for a year and just forgot is still stronger than a brand-new one. Resetting to zero (SM-2's behaviour) is the single biggest source of wasted review time in legacy systems.

### 2.8 Same-day reviews

Short-term reviews within the same day use the short-term stability update (`w₁₇`, `w₁₈`, `w₁₉`):
```
S_short = S · e^{ w₁₇ · (G − 3 + w₁₈) } · S^{−w₁₉}
```
Same-day repetition is capped at **2 per item per day** (doc 07 §2.2).

### 2.9 Parameters

Ship with FSRS-6 default weights `w₀…w₂₀`. Then:
- **Per-cohort optimisation** once ≥ 200,000 reviews exist for a cohort (L1 × level).
- **Per-learner optimisation** once that learner has ≥ 1,000 reviews, refitted monthly by minimising log-loss / RMSE of predicted vs actual recall.
- **Per-item-type parameter sets** — vocabulary, grammar and phonology items have measurably different memory dynamics and get separate parameter vectors.

### 2.10 Fuzz and load balancing

- Apply **interval fuzz** of ±5% (min ±1 day) to prevent items learned together from clumping forever.
- **Daily load balancing:** if a day's projected due count exceeds the learner's declared capacity by > 20%, shift the least-urgent items (highest `R`) forward by up to 15% of their interval. Never shift an item to a date where `R` would fall below `R_d − 0.08`.
- **Backlog handling:** after an absence, do **not** dump 800 items on the learner. Cap the daily queue at 1.5× their normal load, prioritise by `1 − R` (most-forgotten first) weighted by item importance (frequency band), and show an honest "catching up: 6 days left" indicator.

---

## 3. Item types in the scheduler

Every schedulable thing is a **memory item** with its own DSR state. One lexeme generates several memory items — this is essential and is what most apps get wrong.

| Item kind | ID pattern | What is retrieved | Example prompt |
|-----------|-----------|-------------------|----------------|
| `lex.recog` | `lex.03421.recog` | L2 form → meaning | *run a business* → choose the meaning |
| `lex.recall` | `lex.03421.recall` | meaning → L2 form | "to manage a business" → type *run* |
| `lex.aural` | `lex.03421.aural` | sound → meaning | hear it, choose meaning |
| `lex.spell` | `lex.03421.spell` | sound → written form | dictation of the word |
| `lex.produce` | `lex.03421.prod` | meaning → spoken form | say a sentence using it |
| `lex.coll` | `lex.col.0881` | collocation completion | *heavy ___* |
| `gram.form` | `gram.G-107.form` | produce the form | *I ___ (never/be) to Japan.* |
| `gram.choice` | `gram.G-107.choice` | choose between contrasted forms | past simple vs present perfect |
| `gram.transform` | `gram.G-107.trans` | rewrite a sentence | active → passive |
| `gram.judge` | `gram.G-107.judge` | grammaticality judgement | is this correct? |
| `phon.discrim` | `phon.P-014.disc` | minimal-pair identification | hear */ʃɪp/*, tap *ship* |
| `phon.produce` | `phon.P-014.prod` | articulate | record *ship* |
| `chunk` | `func.F-023.ex07` | produce a functional exponent | "Ask politely for the salt." |
| `listen.decode` | `skill.listen.####` | connected-speech decoding | transcribe *"whaddaya wanna do"* |

**Progression rule:** `recog` unlocks first; `aural` at the same time; `recall` after `recog` reaches S ≥ 7 d; `spell` after `recall` S ≥ 7 d; `produce` after `recall` S ≥ 21 d. An item's *lexeme-level* mastery is the **minimum** stability across its required memory items — not the maximum, and not the average. This prevents the classic illusion where a learner "knows" 5,000 words they can only recognise.

---

## 4. Mastery model

### 4.1 States

| State | Definition | Learner-facing name |
|-------|-----------|---------------------|
| `unseen` | Never presented | — |
| `learning` | Introduced, S < 1 day | Learning |
| `young` | 1 d ≤ S < 21 d | Getting there |
| `retained` | 21 d ≤ S < 180 d | Known |
| `durable` | S ≥ 180 d | Strong |
| `leech` | ≥ 6 reviews and S < 5 d | Needs a different approach |
| `suspended` | Manually or automatically paused | Paused |
| `retired` | S ≥ 365 d and D ≤ 4 | Mastered |

### 4.2 Level mastery
A level is `complete` when (doc 00 §7): ≥ 95% of its syllabus items are ≥ tier 2, ≥ 85% of its memory items are `retained` or better, the level exam passes, and the production tasks pass. Item counts per level come from docs 02–06.

### 4.3 Node tiers
Each node is played up to 3 times:

| Tier | Name | Composition | Pass criterion |
|------|------|-------------|----------------|
| 1 | Introduce | 60% new material, heavy scaffolding, mostly recognition | ≥ 70% correct |
| 2 | Consolidate | 30% new, mixed recognition and recall, scaffolding reduced | ≥ 80% correct, ≤ 2 hints |
| 3 | Stretch | 0% new, recall and production only, timed, interleaved with earlier units | ≥ 85% correct, no hints |

Tier 3 is available only after ≥ 3 days have passed since tier 2 (spacing enforced structurally).

---

## 5. Session composition algorithm

Given a learner state and a requested session length `T` minutes:

```
1. Compute the due queue Q = { items where R(t) ≤ R_d }, sorted by priority:
      priority = (1 − R)                        # urgency
                 × importance(item)             # frequency band, 0.5–1.5
                 × (1 + 0.3·is_leech)
                 × (1 + 0.2·in_current_level)
2. Budget:
      T ≤ 5 min   → 100% review, 0% new     (never introduce with no time to consolidate)
      T = 6–10    → 70% review, 30% new
      T = 11–20   → 60% review, 40% new
      T > 20      → 55% review, 45% new, and insert a 15 s break every 12 min
   Hard cap: new items ≤ 15 per day at A1–A2, ≤ 20 at B1+, and ≤ 0 if the backlog > 3× normal.
3. Fill the review block from Q, enforcing interleaving:
      – no more than 3 consecutive items sharing a target ID
      – no more than 2 consecutive items of the same exercise type
      – rotate modality: read / listen / type / speak in a repeating pattern
4. Fill the new block from the current node's item list, in syllabus order.
5. Warm-up: prepend 2 items with predicted p(correct) ≥ 0.95.
6. Close: append the item with the lowest stability among those just reviewed (recency effect).
7. Predict total time:  Σ expected_seconds(item_type, learner_median_RT); trim to fit T ± 10%.
```

### 5.1 Exercise-type selection for a given memory item
An item is not bound to one exercise type. Select by:
```
if state == learning      → recognition types (mcq, match, tap_pairs)
elif state == young       → recall types (type_answer, word_bank, gap_fill)
elif state == retained    → production types (translate_to_L2, speak, transform)
elif state == leech       → a type NOT used in the last 3 failures (forced variation)
```
And never present the same memory item with the same exercise type twice in a row.

---

## 6. Knowledge tracing (predicting what the learner knows)

FSRS models *memory of an item*. A second model estimates *mastery of a skill*, which is what powers placement, the adaptive path and the "you're ready for the exam" signal.

### 6.1 Model
- **Baseline:** Bayesian Knowledge Tracing per syllabus item (parameters: p(init), p(learn), p(guess), p(slip)), with `p(guess)` set from the exercise type's chance level (0.25 for 4-option MCQ, ~0.02 for free typing). BKT is interpretable and cheap and should ship first.
- **v2:** an IRT/Elo hybrid for the placement test (fast, well-calibrated), and a DKT/SAKT sequence model for the path, used **only** for recommendation, never for gating. Any gate must be explainable to the learner.

### 6.2 Item difficulty calibration
Every content item carries an empirically-estimated difficulty `b` (IRT 2PL) refitted weekly from response data, plus a discrimination parameter `a`. Items with `a < 0.4` (they don't distinguish strong from weak learners) or `p(correct) > 0.97` or `< 0.25` are flagged for content review. This is how the item bank stays healthy at scale.

### 6.3 Cold start
A brand-new learner has no data. Priors come from: placement CAT result → L1 → prior languages declared → age band → self-declared goal. Prior FSRS parameters are the cohort mean for (L1, level).

---

## 7. Leeches and stuck items

**Detection:** `reviews ≥ 6 AND S < 5 days`, or 4 lapses in 30 days.

**Escalation ladder:**
1. **Change the exercise type** (most failures are presentation failures).
2. **Add a mnemonic** — auto-suggest a keyword mnemonic or let the learner write one; learner-authored mnemonics improve retention substantially and are stored on the item.
3. **Add an image** or a distinctive personal example sentence.
4. **Split the item** — a leech is often two senses fused into one card.
5. **Contrast it** with the item it is being confused with (the system detects the confusion from wrong answers) and run a discrimination drill.
6. **Focus Clinic** (doc 07 §7).
7. **Suspend and requeue** at a later level if the item is above the learner's current stage — some items are simply not learnable yet, and grinding them is a waste. Tell the learner this honestly: "Let's come back to this one later."

**Never:** delete the item silently, or let it consume more than 5% of a session's time.

---

## 8. Interference management

Two items that are similar in form or meaning interfere with each other when learned close together.

- **Detection:** compute an interference score between items — orthographic (Levenshtein ≤ 2), phonological (edit distance on phoneme strings ≤ 2), semantic (same lexical set + antonym/co-hyponym relation).
- **Rule:** items with interference score > threshold may not be introduced in the same session, and must be ≥ 3 nodes apart. Applies to *left/right, borrow/lend, teach/learn, bring/take, lie/lay, affect/effect, desert/dessert, quiet/quite,* colour sets, day-name sets, number sets, and opposite pairs.
- **Later, deliberately:** once both are individually `retained`, a **discrimination clinic** contrasts them directly. Contrast is harmful during acquisition and essential after it.

---

## 9. Retention audit (the honesty mechanism)

Once a month, the app runs a **surprise retention check**: 20 items sampled from `retained` and `durable` states, presented cold, outside the normal schedule. The result is compared to the model's prediction.

- If actual recall is materially below predicted (e.g. predicted 90%, actual 74%), the learner's parameters are refit and `R_d` is raised.
- The result is shown to the learner as a *true* retention figure. This is the number that makes the vocabulary count honest.
- Aggregate results across learners are the primary quality metric for the scheduler (doc 15 §7).

---

## 10. Offline and sync

- The client holds the next 7 days of scheduled items plus the next 5 units' content.
- Reviews performed offline are stored with their true timestamps and replayed in order on reconnect; the server recomputes state deterministically from the review log, never from client-computed state.
- The review log is **append-only and immutable** — it is the source of truth for all memory state and can be replayed to rebuild everything after any algorithm change. This is what makes it safe to upgrade from FSRS-6 to whatever comes next: re-derive every learner's state from their raw history.

---

## 11. What we deliberately do not do

- **No SM-2.** It ignores retrievability at review time, resets stability on lapse, and needs far more reviews for the same retention.
- **No fixed Leitner boxes.** Fine for paper, wasteful in software.
- **No "review everything every day."** That is cramming with extra steps.
- **No streak-driven scheduling.** The schedule serves memory, not engagement. If a learner has no due items, the honest answer is "nothing is due today — go read something."
- **No hidden difficulty inflation** to drive session length or purchases.
