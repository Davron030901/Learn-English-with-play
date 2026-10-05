"""Audio assets, synthesised speech, voice recordings and the learner's data controls."""

from __future__ import annotations

from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Query, Response
from fastapi.responses import FileResponse
from pydantic import SecretStr

from app.deps import ContainerDep, CurrentPrincipal, DbSession
from app.domain import exam as ex
from app.domain.streaks import local_day
from app.errors import (
    AppError,
    Conflict,
    FieldError,
    InvalidCredentials,
    NotFound,
    ValidationFailed,
)
from app.models.learner import Learner
from app.repositories.learners import LearnerRepository
from app.schemas.media import (
    AssetOut,
    DeleteAccountRequest,
    DeletedOut,
    SpeakingTaskOut,
    SpeechJobOut,
    SpeechRequest,
    TtsOut,
    TtsRequest,
)
from app.schemas.problem import problem_responses
from app.services import data, media, speech

router = APIRouter(tags=["media"])


class MediaUnavailable(AppError):
    status = 503
    type = "media_unavailable"
    title = "This is not available on the server"
    default_headers = {"Retry-After": "60"}


class MediaRefused(Conflict):
    type = "media_refused"
    title = "Not accepted"


def _raise(kind: str, detail: str) -> AppError:
    if kind == "unavailable":
        return MediaUnavailable(detail)
    if kind == "not_found":
        return NotFound(detail)
    if kind == "invalid":
        return ValidationFailed([FieldError("body", detail)], detail)
    return MediaRefused(detail, reason=kind)


def _url(path: str) -> str:
    return f"/v1/media/files/{path}"


# ------------------------------------------------------------------- assets and speech out


@router.get(
    "/media/assets/{path:path}",
    summary="An audio file's status: missing, a synthetic draft, or a human recording",
    responses=problem_responses(401, 404, 429),
)
async def get_asset(
    path: str,
    principal: CurrentPrincipal,  # noqa: ARG001 — signed-in learners only
    session: DbSession,
    container: ContainerDep,
) -> AssetOut:
    try:
        async with session.begin():
            a = await media.asset(session, path)
    except media.MediaError as exc:
        raise _raise(exc.kind, str(exc)) from None
    exists = a.status != "missing" and media.safe_path(container.settings.media_dir, path).exists()
    return AssetOut(
        path=a.path,
        status=a.status,  # type: ignore[arg-type]
        source=a.source,  # type: ignore[arg-type]
        text=a.text,
        url=_url(a.path) if exists else None,
    )


@router.get(
    "/media/files/{path:path}",
    summary="An audio file",
    responses=problem_responses(401, 404, 429),
    response_class=FileResponse,
)
async def get_file(
    path: str,
    principal: CurrentPrincipal,  # noqa: ARG001 — signed-in learners only
    container: ContainerDep,
) -> Response:
    try:
        target = media.safe_path(container.settings.media_dir, path)
    except media.MediaError as exc:
        raise _raise(exc.kind, str(exc)) from None
    if not target.is_file():
        raise NotFound("there is no such audio")
    return FileResponse(
        target, media_type="audio/ogg", headers={"Cache-Control": "private, max-age=86400"}
    )


