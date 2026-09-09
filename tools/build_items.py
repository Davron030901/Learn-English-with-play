#!/usr/bin/env python3
"""
build_items.py — generate the exercise item bank for the built units.

Reads:  build/lexemes.json, build/units/*.json,
        content/syllabus/{grammar,phonology,functions}-a1.json,
        content/texts/stories-s01.json, content/texts/story-questions-s01.json
Writes: build/items/<NODE>T<tier>.json  and  build/items.json (all items)

Design rules implemented here (see docs/09 §4 and docs/08 §5.1):
  * tier 1 recognition-led, tier 2 recall-led, tier 3 production/timed
  * every item carries the memory-item ids it retrieves
  * distractors are same-POS and diagnostic; the interference partner of a
    lexeme is EXCLUDED at tiers 1-2 and DELIBERATELY INCLUDED at tier 3
    (acquisition first, discrimination after — docs/08 §8)
  * no more than 3 consecutive items share a target, no more than 2 share a type
"""
import json, os, random, re, glob
from collections import defaultdict

random.seed(20260908)          # deterministic builds
SYLL_VER = "1.0"
OUT_DIR = "build/items"

# ---------------------------------------------------------------- load

LEX = json.load(open("build/lexemes.json", encoding="utf-8"))
LEX_BY_ID = {l["id"]: l for l in LEX}
GRAM = {g["id"]: g for g in json.load(open("content/syllabus/grammar-a1.json", encoding="utf-8"))}
PHON = {p["id"]: p for p in json.load(open("content/syllabus/phonology-a1.json", encoding="utf-8"))}
FUNC = {f["id"]: f for f in json.load(open("content/syllabus/functions-a1.json", encoding="utf-8"))}
STORIES = {t["id"]: t for t in json.load(open("content/texts/stories-s01.json", encoding="utf-8"))["texts"]}
SQ = json.load(open("content/texts/story-questions-s01.json", encoding="utf-8"))["questions"]
UNITS = [json.load(open(p, encoding="utf-8")) for p in sorted(glob.glob("build/units/*.json"))]

# lexemes available at or before a given unit index (the vocabulary gate)
UNIT_ORDER = [u["id"] for u in UNITS]
AVAILABLE = {}
_seen = []
for u in UNITS:
    _seen = _seen + u["syllabus"]["lexis"]
    AVAILABLE[u["id"]] = list(_seen)

# ---- vocabulary gate applied at generation time (docs/00 §4.2, the +1 rule)
METALANGUAGE = {"what","who","when","where","why","how","which","whose","many","much",
 "the","a","an","of","at","in","on","to","for","with","by","and","or","but","not",
 "both","all","nobody","nothing","everything","them","it","is","are","do","does",
 "did","story","end","time","only","say","ask","know","happen","happening","we",
 "i","you","he","she","they","correct","true","false","yes","no","one","two",
 "three","four","five","six","seven","eight","nine","ten","twelve","us","this",
 "that","these","those","there","here","his","her","my","your","our","their"}

NAMES = {"sarah","aziz","kamola","bobur","karimov","tashkent","samarkand","bukhara",
         "khiva","andijan","nukus","navoi","temur","amir","uzbekistan","england",
         "america","russia","turkey","london","istanbul","japan","navruz","chimgan",
         "fergana","termez","registan","kyzylkum","mr","mrs","ms","som"}
_WORD = re.compile(r"[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ']*")
_FORMS = {}

def forms_upto(uid):
    if uid in _FORMS: return _FORMS[uid]
    f = set()
    for lid in AVAILABLE[uid]:
        l = LEX_BY_ID[lid]
        f.add(l["lemma"].lower())
        f.update(x.lower() for x in l["spelling"]["inflections"])
        f.update({l["spelling"]["us"].lower(), l["spelling"]["uk"].lower()})
        f.update(l["lemma"].lower().split())
    f |= {"i'm","you're","he's","she's","it's","we're","they're","isn't","aren't",
          "don't","doesn't","can't","cannot","wasn't","weren't","didn't","let's",
          "that's","what's","where's","who's","there's","i'd","haven't","hasn't",
          "am","is","are","was","were","has","had","does","did","doing","done",
          "here","its"}
    _FORMS[uid] = f
    return f

def vocab_ok(texts, uid, allow=0):
    f = forms_upto(uid)
    unknown = set()
    for t in texts:
        if not isinstance(t, str): continue
        for w in _WORD.findall(t):
            lw = w.lower()
            if lw in f or lw in NAMES or lw in METALANGUAGE: continue
            if lw.rstrip("s") in f: continue
            unknown.add(lw)
    return len(unknown) <= allow

# Types whose visible words are vehicles for something else (a sound, a taught
# formula) rather than vocabulary the learner must already know. The word is
# always glossed on screen, so the +1 rule does not apply to them.
VOCAB_EXEMPT = {"minimal_pair_discrimination", "phoneme_id", "pragmatics_choose",
                "speak_prompt", "speak_roleplay", "speak_retell", "repeat_after",
                "stress_tap", "write_sentence"}

