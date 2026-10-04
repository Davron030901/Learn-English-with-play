"""US/UK spelling pairs for the grader (docs/09 §5 rule 4: accept both, always).

A line-for-line port of the app's ``src/grading/usUk.ts`` — client and server must accept
exactly the same answers, and ``tests/unit/test_grading_parity.py`` replays vectors the app's
grader produced to prove it. Change both together.

ORTHOGRAPHIC: the same word spelt two ways, accepted anywhere in an answer, curated by hand (no
blanket rule such as -or → -our, which would make *doctour*). LEXICAL: different words the A1
build records as a US/UK pair (apartment/flat …); accepted only when the item targets that
lexeme, and only as a whole word or phrase.
"""

from __future__ import annotations

import re
from typing import Final

Pair = tuple[str, str]

_IZE: Final = [
    "organiz",
    "realiz",
    "recogniz",
    "apologiz",
    "criticiz",
    "emphasiz",
    "summariz",
    "memoriz",
    "prioritiz",
    "specializ",
    "standardiz",
    "minimiz",
    "maximiz",
    "moderniz",
    "characteriz",
    "categoriz",
    "finaliz",
    "stabiliz",
    "authoriz",
    "utiliz",
    "visualiz",
    "symboliz",
    "legaliz",
    "generaliz",
    "hospitaliz",
    "mobiliz",
    "neutraliz",
    "normaliz",
    "optimiz",
    "privatiz",
    "publiciz",
    "socializ",
    "sympathiz",
    "customiz",
    "familiariz",
    "jeopardiz",
    "idealiz",
    "industrializ",
    "globaliz",
    "civiliz",
    "coloniz",
    "centraliz",
    "decentraliz",
    "fertiliz",
    "harmoniz",
    "improviz",
    "localiz",
    "marginaliz",
    "monetiz",
    "motoriz",
    "patroniz",
    "penaliz",
    "polariz",
    "rationaliz",
    "revolutioniz",
    "scrutiniz",
    "subsidiz",
    "terroriz",
    "theoriz",
    "trivializ",
    "urbaniz",
    "vaporiz",
    "agoniz",
    "antagoniz",
    "capitaliz",
    "commercializ",
    "compartmentaliz",
    "demoraliz",
    "dramatiz",
    "energiz",
    "equaliz",
    "hypothesiz",
    "immobiliz",
    "institutionaliz",
    "internaliz",
    "legitimiz",
    "metaboliz",
    "naturaliz",
    "personaliz",
    "radicaliz",
    "sanitiz",
    "sensitiz",
    "stigmatiz",
]


def _ize_family(stem: str) -> list[Pair]:
    if not stem.endswith("iz"):
        return []
    uk = f"{stem[:-1]}s"
    suffixes = ("e", "es", "ed", "ing", "er", "ers", "ation", "ations", "ational")
    return [(f"{stem}{s}", f"{uk}{s}") for s in suffixes]


_YSE: Final = ("analy", "paraly", "cataly")


def _yse_family(stem: str) -> list[Pair]:
    return [(f"{stem}z{s}", f"{stem}s{s}") for s in ("e", "es", "ed", "ing", "er", "ers")]


_LL: Final = [
    "travel",
    "cancel",
    "label",
    "model",
    "fuel",
    "level",
    "signal",
    "total",
    "marvel",
    "quarrel",
    "channel",
    "dial",
    "duel",
    "equal",
    "funnel",
    "jewel",
    "kidnap",
    "libel",
    "panel",
    "pedal",
    "rival",
    "shovel",
    "snorkel",
    "tunnel",
    "worship",
    "counsel",
]


def _ll_family(base: str) -> list[Pair]:
    doubled = f"{base}{base[-1]}"
    return [(f"{base}{s}", f"{doubled}{s}") for s in ("ed", "ing", "er", "ers", "or", "ors")]


_OUR: Final = [
    "color",
    "favor",
    "honor",
    "humor",
    "labor",
    "flavor",
    "harbor",
    "rumor",
    "vapor",
    "endeavor",
    "armor",
    "odor",
    "vigor",
    "parlor",
    "tumor",
    "neighbor",
    "behavior",
    "savor",
    "glamor",
    "splendor",
    "rancor",
    "valor",
    "clamor",
    "candor",
    "demeanor",
    "fervor",
]


def _our_family(base: str) -> list[Pair]:
    uk = f"{base[:-2]}our"
    out: list[Pair] = [(base, uk)]
    suffixes = ("s", "ed", "ing", "ful", "less", "able", "ite", "ites", "hood", "hoods", "al")
    out.extend((f"{base}{s}", f"{uk}{s}") for s in suffixes)
    return out


_RE: Final = [
    "center",
    "theater",
    "meter",
    "kilometer",
    "centimeter",
    "millimeter",
    "liter",
    "fiber",
    "caliber",
    "somber",
    "saber",
    "specter",
    "meager",
    "luster",
    "reconnoiter",
]


def _re_family(base: str) -> list[Pair]:
    uk = f"{base[:-2]}re"
    return [(base, uk), (f"{base}s", f"{uk}s"), (f"{base}ed", f"{uk}d")]


