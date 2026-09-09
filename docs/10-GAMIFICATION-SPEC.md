# 10 — GAMIFICATION SPECIFICATION
## The motivation layer: mechanics, economy, social features, and the ethical guardrails

The brief for this product is "learn English by playing, matching the Duolingo app." This document takes that seriously — and specifies where to copy, where to improve, and where copying would be a mistake.

---

## 1. Design position

Gamification is a **retention technology**, not a learning technology. It gets the learner to open the app; the pedagogy engine (doc 07) determines whether that time produces English. The two must never be in conflict, and when they are, **pedagogy wins**. Concretely: no mechanic may cause a learner to review something the scheduler would not have chosen, to stop when the scheduler says continue, or to continue when the scheduler says stop.

Three tests every proposed mechanic must pass:
1. **Learning test** — does it increase time-on-task *on the right task*?
2. **Autonomy test** — does it inform, or does it coerce? (doc 07 §4.1)
3. **Honesty test** — does the number it shows mean what the learner thinks it means?

A mechanic failing any test is cut.

---

## 2. What Duolingo currently does (as of Sept 2026), and our position on each

| Mechanic | Duolingo's current form | Our decision |
|----------|------------------------|--------------|
| **Hearts → Energy** | Replaced hearts with **Energy**: the learner starts with ~25 units, **every question costs 1 unit whether right or wrong**, refills come from time, ad-watching, correct-answer streaks, practice, or 750 gems for a full refill; Super/Max subscribers get unlimited | **Reject.** A daily cap that spends down even on correct answers converts the app from a learning tool into a metered utility and punishes the most engaged learners. We ship **no consumable that gates learning.** |
| **Hearts (the older model)** | 5 hearts, lose one per mistake, refill by time or gems | **Reject as a gate**, adopt as an *optional* self-challenge mode ("Perfectionist Mode") with no purchase path |
| **Streak** | Daily streak, streak freezes, streak society | **Adopt, heavily modified** — see §5 |
| **XP** | Points per lesson, XP boosts, double-XP events | **Adopt with a redefinition** — XP measures *effort on scheduled work*, not raw taps |
| **Leagues** | Weekly XP leaderboards with promotion/relegation | **Adopt as opt-in only, cooperative by default** — see §6 |
| **Daily quests / friend quests** | Rotating micro-goals | **Adopt** |
| **Gems / currency & shop** | Earn and spend on refills, freezes, cosmetics | **Adopt for cosmetics and conveniences only.** Never for content, never for lives |
| **Streak freeze purchase** | Buyable | **Free, and automatic** — see §5 |
| **Widgets, notifications, push** | Aggressive, guilt-toned ("You made Duo sad") | **Adopt the mechanic, reject the tone** — see §7 |
| **Stories / audio lessons / video call** | Narrative and conversational practice | **Adopt and expand** — this is the highest-value part (doc 06 §7) |
| **Leaderboards visible by default** | Yes | **No** — opt-in |

---

## 3. XP: what it measures

XP must be a proxy for *learning done*, not for *screen time*. Formula:

```
XP(session) = Σ_items  base(type) × difficulty_mult × novelty_mult × mode_mult
```

| Factor | Values |
|--------|--------|
| `base(type)` | recognition 1 · recall 2 · production 3 · speaking 4 · writing (per 50 words) 6 · extensive reading (per 1,000 words) 10 · extensive listening (per 10 min) 10 |
| `difficulty_mult` | 0.5 if predicted p(correct) > 0.95 (too easy to be worth much) · 1.0 normal · 1.5 if p < 0.7 |
| `novelty_mult` | 1.0 for scheduled work · **0.25 for re-grinding already-mastered content** |
| `mode_mult` | 1.0 default · 1.25 timed mode · 1.25 no-hints |

The `novelty_mult` of 0.25 is deliberate and important: it removes the incentive to farm XP by replaying easy old lessons, which is the dominant XP-optimal strategy in competing products and is close to worthless for learning.

**Immersion earns XP.** Reading a chapter and listening to a podcast must be worth more XP than tapping through an easy lesson, because they are worth more to the learner. This single decision aligns the game with the syllabus.

---

## 4. Progression and the path

