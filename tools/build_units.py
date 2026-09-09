#!/usr/bin/env python3
"""
build_units.py — expand content/units/spec-*.json into full unit files.

Fills syllabus.lexis from build/lexeme_index.json, lays out the standard
8-node pattern (docs/13-COURSE-MAP.md), and estimates the three tier times
from the item time model.

Usage:  python3 tools/build_units.py
Output: build/units/S01U01.json … and build/units_index.json
"""
import json, glob, os

SPEC_DIR = "content/units"
OUT_DIR  = "build/units"
SYLL_VER = "1.0"

# Minutes per node kind, per tier. Calibrated so that a unit costs ~139 min of
# lesson time across its three tiers; 12 units + SRS then land on the 35 h that
# docs/00-MASTER-SPEC.md §3.1 budgets for Section 1. Each node stays inside the
# 5-12 minute window docs/07 §3.2 requires.
NODE_MINUTES = {
    "lesson":    {1: 6.5, 2: 5.5, 3: 4.5},
    "story":     {1: 7.0, 2: 5.0, 3: 4.0},
    "speak":     {1: 7.0, 2: 6.0, 3: 5.0},
    "immersion": {1: 8.0, 2: 8.0, 3: 8.0},
    "review":    {1: 5.0, 2: 5.0, 3: 5.0},
}

def build():
    index = json.load(open("build/lexeme_index.json", encoding="utf-8"))
    os.makedirs(OUT_DIR, exist_ok=True)
    all_units = []

    for spec_path in sorted(glob.glob(os.path.join(SPEC_DIR, "spec-*.json"))):
        spec = json.load(open(spec_path, encoding="utf-8"))
        section, cefr = spec["section"], spec["cefr"]

        for u in spec["units"]:
            uid = f"{section}U{u['n']:02d}"
            lexis = index["by_unit"].get(uid, [])

            nodes = []
            teach = u["nodes"]           # 5 authored teaching/speaking nodes
            # N1-N3 lessons, N4 story, N5 lesson, N6 speak, N7 immersion, N8 review
            layout = [
                ("lesson", teach[0]), ("lesson", teach[1]), ("lesson", teach[2]),
                ("story",  None),     ("lesson", teach[3]), ("speak", teach[4]),
                ("immersion", None),  ("review", None),
            ]
            # Every syllabus item gets exactly ONE home node, so nothing is
            # triple-taught (which is what inflates a generated item bank).
            lesson_slots = [(i, m) for i, (k, m) in enumerate(layout, start=1)
                            if k == "lesson"]
            lex_slots  = [i for i, m in lesson_slots if m["focus"] in ("lexis", "mixed")]
            gram_slots = [i for i, m in lesson_slots if m["focus"] in ("grammar", "mixed")]
            phon_slots = [i for i, _ in lesson_slots]

            def split(seq, slots):
                if not slots:
                    return {}
                return {s: seq[k::len(slots)] for k, s in enumerate(slots)}

            lex_by_slot  = split(lexis, lex_slots)
            gram_by_slot = split(u["grammar"], gram_slots)
            phon_by_slot = split(u["phonology"], phon_slots)
            func_by_slot = split(u["functions"], [i for i, m in lesson_slots
                                                  if m["focus"] == "mixed"] or lex_slots)

            for i, (kind, meta) in enumerate(layout, start=1):
                node = {"id": f"{uid}N{i}", "kind": kind}
                if kind == "lesson":
                    node["focus"] = meta["focus"]
                    node["title"] = meta["title"]
                    node["teaches"] = {
                        "lexis": lex_by_slot.get(i, []),
                        "grammar": gram_by_slot.get(i, []),
                        "phonology": phon_by_slot.get(i, []),
                        "functions": func_by_slot.get(i, []),
                    }
                elif kind == "story":
                    node["title"] = "Story"
                    node["text_ref"] = u["story"]
                elif kind == "speak":
                    node["focus"] = "function"
                    node["title"] = teach[4]["title"]
                    node["task_ref"] = f"task.{uid}"
                    node["teaches"] = {"functions": u["functions"]}
                elif kind == "immersion":
                    node["title"] = "Read and listen"
                    node["feed"] = f"reader_a1_{section.lower()}"
                elif kind == "review":
                    node["title"] = "Review"
                    node["source"] = "srs"
                nodes.append(node)

            est = {}
            for t in (1, 2, 3):
                est[f"t{t}"] = round(sum(NODE_MINUTES[k][t] for k, _ in layout), 1)

            unit = {
                "id": uid,
                "type": "unit",
                "section": section,
                "index": u["n"] if section == "S01" else u["n"] + 12,
                "cefr": cefr,
                "title": {"en": u["title_en"], "uz": u["title_uz"]},
                "theme": u["theme"],
                "can_do": u["can_do"],
                "syllabus": {
                    "grammar": u["grammar"],
                    "lexis": lexis,
                    "phonology": u["phonology"],
                    "functions": u["functions"],
                },
                "prerequisites": ([f"{section}U{u['n']-1:02d}"] if u["n"] > 1 else []),
                "nodes": nodes,
                "estimated_minutes": est,
                "status": "published",
                "syllabus_version": SYLL_VER,
            }
            json.dump(unit, open(f"{OUT_DIR}/{uid}.json", "w", encoding="utf-8"),
                      ensure_ascii=False, indent=1)
            all_units.append({"id": uid, "index": unit["index"],
                              "title": u["title_en"], "lexis": len(lexis),
                              "grammar": len(u["grammar"]),
                              "minutes": est})

    json.dump(all_units, open("build/units_index.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(f"built {len(all_units)} units -> {OUT_DIR}/")
    for u in all_units:
        print(f"  {u['id']}  {u['title']:<22} lex={u['lexis']:<3} gram={u['grammar']}  "
              f"t1={u['minutes']['t1']}min")
    return all_units

if __name__ == "__main__":
    build()