DROPPED = defaultdict(int)
OUT_OF_SEQUENCE = defaultdict(set)   # grammar/function id -> words above level

_counter = 0
def next_id():
    global _counter
    _counter += 1
    return f"item.{_counter:07d}"

def lemma(lid):     return LEX_BY_ID[lid]["lemma"]
def gloss(lid):     return LEX_BY_ID[lid]["l1_gloss"]["uz"]
def pos(lid):       return LEX_BY_ID[lid]["pos"]
def audio(lid):     return LEX_BY_ID[lid]["audio"]["word_ga"]
def examples(lid):  return [e["text"] for e in LEX_BY_ID[lid]["examples"]]
def interferer(lid):
    r = LEX_BY_ID[lid].get("related", {})
    return (r.get("interferes_with") or [None])[0]

# ---------------------------------------------------------------- helpers

def distractors(target_id, pool, n=3, tier=1):
    """Same-POS, topic-preferring distractors. The interference partner is
    withheld until tier 3, then deliberately used (docs/08 §8)."""
    t = LEX_BY_ID[target_id]
    inter = interferer(target_id)
    cands = [i for i in pool
             if i != target_id
             and pos(i) == t["pos"]
             and lemma(i) != t["lemma"]]
    if tier < 3 and inter:
        cands = [i for i in cands if i != inter]
    same_topic = [i for i in cands if set(LEX_BY_ID[i]["topic_tags"]) & set(t["topic_tags"])]
    picked = []
    if tier == 3 and inter and inter in pool:
        picked.append(inter)
    random.shuffle(same_topic); random.shuffle(cands)
    for src in (same_topic, cands):
        for c in src:
            if len(picked) >= n: break
            if c not in picked: picked.append(c)
    return picked[:n]

def mcq(prompt_text, key_text, wrong_texts, **kw):
    opts = [key_text] + wrong_texts
    random.shuffle(opts)
    return opts, opts.index(key_text)

def blank(sentence, word):
    """Replace the first inflected occurrence of `word` with a gap."""
    forms = sorted({word, word + "s", word + "es", word + "d", word + "ed",
                    word + "ing", word.rstrip("e") + "ing"}, key=len, reverse=True)
    for f in forms:
        m = re.search(rf"\b{re.escape(f)}\b", sentence, flags=re.I)
        if m:
            return sentence[:m.start()] + "___" + sentence[m.end():], m.group(0)
    return None, None

def tokens(sentence):
    return re.findall(r"[A-Za-z']+|[.,!?]", sentence)

def base_item(type_id, node, tier, targets, memory_items, prompt, answer,
              feedback=None, constraints=None, cefr="A1.1"):
    it = {
        "id": next_id(), "type_id": type_id, "node": node, "tier": tier,
        "targets": targets, "cefr": cefr, "memory_items": memory_items,
        "prompt": prompt, "answer": answer,
        "authoring": {"generator": "build_items.py", "created": "2026-09-08",
                      "corpus_checked": False},
        "status": "draft", "syllabus_version": SYLL_VER,
    }
    if feedback:   it["feedback"] = {k: v for k, v in feedback.items() if v}
    if constraints:
        c = {k: v for k, v in constraints.items() if v is not None}
        if c: it["constraints"] = c
    it["prompt"] = {k: v for k, v in it["prompt"].items()
                    if v is not None or k in ("audio", "image")}
    it["answer"] = {k: v for k, v in it["answer"].items() if v is not None}
    return it

NORM = ["case", "punct", "spacing", "spelling_variant", "contraction"]

# ---------------------------------------------------------------- lexis templates

def t_tap_pairs(node, tier, ids):
    sel = ids[:6]
    pairs = [[lemma(i), gloss(i)] for i in sel]
    return base_item("tap_pairs", node, tier,
        {"lexis": sel}, [f"{i}.recog" for i in sel],
        {"instruction_key": "instr.tap_pairs", "pairs": pairs},
        {"mapping": {lemma(i): gloss(i) for i in sel}},
        {"correct": "Good — you matched them all."})

def t_mcq_word(node, tier, lid, pool):
    ds = distractors(lid, pool, 3, tier)
    opts, idx = mcq(None, lemma(lid), [lemma(d) for d in ds])
    return base_item("mcq_word_from_definition", node, tier,
        {"lexis": [lid]}, [f"{lid}.recog"],
        {"text_uz": gloss(lid), "instruction_key": "instr.mcq_word", "options": opts},
        {"index": idx},
        {"correct": f"Yes — '{lemma(lid)}'.",
         "incorrect_default": f"'{gloss(lid)}' = {lemma(lid)}."})

