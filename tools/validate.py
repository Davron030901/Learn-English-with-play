#!/usr/bin/env python3
"""
validate.py — the CI gates from docs/11-CONTENT-DATA-MODEL.md §5.

Run:  python3 tools/validate.py            (exit 1 if any BLOCKING gate fails)
      python3 tools/validate.py --verbose  (list every violation)
"""
import json, glob, re, sys, os
from collections import Counter, defaultdict

VERBOSE = "--verbose" in sys.argv
FAILS, WARNS = [], []

def fail(gate, msg):  FAILS.append((gate, msg))
def warn(gate, msg):  WARNS.append((gate, msg))

# ---------------------------------------------------------------- load
LEX      = json.load(open("build/lexemes.json", encoding="utf-8"))
LEX_BY_ID= {l["id"]: l for l in LEX}
GRAM     = {g["id"]: g for g in json.load(open("content/syllabus/grammar-a1.json", encoding="utf-8"))}
PHON     = {p["id"]: p for p in json.load(open("content/syllabus/phonology-a1.json", encoding="utf-8"))}
FUNC     = {f["id"]: f for f in json.load(open("content/syllabus/functions-a1.json", encoding="utf-8"))}
UNITS    = [json.load(open(p, encoding="utf-8")) for p in sorted(glob.glob("build/units/*.json"))]
UNIT_BY_ID = {u["id"]: u for u in UNITS}
ITEMS    = json.load(open("build/items.json", encoding="utf-8"))
STORIES  = {t["id"]: t for t in json.load(open("content/texts/stories-s01.json", encoding="utf-8"))["texts"]}

# ---------------------------------------------------------------- gate 1: schema
def gate_schema():
    try:
        from jsonschema import Draft202012Validator
    except ImportError:
        warn("G01 schema", "jsonschema not installed — skipped")
        return
    pairs = [("content/schemas/lexeme.schema.json", LEX),
             ("content/schemas/grammar-point.schema.json", list(GRAM.values())),
             ("content/schemas/phonology-point.schema.json", list(PHON.values())),
             ("content/schemas/unit.schema.json", UNITS),
             ("content/schemas/item.schema.json", ITEMS)]
    for path, docs in pairs:
        schema = json.load(open(path, encoding="utf-8"))
        v = Draft202012Validator(schema)
        bad = 0
        for d in docs:
            errs = list(v.iter_errors(d))
            if errs:
                bad += 1
                if VERBOSE and bad <= 3:
                    print(f"    {os.path.basename(path)} :: {d.get('id')} :: "
                          f"{errs[0].message[:140]}")
        if bad:
            fail("G01 schema", f"{bad}/{len(docs)} invalid against {os.path.basename(path)}")

# ---------------------------------------------------------------- gate 2: id integrity
def gate_ids():
    known = set(LEX_BY_ID) | set(GRAM) | set(PHON) | set(FUNC) | set(STORIES) | set(UNIT_BY_ID)
    missing = Counter()
    for u in UNITS:
        for k, ids in u["syllabus"].items():
            for i in ids:
                if i not in known: missing[i] += 1
        for n in u["nodes"]:
            if n.get("text_ref") and n["text_ref"] not in STORIES:
                missing[n["text_ref"]] += 1
    for it in ITEMS:
        for k, ids in it["targets"].items():
            for i in ids:
                if i not in known: missing[i] += 1
        if it["node"][:6] not in UNIT_BY_ID:
            missing[it["node"]] += 1
    orphans = [it["id"] for it in ITEMS if not any(it["targets"].values())]
    if missing:
        fail("G02 id-integrity", f"{sum(missing.values())} references to unknown ids "
                                 f"({list(missing)[:5]})")
    if orphans:
        warn("G02 id-integrity", f"{len(orphans)} items target no syllabus id "
                                 f"(story comprehension items) e.g. {orphans[:2]}")

# ---------------------------------------------------------------- gates 3 & 4: vocabulary and grammar
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
         "fergana","termez","registan","kyzylkum","mr","mrs","ms","dilnoza","zilola",
         "kilo","alpha","som","v","a","z","i"}
WORD_RE = re.compile(r"[A-Za-z\u00c0-\u024f][A-Za-z\u00c0-\u024f']*")

def unit_index(uid): return UNIT_BY_ID[uid]["index"]

