"""Level exams, production scoring, appeals, the level award and the retention audit."""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Path, Query

from app.ai.rater import PROMPT_VERSION, RaterUnavailable
from app.deps import ContainerDep, CurrentPrincipal, DbSession
from app.domain import exam as ex
from app.domain.level_award import EXAM_PASS, ExamResult, LevelAwardResult
from app.domain.rubric import RubricInvalid, rate
from app.errors import AppError, Conflict, FieldError, NotFound, ValidationFailed
from app.models.certification import LevelExam, RubricScore
from app.observability.logs import get_logger
from app.schemas.certification import (
    AppealOut,
    AppealRequest,
    ConditionOut,
    CriterionOut,
    ExamOut,
    ExamRequest,
    ExamResultOut,
    LevelAwardOut,
    RetentionAuditOut,
    ScoreOut,
    SubmissionOut,
    WritingRequest,
    WritingTaskOut,
)
from app.schemas.problem import problem_responses
from app.services.certification import CertificationError, CertificationService, grounded

router = APIRouter(tags=["certification"])
_log = get_logger("app.certification")

LevelPath = Annotated[Literal["A1", "A2", "B1", "B2", "C1", "C2"], Path()]


class AssessmentConflict(Conflict):
    type = "assessment_conflict"
    title = "That is not possible right now"


def _raise(exc: CertificationError) -> AppError:
    detail = str(exc)
    if exc.kind == "not_found":
        return NotFound(detail)
    if exc.kind == "invalid":
        return ValidationFailed([FieldError("text", detail)], detail)
    return AssessmentConflict(detail, reason=exc.kind)


def _service(session: DbSession, container: ContainerDep) -> CertificationService:
    return CertificationService(session, container.content, container.clock)


def _score_out(s: RubricScore) -> ScoreOut:
    return ScoreOut(
        id=s.id,
        kind=s.kind,
        level=s.level,
        overall=s.overall,
        criteria=[
            CriterionOut(criterion=k, band=v["band"], evidence=list(v["evidence"]))
            for k, v in s.criteria.items()
        ],
        rater=f"{s.rater_kind} / {s.rater_version}",
        certifying=s.certifying,
        borderline=s.borderline,
        created_at=s.created_at,
    )


def _award_out(r: LevelAwardResult, recorded: bool) -> LevelAwardOut:
    return LevelAwardOut(
        level=r.level,
        awarded=r.awarded,
        conditions=[
            ConditionOut(
                name=c.name,
                passed=c.passed,
                value=c.value,
                threshold=c.threshold,
                shortfall=c.shortfall,
            )
            for c in r.conditions
        ],
        message=r.message,
        remediation=list(r.remediation),
        recorded=recorded,
    )


def _exam_out(row: LevelExam) -> ExamOut:
    overall, paper = EXAM_PASS[row.level]
    return ExamOut(
        id=row.id,
        level=row.level,
        papers=row.papers,
        pass_overall=overall,
        pass_paper=paper,
        created_at=row.created_at,
    )


# ------------------------------------------------------------------- level exams