def t_type_from_l1(node, tier, lid):
    return base_item("type_from_l1", node, tier,
        {"lexis": [lid]}, [f"{lid}.recall"],
        {"text_uz": gloss(lid), "instruction_key": "instr.type_from_l1",
         "audio": None},
        {"key": [lemma(lid)],
         "accepted": sorted({LEX_BY_ID[lid]["spelling"]["us"], LEX_BY_ID[lid]["spelling"]["uk"]}),
         "normalise": NORM + (["typo1"] if tier < 3 else [])},
        {"incorrect_default": f"'{gloss(lid)}' = {lemma(lid)}"},
        {"max_seconds": 20 if tier == 3 else None, "hints_allowed": 1 if tier < 3 else 0})

def t_spelling_bee(node, tier, lid):
    return base_item("spelling_bee", node, tier,
        {"lexis": [lid]}, [f"{lid}.spell"],
        {"audio": audio(lid), "instruction_key": "instr.spelling_bee"},
        {"key": [lemma(lid)],
         "accepted": sorted({LEX_BY_ID[lid]["spelling"]["us"], LEX_BY_ID[lid]["spelling"]["uk"]}),
         "normalise": ["case", "spacing", "spelling_variant"]},
        {"incorrect_default": f"Listen again: /{LEX_BY_ID[lid]['phonology']['ipa_ga']}/"},
        {"plays_allowed": 3 if tier == 1 else 2})

def t_dictation_word(node, tier, lid):
    return base_item("dictation_word", node, tier,
        {"lexis": [lid]}, [f"{lid}.aural"],
        {"audio": LEX_BY_ID[lid]["audio"]["slow_ga"] if tier == 1 else audio(lid),
         "instruction_key": "instr.dictation_word"},
        {"key": [lemma(lid)], "normalise": ["case", "punct", "spacing", "spelling_variant"]},
        None, {"plays_allowed": 3 if tier == 1 else 2})

def t_stress_tap(node, tier, lid):
    ipa = LEX_BY_ID[lid]["phonology"]["ipa_ga"]
    n = LEX_BY_ID[lid]["phonology"]["syllables"]
    if n < 2: return None
    stress = int(LEX_BY_ID[lid]["phonology"]["stress"].split(",")[0])
    syls = re.findall(r"[bcdfghjklmnpqrstvwxyz]*[aeiouy]+[bcdfghjklmnpqrstvwxyz]*",
                      lemma(lid), flags=re.I) or [lemma(lid)]
    if len(syls) != n:
        syls = [lemma(lid)[i::n] for i in range(n)]
    return base_item("stress_tap", node, tier,
        {"lexis": [lid], "phonology": ["P-018"]}, [f"{lid}.recog", "P-018.disc"],
        {"text": lemma(lid), "audio": audio(lid), "syllables": syls,
         "instruction_key": "instr.stress_tap"},
        {"index": stress - 1},
        {"incorrect_default": f"The stress is on syllable {stress}: /{ipa}/"})

def t_repeat_after(node, tier, lid):
    return base_item("repeat_after", node, tier,
        {"lexis": [lid]}, [f"{lid}.prod"],
        {"text": lemma(lid), "audio": audio(lid), "instruction_key": "instr.repeat_after"},
        {"key": [lemma(lid)]},
        {"incorrect_default": f"Try again: /{LEX_BY_ID[lid]['phonology']['ipa_ga']}/"})

def t_gap_from_example(node, tier, lid, pool, free=False):
    for ex in examples(lid):
        gapped, form = blank(ex, lemma(lid))
        if gapped:
            if free:
                return base_item("gap_fill_free", node, tier,
                    {"lexis": [lid]}, [f"{lid}.recall"],
                    {"text": gapped, "instruction_key": "instr.gap_fill_free"},
                    {"key": [form], "accepted": [form, lemma(lid)], "normalise": NORM},
                    {"incorrect_default": f"'{gloss(lid)}' = {lemma(lid)}"})
            ds = distractors(lid, pool, 3, tier)
            bank = [form] + [lemma(d) for d in ds]
            random.shuffle(bank)
            return base_item("gap_fill_bank", node, tier,
                {"lexis": [lid]}, [f"{lid}.recog"],
                {"text": gapped, "bank": bank, "instruction_key": "instr.gap_fill_bank"},
                {"key": [form], "normalise": NORM})
    return None

def t_word_bank_build(node, tier, lid, pool):
    ex = examples(lid)[0]
    toks = tokens(ex)
    if len(toks) > 10: return None
    ds = [lemma(d) for d in distractors(lid, pool, 2, tier)]
    bank = toks + ds
    random.shuffle(bank)
    return base_item("word_bank_build", node, tier,
        {"lexis": [lid]}, [f"{lid}.recall"],
        {"text_uz": "", "bank": bank, "audio": None,
         "instruction_key": "instr.word_bank_build"},
        {"key": [ex], "normalise": ["case", "punct", "spacing"]})