@router.post(
    "/media/tts",
    summary="Synthesised speech for a short text (server-side; cached; a daily ceiling)",
    responses=problem_responses(401, 409, 422, 429, 503),
)
async def tts(
    body: TtsRequest, principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> TtsOut:
    try:
        async with session.begin():
            profile = await LearnerRepository(session).profile(principal.learner_id)
            tz = profile.tz if profile else "UTC"
            out = await media.speak(
                session,
                container.tts,
                container.settings.media_dir,
                principal.learner_id,
                body.text,
                local_day(container.clock.now(), tz),
                container.settings.tts_chars_per_day,
            )
    except media.MediaError as exc:
        raise _raise(exc.kind, str(exc)) from None
    return TtsOut(url=_url(out["path"]), source="synthetic", voice=out["voice"])


# ------------------------------------------------------------------- recordings in


@router.get(
    "/assessment/speaking-tasks",
    summary="The speaking tasks for a level",
    responses=problem_responses(401, 422, 429),
)
async def speaking_tasks(
    principal: CurrentPrincipal,  # noqa: ARG001
    level: Annotated[Literal["A1", "A2", "B1", "B2", "C1", "C2"], Query()],
) -> list[SpeakingTaskOut]:
    return [
        SpeakingTaskOut(id=t.id, level=t.level, prompt=t.prompt, seconds=t.seconds)
        for t in ex.SPEAKING_TASKS
        if t.level == level
    ]


@router.post(
    "/media/speech",
    status_code=202,
    summary="Upload an utterance (with consent); it is scored after this returns — poll the job",
    responses=problem_responses(401, 409, 422, 429, 503),
)
async def submit_speech(
    body: SpeechRequest,
    background: BackgroundTasks,
    principal: CurrentPrincipal,
    session: DbSession,
    container: ContainerDep,
) -> SpeechJobOut:
    catalog = container.content
    if body.purpose == "pronunciation":
        item = catalog.items.get(body.item_id or "")
        if item is None:
            raise NotFound("there is no such item")
        # the level comes from the unit, never the item (brief §17.1)
        level = catalog.units[item.unit_id].cefr[:2]
        expected, task_id, item_id = item.say or None, None, item.id
    else:
        task = ex.speaking_task(body.task_id or "")
        if task is None:
            raise NotFound("there is no such speaking task")
        level, expected, task_id, item_id = task.level, None, task.id, None
    try:
        audio = speech.decode_audio(body.audio_base64)
        settings = container.settings
        async with session.begin():
            profile = await LearnerRepository(session).profile(principal.learner_id)
            now = container.clock.now()
            row = await speech.accept(
                session,
                learner_id=principal.learner_id,
                scorer_available=container.speech is not None,
                purpose=body.purpose,
                level=level,
                audio=audio,
                mime=body.mime,
                seconds=body.seconds,
                expected=expected,
                task_id=task_id,
                item_id=item_id,
                now=now,
                day=local_day(now, profile.tz if profile else "UTC"),
                max_seconds=settings.max_recording_seconds,
                seconds_per_day=settings.speech_seconds_per_day,
                retention_days=settings.voice_retention_days,
            )
            out = SpeechJobOut(
                id=row.id,
                status="queued",
                purpose=row.purpose,
                expires_at=row.expires_at,
                result=None,
            )
    except speech.SpeechError as exc:
        raise _raise(exc.kind, str(exc)) from None
    scorer = container.speech
    if scorer is not None:
        background.add_task(
            speech.score,
            container.sessionmaker,
            catalog,
            container.clock,
            scorer,
            container.speaking_rater,
            principal.learner_id,
            out.id,
        )
    return out


@router.get(
    "/media/jobs/{job_id}",
    summary="A recording's scoring job",
    responses=problem_responses(401, 404, 429),
)
async def get_job(job_id: UUID, principal: CurrentPrincipal, session: DbSession) -> SpeechJobOut:
    try:
        async with session.begin():
            row = await speech.job(session, principal.learner_id, job_id)
            return SpeechJobOut(
                id=row.id,
                status=row.status,  # type: ignore[arg-type]
                purpose=row.purpose,
                expires_at=row.expires_at,
                result=row.result,
            )
    except speech.SpeechError as exc:
        raise _raise(exc.kind, str(exc)) from None


# ------------------------------------------------------------------- the learner's data


@router.get(
    "/me/export",
    summary="Everything the server holds about you, as JSON (recordings as base64)",
    responses=problem_responses(401, 429, 503),
)
async def export_data(principal: CurrentPrincipal, session: DbSession) -> dict[str, Any]:
    async with session.begin():
        return await data.export(session, principal.learner_id)


@router.delete(
    "/me/recordings",
    summary="Delete every voice recording now",
    responses=problem_responses(401, 429, 503),
)
async def delete_recordings(
    principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> DeletedOut:
    async with session.begin():
        n = await speech.delete_recordings(session, principal.learner_id, container.clock.now())
    return DeletedOut(deleted=n)


@router.post(
    "/me/delete",
    status_code=204,
    summary="Delete the account and everything in it (password required)",
    responses=problem_responses(401, 422, 429, 503),
)
async def delete_account(
    body: DeleteAccountRequest,
    principal: CurrentPrincipal,
    session: DbSession,
    container: ContainerDep,
) -> Response:
    async with session.begin():
        creds_row = await session.get(Learner, principal.learner_id)
        stored = creds_row.password_hash if creds_row is not None else None
    if not await container.hasher.verify(stored, SecretStr(body.password)):
        raise InvalidCredentials()
    async with session.begin():
        await data.delete_account(session, principal.learner_id, container.clock.now())
    return Response(status_code=204)