| Element | Spec |
|---------|------|
| **Path** | Linear spine with optional side-branches; 2–3 units visible ahead, the rest greyed |
| **Node types** | Lesson · Story · Speak · Review (personalised SRS) · Clinic (remediation) · Checkpoint (test) · Immersion (reading/listening) |
| **Tiers** | Each node has 3 tiers (doc 08 §4.3); the node ring fills 1/3 per tier |
| **Unit completion** | All 8 nodes at tier ≥ 2 |
| **Section completion** | All units complete + section checkpoint passed |
| **Test-out** | Any unit or section may be skipped by passing its test at ≥ 85%. Free, unlimited, and prominently offered — a learner made to grind content they already know will quit |
| **Branching** | From B1, each unit offers a choice of 2 topic variants (e.g. "Work" or "Study") covering the same syllabus items — autonomy without curriculum divergence |
| **Personal path** | From B1.2, up to 25% of nodes are generated from the learner's own error log and harvested vocabulary |

### 4.1 Progress display — the honesty requirement
The primary progress metric shown to the learner is **not** XP or nodes. It is:

> **"You can now understand about 87% of everyday conversation."**
> Vocabulary: 2,340 words known · Coverage: 87% spoken / 79% written
> Level: B1.1 — 62% complete · Estimated: 34 hours to B1.2

Secondary: streak, XP, league. Tertiary: badges.
Putting coverage first is the single most important anti-vanity-metric decision in the product.

---

## 5. Streaks — adopted, with the cruelty removed

Streaks work. They also cause genuine distress, and streak loss is one of the top reasons users abandon language apps entirely (having lost a 400-day streak, the sunk cost is gone and so are they).

| Rule | Spec |
|------|------|
| **Daily goal** | Learner-set: 5 / 10 / 20 / 40 minutes, changeable any time, no penalty for lowering |
| **What counts** | Any scheduled work: lessons, reviews, immersion minutes, writing, speaking |
| **Streak freeze** | **Free and automatic.** 2 held at all times, regenerating one every 5 days. No purchase path, ever |
| **Weekend/rest days** | Learner may designate up to 2 rest days per week that never break the streak |
| **Streak repair** | A broken streak can be repaired within 48 h by completing a double session — free, once per month |
| **Illness/holiday mode** | Pause the streak for up to 30 days, self-declared, no questions |
| **Streak display** | Shown, celebrated at milestones (7, 30, 100, 365), never used in a guilt message |
| **What a streak is *not*** | It is never a gate on content, never a leaderboard input, never required for a certificate |

**Copy rule:** the app never says the learner has disappointed anyone or anything. Streak-loss copy is: *"Your streak reset. That's fine — 41 days of learning didn't disappear. Ready to start the next one?"*

---

## 6. Social layer

| Feature | Spec | Default |
|---------|------|---------|
| **Friends** | Add by code/contact; see activity, not scores | On |
| **Cohorts** | 20–40 learners at the same level who started the same month; persistent, named, with a shared reading goal | On |
| **Cooperative challenges** | "Our cohort reads 500,000 words this month" — aggregate, no individual ranking | On |
| **Leagues (competitive)** | Weekly XP ladder, 30 people, promotion/relegation, 10 tiers | **Off by default; opt-in** |
| **Book club** | Monthly shared book with discussion threads (B2+) | Opt-in |
| **Conversation matching** | Pair with a peer at ±1 sub-level for a 15-min structured task | Opt-in |
| **Teach-back** | A C1 learner explains a point to a B1 learner (the protégé effect is a real and large learning gain for the explainer) | Opt-in |
| **Public leaderboards of individuals** | — | **Never shipped** |

**Why competitive leagues are opt-in:** they reliably increase short-term engagement and reliably damage intrinsic motivation and wellbeing for a substantial minority, and they push learners toward XP-optimal rather than learning-optimal behaviour. Offering them is fine; defaulting them on is not.

---

## 7. Notifications

| Rule | Spec |
|------|------|
| Frequency cap | Max 1 push/day by default, 2 if the learner opts up; hard cap 3 |
| Timing | Learned from the learner's actual session times; plus the implementation-intention slot they chose at onboarding (doc 07 §4.2) |
| Quiet hours | Learner-set; default 21:00–08:00 local |
| Escalation | Never. If a learner ignores 5 consecutive notifications, **reduce** frequency to weekly and send one message asking whether they want to pause |
| Tone | Warm, specific, useful. *"You've got 12 reviews due — about 4 minutes."* **Never** guilt, shame, passive aggression, fake urgency, or anthropomorphic disappointment |
| Content | Prefer *value* over *obligation*: a new story episode, a word they can now understand, a podcast matched to their level |
| Unsubscribe | One tap, honoured immediately, never dark-patterned |

---

## 8. Ethical guardrails (binding, not aspirational)

