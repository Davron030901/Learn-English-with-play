"""Write the OpenAPI document: ``make openapi`` (``python -m scripts.export_openapi``).

Builds the app with throwaway settings — the schema depends only on the routes, and no
connection is opened — and writes the document to the path given (default
``openapi.json``). tests/unit/test_openapi.py fails when the committed file is stale.
"""

from __future__ import annotations

import json
import secrets
import sys
from pathlib import Path
from typing import Any

from pydantic import SecretStr

from app.config import Settings
from app.main import build_app


def openapi_document() -> dict[str, Any]:
    settings = Settings(
        env="dev",
        db_host="localhost",
        db_name="lep",
        db_user="lep_app",
        db_password=SecretStr(secrets.token_urlsafe(24)),
        redis_host="localhost",
        jwt_secret=SecretStr(secrets.token_urlsafe(48)),
        docs_enabled=True,
        log_level="WARNING",
    )
    return build_app(settings).openapi()


def render(document: dict[str, Any]) -> str:
    return json.dumps(document, indent=2, ensure_ascii=False) + "\n"


def main(argv: list[str]) -> int:
    target = Path(argv[1]) if len(argv) > 1 else Path("openapi.json")
    target.write_text(render(openapi_document()), encoding="utf-8")
    print(f"wrote {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
