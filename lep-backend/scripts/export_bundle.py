"""Write the content bundle for a CDN: ``make bundle`` (``python -m scripts.export_bundle DIR``).

Loads the packed course from ``LEP_CONTENT_DIR`` (or its default), validates it as the API does
at start-up, and writes ``course.<hash>.json``, ``units/<unit>.<hash>.json`` and
``manifest.json`` under DIR (default ``var/bundle``). Every name carries the file's hash, so the
files are immutable: publish by copying DIR to the bucket behind ``LEP_CONTENT_CDN_BASE_URL``
with a long cache lifetime, before the API that names them is deployed.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from app.config import DEFAULT_CONTENT_DIR
from app.content.bundle import export
from app.content.catalog import load_catalog


def main(argv: list[str]) -> int:
    out_dir = Path(argv[1]) if len(argv) > 1 else Path("var/bundle")
    content_dir = Path(os.environ.get("LEP_CONTENT_DIR") or DEFAULT_CONTENT_DIR)
    catalog = load_catalog(content_dir)
    listing = export(catalog, out_dir)
    size = sum(u["bytes"] for u in listing["units"]) + listing["course"]["bytes"]
    print(
        f"wrote {len(listing['units'])} units and the course ({size / 1e6:.1f} MB), "
        f"content {listing['content_version']}, to {out_dir}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