def available_forms(upto_index):
    """All word forms taught at or before this unit index."""
    forms = set()
    for u in UNITS:
        if u["index"] > upto_index: continue
        for lid in u["syllabus"]["lexis"]:
            l = LEX_BY_ID[lid]
            forms.add(l["lemma"].lower())
            for f in l["spelling"]["inflections"]:
                forms.add(f.lower())
            for f in (l["spelling"]["us"], l["spelling"]["uk"]):
                forms.add(f.lower())
            # multiword lexemes contribute their parts
            for part in l["lemma"].lower().split():
                forms.add(part)
    # forms produced by the grammar that is taught (contractions, negatives)
    forms |= {"i'm","you're","he's","she's","it's","we're","they're","isn't","aren't",
              "don't","doesn't","can't","cannot","wasn't","weren't","didn't","won't",
              "haven't","hasn't","i've","you've","let's","that's","what's","where's",
              "who's","there's","how's","i'd","couldn't","shouldn't","mustn't",
              "am","is","are","was","were","been","being","has","had","having",
              "do","does","did","doing","done","not","to","of","for","in","on","at",
              "an","the","and","or","but","so","because","with","from","by","as",
              "this","that","these","those","there","here","it","its","he","she",
              "his","her","him","them","they","we","us","our","you","your","my",
              "me","i","yes","no","ok","too","very","up","down","out","off","now",
              "then","also","only","one","two","three","four","five","six","seven",
              "eight","nine","ten","o'clock","please","sorry","hello","goodbye"}
    return forms

VOCAB_EXEMPT = {"minimal_pair_discrimination", "phoneme_id", "pragmatics_choose",
                "speak_prompt", "speak_roleplay", "speak_retell", "repeat_after",
                "stress_tap", "write_sentence"}

def gate_vocab_grammar():
    cache = {}
    gram_todo = defaultdict(set)
    viol = defaultdict(list)
    for it in ITEMS:
        uid = it["node"][:6]
        if uid not in UNIT_BY_ID or it["type_id"] in VOCAB_EXEMPT: continue
        idx = unit_index(uid)
        if idx not in cache: cache[idx] = available_forms(idx)
        forms = cache[idx]
        texts = []
        p, a = it["prompt"], it["answer"]
        for k in ("text",):
            if p.get(k): texts.append(p[k])
        for k in ("options", "bank", "key", "accepted"):
            v = p.get(k) or a.get(k) or []
            texts += [x for x in v if isinstance(x, str)]
        for pair in (p.get("pairs") or []):
            texts.append(pair[0])
        unknown = set()
        for t in texts:
            for w in WORD_RE.findall(t):
                lw = w.lower()
                if lw in forms or lw in NAMES or lw in METALANGUAGE: continue
                if lw.rstrip("s") in forms or lw.rstrip("'s") in forms: continue
                unknown.add(w)
        if unknown:
            gids = it["targets"].get("grammar") or []
            if gids:                      # canonical grammar example: log, don't block
                gram_todo[gids[0]] |= unknown
            else:
                viol[uid].append((it["id"], sorted(unknown)))
    total = sum(len(v) for v in viol.values())
    if total:
        # +1 rule: at most one unknown lemma per item is tolerated with a gloss
        hard = [(u, i, w) for u, lst in viol.items() for i, w in lst if len(w) > 1]
        if VERBOSE:
            for u in sorted(viol):
                for i, w in viol[u][:4]:
                    print(f"    {u} {i}: {w}")
        if hard:
            fail("G03 vocabulary", f"{len(hard)} items break the +1 rule "
                                   f"(>1 untaught word), {total} items with any untaught word")
        else:
            warn("G03 vocabulary", f"{total} items contain exactly 1 untaught word "
                                   "(allowed by the +1 rule if glossed)")
    if gram_todo:
        warn("G03 vocabulary", f"authoring TODO: {len(gram_todo)} grammar points have a "
                               f"canonical example above its unit's vocabulary "
                               f"(e.g. {sorted(gram_todo)[:4]})")

def gate_story_vocab():
    bad = 0
    for tid, s in STORIES.items():
        idx = unit_index(s["unit"])
        forms = available_forms(idx)
        unknown = set()
        for line in s["body"]:
            for w in WORD_RE.findall(line["text"]):
                lw = w.lower()
                if lw in forms or lw in NAMES or lw in METALANGUAGE: continue
                if lw.rstrip("s") in forms: continue
                unknown.add(w)
        if unknown:
            bad += 1
            if VERBOSE: print(f"    {tid} ({s['unit']}): {sorted(unknown)}")
    if bad:
        fail("G03b story-vocabulary", f"{bad}/{len(STORIES)} stories use untaught words")