@router.post(
    "/assessment/exams",
    status_code=201,
    summary="Start a level exam: the listening, reading and use-of-English papers",
    responses=problem_responses(401, 409, 422, 429, 503),
)
async def start_exam(
    body: ExamRequest, principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> ExamOut:
    try:
        async with session.begin():
            row = await _service(session, container).start_exam(principal.learner_id, body.level)
            return _exam_out(row)
    except CertificationError as exc:
        raise _raise(exc) from None


@router.post(
    "/assessment/exams/{exam_id}/complete",
    summary="Score the exam from the answers synced under its id (idempotent)",
    responses=problem_responses(401, 404, 429, 503),
)
async def complete_exam(
    exam_id: UUID, principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> ExamResultOut:
    try:
        async with session.begin():
            row = await _service(session, container).complete_exam(principal.learner_id, exam_id)
            scores = row.scores or {}
            return ExamResultOut(
                id=row.id,
                level=row.level,
                scores=scores,
                overall=round(ExamResult(scores).overall, 4),
                passed=bool(row.passed),
            )
    except CertificationError as exc:
        raise _raise(exc) from None


# ------------------------------------------------------------------- production


@router.get(
    "/assessment/writing-tasks",
    summary="The writing tasks for a level",
    responses=problem_responses(401, 422, 429),
)
async def writing_tasks(
    principal: CurrentPrincipal,  # noqa: ARG001 — signed-in learners only
    level: Annotated[Literal["A1", "A2", "B1", "B2", "C1", "C2"], Query()],
) -> list[WritingTaskOut]:
    return [
        WritingTaskOut(
            id=t.id, level=t.level, prompt=t.prompt, min_words=t.min_words, max_words=t.max_words
        )
        for t in ex.WRITING_TASKS
        if t.level == level
    ]


@router.post(
    "/assessment/writing",
    status_code=201,
    summary="Submit a writing task; it is rated once, with evidence for every criterion",
    responses=problem_responses(401, 404, 422, 429, 503),
)
async def submit_writing(
    body: WritingRequest, principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> SubmissionOut:
    service = _service(session, container)
    try:
        async with session.begin():
            sub = await service.new_writing(principal.learner_id, body.task_id, body.text)
            sub_id, level, prompt, text = sub.id, sub.level, sub.prompt, sub.text
    except CertificationError as exc:
        raise _raise(exc) from None

    rater = container.rater
    if rater is None:
        return SubmissionOut(submission_id=sub_id, status="awaiting_rater", score=None)
    # the model is asked outside any transaction: no connection waits on the network
    try:
        raw = await rater.rate(level=level, prompt=prompt, text=text)
        rated = rate("writing", grounded(raw, text))
    except (RaterUnavailable, RubricInvalid) as exc:
        _log.info("writing_not_rated", reason=type(exc).__name__)
        return SubmissionOut(submission_id=sub_id, status="awaiting_rater", score=None)
    async with session.begin():
        score = await service.store_score(
            principal.learner_id,
            sub_id,
            rated,
            rater_kind="llm",
            rater_version=rater.version,
            prompt_version=PROMPT_VERSION,
        )
        return SubmissionOut(submission_id=sub_id, status="scored", score=_score_out(score))


@router.post(
    "/assessment/appeals",
    status_code=201,
    summary="Appeal a score (once): a human rater who does not see the machine score",
    responses=problem_responses(401, 404, 409, 422, 429, 503),
)
async def appeal(
    body: AppealRequest, principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> AppealOut:
    try:
        async with session.begin():
            row = await _service(session, container).appeal(
                principal.learner_id, body.score_id, body.reason
            )
            return AppealOut(id=row.id, score_id=row.score_id, status=row.status)
    except CertificationError as exc:
        raise _raise(exc) from None


# ------------------------------------------------------------------- the level award


@router.get(
    "/progress/level/{level}",
    summary="The four conditions of a level award, each with its computed value",
    responses=problem_responses(401, 422, 429, 503),
)
async def level_conditions(
    level: LevelPath, principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> LevelAwardOut:
    async with session.begin():
        result = await _service(session, container).evaluate(
            principal.learner_id, level, record=False
        )
    return _award_out(result, recorded=False)


@router.post(
    "/progress/level/{level}/award",
    summary="Ask for the level: evaluated now, stored with its evidence, awarded only if all hold",
    responses=problem_responses(401, 422, 429, 503),
)
async def level_award(
    level: LevelPath, principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> LevelAwardOut:
    async with session.begin():
        result = await _service(session, container).evaluate(
            principal.learner_id, level, record=True
        )
    return _award_out(result, recorded=True)


# ------------------------------------------------------------------- the retention audit


@router.post(
    "/assessment/audit",
    status_code=201,
    summary="Start the monthly retention check: 20 known items, cold",
    responses=problem_responses(401, 409, 429, 503),
)
async def start_audit(
    principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> RetentionAuditOut:
    try:
        async with session.begin():
            row = await _service(session, container).start_retention_audit(principal.learner_id)
            return RetentionAuditOut(id=row.id, item_ids=row.item_ids, predicted=row.predicted)
    except CertificationError as exc:
        raise _raise(exc) from None


@router.post(
    "/assessment/audit/{audit_id}/complete",
    summary="Compare actual recall with the prediction; raise the retention target if needed",
    responses=problem_responses(401, 404, 409, 429, 503),
)
async def complete_audit(
    audit_id: UUID, principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> RetentionAuditOut:
    try:
        async with session.begin():
            row, raised = await _service(session, container).complete_retention_audit(
                principal.learner_id, audit_id
            )
            return RetentionAuditOut(
                id=row.id,
                item_ids=row.item_ids,
                predicted=row.predicted,
                actual=row.actual,
                raised_retention=raised,
            )
    except CertificationError as exc:
        raise _raise(exc) from None