def t_dictation_sentence(node, tier, sentence, targets, mem):
    return base_item("dictation_sentence", node, tier,
        targets, mem,
        {"audio": "a/gen_sentence.opus", "text": None,
         "instruction_key": "instr.dictation_sentence"},
        {"key": [sentence], "normalise": NORM},
        None, {"plays_allowed": 2})

def t_odd_one_out(node, tier, ids):
    by_topic = defaultdict(list)
    for i in ids: by_topic[LEX_BY_ID[i]["topic_tags"][0]].append(i)
    big = max(by_topic.values(), key=len)
    if len(big) < 3: return None
    others = [i for i in ids if i not in big]
    if not others: return None
    odd = random.choice(others)
    opts = [lemma(x) for x in big[:3]] + [lemma(odd)]
    random.shuffle(opts)
    return base_item("odd_one_out", node, tier,
        {"lexis": big[:3] + [odd]}, [f"{i}.recog" for i in big[:3] + [odd]],
        {"options": opts, "instruction_key": "instr.odd_one_out"},
        {"index": opts.index(lemma(odd))},
        {"correct": "Right — the others are in the same group."})

def t_sort_bins_count(node, tier, ids):
    c = [i for i in ids if LEX_BY_ID[i].get("grammar", {}).get("countable") is True]
    u = [i for i in ids if LEX_BY_ID[i].get("grammar", {}).get("countable") is False]
    if len(c) < 2 or len(u) < 2: return None
    sel = c[:4] + u[:4]
    return base_item("sort_bins", node, tier,
        {"lexis": sel, "grammar": ["G-053"]}, [f"{i}.recog" for i in sel] + ["G-053.choice"],
        {"options": [lemma(i) for i in sel], "bins": ["countable", "uncountable"],
         "instruction_key": "instr.sort_bins"},
        {"mapping": {lemma(i): ("countable" if i in c else "uncountable") for i in sel}},
        {"incorrect_default": "Uncountable nouns have no plural and take no a/an."})

def t_word_race(node, tier, ids):
    sel = ids[:12]
    return base_item("word_race", node, tier,
        {"lexis": sel}, [f"{i}.recog" for i in sel],
        {"pairs": [[lemma(i), gloss(i)] for i in sel],
         "instruction_key": "instr.word_race"},
        {"mapping": {lemma(i): gloss(i) for i in sel}},
        None, {"max_seconds": 60})

def t_memory_match(node, tier, ids):
    sel = ids[:6]
    if len(sel) < 4: return None
    return base_item("memory_match", node, tier,
        {"lexis": sel}, [f"{i}.recog" for i in sel],
        {"pairs": [[lemma(i), gloss(i)] for i in sel],
         "instruction_key": "instr.memory_match"},
        {"mapping": {lemma(i): gloss(i) for i in sel}},
        None, {"max_seconds": 120})

def t_write_sentence(node, tier, lid, gid=None):
    l = LEX_BY_ID[lid]
    spec = f"Write one sentence about yourself using '{l['lemma']}'."
    if gid:
        spec += f" ({GRAM[gid]['label']})"
    return base_item("write_sentence", node, tier,
        {"lexis": [lid], **({"grammar": [gid]} if gid else {})},
        [f"{lid}.prod"] + ([f"{gid}.form"] if gid else []),
        {"text": spec, "instruction_key": "instr.write_sentence"},
        {"key": [], "normalise": NORM},
        {"correct": "Good sentence."})

def t_speak_prompt_lex(node, tier, lid):
    l = LEX_BY_ID[lid]
    return base_item("speak_prompt", node, tier,
        {"lexis": [lid]}, [f"{lid}.prod"],
        {"text": f"Say one sentence about yourself using '{l['lemma']}'.",
         "instruction_key": "instr.speak_prompt"},
        {"key": []},
        {"correct": "Good. Now say it without stopping."},
        {"max_seconds": 30})

def t_read_aloud(node, tier, sentence, targets, mem):
    return base_item("read_aloud", node, tier, targets, mem,
        {"text": sentence, "instruction_key": "instr.read_aloud"},
        {"key": [sentence]},
        {"correct": "Clear. Now say it a little faster."},
        {"max_seconds": 30})

# ---------------------------------------------------------------- grammar templates

def t_gram_gap(node, tier, gid, pool):
    g = GRAM[gid]
    ex = g.get("positive_example", "")
    words = [w.strip(".,!?") for w in ex.split() if len(w.strip(".,!?")) > 1]
    if not words: return None
    key = words[0] if len(words) == 1 else words[min(1, len(words) - 1)]
    gapped = re.sub(rf"\b{re.escape(key)}\b", "___", ex, count=1)
    bank = [key] + [w for w in ("is", "are", "am", "do", "does", "the", "a") if w != key][:3]
    random.shuffle(bank)
    return base_item("gap_fill_bank", node, tier,
        {"grammar": [gid]}, [f"{gid}.form"],
        {"text": gapped, "bank": bank, "instruction_key": "instr.gap_fill_bank"},
        {"key": [key], "normalise": NORM},
        {"incorrect_default": g["explanation"]["en"], "explain_ref": gid})

