"""The cosmetic shop (docs/10 §9, docs/16 E17). Pure catalogue and rules.

Gems are earned only and buy only looks: Pip's outfits, app themes and path skins. Nothing here
can buy content, a lesson, a hint, a streak freeze, a repair or a test attempt — the catalogue
has no such kind, and a test fails if one is added. Items never expire and are never
"limited-time" (docs/10 §8.2: no fake scarcity).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

KINDS: Final = frozenset({"pip_outfit", "theme", "path_skin"})


@dataclass(frozen=True, slots=True)
class ShopItem:
    id: str
    kind: str
    price: int
    name: dict[str, str]
    #: a slot equips one item at a time (one outfit, one theme, one path skin)
    slot: str


def _item(id_: str, kind: str, price: int, en: str, uz: str, ru: str) -> ShopItem:
    return ShopItem(id_, kind, price, {"en": en, "uz": uz, "ru": ru}, slot=kind)


CATALOGUE: Final[tuple[ShopItem, ...]] = (
    _item("outfit.doppi", "pip_outfit", 60, "Doppi", "Do'ppi", "Тюбетейка"),
    _item("outfit.ikat_scarf", "pip_outfit", 80, "Ikat scarf", "Atlas sharf", "Шарф из иката"),
    _item(
        "outfit.round_glasses",
        "pip_outfit",
        50,
        "Round glasses",
        "Dumaloq ko'zoynak",
        "Круглые очки",
    ),
    _item(
        "outfit.graduation_cap",
        "pip_outfit",
        150,
        "Graduation cap",
        "Bitiruv shapkasi",
        "Выпускная шапочка",
    ),
    _item("outfit.chef_hat", "pip_outfit", 90, "Chef's hat", "Oshpaz qalpog'i", "Поварской колпак"),
    _item(
        "outfit.raincoat",
        "pip_outfit",
        90,
        "Raincoat and umbrella",
        "Yomg'irpo'sh va soyabon",
        "Дождевик и зонт",
    ),
    _item("outfit.headphones", "pip_outfit", 70, "Headphones", "Quloqchin", "Наушники"),
    _item(
        "outfit.astronaut",
        "pip_outfit",
        300,
        "Astronaut helmet",
        "Kosmonavt dubulg'asi",
        "Шлем космонавта",
    ),
    _item(
        "theme.samarkand", "theme", 120, "Samarkand blue", "Samarqand ko'ki", "Самаркандская лазурь"
    ),
    _item("theme.chorsu", "theme", 120, "Chorsu bazaar", "Chorsu bozori", "Базар Чорсу"),
    _item(
        "theme.night_tashkent",
        "theme",
        150,
        "Tashkent at night",
        "Tungi Toshkent",
        "Ночной Ташкент",
    ),
    _item(
        "path.silk_road", "path_skin", 200, "Silk Road", "Buyuk Ipak yo'li", "Великий шёлковый путь"
    ),
    _item(
        "path.mountains", "path_skin", 200, "Chimgan mountains", "Chimyon tog'lari", "Горы Чимгана"
    ),
)
BY_ID: Final[dict[str, ShopItem]] = {i.id: i for i in CATALOGUE}


class ShopError(ValueError):
    """A purchase or equip the rules refuse (reason given)."""


def check_purchase(item_id: str, balance: int, owned: frozenset[str]) -> ShopItem:
    item = BY_ID.get(item_id)
    if item is None:
        raise ShopError("there is no such item")
    if item_id in owned:
        raise ShopError("you already have this")
    if balance < item.price:
        raise ShopError("not enough gems yet")
    return item
