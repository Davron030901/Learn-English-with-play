# 04 — LEXIS SPECIFICATION
## Vocabulary: how much, which words, in what order, and what "knowing" one means

---

## 1. Size targets

### 1.1 Headline table

| Level | New lexemes taught | Cumulative **productive** | Target **receptive** | Text coverage achieved |
|-------|-------------------:|--------------------------:|---------------------:|-----------------------:|
| A1 | 800 | 800 | 1,200 | ~72% of everyday speech |
| A2 | 1,000 | 1,800 | 3,000 | ~85% of everyday speech |
| B1 | 1,700 | 3,500 | 6,000 | ~92% of general text |
| B2 | 2,500 | 6,000 | 10,000 | ~95% of general text |
| C1 | 3,000 | 9,000 | 15,000 | ~98% of general text |
| C2 | 3,000 | 12,000 | 20,000+ | ~99% of general text |

Plus, counted separately (they are learned as units, not as words):

| Level | Collocations | Phrasal verbs | Idioms & fixed expressions | Chunks/formulae |
|-------|-------------:|--------------:|---------------------------:|----------------:|
| A1 | 150 | 8 | 20 | 120 |
| A2 | 400 | 30 | 60 | 250 |
| B1 | 1,000 | 80 | 150 | 450 |
| B2 | 1,800 | 150 | 300 | 650 |
| C1 | 2,800 | 220 | 500 | 850 |
| C2 | 3,500 | 300 | 800 | 1,000 |

*(Figures are cumulative.)*

### 1.2 Why these numbers — the coverage arithmetic

Comprehension requires **95% lexical coverage** for adequate understanding with support, and **98%** for unassisted reading (Nation, Laufer, Hu). Coverage as a function of vocabulary size (word families, general English):

| Word families known | Coverage of general written text | What that feels like |
|--------------------:|---------------------------------:|----------------------|
| 1,000 | 78–80% | 1 unknown word in 5 — incomprehensible |
| 2,000 | 86–88% | 1 in 8 — exhausting, needs a dictionary constantly |
| 3,000 | 90% | 1 in 10 — the "intermediate wall" |
| 5,000 | 95% | 1 in 20 — readable with effort; **the B2 threshold** |
| 8,000 | 97% | 1 in 33 — comfortable |
| 9,000–10,000 | 98% | 1 in 50 — **unassisted reading; the C1 threshold** |
| 15,000–20,000 | 99%+ | native-adult-like range |

For **spoken** English the numbers are kinder: 3,000 families ≈ 95% of conversation, 6,000 ≈ 98%. This is why listening comprehension of casual speech arrives earlier than reading of journalism — and why the app must not let learners conclude from easy conversation that they are ready for *The Economist*.

**Product consequence:** the learner-facing progress screen shows *coverage*, not raw word count — "You now understand about 92% of a typical news article" is motivating and true; "4,214 words learned" is neither.

---

## 2. What counts as "one word"

The unit of teaching is the **lexeme**: a lemma in one sense, with its own record.

