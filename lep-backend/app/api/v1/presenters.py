"""Turn service and repository results into response models."""

from __future__ import annotations

from datetime import date, datetime

from app.domain.age_policy import is_minor
from app.repositories.learners import Profile
from app.schemas.auth import TokenResponse
from app.schemas.learner import LearnerOut, LearnerSettingsOut
from app.services.auth import IssuedTokens


def _seconds_until(moment: datetime, now: datetime) -> int:
    return max(0, int((moment - now).total_seconds()))


def token_response(issued: IssuedTokens, *, now: datetime) -> TokenResponse:
    return TokenResponse(
        access_token=issued.access_token,
        expires_in=_seconds_until(issued.access_expires_at, now),
        refresh_token=issued.refresh_token,
        refresh_expires_in=_seconds_until(issued.refresh_expires_at, now),
    )


def learner_out(profile: Profile, *, today: date) -> LearnerOut:
    return LearnerOut(
        id=profile.id,
        email=profile.email,
        l1=profile.l1,
        birth_year=profile.birth_year,
        is_minor=is_minor(profile.birth_year, today),
        tz=profile.tz,
        display_name=profile.display_name,
        daily_goal_min=profile.daily_goal_min,
        status=profile.status,
        created_at=profile.created_at,
        settings=LearnerSettingsOut(
            desired_retention=float(profile.desired_retention),
            rest_days=list(profile.rest_days),
            leagues_opt_in=profile.leagues_opt_in,
            league_tier=profile.league_tier,
            perfectionist_mode=profile.perfectionist_mode,
            data_collection_paused=profile.data_collection_paused,
            spelling_variant="uk" if profile.spelling_variant == "uk" else "us",
            voice_consent=profile.voice_consent,
            training_opt_in=profile.training_opt_in,
            a11y_no_audio=profile.a11y_no_audio,
            a11y_no_vision=profile.a11y_no_vision,
        ),
    )
