"""GET /v1/capabilities — what this server offers; POST /v1/client-events — what the apps report.

**Capabilities.** The app can tell from the OpenAPI document which routes exist, but not whether
a feature behind one is configured: the conversation partner without a key, speech without a
provider, password reset without a mail backend all answer 503. One cacheable, public answer
lets the app show such features honestly — absent, never broken.

**Client events** (frontend DECISIONS F2). A small, fixed list of things only the device can
see, counted so product questions can be decided on data — first of all R13, whether a refresh
token needs a grace window (``refresh_response_lost``). No learner, no device id, no free text:
a name from the list, a count, the platform and the app's version. Counted in
``client_events_total`` and logged once per batch; nothing is stored in the database. Anyone
may send them (an event often follows a lost session), so the route is rate-limited per address
and fails open.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field

from app.deps import ContainerDep, limit_client_events_ip
from app.observability.logs import get_logger
from app.schemas.problem import problem_responses

router = APIRouter(tags=["meta"])

_log = get_logger("app.client_events")

ClientEventName = Literal[
    # a refresh whose response was lost: the retry with the same token then ended the session
    "refresh_response_lost",
    # the device outbox reached its 5,000-answer cap and stopped accepting answers
    "outbox_full",
    # a server-composed lesson the packed content could not play, composed on the device instead
    "server_plan_unplayable",
    # a recorded audio file failed to load and the device voice spoke instead
    "audio_fallback",
]


class CapabilitiesOut(BaseModel):
    ai_partner: bool = Field(description="The conversation partner and the writing rater.")
    tts: bool = Field(description="Server-side synthesised speech (POST /v1/media/tts).")
    speech_scoring: bool = Field(description="Recorded speech is scored (POST /v1/media/speech).")
    password_reset: bool = Field(description="POST /v1/auth/password/forgot sends links.")
    web_refresh_cookie: bool = Field(
        description="A web client may keep its refresh token in an httpOnly cookie."
    )
    breached_password_check: Literal["built_in", "built_in_and_hibp"] = Field(
        description="How new passwords are screened (NIST SP 800-63B §5.1.1.2)."
    )
    content_version: str


class ClientEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: ClientEventName
    count: int = Field(default=1, ge=1, le=1_000)


class ClientEventsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    platform: Literal["ios", "android", "web"]
    app_version: str = Field(min_length=1, max_length=32, pattern=r"^[0-9A-Za-z.+-]+$")
    events: list[ClientEvent] = Field(min_length=1, max_length=20)


class ClientEventsOut(BaseModel):
    accepted: int


@router.get(
    "/capabilities",
    summary="Which optional features this server has configured",
    responses=problem_responses(429),
)
async def capabilities(container: ContainerDep, response: Response) -> CapabilitiesOut:
    response.headers["Cache-Control"] = "public, max-age=300"
    settings = container.settings
    screen = container.password_screen
    return CapabilitiesOut(
        ai_partner=container.ai is not None,
        tts=container.tts is not None,
        speech_scoring=container.speech is not None,
        password_reset=container.mailer is not None and settings.password_reset_url is not None,
        web_refresh_cookie=settings.web_refresh_cookie,
        breached_password_check=(
            "built_in_and_hibp" if screen is not None and screen.remote else "built_in"
        ),
        content_version=container.content.version,
    )


@router.post(
    "/client-events",
    status_code=202,
    summary="Count events only the device can see (an allow-list; nothing personal)",
    dependencies=[Depends(limit_client_events_ip)],
    responses=problem_responses(422, 429),
)
async def client_events(body: ClientEventsIn, container: ContainerDep) -> ClientEventsOut:
    totals: dict[str, int] = {}
    for event in body.events:
        totals[event.name] = totals.get(event.name, 0) + event.count
    for name, count in totals.items():
        container.metrics.client_events.labels(name=name, platform=body.platform).inc(count)
    _log.info("client_events", platform=body.platform, app_version=body.app_version, events=totals)
    return ClientEventsOut(accepted=sum(totals.values()))
