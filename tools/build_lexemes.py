#!/usr/bin/env python3
"""
build_lexemes.py — expand the compact lexeme source files into full
schema-conformant lexeme records (docs/04-LEXIS-SPEC.md §11).

Usage:  python3 tools/build_lexemes.py
Output: build/lexemes.json  (array of full records)
        build/lexeme_index.json  (lemma+pos -> id, and unit -> [ids])

Compact source keys
-------------------
u    unit number (1-168)          l    lemma
p    part of speech               ipa  General American IPA (no slashes)
uz   Uzbek gloss                  ru   Russian gloss
ex   list of example sentences    col  list of collocations
t    topic tags                   b    frequency band
ch   is a learned chunk           fw   is a function word
cnt  countable (nouns)            unc  uncountable (nouns)
pl   irregular plural             irr  [base, past, past participle]
cmp/sup  irregular comparative / superlative
us/uk    spelling or lexical variant in the other standard
prop is a proper noun             state  is a state verb
pv   is a phrasal verb            weak  weak-form pronunciation
P    phonology point ids          trap  {lang: warning}
int  lemma this item interferes with (kept apart by the scheduler)
"""
import json, glob, os, re, sys

SRC_DIR   = "content/lexemes"
OUT_DIR   = "build"
SYLL_VER  = "1.0"
POS_MAP = {
    "noun": "noun", "verb": "verb", "adj": "adj", "adv": "adv",
    "pron": "pron", "det": "det", "prep": "prep", "conj": "conj",
    "num": "num", "interj": "interj", "modal": "modal", "phrase": "phrase",
}
# Section 1 = units 1-12 (A1.1), Section 2 = units 13-24 (A1.2)
def cefr_of(unit):
    return "A1.1" if unit <= 12 else "A1.2"

def section_of(unit):
    return 1 if unit <= 12 else 2

def unit_id(unit):
    s = section_of(unit)
    idx = unit if s == 1 else unit - 12
    return f"S{s:02d}U{idx:02d}"

VOWELS = "aeiouæɑɔɛɜʊʌəɪiuoeɚ"

def count_syllables(ipa):
    """Rough syllable count from an IPA string: count vowel nuclei."""
    nuclei = re.findall(r"[iɪeɛæaɑɔoʊuʌəɜɚ]ː?[ɪʊə]?", ipa)
    return max(1, len(nuclei))

def stress_position(ipa):
    """Return the 1-indexed stressed syllable, derived from the ˈ marker."""
    if "ˈ" not in ipa:
        return "1"
    before = ipa.split("ˈ")[0]
    return str(count_syllables(before) + 1) if before.strip() else "1"

def inflections(rec):
    lemma, pos = rec["l"], rec["p"]
    out = []
    if pos == "verb":
        if rec.get("irr"):
            base = lemma
            ing = (base[:-1] + "ing" if base.endswith("e") and not base.endswith("ee")
                   else base + base[-1] + "ing" if re.search(r"[^aeiou][aeiou][bdgmnprt]$", base)
                   else base + "ing")
            third = (base + "es" if re.search(r"(ch|sh|s|x|z|o)$", base) else base + "s")
            out = list(dict.fromkeys(list(rec["irr"]) + [third, ing]))
        else:
            base = lemma
            if base.endswith("e"):
                out = [base, base + "s", base + "d", base[:-1] + "ing"]
            elif re.search(r"[^aeiou]y$", base):
                out = [base, base[:-1] + "ies", base[:-1] + "ied", base + "ing"]
            elif re.search(r"(ch|sh|s|x|z|o)$", base):
                out = [base, base + "es", base + "ed", base + "ing"]
            else:
                out = [base, base + "s", base + "ed", base + "ing"]
    elif pos == "noun":
        if rec.get("pl"):
            out = [lemma, rec["pl"]]
        elif rec.get("unc") or rec.get("prop"):
            out = [lemma]
        elif re.search(r"(ch|sh|s|x|z)$", lemma):
            out = [lemma, lemma + "es"]
        elif re.search(r"[^aeiou]y$", lemma):
            out = [lemma, lemma[:-1] + "ies"]
        else:
            out = [lemma, lemma + "s"]
    elif pos == "adj":
        out = [lemma]
        if rec.get("cmp"):
            out += [rec["cmp"], rec.get("sup", "")]
        elif len(lemma) <= 8 and lemma.isalpha():
            # regular -er/-est, with the doubling and y->i spellings
            if lemma.endswith("e"):
                stem = lemma[:-1]
            elif re.search(r"[^aeiou]y$", lemma):
                stem = lemma[:-1] + "i"
            elif re.search(r"[^aeiou][aeiou][bdgmnprt]$", lemma):
                stem = lemma + lemma[-1]
            else:
                stem = lemma
            out += [stem + "er", "the " + stem + "est", stem + "est"]
    return [x for x in out if x]