_SINGLE: Final[tuple[Pair, ...]] = (
    ("gray", "grey"), ("grays", "greys"), ("grayish", "greyish"),
    ("program", "programme"), ("programs", "programmes"),
    ("catalog", "catalogue"), ("catalogs", "catalogues"), ("dialog", "dialogue"),
    ("dialogs", "dialogues"), ("analog", "analogue"), ("monolog", "monologue"),
    ("prolog", "prologue"), ("epilog", "epilogue"),
    ("defense", "defence"), ("defenses", "defences"), ("offense", "offence"),
    ("offenses", "offences"), ("license", "licence"), ("licenses", "licences"),
    ("pretense", "pretence"),
    ("practice", "practise"), ("practiced", "practised"), ("practices", "practises"),
    ("practicing", "practising"),
    ("jewelry", "jewellery"), ("counselor", "counsellor"), ("counselors", "counsellors"),
    ("aluminum", "aluminium"), ("pajamas", "pyjamas"), ("plow", "plough"), ("mold", "mould"),
    ("moldy", "mouldy"), ("smolder", "smoulder"), ("molt", "moult"),
    ("enroll", "enrol"), ("enrollment", "enrolment"), ("enrolls", "enrols"),
    ("fulfill", "fulfil"), ("fulfillment", "fulfilment"), ("fulfills", "fulfils"),
    ("skillful", "skilful"), ("skillfully", "skilfully"), ("willful", "wilful"),
    ("instill", "instil"), ("distill", "distil"), ("installment", "instalment"),
    ("anemia", "anaemia"), ("anemic", "anaemic"), ("encyclopedia", "encyclopaedia"),
    ("pediatric", "paediatric"), ("pediatrician", "paediatrician"), ("maneuver", "manoeuvre"),
    ("maneuvers", "manoeuvres"), ("esthetic", "aesthetic"), ("archeology", "archaeology"),
    ("archeologist", "archaeologist"), ("ax", "axe"), ("mustache", "moustache"),
    ("mustaches", "moustaches"), ("omelet", "omelette"), ("omelets", "omelettes"),
    ("cozy", "cosy"), ("judgment", "judgement"), ("judgments", "judgements"),
    ("acknowledgment", "acknowledgement"), ("aging", "ageing"), ("artifact", "artefact"),
    ("artifacts", "artefacts"), ("sulfur", "sulphur"), ("yogurt", "yoghurt"),
    ("donut", "doughnut"), ("donuts", "doughnuts"), ("skeptic", "sceptic"),
    ("skeptics", "sceptics"), ("skeptical", "sceptical"), ("skepticism", "scepticism"),
    ("woolen", "woollen"), ("percent", "per cent"), ("airplane", "aeroplane"),
    ("airplanes", "aeroplanes"),
)  # fmt: skip


def _build_orthographic() -> dict[str, str]:
    pairs: list[Pair] = []
    for s in _IZE:
        pairs.extend(_ize_family(s))
    for s in _YSE:
        pairs.extend(_yse_family(s))
    for b in _LL:
        pairs.extend(_ll_family(b))
    for b in _OUR:
        pairs.extend(_our_family(b))
    for b in _RE:
        pairs.extend(_re_family(b))
    pairs.extend(_SINGLE)
    canon: dict[str, str] = {}
    for us, uk in pairs:
        if not us or not uk or us == uk:
            continue
        canon[us] = us
        canon[uk] = us
    return canon


#: word → canonical (US) spelling, for words with an orthographic US/UK pair
ORTHOGRAPHIC_CANON: Final[dict[str, str]] = _build_orthographic()

#: The A1 build's lexical "spelling" pairs, keyed by the packed lemma (content defect C16).
LEXICAL_PAIRS: Final[tuple[tuple[str, str, str], ...]] = (
    ("flat", "apartment", "flat"),
    ("shop assistant", "sales assistant", "shop assistant"),
    ("shop", "store", "shop"),
    ("autumn", "fall", "autumn"),
    ("film", "movie", "film"),
    ("holiday", "vacation", "holiday"),
    ("bill", "check", "bill"),
    ("trousers", "pants", "trousers"),
    ("cinema", "movie theater", "cinema"),
    ("pharmacy", "pharmacy", "chemist's"),
    ("clever", "smart", "clever"),
    ("metro", "subway", "metro"),
    ("ill", "sick", "ill"),
)

_TOKEN = re.compile(r"^([^a-z]*)([a-z][a-z'-]*[a-z]|[a-z])([^a-z]*)$")


def canonical_spelling(text: str) -> str:
    """Every orthographic variant in a case-folded, space-tokenised string → its US form."""
    out: list[str] = []
    for token in text.split(" "):
        m = _TOKEN.match(token)
        if not m:
            out.append(token)
            continue
        lead, core, trail = m.group(1), m.group(2), m.group(3)
        c = ORTHOGRAPHIC_CANON.get(core)
        out.append(f"{lead}{c}{trail}" if c else token)
    return " ".join(out)


def lexical_alternatives(key: str, target_lemmas: tuple[str, ...]) -> list[str]:
    """A key with a targeted lexeme's lexical pair swapped in, on word boundaries only."""
    out: list[str] = []
    for lemma in target_lemmas:
        pair = next((p for p in LEXICAL_PAIRS if p[0] == lemma.lower()), None)
        if pair is None:
            continue
        _, us, uk = pair
        for source, target in ((uk, us), (us, uk)):
            if source == target:
                continue
            pattern = re.compile(rf"(^|[^A-Za-z'])({re.escape(source)})(?=$|[^A-Za-z'])", re.I)
            if pattern.search(key):
                replacement = target

                def swap(m: re.Match[str], to: str = replacement) -> str:
                    return f"{m.group(1)}{to}"

                out.append(pattern.sub(swap, key))
    return out