1. **No content behind a consumable.** Learning is never gated by hearts, energy, lives or currency. Ever.
2. **No dark patterns.** No fake scarcity, no countdown timers on purchase decisions, no confirm-shaming ("No thanks, I don't want to learn"), no hidden subscription renewals, no obstacle-course cancellation.
3. **No manufactured anxiety.** No mechanic whose motive force is fear of loss beyond a streak the learner can freely protect.
4. **No engagement metric in the pedagogy loop.** The scheduler's objective function is retention of English, never session length or DAU.
5. **No comparison by default.** Nobody is shown as behind anyone else.
6. **Honest numbers.** Every displayed number means what a reasonable person would think it means. "2,340 words known" must survive a surprise retention audit (doc 08 §9). If it doesn't, the number is wrong and must be changed, not defended.
7. **Honest timelines.** The app tells learners how long C2 actually takes (doc 00 §3.2), at onboarding, before payment.
8. **Minors.** Under-18 accounts: no leagues, no purchases, stricter notification caps, no social matching with adults.
9. **Data.** Voice recordings and writing samples are the learner's; exportable, deletable; never used for model training without explicit, separate, revocable opt-in.
10. **Exit.** Full data export in an open format, and a real "delete everything" that deletes everything.

---

## 9. Economy

| Element | Spec |
|---------|------|
| **Currency** | Gems, earned only (not the primary purchase driver) |
| **Earn rates** | Daily goal met: 10 · Quest complete: 15 · Unit complete: 30 · Checkpoint passed: 60 · Weekly immersion goal: 50 |
| **Spend** | Cosmetics (themes, avatars, path skins) · Convenience (extra AI roleplay minutes, priority tutor booking) · Charity conversion (donate gems to fund free accounts) |
| **Never spendable on** | Content, hearts/energy (none exist), streak freezes (free), test attempts, certificates |
| **Subscription (Premium)** | Removes ads · unlimited AI conversation minutes · full offline library · detailed analytics · human-graded writing (4/month) · early access to new sections. **Every syllabus item, every lesson, every review and every test is in the free tier.** |
| **Free tier viability** | A learner who never pays must be able to reach C2. This is a product requirement, not a marketing line. Monetise depth of service, not access to the language |

---

## 10. Quests, badges and celebration

- **Daily quests** (3, rotating): "Complete 2 reviews", "Speak for 2 minutes", "Read 500 words", "Get 8 items right in a row", "Finish a story". Generated from what the scheduler wants the learner to do anyway.
- **Weekly quests** (2, larger): immersion volume, a writing task, a clinic.
- **Badges** — awarded for *capabilities*, not activity: "Ordered a meal", "Told a story in the past", "Argued a position", "Read your first unsimplified book", "Understood a native-speed conversation". These are the CEFR can-do statements as achievements, which makes the badge system and the syllabus the same object.
- **Celebration moments** must be rare enough to mean something: unit complete (small), section complete (large), level achieved (largest, with a shareable certificate), first book finished, first 30-minute conversation.
- **Anti-pattern:** confetti on every correct answer. It stops meaning anything within a week and adds latency to every item.

---

## 11. Onboarding (first 5 minutes — the highest-stakes screen sequence)

```
1. "Why do you want English?"            → sets content weighting, not just a badge
2. "What's your first language?"          → sets L1 glosses, contrastive content (doc 14)
3. "Do you know any English already?"     → routes to placement CAT or to Section 1
4. [Placement CAT, 8–12 min, adaptive]    → skippable
5. "How much time per day?"               → sets the daily goal honestly
6. "When and where will you study?"       → implementation intention + notification slot
7. HONEST EXPECTATION SCREEN:
   "At 20 minutes a day, you'll reach B1 in about 3 years and C2 in about 10.
    At 60 minutes a day: B1 in about a year, C2 in about 3.
    We'll show you real progress either way."
8. FIRST LESSON — the learner says a real English sentence out loud within 90 seconds.
```

Step 7 loses some installs and keeps far more learners. It is also true, which is the main argument for it.

---

## 12. Anti-patterns explicitly banned

| Anti-pattern | Why |
|--------------|-----|
| Energy/hearts gating lessons | Punishes engagement; converts learning into a metered resource |
| XP for replaying trivial content | Rewards the worst learning strategy |
| Guilt-based push notifications | Effective short-term, corrosive long-term, and unkind |
| Leaderboards by default | Turns a personal journey into a competition most people lose |
| "Fluent in 3 months" claims | False, and the discovery of the falsehood causes churn and distrust |
| Confetti on every tap | Devalues celebration, adds latency |
| Streak-loss as a monetisation lever | Monetising distress |
| Hiding the cancel button | |
| Word counts that don't survive a retention test | Lying with numbers |
| Auto-playing ads between exercises | Destroys the session's cognitive continuity |
| Requiring a microphone or camera to progress | Excludes learners in shared spaces and with disabilities |
