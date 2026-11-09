"""All /v1 routes. Every one of them passes the per-IP rate limit first."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.v1 import (
    ai,
    assessment,
    auth,
    capabilities,
    certification,
    content,
    gamification,
    leagues,
    me,
    media,
    progress,
    reviews,
    sessions,
    sync,
)
from app.deps import limit_ip

router = APIRouter(dependencies=[Depends(limit_ip)])
router.include_router(auth.router)
router.include_router(me.router)
router.include_router(content.router)
router.include_router(reviews.router)
router.include_router(gamification.router)
router.include_router(leagues.router)
router.include_router(progress.router)
router.include_router(assessment.router)
router.include_router(ai.router)
router.include_router(sessions.router)
router.include_router(certification.router)
router.include_router(media.router)
router.include_router(sync.router)
router.include_router(capabilities.router)
