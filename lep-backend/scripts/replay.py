"""``make replay LEARNER=<uuid> [WRITE=1]`` — rebuild memory state from the review log.

Reports how many memory items the learner has and which ones drift from a replay of the log;
``--write`` repairs them. Exit status 0 means zero drift (or every drift repaired).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from uuid import UUID

from app.config import WorkerSettings, load_settings
from app.db import create_engine, create_sessionmaker
from app.services.replay import replay_learner


async def _main(learner_id: UUID, write: bool) -> int:
    settings = load_settings(WorkerSettings)
    engine = create_engine(
        settings,
        user=settings.db_user,
        password=settings.db_password,
        application_name=f"{settings.service_name}-replay",
        pooled=False,
    )
    try:
        async with create_sessionmaker(engine)() as session, session.begin():
            report = await replay_learner(session, learner_id, write=write)
    finally:
        await engine.dispose()
    out = {
        "learner_id": str(report.learner_id),
        "memory_items": report.items,
        "drift": len(report.drift),
        "missing": len(report.missing),
        "repaired": report.repaired,
        "examples": (report.drift + report.missing)[:10],
    }
    sys.stdout.write(json.dumps(out) + "\n")
    unresolved = len(report.drift) + len(report.missing) - report.repaired
    return 0 if unresolved == 0 else 1


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("learner_id", type=UUID)
    parser.add_argument("--write", action="store_true", help="repair the drifted items")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(_main(args.learner_id, args.write)))


if __name__ == "__main__":
    main()