def build():
    src = []
    for path in sorted(glob.glob(os.path.join(SRC_DIR, "src-*.json"))):
        src += json.load(open(path, encoding="utf-8"))["lexemes"]

    # Stable ids: ordered by unit, then by appearance in the source.
    src = [r for _, r in sorted(enumerate(src), key=lambda p: (p[1]["u"], p[0]))]
    by_lemma_pos = {}
    out = []
    for i, r in enumerate(src, start=1):
        lex_id = f"lex.{i:05d}"
        u = r["u"]
        pos = POS_MAP.get(r["p"], r["p"])
        lemma = r["l"]
        key = (lemma, pos)
        sense_id = 1 + sum(1 for k in by_lemma_pos if k[0] == lemma)
        by_lemma_pos[key] = lex_id

        rec = {
            "id": lex_id,
            "lemma": lemma,
            "sense_id": sense_id,
            "sense_gloss_en": r.get("en", ""),
            "pos": pos,
            "cefr": cefr_of(u),
            "frequency": {"band": r.get("b", 2000)},
            "phonology": {
                "ipa_ga": r["ipa"],
                "syllables": count_syllables(r["ipa"]),
                "stress": stress_position(r["ipa"]),
            },
            "spelling": {
                "us": r.get("us", lemma) if r.get("us") else lemma,
                "uk": r.get("uk", lemma) if r.get("uk") else lemma,
                "inflections": inflections(r),
            },
            "audio": {
                "word_ga": f"a/{lex_id}_ga.opus",
                "word_sbe": f"a/{lex_id}_sbe.opus",
                "slow_ga": f"a/{lex_id}_slow.opus",
            },
            "grammar": {},
            "collocations": r.get("col", []),
            "register": r.get("reg", "neutral"),
            "connotation": "neutral",
            "examples": [
                {"text": t, "audio": f"a/{lex_id}_ex{n}.opus"}
                for n, t in enumerate(r["ex"], start=1)
            ],
            "l1_gloss": {"uz": r["uz"], **({"ru": r["ru"]} if r.get("ru") else {})},
            "topic_tags": r.get("t", ["core"]),
            "first_taught_node": f"{unit_id(u)}N1",
            "status": "published",
            "syllabus_version": SYLL_VER,
        }
        if r.get("P"):
            rec["phonology"]["teaches"] = r["P"]
        if r.get("trap"):
            rec["l1_traps"] = r["trap"]
        if r.get("ch"):
            rec["is_chunk"] = True
        if r.get("fw"):
            rec["is_function_word"] = True
        # grammar sub-object
        g = {}
        if pos == "verb":
            g["irregular"] = bool(r.get("irr"))
        if pos == "noun":
            if r.get("unc"):
                g["countable"] = False
            elif r.get("cnt"):
                g["countable"] = True
            if r.get("pl"):
                g["plural"] = r["pl"]
        if r.get("cmp"):
            g["comparative"] = r["cmp"]
        if r.get("sup"):
            g["superlative"] = r["sup"]
        if g:
            rec["grammar"] = g
        else:
            rec.pop("grammar")
        if not rec["sense_gloss_en"]:
            rec.pop("sense_gloss_en")
        out.append(rec)

    # second pass: resolve interference links
    lemma_to_id = {}
    for rec, r in zip(out, src):
        lemma_to_id.setdefault(rec["lemma"], rec["id"])
    for rec, r in zip(out, src):
        if r.get("int"):
            target = lemma_to_id.get(r["int"])
            if target:
                rec.setdefault("related", {})["interferes_with"] = [target]

    os.makedirs(OUT_DIR, exist_ok=True)
    json.dump(out, open(f"{OUT_DIR}/lexemes.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)

    index = {
        "by_lemma_pos": {f"{l}|{p}": i for (l, p), i in by_lemma_pos.items()},
        "by_unit": {},
        "by_id": {r["id"]: r["lemma"] for r in out},
    }
    for rec, r in zip(out, src):
        index["by_unit"].setdefault(unit_id(r["u"]), []).append(rec["id"])
    json.dump(index, open(f"{OUT_DIR}/lexeme_index.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)

    print(f"built {len(out)} lexemes -> {OUT_DIR}/lexemes.json")
    units = sorted(index["by_unit"])
    print(f"units: {len(units)}  ({units[0]} … {units[-1]})")
    return out

if __name__ == "__main__":
    build()