def t_gram_judge(node, tier, gid):
    g = GRAM[gid]
    if not g.get("negative_example"): return None
    use_wrong = random.random() < 0.5
    sent = g["negative_example"] if use_wrong else g["positive_example"]
    return base_item("grammaticality_judgement", node, tier,
        {"grammar": [gid]}, [f"{gid}.judge"],
        {"text": sent, "options": ["Correct", "Not correct"],
         "instruction_key": "instr.grammaticality_judgement"},
        {"index": 1 if use_wrong else 0},
        {"incorrect_default": g["explanation"]["en"], "explain_ref": gid},
        {"max_seconds": 4 if tier == 3 else 10})

def t_gram_error_correct(node, tier, gid, k=0):
    g = GRAM[gid]
    errs = [e for e in g.get("known_errors", []) if e.startswith("*")]
    if len(errs) <= k: return None
    wrong = errs[k].lstrip("*").strip()
    return base_item("error_correct", node, tier,
        {"grammar": [gid]}, [f"{gid}.judge", f"{gid}.form"],
        {"text": wrong, "instruction_key": "instr.error_correct"},
        {"key": [g["positive_example"]], "normalise": NORM,
         "rejected_with_feedback": [{"pattern": wrong, "feedback": g["explanation"]["en"],
                                     "error_code": "GRAM"}]},
        {"incorrect_default": g["explanation"]["uz"], "explain_ref": gid},
        {"hints_allowed": 1 if tier < 3 else 0})

def t_gram_reorder(node, tier, gid):
    g = GRAM[gid]
    ex = g.get("positive_example", "")
    toks = tokens(ex)
    if len(toks) < 3 or len(toks) > 10: return None
    bank = toks[:]; random.shuffle(bank)
    return base_item("sentence_reorder", node, tier,
        {"grammar": [gid]}, [f"{gid}.form"],
        {"bank": bank, "instruction_key": "instr.sentence_reorder"},
        {"key": [ex], "normalise": ["case", "punct", "spacing"]},
        {"explain_ref": gid})

# ---------------------------------------------------------------- phonology / function templates

def t_minimal_pair(node, tier, pid, k=0):
    """One trial of the perception gate. docs/02 §9 step 2 requires a block of
    these to reach 90% BEFORE production of the contrast is asked for, so the
    generator emits several per point rather than one."""
    p = PHON[pid]
    pairs = p.get("minimal_pairs") or []
    if not pairs: return None
    a, b = pairs[k % len(pairs)]
    heard = a if (k % 2 == 0) else b
    opts = [a, b]
    return base_item("minimal_pair_discrimination", node, tier,
        {"phonology": [pid]}, [f"{pid}.disc"],
        {"audio": f"a/mp_{heard}.opus", "options": opts,
         "instruction_key": "instr.minimal_pair"},
        {"index": opts.index(heard)},
        {"incorrect_default": p.get("articulation", {}).get("instruction_uz", "")},
        {"plays_allowed": 3 if tier == 1 else 2})

def t_phoneme_id(node, tier, pid, pool):
    p = PHON[pid]
    words = p.get("example_words") or []
    if len(words) < 2: return None
    target = words[tier % len(words)]
    others = [lemma(i) for i in pool if p["label"].split()[0].strip("/") not in
              LEX_BY_ID[i]["phonology"]["ipa_ga"]][:3]
    if len(others) < 3: return None
    opts, idx = mcq(None, target, others)
    return base_item("phoneme_id", node, tier,
        {"phonology": [pid]}, [f"{pid}.disc"],
        {"text": f"Which word has the sound {p.get('ipa', p['label'])}?",
         "options": opts, "option_audio": [f"a/w_{o}.opus" for o in opts],
         "instruction_key": "instr.phoneme_id"},
        {"index": idx},
        {"incorrect_default": p.get("articulation", {}).get("instruction_uz", "")})

def phonology_block(node, tier, pids, pool):
    """Emit a perception block for every contrast point in the node."""
    out = []
    for pid in pids:
        p = PHON.get(pid)
        if not p: continue
        n = 4 if p["kind"] == "contrast" else 2
        if tier == 3: n = max(1, n - 2)
        for k in range(n):
            out.append(t_minimal_pair(node, tier, pid, k))
        if tier == 1:
            out.append(t_phoneme_id(node, tier, pid, pool))
    return [o for o in out if o]