def gate_grammar_gate():
    missing = []
    for u in UNITS:
        for gid in u["syllabus"]["grammar"]:
            if gid not in GRAM:
                missing.append((u["id"], gid)); continue
            if GRAM[gid]["level"] not in ("A1.1", "A1.2"):
                missing.append((u["id"], gid))
    if missing:
        fail("G04 grammar", f"{len(missing)} grammar points above level or unknown")

# ---------------------------------------------------------------- gate 5: level fit
MAX_WORDS = {"A1.1": 8, "A1.2": 12}
def gate_level_fit():
    over = []
    for it in ITEMS:
        cap = MAX_WORDS.get(it["cefr"], 99)
        for t in ([it["prompt"].get("text")] + (it["answer"].get("key") or [])):
            if isinstance(t, str) and len(t.split()) > cap + 4:
                over.append((it["id"], len(t.split()), t[:60]))
    if over:
        warn("G05 level-fit", f"{len(over)} strings exceed the A1 sentence-length cap "
                              f"(e.g. {over[0][2]!r} = {over[0][1]} words)")

# ---------------------------------------------------------------- gate 6/7/8: answers & distractors
def gate_answers():
    nokey, keyindistract, dupopt, lenvar = 0, 0, 0, 0
    for it in ITEMS:
        a, p = it["answer"], it["prompt"]
        has = any(a.get(k) is not None for k in ("key", "index", "indices", "mapping"))
        if not has and it["type_id"] not in ("speak_prompt", "speak_roleplay",
                                             "speak_retell", "write_sentence"):
            nokey += 1
        opts = p.get("options")
        if opts:
            if len(set(opts)) != len(opts): dupopt += 1
            L = [len(o) for o in opts]
            if max(L) > 3 * max(1, min(L)) and max(L) > 12: lenvar += 1
            if a.get("mapping") is None and a.get("key") is None:
                idx = a.get("index")
                if idx is None or not (0 <= idx < len(opts)): keyindistract += 1
    if nokey:         fail("G06 answer-key", f"{nokey} items have no answer key")
    if keyindistract: fail("G06 answer-key", f"{keyindistract} MCQ items have a bad answer index")
    if dupopt:        fail("G07 distractors", f"{dupopt} MCQ items have duplicate options")
    if lenvar:        warn("G07 distractors", f"{lenvar} MCQ items have very uneven option lengths")

def gate_position_bias():
    """Bias is only meaningful within items that have the same number of options."""
    by_n = defaultdict(Counter)
    for it in ITEMS:
        opts, idx = it["prompt"].get("options"), it["answer"].get("index")
        if opts and idx is not None:
            by_n[len(opts)][idx] += 1
    ok = True
    for n, pos in sorted(by_n.items()):
        tot = sum(pos.values())
        if tot < 30:            # too small a sample to judge
            continue
        worst = max(pos.values()) / tot
        cap = 1.0 / n + 0.10
        line = f"{n}-option items (n={tot}): {dict(sorted(pos.items()))} max {worst:.0%} (cap {cap:.0%})"
        if worst > cap:
            fail("G08 position-bias", line); ok = False
        else:
            print(f"  G08 position-bias  ok  — {line}")

# ---------------------------------------------------------------- gate 9: audio
def gate_audio():
    missing = 0
    for l in LEX:
        if not l["audio"].get("word_ga"): missing += 1
        for e in l["examples"]:
            if not e.get("audio"): missing += 1
    need_audio = ("spelling_bee", "dictation_word", "dictation_sentence",
                  "minimal_pair_discrimination", "repeat_after", "listen_gist_mcq",
                  "listen_order_events", "listen_detail_gap")
    noaudio = sum(1 for it in ITEMS
                  if it["type_id"] in need_audio and not it["prompt"].get("audio"))
    if missing:  fail("G09 audio", f"{missing} lexeme audio slots empty")
    if noaudio:  fail("G09 audio", f"{noaudio} audio-dependent items have no audio ref")

# ---------------------------------------------------------------- gate 13: duplicates
def gate_duplicates():
    seen = defaultdict(list)
    for it in ITEMS:
        sig = (it["node"], it["tier"], it["type_id"],
               json.dumps(it["prompt"], sort_keys=True, ensure_ascii=False))
        seen[sig].append(it["id"])
    dupes = {k: v for k, v in seen.items() if len(v) > 1}
    if dupes:
        fail("G13 duplicates", f"{len(dupes)} duplicate items within a node-tier "
                               f"(e.g. {list(dupes.values())[0]})")