- *bank* (financial) and *bank* (river) are **two lexemes**, taught at different levels.
- *run* has 12 taught senses spread A1→C1 (*run a race* A1 → *run a business* B1 → *run a risk* B2 → *in the long run* B2 → *run in the family* C1).
- **Word family** is used only for reporting size (following Nation's Level 6 family definition: base + inflections + the most frequent, transparent derivations).
- **Multiword items** (*give up*, *by the way*, *heavy rain*) are lexemes in their own right, not derived from their parts.

### 2.1 Nation's framework: the 18 aspects of knowing a word

Every lexeme record must eventually be taught and tested across these. The app tracks a per-aspect mastery vector.

| Dimension | Aspect | Receptive question | Productive question |
|-----------|--------|--------------------|---------------------|
| **Form** | Spoken | What does it sound like? | How is it pronounced? |
| | Written | What does it look like? | How is it written and spelled? |
| | Word parts | What parts are recognisable? | What parts are needed to express the meaning? |
| **Meaning** | Form–meaning | What meaning does this form signal? | What form expresses this meaning? |
| | Concept & referents | What is included in the concept? | What can the concept refer to? |
| | Associations | What other words does it make us think of? | What other words could we use instead? |
| **Use** | Grammatical functions | In what patterns does it occur? | In what patterns must we use it? |
| | Collocations | What words or types occur with it? | What words must we use with it? |
| | Constraints (register, frequency) | Where, when and how often would we meet it? | Where, when and how often can we use it? |

**Minimum for "taught" status:** spoken form, written form, form–meaning (both directions), one collocation, one grammatical pattern.
**Minimum for "mastered":** all of the above plus productive use in a free task, plus SRS stability ≥ 60 days.

---

## 3. Selection: which words, and why

### 3.1 Sources (in priority order)

1. **Frequency lists** — NGSL (New General Service List, 2,800 words ≈ 92% of general English), NAWL (New Academic Word List), BNC/COCA frequency bands, the SUBTLEX spoken-frequency lists (better than written frequency for conversation).
2. **CEFR-tagged inventories** — English Vocabulary Profile (EVP), English Grammar Profile (EGP), Global Scale of English learning objectives.
3. **Topic/functional need** — some low-frequency words are indispensable early (*passport, allergy, receipt*).
4. **Learner corpora** — words that L2 learners at each level actually attempt to use (and get wrong).
5. **Dispersion, not just raw frequency** — a word appearing 500 times in one text is less useful than one appearing 200 times across 200 texts. Rank by Juilland's D or Gries' DP.

### 3.2 Selection rules

- **Rule 1 — frequency floor per level:** a word may not be introduced more than one band above the current level. Bands: A1 ≤ 1,000; A2 ≤ 2,000; B1 ≤ 4,000; B2 ≤ 8,000; C1 ≤ 14,000; C2 unbounded.
- **Rule 2 — spoken-frequency bonus:** for A1–B1, weight SUBTLEX (spoken) frequency at 1.5× written frequency. Learners need to talk before they need to read editorials.
- **Rule 3 — utility override:** up to 8% of each level's list may be lower-frequency "survival" words justified by a functional need documented in doc 05.
- **Rule 4 — no false friends unflagged:** any word that is a false friend for a supported L1 must carry an `l1_traps` entry (see doc 14).
- **Rule 5 — polysemy split:** only the sense(s) meeting the frequency floor are taught at that level; other senses are separate items at their own level.
- **Rule 6 — no dead words:** anything absent from spoken/written corpora of the last 25 years is excluded from productive lists (receptive only, C1+). *Shall* for future, *whom* in speech, *How do you do?* — receptive with a usage note.

### 3.3 Explicit A1 core (illustrative; the full list is in the item bank)

Function words come first — the 100 most frequent words are ~50% of all tokens:
*the, be, to, of, and, a, in, that, have, I, it, for, not, on, with, he, as, you, do, at, this, but, his, by, from, they, we, say, her, she, or, an, will, my, one, all, would, there, their, what, so, up, out, if, about, who, get, which, go, me, when, make, can, like, time, no, just, him, know, take, people, into, year, your, good, some, could, them, see, other, than, then, now, look, only, come, its, over, think, also, back, after, use, two, how, our, work, first, well, way, even, new, want, because, any, these, give, day, most, us*

---

## 4. Lexical sets by level (topic syllabus)

Vocabulary is taught in **semantic sets bound to a communicative need**, never in alphabetical or random lists. Sets are capped at **8–10 new items at a time** (interference rises sharply beyond that), and semantically *contrasting* items (e.g. all the colours, all the days) are **deliberately separated across lessons** — teaching *left/right* or *borrow/lend* together causes cross-association errors that persist for years.

### A1.1
identity & greetings · the alphabet & spelling aloud · numbers 0–100 · countries & nationalities (20) · classroom objects · colours · family (core 12) · jobs (20) · days & months · time (o'clock, half past) · basic verbs (60) · food & drink (40) · the house & rooms · clothes (25) · body parts (20) · common adjectives (40)

### A1.2
daily routine · weather · transport · places in town · shopping & prices & money · at a café/restaurant · directions · hobbies & free time · animals (20) · school subjects · feelings (basic 12) · frequency & time expressions · numbers 100–1,000,000 · dates & ordinals

### A2.1
travel & holidays · hotel & accommodation · at the airport & station · health & the body & symptoms · the doctor & pharmacy · sports (25) · furniture & household · technology basics · describing people (appearance & personality) · past-time expressions · films, TV & music genres · celebrations & festivals

### A2.2
work & workplaces · education & study · shopping (clothes, sizes, returns) · food & cooking & recipes · restaurant complaints · phone & messaging language · invitations & arrangements · the natural world & geography · describing places · money & banking basics · emotions (extended 30) · the internet & apps

### B1.1
personality & relationships · life events & stages · crime & the law (basic) · the media & news · environment & climate · jobs & careers & applications · money & personal finance · health & fitness & diet · science & inventions (basic) · culture & the arts · social media · opinions & argument language

### B1.2
politics & society (basic) · education systems · travel & tourism (extended) · shopping & consumerism · technology & the future · advertising & marketing · sports & competition · food culture & diet · urban vs rural life · volunteering & charity · workplace communication · problems & solutions

### B2.1
business & economics · law & justice · psychology & behaviour · medicine & healthcare systems · energy & sustainability · migration & globalisation · art, design & aesthetics · history & heritage · literature & narrative · statistics & data language · research & evidence · debate & rhetoric

### B2.2
ethics & moral dilemmas · science & research methods · technology & AI · media literacy & bias · gender & identity · work-life balance & the future of work · architecture & the built environment · food security & agriculture · public health & policy · innovation & entrepreneurship · risk & probability · negotiation

### C1
philosophy & abstract thought · political theory & ideology · economics (advanced) · neuroscience & cognition · law (advanced) · literary criticism & stylistics · film & media theory · international relations & diplomacy · academic disciplines & their jargon · humour, irony & satire · cultural criticism · specialised register sampling (medicine, engineering, finance, law)

### C2
idiomatic and figurative language at density · regional and social varieties · literary and archaic vocabulary · slang and its half-life · technical registers of the learner's own field · rhetoric & persuasion lexis · nuance sets (30-way near-synonym discrimination) · etymology & word history · neologism & lexical creativity · translation-resistant vocabulary

---

## 5. Collocation

**Principle:** *We do not learn words; we learn phrases.* Native-like fluency is overwhelmingly a matter of knowing which words go together. A learner who says *strong rain* has a vocabulary problem no dictionary will fix.

### 5.1 Types taught, in order

| Type | Pattern | Example | Level |
|------|---------|---------|-------|
| Verb + noun | | *make a mistake, take a photo, do homework, have breakfast* | A1 |
| Adjective + noun | | *heavy rain, strong coffee, fast food, hard work* | A1 |
| Verb + preposition | | *depend on, listen to, wait for* | A2 |
| Adjective + preposition | | *good at, interested in, afraid of, keen on* | A2 |
| Noun + noun | | *traffic jam, credit card, climate change* | A2 |
| Adverb + adjective | | *deeply concerned, highly likely, fully aware* | B1 |
| Verb + adverb | | *speak fluently, drive carefully, strongly recommend* | B1 |
| Delexical verb + noun | | *have a look, take a decision, give a talk, make an effort* | B1 |
| Noun + verb | | *prices rise, problems arise, opportunities emerge* | B2 |
| Noun + of + noun | | *a sense of humour, a wealth of experience* | B2 |
| Formal/academic V+N | | *pose a threat, raise an issue, conduct research, draw a conclusion* | B2/C1 |
| Binomials | fixed order | *safe and sound, by and large, terms and conditions* | C1 |
| Semantic prosody sets | | *cause* + negative outcomes; *provide* + positive | C1 |

### 5.2 Delivery
- Every lexeme record carries **3–6 collocations**, ranked by corpus MI-score *and* raw frequency (MI alone surfaces rare oddities).
- Collocations are **taught as single SRS items** with their own IDs — `lex.col.####`.
- A dedicated exercise type (`collocation_grid`) presents a 4×4 grid of verbs × nouns; the learner marks legal combinations.
- From B1, the learner has a personal **Collocation Notebook** auto-populated from their own writing errors.

### 5.3 The 60 highest-value collocation clusters (B1 core)
*make/do* (48 pairs) · *take/have* · *say/tell/speak/talk* · *get* (28 patterns) · *put* · *come/go* · *bring/take* · *hear/listen* · *see/watch/look* · *lend/borrow* · *rise/raise* · *win/beat* · *earn/win/gain* · *travel/trip/journey/voyage* · *job/work* · *fun/funny* · *remember/remind* · *learn/teach/study* · *hope/wait/expect/look forward to* · *steal/rob* · … (full list in the item bank)

---

## 6. Phrasal verbs

**Total taught: 300** (productive), plus ~200 receptive at C1–C2.

### 6.1 Teaching principle
Never as an alphabetical list. Three organising principles, applied in this order:

1. **By particle meaning** — the particles are not arbitrary. *up* = completion/increase/approach (*eat up, speed up, come up to*); *out* = exit/exclusion/distribution/exhaustion (*run out, hand out, find out*); *down* = reduction/recording/defeat (*cut down, write down, turn down*); *off* = separation/departure/cancellation (*take off, call off, cut off*); *on* = continuation/attachment (*carry on, put on*); *back* = return/reciprocation; *over* = repetition/inspection/transfer; *through* = completion of a process; *away* = removal/persistence; *in/into* = entry/inclusion; *around/about* = aimlessness; *forward* = progress.
2. **By base verb families** — *get* (35), *take* (28), *put* (25), *come* (22), *go* (22), *look* (16), *turn* (16), *bring* (14), *make* (12), *run* (12), *break* (10), *set* (10), *give* (9), *call* (9), *hold* (8), *pick* (8), *cut* (8), *keep* (7), *pull* (7), *carry* (6).
3. **By topic** — travel phrasal verbs, relationship phrasal verbs, work phrasal verbs, etc., matched to the unit theme.

### 6.2 Grammar of phrasal verbs (taught at B1.1 and B2.2)

| Type | Structure | Separable? | Example |
|------|-----------|------------|---------|
| Intransitive | V + particle | n/a | *The plane took off.* |
| Transitive separable | V + particle + O / V + O + particle | Yes — **must** separate with a pronoun | *Turn on the light / Turn the light on / Turn it on* (**not** *turn on it*) |
| Transitive inseparable (prepositional) | V + prep + O | No | *Look after the baby / look after her* |
| Phrasal-prepositional | V + particle + prep + O | No | *put up with, look forward to, get on with, come up with, run out of, cut down on, catch up with, get away with, look down on, face up to* |

**Register note taught from B2:** phrasal verbs are the *informal* half of English; their Latinate equivalents are the formal half (*put off / postpone; find out / discover; look into / investigate; go up / increase; give up / abandon; set up / establish; take on / assume; carry out / conduct; bring about / cause; point out / indicate*). C1 learners must be able to swap registers in both directions — this is a core C1 exercise type.

### 6.3 Distribution
A1: 8 · A2: +22 (30) · B1: +50 (80) · B2: +70 (150) · C1: +70 (220) · C2: +80 (300).

---

## 7. Idioms, fixed expressions and formulaic language

### 7.1 The chunk inventory (formulaic sequences)
Chunks are taught from lesson 1, unanalysed. They are what makes a learner sound fluent long before their grammar is.

- **A1 (120 chunks):** *How are you? Nice to meet you. See you later. Excuse me. I'm sorry. Thank you very much. You're welcome. How much is it? Can I have…? I'd like… Here you are. What's this? I don't know. I don't understand. Can you repeat that, please? How do you say … in English? What does … mean? Let's go. Of course. That's right. Me too. Not bad. See you tomorrow…*
- **A2 (+130):** *What's the matter? It doesn't matter. Never mind. I'm afraid… Would you like…? Why don't we…? How about…? It depends. I'm not sure. To be honest. By the way. At the moment. In my opinion. As soon as possible. Take care…*
- **B1 (+200):** *It's up to you. Fair enough. That makes sense. I see your point. On the one hand… I couldn't agree more. As far as I know. To be fair. It's worth -ing. There's no point -ing. I'd rather. I'm supposed to…*
- **B2 (+200):** *That said. Having said that. To put it another way. It goes without saying. Let's face it. As a matter of fact. Come to think of it. If anything. Not to mention. All things considered. The thing is…*
- **C1 (+200):** *By and large. In hindsight. To a certain extent. That's beside the point. I take your point, but… Be that as it may. Insofar as. For all intents and purposes. Suffice it to say…*
- **C2 (+150):** register-marked, ironic and literary formulae; discourse-organising phrases of academic and professional English.

### 7.2 Idioms — 800 by C2, taught semantically

Grouped by **source domain** (which makes them memorable and often transparent once the metaphor is shown):
body (*keep an eye on, give a hand, cost an arm and a leg, head over heels*) · animals (*let the cat out of the bag, kill two birds, elephant in the room*) · food (*piece of cake, spill the beans, bring home the bacon*) · weather (*under the weather, break the ice, storm in a teacup*) · sport (*ballpark figure, move the goalposts, jump the gun, on the ropes*) · sea & sailing (*learn the ropes, plain sailing, miss the boat, all hands on deck*) · war (*bite the bullet, dodge a bullet, up in arms*) · money (*break the bank, foot the bill, tighten one's belt*) · time (*call it a day, in the nick of time, around the clock*) · colours (*red tape, green light, out of the blue, black and white*).

**Rule:** idioms are **receptive-first**. A B1 learner who deploys *it's raining cats and dogs* sounds like a textbook, not a speaker. Production of idiom is gated to B2+, and each idiom carries a `currency` tag (`current / dated / regional`) so learners are not taught dead idioms.

### 7.3 Proverbs and cultural allusions (C1–C2, 150 items)
*Actions speak louder than words · Don't count your chickens · The early bird… · When in Rome…* plus Shakespearean and biblical allusions in common use (*a foregone conclusion, the writing on the wall, a wild goose chase, at the eleventh hour*), each with a note on when it is used and when it sounds hackneyed.

---

## 8. Word formation (morphology)

Word-building is the highest-leverage vocabulary multiplier at B2+: one root plus productive affixes yields 5–8 words.

### 8.1 Prefixes

| Group | Prefixes | Level |
|-------|----------|-------|
| Negation | *un-, in-/im-/il-/ir-, dis-, non-, a-* | A2→B1 |
| Opposition/reversal | *un-, de-, dis-, anti-, counter-* | B1 |
| Degree/size | *over-, under-, out-, super-, sub-, hyper-, mini-, micro-, macro-, mega-* | B1→B2 |
| Time/order | *pre-, post-, re-, ex-, fore-, retro-* | B1→B2 |
| Number | *uni-, mono-, bi-, tri-, multi-, poly-, semi-, hemi-* | B2 |
| Attitude | *pro-, anti-, co-, mis-, mal-, pseudo-* | B2 |
| Location | *inter-, intra-, trans-, sub-, super-, extra-, ultra-, circum-* | B2→C1 |
| Greek/Latin scientific | *auto-, bio-, geo-, hydro-, photo-, tele-, thermo-, psycho-, neuro-* | C1 |

**Spelling rules taught:** *in-* → *im-* before p/b/m, *il-* before l, *ir-* before r. Which negative prefix a given root takes is **not** predictable and must be learned per item (*unhappy* but *impossible* but *illegal* but *disloyal*) — this is a documented high-frequency error.

### 8.2 Suffixes by output word class

| Output | Suffixes | Examples | Level |
|--------|----------|----------|-------|
| Noun (person) | *-er, -or, -ist, -ian, -ee, -ant, -ent* | *teacher, actor, artist, musician, employee* | A2 |
| Noun (abstract) | *-ness, -ity, -ment, -tion/-sion, -ance/-ence, -ship, -hood, -dom, -th, -age, -al, -ure* | *happiness, ability, movement, decision, importance, friendship* | A2→B2 |
| Noun (process/result) | *-ing, -ery, -ism* | | B1 |
| Verb | *-ise/-ize, -ify, -en, -ate* | *modernise, simplify, widen, activate* | B1→B2 |
| Adjective | *-ful, -less, -y, -ly, -ous, -ious, -al, -ial, -ic, -ical, -ive, -able/-ible, -ish, -en, -ant/-ent, -ary, -ate* | *useful, useless, cloudy, friendly, famous, natural* | A2→B2 |
| Adverb | *-ly, -ward(s), -wise* | | A2 |

### 8.3 Word-family drills
From B1, every third vocabulary lesson includes a **word-family table** exercise: given *decide*, produce *decision, decisive, decisively, indecisive, undecided*. From B2, the productive test is a Cambridge-style word-formation gapfill.

### 8.4 Compounding, conversion, clipping, blending, acronyms (B2–C1)
compound nouns/adjectives/verbs · conversion (*a text → to text*) · clipping (*advertisement→ad*) · blending (*brunch, smog, podcast*) · acronyms & initialisms · back-formation (*edit* ← *editor*) · reduplication (*chit-chat, zigzag*).

---

## 9. Near-synonym discrimination and connotation

From B1, and intensively at C1–C2. This is what separates B2 from C1 more than anything else.

**Method:** for each set, the learner receives (a) the shared core meaning, (b) the differentiating feature, (c) the collocational signature, (d) the register tag, (e) a corpus-based discrimination exercise.

Sample sets (the full bank has 300):
- *say / tell / speak / talk / mention / state / claim / remark / assert*
- *big / large / great / huge / enormous / vast / immense / massive*
- *look / see / watch / observe / notice / glance / stare / gaze / glimpse*
- *make / do / create / produce / manufacture / generate / construct*
- *happy / glad / pleased / delighted / content / cheerful / thrilled / elated*
- *problem / issue / difficulty / trouble / matter / concern / obstacle / setback*
- *think / believe / reckon / suppose / assume / consider / regard / deem*
- *stop / cease / halt / quit / end / finish / terminate / discontinue*
- *important / significant / crucial / vital / essential / critical / paramount*
- *walk / stroll / wander / stride / march / trudge / amble / pace*
- *thin / slim / slender / skinny / lean / scrawny / gaunt* — **connotation is the point**
- *childlike / childish*, *famous / notorious*, *thrifty / stingy*, *confident / arrogant*, *smell / aroma / stench*

**Semantic prosody** (C1): words that are neutral in dictionaries but carry evaluative loading in use — *cause* (bad outcomes), *utterly* (negative), *provide* (positive), *set in* (unpleasant), *commit* (crimes/errors), *bent on* (bad intentions).

---

## 10. Academic and specialised vocabulary

| Stage | Content | Level |
|-------|---------|-------|
| Academic Word List (AWL) — 570 families, ~10% of academic text | first 200 | B2.1 |
| AWL remainder | 370 | B2.2 |
| Academic Vocabulary List (AVL) top 500 + academic formulae ("academic phrasebank") | | C1 |
| Academic collocations (ACL) | 2,469 collocations, top 800 taught | C1 |
| Discipline sampling: 300 items each from medicine, law, business/finance, engineering, IT | learner picks 2 | C1–C2 |
| Latin/Greek roots for inference (120 roots) | | C1 |
| Learner's own-field terminology harvesting tool | | C2 |

---

## 11. The lexeme record (data contract)

```json
{
  "id": "lex.03421",
  "lemma": "run",
  "sense_id": 4,
  "sense_gloss_en": "to manage or be in charge of a business or organisation",
  "pos": "verb",
  "cefr": "B1.2",
  "frequency": { "coca_rank": 187, "subtlex_rank": 141, "band": 1000, "dispersion": 0.94 },
  "phonology": { "ipa_ga": "/rʌn/", "ipa_sbe": "/rʌn/", "syllables": 1, "stress": "1" },
  "spelling": { "us": "run", "uk": "run", "inflections": ["runs","ran","run","running"] },
  "audio": { "word_ga": "a/03421_ga.opus", "word_sbe": "...", "sentence": "..." },
  "grammar": { "patterns": ["V n"], "irregular": true, "countable": null },
  "collocations": ["run a business", "run a company", "run a department",
                   "run a campaign", "run a household"],
  "colligations": ["run + [organisation noun]"],
  "register": "neutral",
  "connotation": "neutral",
  "examples": [
    { "text": "She runs a small bakery in the old town.", "audio": "...", "level": "B1" },
    { "text": "Who runs this place?", "audio": "...", "level": "B1" }
  ],
  "l1_gloss": { "uz": "boshqarmoq, yuritmoq", "ru": "управлять", "tr": "işletmek" },
  "l1_traps": { "uz": "≠ yugurmoq in this sense — do not translate literally" },
  "images": ["img/run_business.webp"],
  "related": { "synonyms": ["manage","operate","be in charge of"],
               "antonyms": [], "family": ["runner","running","runaway"] },
  "topic_tags": ["work","business"],
  "first_taught_node": "S05U12N2",
  "status": "active",
  "syllabus_version": "1.0"
}
```

**Mandatory fields for shipping:** id, lemma, sense_id, pos, cefr, frequency.band, ipa_ga, audio.word_ga, ≥2 examples with audio, ≥3 collocations, ≥1 l1_gloss per supported L1.

---

## 12. The vocabulary teaching cycle (per lexeme)

1. **Encounter in comprehensible context** — never as a bare bilingual pair. Picture + sentence + audio.
2. **Form focus** — spelling, pronunciation, stress; the learner says it aloud once.
3. **Meaning focus** — L1 gloss (A1–A2) or L2 definition + image (B1+); a distractor-based check.
4. **Use focus** — one collocation and one grammatical pattern in the same session.
5. **Retrieval, spaced** — recognition → recall → production, at expanding intervals (doc 08).
6. **Re-encounter in new contexts** — the scheduler guarantees each lexeme reappears in **≥ 8 different contexts** across ≥ 4 units. Repetition in a single context produces context-bound knowledge that fails in transfer.
7. **Productive use** — the lexeme appears in a speaking or writing prompt where it is the natural choice; a use in *free* production is what promotes it to `productive: true`.
8. **Refinement** — at higher levels the same lexeme returns for connotation, register and near-synonym discrimination.

### 12.1 Repetition requirements (empirically grounded)
Minimum encounters for durable learning: **8–12 spaced encounters** for a receptive item; **15–20** for a productive one. The scheduler must be able to prove, per lexeme, that this budget was met before marking it mastered. Any lexeme with fewer than 8 logged encounters is *not* counted in the learner's vocabulary total, however many times they answered it correctly in a single session.

---

## 13. Vocabulary measurement in-app

| Instrument | What it measures | When |
|------------|------------------|------|
| Internal SRS state | Taught items, per-aspect mastery | Continuous |
| **Vocabulary Size Test** (Nation/Beglar style, 100 items sampled across 14 frequency bands ×1,000) | Total receptive size, incl. words never taught | Every 3 months + level exams |
| **Yes/No test with pseudowords** (e.g. *plaunch, morrit*) | Fast size estimate corrected for over-claiming | Monthly, 3 minutes |
| **Lexical Frequency Profile** of learner's own writing (proportion of tokens in each band) | Productive sophistication | Every writing task |
| **Type-token ratio / MTLD** of learner output | Lexical diversity | Every writing/speaking task |
| Collocation error rate in output | Depth of knowledge | Continuous |

Reported to the learner as: *estimated vocabulary size · coverage percentage · sophistication band · diversity trend*. Never as a leaderboard of raw counts.