def t_pragmatics(node, tier, fid):
    f = FUNC[fid]
    good = [e for e in f["exponents"] if e.get("formality") != "rude"]
    bad = [e for e in f["exponents"] if e.get("formality") == "rude"]
    if not good: return None
    key = good[0]["text"]
    wrong = [b["text"] for b in bad] + [e for e in f.get("known_failures", []) if not e.startswith("*")]
    wrong = [w.lstrip("*").strip() for w in wrong][:3]
    while len(wrong) < 3 and len(good) > 1:
        wrong.append(good[-1]["text"]); good = good[:-1]
    if len(wrong) < 3: return None
    opts, idx = mcq(None, key, wrong[:3])
    return base_item("pragmatics_choose", node, tier,
        {"functions": [fid]}, [f"{fid}.ex01"],
        {"text": f["label"] + " — which is the best thing to say?",
         "options": opts, "instruction_key": "instr.pragmatics_choose"},
        {"index": idx},
        {"incorrect_default": (f.get("l1_note") or {}).get("uz", "")
                              or "Think about who you are speaking to."})

def t_speak_prompt(node, tier, fid, can_do):
    f = FUNC[fid]
    return base_item("speak_prompt", node, tier,
        {"functions": [fid]}, [f"{fid}.prod"],
        {"text": f"{f['label']}. {can_do}", "instruction_key": "instr.speak_prompt"},
        {"key": [e["text"] for e in f["exponents"] if e.get("formality") != "rude"]},
        {"correct": "Good. Say it again, faster this time."},
        {"max_seconds": 30 if tier == 1 else 45})

def t_speak_roleplay(node, tier, uid, fids, can_do):
    return base_item("speak_roleplay", node, tier,
        {"functions": fids}, [f"{f}.prod" for f in fids],
        {"text": can_do, "instruction_key": "instr.speak_roleplay"},
        {"key": []},
        {"correct": "Task complete."},
        {"max_seconds": 180})

# ---------------------------------------------------------------- story templates

def t_story_question(node, tier, txt_id, q):
    # authored with the key first; shuffle so answer position is not biased
    opts = q["options"][:]
    key = opts[q["answer"]]
    rnd = random.Random(f"{txt_id}{q['q']}{tier}")
    rnd.shuffle(opts)
    q = {**q, "options": opts, "answer": opts.index(key)}
    return base_item(q["type"], node, tier,
        {"lexis": []}, [f"{txt_id}.comp"],
        {"text": q["q"], "options": q["options"],
         "audio": (f"a/{txt_id}.opus" if q["type"].startswith("listen") else None),
         "instruction_key": f"instr.{q['type']}"},
        {"index": q["answer"]},
        {"correct": q["why"], "incorrect_default": q["why"]})

def t_story_order(node, tier, txt_id, lines):
    sel = [l["text"] for l in lines if l["speaker"] != "narrator"][:6]
    if len(sel) < 4: return None
    shuffled = sel[:]; random.shuffle(shuffled)
    return base_item("listen_order_events", node, tier,
        {"lexis": []}, [f"{txt_id}.comp"],
        {"options": shuffled, "audio": f"a/{txt_id}.opus",
         "instruction_key": "instr.listen_order_events"},
        {"key": sel},
        {"correct": "That's the right order."})

# ---------------------------------------------------------------- node builders

def build_lexis_node(unit, node, tier):
    """Recognition-led at tier 1, recall at tier 2, production/timed at tier 3.
    Proportions follow the A1 column of docs/09 §2."""
    uid, nid = unit["id"], node["id"]
    ids = node["teaches"]["lexis"] or unit["syllabus"]["lexis"][:10]
    pids = node["teaches"].get("phonology", [])
    pool = AVAILABLE[uid]
    items = []
    if tier == 1:
        items.append(t_tap_pairs(nid, tier, ids))
        items.append(t_memory_match(nid, tier, ids[3:]))
        items += [t_mcq_word(nid, tier, i, pool) for i in ids[:6]]
        items.append(t_odd_one_out(nid, tier, ids))
        items += [t_stress_tap(nid, tier, i) for i in ids[:5]]
        items += [t_repeat_after(nid, tier, i) for i in ids[:5]]
        items += [t_gap_from_example(nid, tier, i, pool) for i in ids[:5]]
        items += [t_dictation_word(nid, tier, i) for i in ids[:4]]
        items += [t_spelling_bee(nid, tier, i) for i in ids[:2]]
    elif tier == 2:
        items += [t_mcq_word(nid, tier, i, pool) for i in ids[:7]]
        items += [t_type_from_l1(nid, tier, i) for i in ids[:3]]
        items += [t_spelling_bee(nid, tier, i) for i in ids[3:5]]
        items += [t_gap_from_example(nid, tier, i, pool, free=True) for i in ids[:4]]
        items.append(t_sort_bins_count(nid, tier, ids))
        items += [t_dictation_word(nid, tier, i) for i in ids[3:7]]
        items += [t_dictation_sentence(nid, tier, examples(i)[0], {"lexis": [i]},
                                       [f"{i}.aural"]) for i in ids[:3]]
        items += [t_repeat_after(nid, tier, i) for i in ids[3:5]]
        items.append(t_odd_one_out(nid, tier, ids[2:]))
    else:
        items += [t_type_from_l1(nid, tier, i) for i in ids[:4]]
        items += [t_mcq_word(nid, tier, i, pool) for i in ids[4:8]]
        items += [t_word_bank_build(nid, tier, i, pool) for i in ids[:5]]
        items += [t_dictation_sentence(nid, tier, examples(i)[0], {"lexis": [i]},
                                       [f"{i}.aural"]) for i in ids[:5]]
        items.append(t_word_race(nid, tier, ids))
        items += [t_read_aloud(nid, tier, examples(i)[0], {"lexis": [i]},
                               [f"{i}.prod"]) for i in ids[:4]]
        items.append(t_write_sentence(nid, tier, ids[0]))
        items += [t_speak_prompt_lex(nid, tier, i) for i in ids[:4]]
    items += phonology_block(nid, tier, pids, pool)
    return items

