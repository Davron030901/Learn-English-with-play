"""Content bundles for offline use (docs/11 §3; backend brief §11).

The course is served as JSON: one outline and one file per unit. A manifest names each file
with its SHA-256 and size, so a client keeps a cached file while its hash is unchanged and
checks what it downloads. With ``LEP_CONTENT_CDN_BASE_URL`` set, the files live on a CDN at
immutable URLs keyed by their hash (``scripts/export_bundle.py`` writes them, so publishing is
copying a directory); otherwise the URLs are the API's own ``/v1/course`` and ``/v1/units/…``.

Bundles are not signed with a key: they carry no learner data and no secret, and the hash —
delivered over the authenticated API — is what proves a file is the one the server meant.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.content.catalog import ContentCatalog

COURSE = "course"


@dataclass(frozen=True, slots=True)
class BundleFile:
    #: "course" or a unit id
    id: str
    sha256: str
    bytes: int
    url: str


def _scope(file_id: str) -> str:
    return COURSE if file_id == COURSE else f"unit:{file_id}"


def file_name(file_id: str, sha256: str) -> str:
    """The immutable name a file is published under: a new version is a new name."""
    stem = COURSE if file_id == COURSE else f"units/{file_id}"
    return f"{stem}.{sha256[:16]}.json"


def bundle_file(catalog: ContentCatalog, file_id: str, cdn_base_url: str | None) -> BundleFile:
    sha256, size = catalog.digest(_scope(file_id))
    if cdn_base_url:
        url = f"{cdn_base_url}/{file_name(file_id, sha256)}"
    else:
        url = "/v1/course" if file_id == COURSE else f"/v1/units/{file_id}"
    return BundleFile(file_id, sha256, size, url)


def manifest(catalog: ContentCatalog, cdn_base_url: str | None) -> dict[str, Any]:
    return {
        "content_version": catalog.version,
        "course": _plain(bundle_file(catalog, COURSE, cdn_base_url)),
        "units": [_plain(bundle_file(catalog, u, cdn_base_url)) for u in catalog.unit_order()],
    }


def _plain(f: BundleFile) -> dict[str, Any]:
    return {"id": f.id, "sha256": f.sha256, "bytes": f.bytes, "url": f.url}


def export(catalog: ContentCatalog, out_dir: Path) -> dict[str, Any]:
    """Write every file under its immutable name, plus ``manifest.json`` (URLs relative)."""
    for file_id in (COURSE, *catalog.unit_order()):
        sha256, _ = catalog.digest(_scope(file_id))
        target = out_dir / file_name(file_id, sha256)
        target.parent.mkdir(parents=True, exist_ok=True)
        body = catalog.course_json() if file_id == COURSE else catalog.unit_json(file_id)
        assert body is not None  # noqa: S101 — unit_order() only names units the catalog has
        target.write_bytes(body)
    listing = manifest(catalog, None)
    for entry in (listing["course"], *listing["units"]):
        entry["url"] = file_name(entry["id"], entry["sha256"])
    (out_dir / "manifest.json").write_text(json.dumps(listing, indent=2), encoding="utf-8")
    return listing
