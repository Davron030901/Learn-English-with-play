# 14 — L1 CONTRASTIVE ANALYSIS
## Uzbek (and Russian) speakers learning English: predicted errors and their remediation

The product's first market is Uzbek-speaking. Almost every learner is bilingual Uzbek–Russian, so **both** transfer profiles apply, and they reinforce each other on several points (notably articles). This document is the source for the `l1_notes`, `l1_traps` and difficulty-weighting fields in the content model, and for the L1-specific clinic content.

**How this is used in the product:** every predicted error below has (a) a weighting that makes the relevant items appear more often for these learners, (b) a targeted clinic, (c) a distractor in the relevant MCQ items, and (d) an entry in the automatic-feedback rules so that when the learner makes it, the explanation names the L1 cause. Naming the cause — *"In Uzbek there is no article, so English speakers of Uzbek often leave out 'the'. Here's the rule."* — is far more effective than a bare correction.

---

## 1. Typological summary

| Feature | Uzbek | Russian | English | Transfer risk |
|---------|-------|---------|---------|---------------|
| Family | Turkic (Karluk) | Slavic | Germanic | — |
| Morphology | Agglutinative | Fusional, inflectional | Analytic, weak inflection | High |
| Basic word order | **SOV** | SVO (free) | **SVO (fixed)** | High |
| Articles | **None** | **None** | Definite/indefinite/zero | **Very high** |
| Grammatical gender | None | 3 genders | None (natural gender in pronouns) | Medium |
| Case marking | 6 cases (suffixes) | 6 cases | Almost none | High |
| Adpositions | **Postpositions** + cases | Prepositions | Prepositions | High |
| Copula in present | **Usually zero / suffix** | **Zero** | Obligatory *be* | **Very high** |
| "Have" verb | **None** (*bor/yoʻq* + possessive) | **None** (*u menya est'*) | *have* | High |
| Question formation | Particle *-mi*, intonation | Intonation, particle *li* | **Inversion + do-support** | **Very high** |
| Negation | Verbal suffix *-ma-* | Particle *ne* | *not* + auxiliary | High |
| Aspect system | Different (progressive *-moqda*, perfect *-gan*) | Perfective/imperfective pairs | Progressive + perfect | **Very high** |
| Relative clauses | **Pre-nominal participles** | Post-nominal *kotoryj* | Post-nominal | High (Uzbek), low (Russian) |
| Rhythm | Syllable-timed | Stress-timed with reduction | **Stress-timed with reduction** | High (Uzbek), medium (Russian) |
| Word stress | Usually final | Mobile, unpredictable | Mobile, lexical | High |
| Orthography | Phonemic (Latin + Cyrillic) | Phonemic-ish (Cyrillic) | **Deeply irregular** | **Very high** |
| Vowel inventory | 6 | 5–6 | 14–20 | **Very high** |

---

## 2. Pronunciation: predicted errors and priority

### 2.1 Consonants

| Target | Typical substitution | Cause | Cost | Priority |
|--------|---------------------|-------|------|----------|
| /θ/ | [t] or [s] | Absent in both L1s | *thin→tin/sin*, *think→sink* | **1 — critical** |
| /ð/ | [d] or [z] | Absent | *they→dey*, *breathe→breeze* | **1 — critical** |
| /w/ | [v] | Uzbek *v* covers both; Russian has no /w/ | *west→vest*, *wine→vine* | **1 — critical** |
| /v/ | [w] (hypercorrection) | Overcorrection after the above | *very→wery* | 2 |
| /æ/ | [a] or [e] | No /æ/ in either L1 | *cat→cot/ket*, *bad→bed* | **1 — critical** |
| /ɪ/ vs /iː/ | both → [i] | One high front vowel | *ship→sheep*, *live→leave* | **1 — critical** |
| /ʌ/ | [a] | | *cup→cap*, *luck→lock* | 2 |
| /ɜːr/, /ɚ/ | [er], [or] | No r-coloured vowels | *bird→berd*, *doctor→doktor* | 2 |
| /ŋ/ + [ɡ] | *singer→sing-ger* | Uzbek *ng* is fine but spelling misleads | | 3 |
| Final voiced obstruents | devoiced | **Final devoicing is systematic in both L1s** | *bad→bat*, *dog→dok*, *is→is[s]* | **1 — critical** (kills plural/past distinctions) |
| Aspiration of /p t k/ | unaspirated | L1 stops are unaspirated | *pin* heard as *bin* | 2 |
| /r/ | trill [r] | | Intelligible; **do not correct** | 5 — leave it |
| Dark /ɫ/ | clear [l] | | *milk*, *full* | 3 |
| /h/ | [x] (velar) | Uzbek/Russian *x* | *house→xouse* | 3 |
| /dʒ/ vs /ʒ/ | merged | | *jelly/Zhelly* | 4 |

### 2.2 Vowels — the core problem
English has 14–20 vowel phonemes; Uzbek has 6 (*a, e, i, o, u, oʻ*), Russian 5–6. Learners map the whole English system onto their six, collapsing many contrasts. **The remedy is perceptual training before production**: the minimal-pair discrimination gate (doc 02 §9 step 2) is not optional for these learners.

Priority contrast order for this L1 group:
1. /ɪ/–/iː/ 2. /æ/–/e/ 3. /æ/–/ʌ/ 4. /ʌ/–/ɑː/ 5. /ʊ/–/uː/ 6. length before voiced/voiceless codas 7. /ɜːr/–/ɑːr/–/ɔːr/ 8. /oʊ/–/ɔː/ 9. schwa in unstressed syllables.

### 2.3 Syllable structure
Uzbek disallows most initial clusters. Two repair strategies transfer:
- **Prothesis:** *school → ishkool*, *station → istation*, *sport → isport*
- **Epenthesis:** *street → sitreet*, *films → filmsi*, *asked → askéd*

**Remediation:** explicit cluster drills in the order of doc 02 §2, with the *s*-clusters first, taught as a single articulatory gesture rather than as two sounds. Backchaining works well here (*-treet → street*).

### 2.4 Stress and rhythm
- Uzbek stress is predominantly **word-final**; English is lexical and unpredictable → systematic misplacement (*deVElop → develOP*, *PHOtograph → photoGRAPH*).
- Uzbek is **syllable-timed**; English is stress-timed with heavy reduction. This causes two symptoms: (a) the learner's speech sounds "machine-gun" even when every sound is right; (b) **the learner cannot decode fast English**, because they are listening for full vowels that native speakers do not produce.
- **Remediation:** the schwa is taught from lesson 1 as "the sound of *unstressed*"; the 300-word stress bank (doc 02 §3.2); weak-form drills; and the listening-cliff protocol (doc 06 §2.4) from B1.1. This is the highest-leverage phonological intervention for this L1 group and must not be cut.

### 2.5 Orthography shock
Uzbek orthography is essentially phonemic; English is not. Predicted symptoms: spelling by sound (*bisness, laik, tomorow, wich*), reading by letter (*[knife] → k-nife*), and enormous frustration. **Remediation:** adult phonics (doc 02 §7) is a compulsory strand at A1–A2, not an optional extra. The learner is told explicitly and early that English spelling is ~75% rule-governed and that the rules will be taught.

---

## 3. Grammar: the transfer error catalogue

### 3.1 Articles — the single biggest and longest-lasting problem
Neither Uzbek nor Russian has articles, so there is no L1 hook at all. Symptoms:

| Error | Example | Cause |
|-------|---------|-------|
| Omission | *I am student.* / *He went to shop.* | No article in L1 |
| Overuse of *the* | *The life is hard.* / *I like the music.* | Over-application after the rule is learned |
| *a* with uncountables | *an advice, a news, an information* | Countability differs |
| Article with proper nouns | *the London* | Overgeneralisation |
| Missing *the* with unique reference | *Sun is hot.* | |

**Remediation strategy:** do **not** teach the article system as a rule list at A1. Teach articles as *chunks* first (*at the moment, in the morning, go to school, play the piano*), then introduce the first/second-mention rule at A1.2, countability at A2, generic reference at B1, and the hard 15% at B2. Articles stay on the fossilisation watchlist for the entire course, with a permanent low-frequency SRS presence. Expect residual errors at C1; that is normal and should not block certification if communication is unaffected.

### 3.2 Word order

| Error | Example | Cause |
|-------|---------|-------|
| SOV transfer | *I English study.* / *I to school go.* | Uzbek verb-final |
| Verb-final in subordinate clauses | *When I home came, …* | |
| Adverb between verb and object | *I like very much English.* | Russian/Uzbek freedom |
| Adjective after noun (rare, Russian influence) | | |
| Question word order | *Where you are going?* / *You are student?* | No inversion in L1 |
| Indirect question inversion | *Can you tell me where is the bank?* | Overgeneralisation of inversion |

**Remediation:** colour-coded constituent tiles (S / V / O / A) used consistently from A1; `sentence_reorder` and `word_bank_build` items weighted up for this L1; an explicit "English word order is fixed — this is the price of having almost no case endings" explanation at A1.2.

### 3.3 The verb *be* and the copula

| Error | Example |
|-------|---------|
| Copula omission | *He teacher.* / *She very tired.* / *I from Uzbekistan.* |
| *be* + verb confusion | *I am go to work.* / *I am like it.* |
| Wrong short answer | *Yes, I'm.* (instead of *Yes, I am.*) |

Both L1s have zero present copula, so this is a *systematic*, not careless, error. Drill *be* to automaticity in Section 1; it is the most frequent verb in English and errors here are the most visible of all.

### 3.4 Auxiliary *do* and negation

| Error | Example |
|-------|---------|
| No do-support in questions | *You like coffee?* / *Where you live?* |
| No do-support in negatives | *I not understand.* / *He no came.* |
| Double marking | *He didn't went.* / *Does he likes it?* |
| Negative concord | *Nobody didn't come.* / *I don't know nothing.* | (Both L1s use negative concord — this is grammatical in Russian and Uzbek) |

**Remediation:** teach *do* explicitly as "the helper verb English uses to carry the question and the negative", with a diagram showing the tense moving onto the auxiliary. The double-marking error (*didn't went*) is actually a sign of progress and should be treated gently.

### 3.5 Possession and existence

| Error | Example | Cause |
|-------|---------|-------|
| *There is at me…* | *At me there is a car.* | Russian *u menya est'* |
| *My car is.* | | Uzbek *mening mashinam bor* |
| *I have not a car.* | | No *do* + *have* pattern |
| *There is/are* confusion with *it is* | *It is many people here.* | |

### 3.6 Plurals and countability

| Error | Example | Cause |
|-------|---------|-------|
| No plural after numerals | *five book, three car* | Uzbek: numeral + singular |
| Plural on uncountables | *informations, advices, furnitures, moneys* | Countable in L1 |
| *people* treated as singular | *People is…* | |
| Irregular plurals regularised | *childs, mans, foots* | |

### 3.7 Pronouns

| Error | Example | Cause |
|-------|---------|-------|
| **he/she confusion** | *My mother… he works…* | Uzbek *u* is genderless — this is by far the most noticeable single error for Uzbek speakers and persists to B2+ |
| Subject pronoun dropped | *Is very good.* / *Went home.* | Both L1s are pro-drop-ish |
| Object pronoun dropped | *I like.* (meaning *I like it*) | |
| Reflexives misused | *I feel myself good.* | Russian calque |

**Remediation:** dedicated he/she drills from A1.1, with a gender-tagged picture bank and forced production; the error is flagged specially in speaking feedback because listeners find it genuinely confusing.

### 3.8 Tense and aspect

| Error | Example | Cause |
|-------|---------|-------|
| Present simple for now | *What you do?* (meaning *What are you doing?*) | No obligatory progressive |
| Progressive with state verbs | *I am knowing, I am liking* | Overgeneralisation |
| Present perfect avoided entirely | *I live here since 2019.* / *I am here since Monday.* | No equivalent form; Russian aspect maps badly |
| Present perfect over-used | *I have seen him yesterday.* | Overcorrection |
| Past simple for present perfect | *Did you ever go to Paris?* as the only form | |
| Past perfect avoided | | |
| *since/for* confusion | *since 3 years* | Russian *uzhe 3 goda* |
| Future with *will* in time clauses | *When I will come, I will call you.* | Both L1s use future in the *when*-clause |

The present perfect is the hardest single structure for this group. It gets a full clinic (C-09), a spiral treatment across B1.1–B1.2, and permanent watchlist status.

### 3.9 Prepositions
Both L1s encode these relations with cases and postpositions, so English prepositions are learned item-by-item. Highest-frequency errors:

*in Monday* (→ on) · *on the morning* (→ in) · *in the weekend* (US: on / UK: at) · *depend of* (→ on) · *listen music* (→ to) · *discuss about* (→ ∅) · *marry with* (→ ∅) · *enter to* (→ ∅) · *arrive to* (→ at/in) · *explain me* (→ to me) · *ask to someone* (→ ask someone) · *afraid from* (→ of) · *interested for* (→ in) · *good in* (→ at) · *in the picture* vs *on the photo* · *by foot* (→ on foot) · *in the bus* (→ on the bus) · *different with* (→ from/than).

**Remediation:** prepositions are always taught **inside collocations**, never as a preposition list. `lex.col` items carry the preposition as part of the unit.

### 3.10 Relative clauses (Uzbek-specific)
Uzbek relativises with a **pre-nominal participle**: *kecha men sotib olgan kitob* = "yesterday I bought book" = *the book I bought yesterday*. Predicted errors: *the yesterday I bought book*; omission of the relative pronoun in subject position (*The man lives next door is nice*); resumptive pronouns (*The man who I saw him*).

### 3.11 Reported speech
Uzbek reports with a direct quotation plus *deb*; there is no backshift. Predicted: *He said he is tired* (may be acceptable), *He said me* (→ told me), *He asked me where do I live*, absence of pronoun/time shifts.

### 3.12 Modality
L1 modality is suffixal or periphrastic. Predicted: *must to go*, *can to swim*, *I must go yesterday* (no past of *must*), *should to*, confusion of *must* (internal) vs *have to* (external), and over-use of *must* where English prefers *should/need to* — which sounds harsh in English.

### 3.13 Other high-frequency transfer errors
*I have 20 years* (→ I am 20) · *I feel myself well* · *How do you call…?* (→ What do you call…?) · *What means this?* (→ What does this mean?) · *I am agree* (→ I agree) · *I am interesting* (→ interested) · *Say me* (→ Tell me) · *Very much I like it* · *All the people knows* · *In my opinion, I think* (double marking) · *Thanks God* · *Please, sit down* with the Russian comma-*please* pattern · overuse of *of* for the genitive (*the car of my brother*).

---

## 4. False friends (Uzbek/Russian → English)

| L1 word | Looks like | Actually means | English word needed |
|---------|-----------|----------------|--------------------|
| magazin | magazine | shop | *shop / store* |
| familiya | family | surname | *surname* |
| aktual | actual | current, topical | *relevant, topical* |
| akkurat(niy) | accurate | neat, tidy | *neat* |
| korrekt(niy) | correct | polite, tactful | *polite* |
| simpatichniy | sympathetic | good-looking, nice | *attractive, likeable* |
| intelligent(niy) | intelligent | cultured, educated | *cultured* |
| direktor | director | head teacher / manager | *principal / manager* |
| kabinet | cabinet | office, study | *office* |
| prospekt | prospect | avenue | *avenue* |
| konkurs | concourse | competition | *competition* |
| artist | artist | performer, actor | *performer* |
| fizik | physique | physicist | *physicist* |
| banka | bank | jar, tin | *jar* |
| dekada | decade | ten days (RU) | *decade = 10 years* |
| aspirant | aspirant | postgraduate student | *PhD student* |
| student | student | **university** student only | *pupil/student* distinction |
| professor | professor | full professor only | |
| normal'no | normal | fine, OK | *fine* |
| konspekt | — | lecture notes | *notes* |
| referat | referee | term paper | *paper, essay* |
| eksponat | exponent | exhibit | *exhibit* |
| repetitsiya | repetition | rehearsal | *rehearsal* |
| tualet | toilet | also "outfit" (RU dated) | |
| kostyum | costume | suit | *suit* |
| gazeta | gazette | newspaper | *newspaper* |
| avtor | author | author (ok) but *avtomat* ≠ automat | |
| paragraf | paragraph | section/chapter (in textbooks) | |
| original | original | also "eccentric person" | |

Each of these has an `l1_traps` entry and appears as a **deliberate distractor** in the relevant MCQ items — the most efficient way to inoculate against them.

---

## 5. Pragmatic and cultural transfer

| Area | L1 norm | English norm | Risk |
|------|---------|--------------|------|
| Greetings | Extended ritual (*Assalomu alaykum*, health of family, etc.) | Short, phatic (*How are you? — Fine, thanks*) | Learner gives a full health report; or finds English greetings cold |
| Directness of requests | More direct is normal and not rude | Conventional indirectness expected | *Give me…* / *I want…* reads as rude |
| Refusals | Often indirect, face-saving, may avoid a flat "no" | Also indirect, but with an explicit account | Mismatch in both directions |
| Small talk topics | Age, marital status, salary, family plans are normal | Risky with strangers/colleagues | Serious social cost — taught explicitly at B1 |
| Compliments | Deflection expected | Acceptance + thanks expected | Learner seems ungracious |
| Hospitality language | Insistence is polite | Repeated insistence reads as pressure | |
| *Must* | Neutral obligation | Strong, can sound authoritarian | *You must come* → *You should come / You're welcome to come* |
| Titles | Teacher/older person addressed by title | First names common in many English workplaces | Learner over-formal, or shocked by informality |
| Silence and interruption | | Culture-specific | Taught as strategy, never as "the correct way" |
| Written email openings | *Dear Sir!* with exclamation (Russian convention) | *Dear Sir or Madam,* with a comma | Style guide taught at B1 |

**Framing rule for all of the above:** the app never says the learner's culture is wrong. It says: *here is how this is usually done in English-speaking contexts, and here is why knowing it protects you.*

---

## 6. What Uzbek speakers find *easier* than average

Design should exploit these, not only compensate for weaknesses:

- **No grammatical gender in nouns** — English agreement is simpler than Russian, so learners transfer no gender machinery.
- **Adjectives do not inflect** in Uzbek either — English adjective invariance is natural.
- **Agglutinative morphology habits** make English derivational morphology (prefixes/suffixes, doc 04 §8) unusually approachable; word-family exercises land well.
- **Latin script** is already familiar from modern Uzbek orthography — no script training needed (unlike Arabic- or Chinese-L1 learners).
- **/ŋ/, /tʃ/, /dʒ/, /ʃ/** already exist in Uzbek.
- **Vowel reduction** exists in Russian, giving a hook for teaching the English schwa to Russian-dominant bilinguals.
- **Bilingualism itself**: Uzbek–Russian bilinguals have well-developed metalinguistic awareness and code-switching skill; explicit grammar explanation and mediation tasks work well with them.
- **Large Russian–English cognate set** via international vocabulary (*information, situation, problem, system, university, computer, telephone*) gives a receptive head start of several hundred words at A1–A2 — worth harvesting deliberately in the A1 lexis selection.

---

## 7. Difficulty weighting (implementation)

For learners with `l1 ∈ {uz, ru, kk, tg}`, apply these multipliers to item selection frequency and to the SRS `importance` factor (doc 08 §5):

| Syllabus area | Weight |
|---------------|-------:|
| Articles (G-049–051, G-123, G-200, G-269) | ×2.0 |
| *be* / copula (G-001–008) | ×1.6 |
| Question formation & do-support (G-004, G-018–019, G-032, G-142) | ×1.8 |
| Present perfect (G-079–083, G-143–146) | ×1.9 |
| Prepositions (G-068–071, G-134–137) | ×1.7 |
| he/she pronoun gender (G-057–058) | ×1.8 |
| Word order (G-072, G-212) | ×1.5 |
| Plural after numerals / countability (G-047, G-053, G-117) | ×1.4 |
| /θ ð/, /v w/, /æ/, /ɪ iː/, final devoicing | ×2.0 |
| Word stress & weak forms | ×1.8 |
| Initial consonant clusters | ×1.5 |
| Trilled /r/, dark /l/ | ×0.6 (deprioritised — intelligible) |
| Gender agreement | ×0.5 (English has almost none) |

---

## 8. Profiles for the other supported L1s (summary)

| L1 | Top phonological risks | Top grammatical risks | Notes |
|----|------------------------|----------------------|-------|
| **Russian** | /θ ð/, /w/, /æ/, /ɪ iː/, final devoicing, palatalisation, /h/→[x] | Articles, copula, do-support, aspect→perfect mapping, *at me is*, negative concord | Nearly identical profile to Uzbek; treat as one cohort with minor differences |
| **Turkish** | /w/, /θ ð/, /æ/, vowel epenthesis in clusters | Articles, SOV transfer, no *have*, question particle, relative clauses | Very close to Uzbek (same family) — content is largely reusable |
| **Kazakh / Kyrgyz** | as Uzbek, plus /f v/ instability | as Uzbek | Reuse the Turkic profile |
| **Tajik / Persian** | /w/, /θ ð/, /ŋ/, initial clusters | Articles (indefinite exists, definite doesn't), adjective order, ezafe transfer | Distinct enough to need its own set |
| **Arabic** | /p/→[b], /v/→[f], vowel epenthesis, /ɪ e/ merger | Articles (definite exists, indefinite doesn't), copula, VSO transfer, relative resumptives | Script training may be needed |
| **Spanish / Portuguese** | /ɪ iː/, /æ/, initial *s*-clusters (*espeak*), final consonants | *have/be* for age & states, gender in pronouns, false friends, double negation | |
| **Hindi/Urdu** | /v w/, retroflex /t d/, /θ/→[t̪ʰ] | Articles, SOV transfer, progressive over-use, postposition transfer | |
| **Chinese (Mandarin)** | Final consonants, consonant clusters, /l r/, /n ŋ/, tone→intonation transfer | No inflection at all: tense, plural, articles, agreement all absent | Highest overall grammatical distance |
| **Vietnamese** | Final consonants, clusters, /θ ð/, tone transfer | Tense marking, articles, plurals, copula | |
| **Indonesian** | /θ ð/, /v/, final consonants | Tense, articles, plurals (reduplication transfer) | |
| **French** | /h/ dropping, /θ ð/, /ɪ iː/, word stress (final) | *Since/for*, present for present perfect, adjective position, false friends | |