def build_grammar_node(unit, node, tier):
    uid, nid = unit["id"], node["id"]
    gids = node["teaches"]["grammar"] or unit["syllabus"]["grammar"]
    pool = AVAILABLE[uid]
    items = []
    for gid in gids:
        if tier == 1:
            items += [t_gram_gap(nid, tier, gid, pool), t_gram_judge(nid, tier, gid),
                      t_gram_reorder(nid, tier, gid), t_gram_error_correct(nid, tier, gid, 0)]
        elif tier == 2:
            items += [t_gram_error_correct(nid, tier, gid, 0),
                      t_gram_error_correct(nid, tier, gid, 1),
                      t_gram_reorder(nid, tier, gid), t_gram_judge(nid, tier, gid)]
        else:
            items += [t_gram_error_correct(nid, tier, gid, 2),
                      t_gram_judge(nid, tier, gid), t_gram_reorder(nid, tier, gid),
                      t_dictation_sentence(nid, tier, GRAM[gid]["positive_example"],
                                           {"grammar": [gid]}, [f"{gid}.form"])]
    items += phonology_block(nid, tier, node["teaches"].get("phonology", []), pool)
    return items

def build_mixed_node(unit, node, tier):
    nid = node["id"]
    lex = [i for i in build_lexis_node(unit, node, tier) if i][:8]
    gram = [i for i in build_grammar_node(unit, node, tier) if i][:6]
    prag = [t_pragmatics(nid, tier, f) for f in node["teaches"].get("functions", [])]
    extra = []
    if tier == 3 and node["teaches"]["lexis"] and node["teaches"]["grammar"]:
        extra.append(t_write_sentence(nid, tier, node["teaches"]["lexis"][0],
                                      node["teaches"]["grammar"][0]))
    return lex + gram + prag + extra

def build_story_node(unit, node, tier):
    nid, txt_id = node["id"], node["text_ref"]
    story = STORIES[txt_id]
    items = [t_story_question(nid, tier, txt_id, q) for q in SQ.get(txt_id, [])]
    items.append(t_story_order(nid, tier, txt_id, story["body"]))
    lines = [l["text"] for l in story["body"] if 3 <= len(l["text"].split()) <= 9]
    for s in lines[: (2 if tier == 1 else 3)]:
        items.append(t_dictation_sentence(nid, tier, s, {"lexis": []}, [f"{txt_id}.comp"]))
    if tier == 3:
        items.append(base_item("speak_retell", nid, tier, {"lexis": []}, [f"{txt_id}.comp"],
            {"text": f"Tell the story of '{story['title']}' in your own words.",
             "instruction_key": "instr.speak_retell"},
            {"key": []}, {"correct": "Good retelling."}, {"max_seconds": 90}))
    return items

def build_speak_node(unit, node, tier):
    nid = node["id"]
    fids = unit["syllabus"]["functions"]
    can_do = unit["can_do"][0]
    items = [t_pragmatics(nid, tier, f) for f in fids[:3]]
    items += [t_speak_prompt(nid, tier, f, can_do) for f in fids[:2]]
    items.append(t_speak_roleplay(nid, tier, unit["id"], fids[:3], can_do))
    for fid in fids[:2]:
        for e in FUNC[fid]["exponents"][:2]:
            if e.get("formality") == "rude": continue
            items.append(base_item("repeat_after", nid, tier, {"functions": [fid]},
                [f"{fid}.prod"], {"text": e["text"], "audio": f"a/{fid}_{abs(hash(e['text']))%9999}.opus",
                                  "instruction_key": "instr.repeat_after"},
                {"key": [e["text"]]}))
    return items

BUILDERS = {"lesson": None, "story": build_story_node, "speak": build_speak_node}

