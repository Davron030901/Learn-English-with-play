"""The README's configuration table must name every setting the code reads."""

from __future__ import annotations

from pathlib import Path

from app.config import ENV_PREFIX, MigrationSettings, Settings, WorkerSettings

ROOT = Path(__file__).resolve().parents[2]


def test_every_setting_is_documented_in_the_readme() -> None:
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    names = {
        f"{ENV_PREFIX}{field.upper()}"
        for model in (Settings, WorkerSettings, MigrationSettings)
        for field in model.model_fields
    }
    missing = sorted(name for name in names if f"`{name}`" not in readme)
    assert not missing, f"undocumented settings: {missing}"


def test_decisions_record_exists_and_names_the_open_rulings() -> None:
    decisions = (ROOT / "DECISIONS.md").read_text(encoding="utf-8")
    for heading in ("Memory-item ID convention", "Open rulings"):
        assert heading in decisions
