"""The local stack: every process that loads the course has it mounted, and the demo seed runs."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

yaml = pytest.importorskip("yaml")

ROOT = Path(__file__).resolve().parents[2]


def _compose() -> dict[str, Any]:
    loaded: dict[str, Any] = yaml.safe_load(
        (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    )
    return loaded


@pytest.mark.parametrize("service", ["api", "worker", "beat", "demo"])
def test_every_process_that_loads_the_course_has_it_mounted(service: str) -> None:
    svc = _compose()["services"][service]
    target = svc["environment"]["LEP_CONTENT_DIR"]
    (mount,) = [v for v in svc["volumes"] if v["target"] == target]
    assert mount["read_only"] is True
    # the packed course is where the mount says, next to this repository's backend
    assert (ROOT / mount["source"] / "index.json").is_file()


def test_the_image_carries_the_course_nowhere_else() -> None:
    # the content is a separate artefact: a Dockerfile COPY of it would hide a missing mount
    assert "Claude outputs" not in (ROOT / "Dockerfile").read_text(encoding="utf-8")


def test_the_demo_learner_is_seeded_once_after_the_migrations() -> None:
    demo = _compose()["services"]["demo"]
    assert demo["command"] == ["python", "-m", "scripts.seed_demo"]
    assert demo["restart"] == "no"
    assert demo["depends_on"]["migrate"]["condition"] == "service_completed_successfully"
    assert "lep_demo_password" in demo["secrets"]
    assert "lep_demo_password" in (ROOT / "scripts" / "init-local-secrets.sh").read_text(
        encoding="utf-8"
    )
    assert "!scripts/" in (ROOT / ".dockerignore").read_text(encoding="utf-8")


def test_reset_letters_go_to_a_volume_the_api_can_write() -> None:
    api = _compose()["services"]["api"]
    env = api["environment"]
    assert env["LEP_MAIL_BACKEND"] == "file"
    (mount,) = [v for v in api["volumes"] if v["target"] == env["LEP_MAIL_OUTBOX_DIR"]]
    assert mount["type"] == "volume"
    assert mount["source"] in _compose()["volumes"]
    # a named volume takes the image directory's owner: the process is not root
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    assert f"chown lep:lep {env['LEP_MAIL_OUTBOX_DIR']}" in dockerfile