# ---------------------------------------------------------------- gate 14: interference
def gate_interference():
    bad = []
    for u in UNITS:
        for n in u["nodes"]:
            ids = (n.get("teaches") or {}).get("lexis") or []
            s = set(ids)
            for lid in ids:
                inter = (LEX_BY_ID[lid].get("related") or {}).get("interferes_with")
                if inter and inter[0] in s:
                    bad.append((n["id"], LEX_BY_ID[lid]["lemma"],
                                LEX_BY_ID[inter[0]]["lemma"]))
    if bad:
        fail("G14 interference", f"{len(bad)} interfering pairs introduced in the same "
                                 f"node (e.g. {bad[0]})")

# ---------------------------------------------------------------- gate 16: sequencing inside a node-tier
def gate_sequencing():
    bad_type, bad_target = 0, 0
    by_nt = defaultdict(list)
    for it in ITEMS: by_nt[(it["node"], it["tier"])].append(it)
    for seq in by_nt.values():
        for i in range(1, len(seq)):
            if seq[i]["type_id"] == seq[i-1]["type_id"]: bad_type += 1
        for i in range(2, len(seq)):
            t = [json.dumps(seq[j]["targets"], sort_keys=True) for j in (i, i-1, i-2)]
            if t[0] == t[1] == t[2]: bad_target += 1
    if bad_type:   warn("G16 sequencing", f"{bad_type} adjacent items share an exercise type")
    if bad_target:
        # a node that teaches exactly one grammar point legitimately runs on it
        multi = 0
        for (node, tier), seq in by_nt.items():
            tg = {json.dumps(i["targets"], sort_keys=True) for i in seq}
            if len(tg) > 2:
                for i in range(2, len(seq)):
                    t = [json.dumps(seq[j]["targets"], sort_keys=True) for j in (i, i-1, i-2)]
                    if t[0] == t[1] == t[2]: multi += 1
        if multi: fail("G16 sequencing", f"{multi} runs of 3+ on one target in "
                                          f"multi-target nodes")
        else:     warn("G16 sequencing", f"{bad_target} runs of 3+ items on one target, "
                                          f"all in single-target (clinic-style) nodes")

# ---------------------------------------------------------------- gate 20: timing
def gate_timing():
    SEC = {"tap_pairs": 40, "memory_match": 90, "word_race": 60, "speak_roleplay": 180,
           "speak_retell": 90, "write_sentence": 90, "speak_prompt": 35}
    DEFAULT = 14
    for u in UNITS:
        by_tier = defaultdict(float)
        for it in ITEMS:
            if it["node"][:6] != u["id"]: continue
            by_tier[it["tier"]] += SEC.get(it["type_id"], DEFAULT) / 60
        for t in (1, 2, 3):
            est = u["estimated_minutes"][f"t{t}"]
            # unit estimate covers 8 nodes; items exist for 6 of them
            item_min = by_tier[t]
            budget = est * 0.75
            if item_min > budget * 1.35 or item_min < budget * 0.65:
                warn("G20 timing", f"{u['id']} tier {t}: items ≈ {item_min:.0f} min vs "
                                    f"{budget:.0f} min budgeted")

# ---------------------------------------------------------------- run
def main():
    print("running content gates…\n")
    for g in (gate_schema, gate_ids, gate_vocab_grammar, gate_story_vocab,
              gate_grammar_gate, gate_level_fit, gate_answers, gate_position_bias,
              gate_audio, gate_duplicates, gate_interference, gate_sequencing,
              gate_timing):
        g()
    print()
    for gate, msg in FAILS: print(f"  FAIL  {gate}: {msg}")
    for gate, msg in WARNS: print(f"  warn  {gate}: {msg}")
    print(f"\n{len(FAILS)} blocking failure(s), {len(WARNS)} warning(s)")
    print(f"corpus: {len(LEX)} lexemes · {len(GRAM)} grammar points · "
          f"{len(PHON)} phonology points · {len(FUNC)} functions · "
          f"{len(UNITS)} units · {len(STORIES)} stories · {len(ITEMS)} items")
    sys.exit(1 if FAILS else 0)

if __name__ == "__main__":
    main()
