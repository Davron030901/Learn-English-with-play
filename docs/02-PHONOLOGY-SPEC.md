# 02 — PHONOLOGY & PRONUNCIATION SPECIFICATION
## The complete sound system, its teaching order, and how the app scores it

Pronunciation is the single most neglected area in gamified language apps and the single biggest determinant of whether a learner is *understood*. This document specifies every segment, every prosodic feature, the order they are taught in, the minimal-pair banks, and the scoring model.

**Reference accent:** General American (GA) is the production model. Standard Southern British English (SSBE) is a receptive model from A2 and an optional production model from B1.

---

## 1. Segmental inventory

### 1.1 Consonants (24 phonemes — identical inventory in GA and SSBE)

| IPA | Example | Place | Manner | Voice | Level introduced | Notes for teaching |
|-----|---------|-------|--------|-------|------------------|--------------------|
| /p/ | **p**en, s**p**in, ha**pp**y | bilabial | plosive | − | A1.1 | **Aspiration** [pʰ] word-initially and at stressed-syllable onset; unaspirated after /s/. Teach with the paper-strip test. |
| /b/ | **b**ig, ro**bb**er | bilabial | plosive | + | A1.1 | Final devoicing must be avoided; preceding vowel is long (*cab* vs *cap*). |
| /t/ | **t**en, s**t**op | alveolar | plosive | − | A1.1 | Aspirated [tʰ]; **flapped [ɾ]** intervocalically in GA (*water, better, city*); glottalised [ʔ] before syllabic /n/ (*button*). |
| /d/ | **d**og, la**dd**er | alveolar | plosive | + | A1.1 | Also flaps in GA (*ladder ≈ latter*). |
| /k/ | **c**at, s**k**y | velar | plosive | − | A1.1 | Aspiration as /p/. |
| /ɡ/ | **g**o, bi**gg**er | velar | plosive | + | A1.1 | Not [ŋɡ] in *singer*. |
| /f/ | **f**ish, o**ff**, **ph**one | labiodental | fricative | − | A1.1 | Uzbek/Russian speakers may substitute [p] — drill. |
| /v/ | **v**an, o**f** | labiodental | fricative | + | A1.1 | **High-priority contrast with /w/** for Slavic/Turkic L1s. |
| /θ/ | **th**ink, ba**th** | dental | fricative | − | A1.2 | High-priority. Substitutions [s], [t], [f] all reduce intelligibility differently — [f] is least costly. |
| /ð/ | **th**is, mo**th**er | dental | fricative | + | A1.2 | Occurs in the highest-frequency words (*the, this, that, they, there*). |
| /s/ | **s**ee, ci**t**y | alveolar | fricative | − | A1.1 | |
| /z/ | **z**oo, ha**s**, ro**s**e | alveolar | fricative | + | A1.1 | Critical for plural/3sg/possessive -s allomorphy. |
| /ʃ/ | **sh**oe, na**ti**on | postalveolar | fricative | − | A1.2 | |
| /ʒ/ | vi**si**on, gara**g**e | postalveolar | fricative | + | B1.1 | Lowest-frequency English consonant; never word-initial in native words. |
| /h/ | **h**at, be**h**ind | glottal | fricative | − | A1.1 | Deleted in weak forms (*tell 'im*) — teach receptively at B1. |
| /tʃ/ | **ch**urch, wa**tch** | postalveolar | affricate | − | A1.1 | |
| /dʒ/ | **j**udge, **g**ym, brid**ge** | postalveolar | affricate | + | A1.1 | |
| /m/ | **m**an, ha**mm**er | bilabial | nasal | + | A1.1 | Syllabic [m̩] in *rhythm*. |
| /n/ | **n**o, ru**nn**ing | alveolar | nasal | + | A1.1 | Syllabic [n̩] in *button, sudden*. |
| /ŋ/ | si**ng**, thi**nk** | velar | nasal | + | A1.2 | Never followed by pronounced [ɡ] in *singer*; but *finger* = [ˈfɪŋɡɚ]. Never word-initial. |
| /l/ | **l**ight (clear [l]), fu**ll** (dark [ɫ]) | alveolar | lateral | + | A1.1 | **Clear vs dark /l/** taught at A2; syllabic [ɫ̩] in *bottle, little*. |
| /ɹ/ | **r**ed, ca**r** (GA) | postalveolar | approximant | + | A1.1 | GA is **rhotic** — /r/ pronounced everywhere. SSBE non-rhotic (receptive at A2). Bunched or retroflex both acceptable. |
| /j/ | **y**es, m**u**sic | palatal | approximant | + | A1.1 | Yod-dropping in GA (*new* = [nuː]) vs SSBE [njuː]. |
| /w/ | **w**e, **wh**at | labial-velar | approximant | + | A1.1 | |

### 1.2 Vowels — General American (14 monophthongs+ / 5 diphthongs)

| IPA (GA) | Keyword | Type | Level | Teaching note |
|----------|---------|------|-------|---------------|
| /iː/ | fl**ee**ce, s**ee**, m**e** | close front tense | A1.1 | Contrast with /ɪ/ from lesson 1. |
| /ɪ/ | k**i**t, s**i**t, b**i**g | near-close front lax | A1.1 | **The #1 global L2 error.** Shorter *and* more central than /iː/, not just shorter. |
| /e/ (/ɛ/) | dr**e**ss, b**e**d | mid front lax | A1.1 | |
| /æ/ | tr**a**p, c**a**t, b**a**d | near-open front | A1.1 | Longer and lower in GA than SSBE; nasalised before nasals (*man*). |
| /ɑː/ | l**o**t, f**a**ther, p**a**lm | open back | A1.1 | GA merges LOT and PALM (*cot*≈*caught* in many GA speakers). |
| /ɔː/ | th**ou**ght, l**aw**, n**or**th | open-mid back rounded | A1.2 | Cot–caught merger present for many GA speakers; content must not hinge on this contrast. |
| /ʊ/ | f**oo**t, p**u**t, b**oo**k | near-close back lax | A1.2 | |
| /uː/ | g**oo**se, tw**o**, bl**ue** | close back tense | A1.1 | Often fronted [ʉ] in modern GA. |
| /ʌ/ | str**u**t, c**u**p, l**o**ve | open-mid central | A1.1 | Common substitution: [a]. Contrast with /æ/ and /ɑː/. |
| /ɜːr/ | n**ur**se, b**ir**d, w**or**d | r-coloured central | A1.2 | GA: single r-coloured vowel [ɝ]. |
| /ə/ | **a**bout, comm**a**, suppl**y** | schwa (unstressed only) | A1.1 | **The most frequent vowel in English.** Taught from day one as the sound of *unstressed*. |
| /ɚ/ | lett**er**, doct**or** | r-coloured schwa | A1.2 | |
| /eɪ/ | f**a**ce, d**ay**, s**ay** | diphthong | A1.1 | |
| /aɪ/ | pr**i**ce, m**y**, t**i**me | diphthong | A1.1 | |
| /ɔɪ/ | ch**oi**ce, b**oy** | diphthong | A1.2 | |
| /aʊ/ | m**ou**th, n**ow** | diphthong | A1.2 | |
| /oʊ/ | g**oa**t, g**o**, kn**ow** | diphthong | A1.1 | Not a pure [o] — the glide must be taught. |

**SSBE differences taught receptively from A2.1:** non-rhoticity; /ɒ/ (*lot*); centring diphthongs /ɪə eə ʊə/ (*near, square, cure*); /əʊ/ for GA /oʊ/; TRAP–BATH split (*bath* = /bɑːθ/); no flapping; yod retention (*tune* = /tjuːn/).

### 1.3 Allophonic rules (explicitly taught, in this order)

| # | Rule | Level | Example |
|---|------|-------|---------|
| 1 | Aspiration of /p t k/ in stressed onsets | A1.2 | *pin* [pʰɪn] vs *spin* [spɪn] |
| 2 | Vowel length before voiced vs voiceless codas ("pre-fortis clipping") | A2.1 | *bat* [bæt] vs *bad* [bæːd] |
| 3 | Flapping of /t d/ in GA | A2.1 | *water* [ˈwɑɾɚ], *better* [ˈbɛɾɚ] |
| 4 | Dark /l/ in codas; syllabic [ɫ̩] | A2.2 | *milk* [mɪɫk], *bottle* [ˈbɑɾɫ̩] |
| 5 | Nasal plosion; syllabic [n̩] | B1.1 | *button* [ˈbʌʔn̩], *sudden* |
| 6 | Glottal reinforcement of /t/ | B1.1 | *football* [ˈfʊʔbɔːl] |
| 7 | /nt/ deletion in GA | B1.2 | *interview* [ˈɪnɚvjuː], *twenty* [ˈtwɛni] |
| 8 | Yod coalescence | B1.2 | *did you* [dɪdʒu], *last year* [læstʃɪr] |
| 9 | Elision of /t d/ in clusters | B1.2 | *next day* [nɛksdeɪ], *friendship* |
| 10 | Assimilation of place | B2.1 | *ten bikes* [tɛmbaɪks], *good girl* [ɡʊɡɡɜːl] |
| 11 | Linking /r/, intrusive /r/ (SSBE receptive) | B2.1 | *law(r) and order* |
| 12 | Compression / syllable loss in fast speech | B2.2 | *comfortable* [ˈkʌmftɚbɫ̩], *probably* [ˈprɑbli] |

---

## 2. Phonotactics & syllable structure

- **Maximal English syllable:** (C)(C)(C)V(C)(C)(C)(C) — *strengths* /strɛŋkθs/.
- **Onset clusters taught in order:**
  1. A1.2 — /s/+stop: *sp-, st-, sk-*
  2. A1.2 — stop+liquid: *pl-, pr-, bl-, br-, tr-, dr-, kl-, kr-, ɡl-, ɡr-, fl-, fr-*
  3. A2.1 — /s/+nasal/liquid: *sm-, sn-, sl-, sw-*
  4. A2.2 — 3-member: *spr-, str-, skr-, spl-, skw-*
  5. B1.1 — /θr-, ʃr-, θw-*
- **Coda clusters:** taught with the morphology that creates them — plural/3sg /-s -z -ɪz/ (A1.2), past /-t -d -ɪd/ (A2.1), superlative/comparative, then /-sts/, /-kθs/, /-mpts/ (B1+).
- **Illegal in English (must be explicitly de-trained for Turkic/Slavic L1s):** initial /ŋ/; /pn-, ps-, kn-, ɡn-, mn-/ pronounced fully (*knee* = /niː/); vowel epenthesis into clusters (*street* → *sitreet*) — see doc 14.

---

## 3. Word stress

### 3.1 Rules taught (explicitly, with the exceptions)

| # | Rule | Level | Examples |
|---|------|-------|----------|
| 1 | Every word of 2+ syllables has exactly one primary stress; longer words also have secondary | A1.2 | ˈta·ble, ˌun·der·ˈstand |
| 2 | Unstressed vowels reduce to /ə ɪ/ | A1.2 | *banana* [bəˈnænə] |
| 3 | 2-syllable nouns/adjectives → usually stress 1 | A2.1 | ˈdoctor, ˈhappy |
| 4 | 2-syllable verbs → usually stress 2 | A2.1 | to·ˈday? no — de·ˈcide, be·ˈgin |
| 5 | **Noun–verb stress pairs** | A2.2 | ˈREcord (n) / reˈCORD (v); ˈPREsent / preˈSENT; ˈOBject / obˈJECT; ˈCONtrast / conˈTRAST; ˈIMport / imˈPORT; ˈREbel / reˈBEL; ˈPERmit / perˈMIT; ˈINcrease / inˈCREASE; ˈCONduct / conˈDUCT; ˈSUSpect / susˈPECT (full list of 34 pairs in the item bank) |
| 6 | Suffixes that **carry** stress: *-ee, -eer, -ese, -ette, -esque, -oon* | B1.1 | employ·ˈEE, engin·ˈEER, Japan·ˈESE |
| 7 | Suffixes that **shift** stress to the preceding syllable: *-ic, -ical, -ity, -ity, -ion, -ial, -ious, -ify, -logy, -graphy, -meter* | B1.1 | ˈphoto → phoˈtography → photoˈgraphic; ˈable → aˈbility |
| 8 | Suffixes that are **stress-neutral**: *-ing, -ed, -er, -est, -ly, -ness, -ful, -less, -ment, -able* | B1.1 | ˈcomfort → ˈcomfortable |
| 9 | Compound nouns → stress on the **first** element | B1.2 | ˈgreenhouse, ˈblackboard, ˈbus stop |
| 10 | Adjective+noun phrases → stress on the **second** | B1.2 | green ˈhouse, black ˈboard |
| 11 | Phrasal verbs → stress on the **particle** as verbs, on the **first** as nouns | B2.1 | to take ˈoff / a ˈtakeoff |
| 12 | Stress shift in connected speech (rhythm rule) | B2.2 | thirˈTEEN → ˈTHIRteen ˈMEN; Japanˈese → ˈJapanese ˈfood |

### 3.2 The 300-word stress bank
A curated bank of the 300 highest-frequency polysyllabic words whose stress is most often mis-produced by L2 learners (e.g. *develop, comfortable, photograph/photography, necessary, temperature, interesting, vegetable, category, opportunity, particularly, February, restaurant, chocolate, business, hotel, police, prefer, machine, technique, unique*), each with audio, syllable-clap animation and a stress-tapping exercise.

---

## 4. Rhythm and weak forms

English is **stress-timed**: stressed syllables recur at roughly even intervals and everything between compresses. This is the biggest perceptual barrier for speakers of syllable-timed L1s and the reason learners "can't hear" fast English.

### 4.1 Weak forms (taught A2.1 onward; the full list of 45)

| Word | Strong | Weak | Example |
|------|--------|------|---------|
| a | /eɪ/ | /ə/ | *a book* /ə bʊk/ |
| an | /æn/ | /ən/ | |
| the | /ðiː/ | /ðə/ before C, /ði/ before V | |
| and | /ænd/ | /ən, n̩/ | *fish 'n' chips* |
| but | /bʌt/ | /bət/ | |
| that (conj) | /ðæt/ | /ðət/ | |
| than | /ðæn/ | /ðən/ | |
| as | /æz/ | /əz/ | |
| of | /ʌv/ | /əv, ə/ | *cup o' tea* |
| to | /tuː/ | /tə/ before C, /tu/ before V | *go to work* /ɡə tə wɝk/ |
| for | /fɔːr/ | /fɚ/ | |
| from | /frʌm/ | /frəm/ | |
| at | /æt/ | /ət/ | |
| can | /kæn/ | /kən, kn̩/ | **can /kən/ vs can't /kænt/ — a core B1 listening skill** |
| must | /mʌst/ | /məs(t)/ | |
| do | /duː/ | /də, d/ | *What d'you want?* |
| does | /dʌz/ | /dəz/ | |
| have | /hæv/ | /həv, əv, v/ | *I've*, *should've* = /ʃʊdəv/ — hence *should of* misspelling |
| has | /hæz/ | /həz, əz, z/ | |
| had | /hæd/ | /həd, əd, d/ | |
| was | /wʌz/ | /wəz/ | |
| were | /wɝ/ | /wɚ/ | |
| are | /ɑːr/ | /ɚ/ | |
| am | /æm/ | /əm/ | |
| be / been | | /bi/, /bɪn/ | |
| will | /wɪl/ | /l̩/ | *I'll* |
| would | /wʊd/ | /wəd, d/ | |
| shall/should | | /ʃəl/, /ʃəd/ | |
| he / him / his / her / them / us / your / you | | /i, ɪm, ɪz, ɚ, ðəm/ðm̩, əs, jɚ, jə/ | *Did he?* /dɪdi/ |
| there (existential) | /ðeɪr/ | /ðɚ/ | |
| some (quantifier) | /sʌm/ | /səm/ | |
| not | /nɑt/ | /n̩t/ | |

Rule taught explicitly: **weak forms take strong form when stressed, final in a clause, or contrastive** — *Who's it for?* /fɔːr/.

### 4.2 Contractions
Full inventory taught A1.2–B1.1, including negative contractions (*isn't/aren't/wasn't/weren't/don't/doesn't/didn't/haven't/hasn't/hadn't/won't/wouldn't/can't/couldn't/shouldn't/mustn't/mightn't/needn't/shan't*), double contractions receptively at B2 (*I'd've, wouldn't've, she'll've*), and spoken reductions at B2 (*gonna, wanna, gotta, kinda, sorta, lemme, gimme, dunno, whatcha, cuppa, ain't*) — **receptive-first, production optional and register-flagged.**

---

## 5. Connected speech (the "listening cliff")

Taught as a systematic module at B1.1 and drilled to B2.2. Each process gets its own exercise type (`dictation_connected`, doc 09).

| Process | Definition | Examples | Level |
|---------|------------|----------|-------|
| **Linking C→V** | Final consonant attaches to next vowel | *an apple* → [əˈnæpḷ]; *turn it off* → [tɝnɪˈtɔf] | A2.2 |
| **Linking V→V with /j/ /w/** | Glide inserted | *he is* → [hiːjɪz]; *do it* → [duːwɪt] | B1.1 |
| **Linking /r/** (SSBE) | Silent r pronounced before vowel | *far away* | B1.2 (receptive) |
| **Geminate reduction** | Identical consonants merge | *bus stop* → [bʌstɑp] | B1.1 |
| **Elision of /t/ /d/** | Middle of 3-consonant cluster deleted | *next week*, *old man*, *most people* | B1.1 |
| **Elision of /h/** | In unstressed pronouns | *ask her* → [æskɚ] | B1.2 |
| **Elision of schwa** | *police* → [pliːs], *camera* → [ˈkæmrə] | B2.1 |
| **Assimilation (regressive place)** | /t d n/ → /p b m/ before bilabials, /k ɡ ŋ/ before velars | *ten men* → [tɛmmɛn]; *that girl* → [ðækɡɜːl] | B2.1 |
| **Coalescence (yod)** | /t+j/→/tʃ/, /d+j/→/dʒ/, /s+j/→/ʃ/, /z+j/→/ʒ/ | *want you* → [wɑntʃu]; *would you* → [wʊdʒu]; *miss you* → [mɪʃu] | B1.2 |
| **Catenation across words** | Whole-phrase resyllabification | *a cup of tea* → [əˈkʌ‿pə‿ˈftiː] | B2.1 |

**Design requirement:** every listening item from B1 up must include at least one connected-speech process, and the app must be able to display the "slow careful" and "natural fast" versions of the same sentence side by side with the processes highlighted. This single feature closes more of the listening gap than any amount of vocabulary work.

---

## 6. Intonation and prosody

### 6.1 Tone units
- **Tonality:** dividing speech into tone units (chunks). Taught B1.1 with pause-marking exercises.
- **Tonicity:** placing the nucleus (main stress) in the unit. Default = last lexical item; shifts for contrast, given/new information. Taught B1.2. **This is the highest-value prosody skill** — wrong nucleus placement causes more misunderstanding than any segment error.
- **Tone:** the pitch movement on the nucleus.

### 6.2 The five nuclear tones

| Tone | Symbol | Meaning | Example | Level |
|------|--------|---------|---------|-------|
| Fall | ↘ | Complete, definite, wh-questions, statements, commands | *Where do you ↘live?* | A1.2 |
| Rise | ↗ | Incomplete, yes/no questions, encouraging, listing non-final | *Are you ↗ready?* | A1.2 |
| Fall–rise | ↘↗ | Reservation, polite disagreement, implication, "but…" | *I ↘↗like it…* (implying "but") | B1.2 |
| Rise–fall | ↗↘ | Strong emotion, impressed, sarcastic | *That's ↗↘wonderful!* | B2.1 |
| Level | → | Routine, bored, reciting | | B2.2 |

### 6.3 Functional intonation taught explicitly

| Function | Pattern | Level |
|----------|---------|-------|
| Statement vs question with same words | fall vs rise | A1.2 |
| Lists | rise-rise-rise-fall | A2.1 |
| Tag questions: genuine (rise) vs rhetorical (fall) | | B1.2 |
| Politeness in requests | wider pitch range + fall–rise | B1.2 |
| Contrastive stress | nucleus shift | B1.2 |
| Given/new information structure | | B2.1 |
| Signalling "there's more coming" | non-final rise / level | B2.1 |
| Turn-yielding vs turn-holding | fall vs level+no pause | B2.2 |
| Corrective / contradictory stress | *I didn't say **he** stole it* (7 meanings of one sentence) | B2.2 |
| Irony, understatement, sarcasm | rise–fall, exaggerated range, flat delivery | C1 |
| Emphatic and rhetorical prosody in presentation | | C1–C2 |

### 6.4 The 7-meanings drill (a signature exercise)
"I never said she took my money." — stress each of the 7 words in turn; the learner matches each rendition to its meaning. Introduced B1.2, revisited C1 with harder sets. This is the clearest possible demonstration that prosody carries propositional meaning.

---

## 7. Spelling–sound correspondence (phonics for adults)

English orthography is ~75% predictable if the rules are taught. It is *not* taught as "just memorise."

### 7.1 Sequence

| Stage | Level | Content |
|-------|-------|---------|
| 1 | A1.1 | 26 letters, names vs sounds; the 5 short vowels a-e-i-o-u; the most frequent consonant graphemes |
| 2 | A1.1 | Consonant digraphs: *ch, sh, th, ph, wh, ck, ng, qu* |
| 3 | A1.2 | Magic-e / split digraph: *a_e, e_e, i_e, o_e, u_e* (*hat→hate, kit→kite*) |
| 4 | A1.2 | Vowel digraphs: *ai/ay, ee/ea, oa/ow, ie/igh, oo (both), ou/ow, oi/oy, au/aw, ew/ue* |
| 5 | A2.1 | R-controlled vowels: *ar, or, er, ir, ur, ear, air, ore* |
| 6 | A2.1 | Soft c/g rule (before e, i, y); *-tch, -dge* after short vowels |
| 7 | A2.2 | Silent letters: *kn-, wr-, gn-, -mb, -lm, -mn, -st(en), gh, ps-, pn-* |
| 8 | A2.2 | Doubling rule (1-1-1 rule): *stop→stopping*; drop-e rule; y→i rule |
| 9 | B1.1 | Suffix spelling: *-tion/-sion/-cian*, *-able/-ible*, *-ance/-ence*, *-ary/-ery/-ory* |
| 10 | B1.2 | Schwa spelling traps: *separate, definite, grammar, calendar, independent* |
| 11 | B2.1 | Greek/Latin roots and their spellings: *ph, ch=/k/, y=/ɪ/, rh, mn* |
| 12 | B2.2 | Homophone banks (150 pairs): *their/there/they're, its/it's, your/you're, to/too/two, affect/effect, principal/principle, complement/compliment, stationary/stationery, practice/practise (UK)* |
| 13 | C1 | Etymological spelling; loanword spelling (*rendezvous, bourgeois, tsunami, jalapeño*) |

### 7.2 US/UK spelling map (stored on every lexeme)
*-or/-our* · *-er/-re* · *-ize/-ise* · *-yze/-yse* · *-og/-ogue* · *-ense/-ence* · single/double *l* (*traveling/travelling*) · *ae/oe* simplification (*encyclopedia/encyclopaedia*) · individual pairs (*program/programme, tire/tyre, curb/kerb, aluminum/aluminium, jewelry/jewellery, gray/grey, plow/plough, check/cheque, story/storey*).

---

## 8. Per-level phonology syllabus (the delivery schedule)

| Level | Segments | Prosody | Connected speech | Orthography | Minimal-pair sets |
|-------|----------|---------|------------------|-------------|-------------------|
| **A1.1** | All 24 consonants; 11 core vowels; schwa concept | Syllables & clapping; primary word stress | — | Alphabet, short vowels, digraphs | 12 sets |
| **A1.2** | /θ ð ŋ ʊ ɔː ɔɪ aʊ ɜːr ɚ/; aspiration | Word stress rules 1–2; fall vs rise | — | Magic-e; vowel digraphs | 18 sets |
| **A2.1** | Pre-fortis clipping; flapping | Stress rules 3–4; list intonation | Linking C→V | R-controlled; soft c/g | 20 sets |
| **A2.2** | Dark /l/; syllabic consonants | Noun–verb stress pairs | Linking; geminates | Silent letters; doubling | 20 sets |
| **B1.1** | /ʒ/; nasal plosion; glottal /t/ | Tone units; tonicity intro; fall–rise | Elision /t d/; /j w/ linking | Suffix spelling | 22 sets |
| **B1.2** | /nt/ deletion; yod coalescence | Tag questions; contrastive stress; 7-meanings drill | Coalescence; /h/-elision | Schwa traps | 20 sets |
| **B2.1** | Assimilation of place; schwa elision | Rise–fall; given/new; turn signals | Full assimilation; catenation | Greek/Latin roots | 18 sets |
| **B2.2** | Compression; fast-speech reduction | Stress shift (rhythm rule); turn-holding | All processes at 180 wpm | Homophones | 15 sets |
| **C1** | Accent variation (8 accents receptive) | Irony, understatement, emphasis | Degraded-audio listening | Etymology | 12 sets |
| **C2** | Stylistic and rhetorical prosody | Full rhetorical control; regional style | Native-speed everything | Loanwords | 8 sets |

**Total minimal-pair sets: 165**, ~20 pairs each ≈ 3,300 minimal-pair items, all with audio, all schedulable in the SRS.

### 8.1 The 25 highest-value minimal-pair contrasts (in priority order)
1. /ɪ/–/iː/ *ship–sheep, bit–beat, live–leave, fit–feet, it–eat*
2. /æ/–/e/ *bad–bed, man–men, sat–set, had–head*
3. /æ/–/ʌ/ *cat–cut, bat–but, ran–run, match–much*
4. /ʌ/–/ɑː/ *cup–carp, but–bought, luck–lock*
5. /ʊ/–/uː/ *full–fool, pull–pool, could–cooed*
6. /θ/–/s/ *think–sink, thick–sick, mouth–mouse*
7. /θ/–/t/ *thin–tin, three–tree, thought–taught*
8. /ð/–/d/ *they–day, there–dare, breathe–breed*
9. /ð/–/z/ *breathe–breeze, clothing–closing*
10. /v/–/w/ *vest–west, veil–whale, vine–wine*
11. /v/–/b/ *vote–boat, van–ban, curve–curb*
12. /v/–/f/ *leave–leaf, save–safe, live–life*
13. /b/–/p/ *bat–pat, cab–cap, rib–rip*
14. /ɡ/–/k/ *goat–coat, bag–back, log–lock*
15. /d/–/t/ *do–to, bad–bat, card–cart*
16. /ʃ/–/tʃ/ *ship–chip, wash–watch, cash–catch*
17. /ʒ/–/dʒ/ *measure–major (positional)*
18. /s/–/ʃ/ *sea–she, sock–shock, mass–mash*
19. /n/–/ŋ/ *thin–thing, sin–sing, ban–bang*
20. /l/–/ɹ/ *light–right, glass–grass, collect–correct, fly–fry*
21. /eɪ/–/e/ *late–let, main–men, pain–pen*
22. /oʊ/–/ɔː/ *coat–caught, so–saw, boat–bought*
23. /aɪ/–/ɔɪ/ *bite–boyt? → tie–toy, file–foil*
24. /ɜːr/–/ɑːr/–/ɔːr/ *bird–bard–board, fur–far–four*
25. Vowel length before voiced/voiceless: *bat–bad, back–bag, seat–seed*

---

## 9. How pronunciation is taught (method, not just content)

Every pronunciation item follows the **Notice → Discriminate → Produce → Automatise** cycle:

1. **Notice** — hear the sound in a real word; see the mouth diagram / short articulation video; see the IPA symbol.
2. **Discriminate (receptive)** — minimal-pair identification: hear one, tap which word. Must reach **90% over 20 trials** before production is required. *You cannot produce a contrast you cannot hear.* This gate is non-negotiable and is the single most-skipped step in competing products.
3. **Produce (controlled)** — record the word; GOP scoring; visual feedback on the specific phone.
4. **Produce (in context)** — the sound inside a phrase, then a sentence, then a tongue-twister/chant.
5. **Automatise** — the item enters the SRS with a *production* review type; shadowing tasks at natural speed.

**Articulatory instruction is explicit.** For each difficult phone the app provides: a mid-sagittal animation; a plain-language instruction ("put the tip of your tongue between your teeth and blow"); a common-error contrast ("if you feel your top teeth on your bottom lip, you're saying /f/"); and a self-check ("hold a finger in front of your mouth — you should feel air").

---

## 10. Pronunciation scoring model

### 10.1 What is scored

| Layer | Metric | Method |
|-------|--------|--------|
| Phone | **GOP** (goodness of pronunciation) per phone | Forced alignment against the expected phone sequence with an acoustic model; GOP = log posterior of the expected phone minus max over all phones |
| Word | Word-level accuracy | Mean GOP over phones, weighted by phone salience (contrastive phones weighted ×2) |
| Stress | Primary-stress placement | F0 + intensity + duration peak on the expected syllable |
| Rhythm | Stress-timing index | nPVI (normalised pairwise variability index) of vowel durations vs a native reference band |
| Intonation | Nucleus placement, tone direction | F0 contour matched against reference tone templates (DTW) |
| Fluency | Speech rate, articulation rate, pause count/length, filled-pause rate, repetition rate | Forced alignment timings |
| Intelligibility | Word error rate of an *independent* ASR pass | A second ASR with no expected-text prior; WER against the target is the closest proxy to "would a stranger understand you" |

### 10.2 Scoring policy (this matters more than the algorithm)

- Report **one** headline number (0–100) plus **at most two** specific, actionable notes. Never a wall of red.
- Thresholds by level — the same utterance is scored against different bars:

| Level | Pass GOP (word) | Intelligibility (independent-ASR WER) | Stress accuracy |
|-------|----------------:|--------------------------------------:|----------------:|
| A1 | ≥ 40 | ≤ 40% | ≥ 60% |
| A2 | ≥ 50 | ≤ 30% | ≥ 70% |
| B1 | ≥ 60 | ≤ 22% | ≥ 80% |
| B2 | ≥ 68 | ≤ 15% | ≥ 88% |
| C1 | ≥ 75 | ≤ 10% | ≥ 92% |
| C2 | ≥ 80 | ≤ 7% | ≥ 95% |

- **Never fail a learner for accent.** The scorer must distinguish *substitution of a contrastive phoneme* (fail — *ship/sheep*) from *accented realisation of the right phoneme* (pass — a trilled /r/ that is still clearly /r/).
- Calibrate the model on **L2 speech**, including Uzbek-, Russian-, Turkish-, Arabic-, Spanish- and Chinese-accented English. A model trained only on native speech will systematically under-score every learner and destroy their confidence.
- Offer "no-microphone mode" and a full non-speaking path — some learners are in shared spaces, and some are deaf or hard of hearing.