def dedupe(items):
    """Drop items identical in type + prompt within one node-tier."""
    seen, out = set(), []
    for it in items:
        sig = (it["type_id"], json.dumps(it["prompt"], sort_keys=True, ensure_ascii=False))
        if sig in seen: continue
        seen.add(sig); out.append(it)
    return out

def interleave(items):
    """Enforce docs/07 §2.4: no 3 consecutive items on one target, no 2 adjacent
    items of one exercise type. Greedy with a relaxation pass so it terminates."""
    pending, out = items[:], []
    def ok(it, relax):
        if not out: return True
        tgt = json.dumps(it["targets"], sort_keys=True)
        same_type = out[-1]["type_id"] == it["type_id"]
        run = 0
        for p in reversed(out):
            if json.dumps(p["targets"], sort_keys=True) == tgt: run += 1
            else: break
        if relax == 0: return not same_type and run < 2
        if relax == 1: return run < 2
        return True
    while pending:
        for relax in (0, 1, 2):
            for i, it in enumerate(pending):
                if ok(it, relax):
                    out.append(pending.pop(i)); break
            else:
                continue
            break
    # repair pass: break any surviving run of 3 by swapping in a later item
    tgt = lambda x: json.dumps(x["targets"], sort_keys=True)
    for i in range(2, len(out)):
        if tgt(out[i]) == tgt(out[i-1]) == tgt(out[i-2]):
            for j in range(i + 1, len(out)):
                if tgt(out[j]) != tgt(out[i]):
                    out[i], out[j] = out[j], out[i]; break
            else:
                for j in range(0, i - 2):
                    if tgt(out[j]) != tgt(out[i]):
                        out[i], out[j] = out[j], out[i]; break
    return out

def build():
    os.makedirs(OUT_DIR, exist_ok=True)
    all_items, stats = [], []
    for unit in UNITS:
        for node in unit["nodes"]:
            if node["kind"] in ("immersion", "review"):
                continue
            for tier in (1, 2, 3):
                if node["kind"] == "lesson":
                    f = node.get("focus")
                    items = (build_grammar_node(unit, node, tier) if f == "grammar"
                             else build_mixed_node(unit, node, tier) if f == "mixed"
                             else build_lexis_node(unit, node, tier))
                else:
                    items = BUILDERS[node["kind"]](unit, node, tier)
                items = [i for i in items if i]
                kept = []
                for it in items:
                    texts = [it["prompt"].get("text")]
                    for k in ("options", "bank"):
                        texts += [x for x in (it["prompt"].get(k) or []) if isinstance(x, str)]
                    for pr in (it["prompt"].get("pairs") or []): texts.append(pr[0])
                    texts += [x for x in (it["answer"].get("key") or []) if isinstance(x, str)]
                    if it["type_id"] in VOCAB_EXEMPT:
                        kept.append(it); continue
                    gids = it["targets"].get("grammar") or []
                    # A grammar point's canonical example IS the taught material;
                    # allow it but record any out-of-sequence words for the author.
                    allow = 3 if gids else 0
                    if vocab_ok(texts, unit["id"], allow=allow):
                        if gids:
                            f = forms_upto(unit["id"])
                            bad = {w.lower() for t in texts if isinstance(t, str)
                                   for w in _WORD.findall(t)
                                   if w.lower() not in f and w.lower() not in NAMES
                                   and w.lower().rstrip("s") not in f}
                            if bad: OUT_OF_SEQUENCE[gids[0]] |= bad
                        kept.append(it)
                    else:
                        DROPPED[it["type_id"]] += 1
                items = dedupe(kept)
                items = interleave(items)
                json.dump(items, open(f"{OUT_DIR}/{node['id']}T{tier}.json", "w",
                                      encoding="utf-8"), ensure_ascii=False, indent=1)
                all_items += items
                stats.append((node["id"], tier, len(items)))
    json.dump(all_items, open("build/items.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(f"built {len(all_items)} items across {len(stats)} node-tiers")
    if OUT_OF_SEQUENCE:
        print(f"  authoring TODO — {len(OUT_OF_SEQUENCE)} grammar points whose example "
              f"sentence uses vocabulary above its unit:")
        for gid, ws in sorted(OUT_OF_SEQUENCE.items())[:12]:
            print(f"      {gid}: {sorted(ws)}")
    if DROPPED:
        print(f"  dropped by the vocabulary gate: {sum(DROPPED.values())} "
              f"({dict(sorted(DROPPED.items(), key=lambda x: -x[1])[:6])})")
    per = defaultdict(int)
    for n, t, c in stats: per[n[:6]] += c
    for u in sorted(per): print(f"  {u}: {per[u]} items")
    from collections import Counter
    print("\nby exercise type:")
    for k, v in Counter(i["type_id"] for i in all_items).most_common():
        print(f"  {k:<32} {v}")
    return all_items

if __name__ == "__main__":
    build()
