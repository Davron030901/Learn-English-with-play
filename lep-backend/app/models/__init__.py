"""ORM models. Importing this package registers every table on ``Base.metadata``."""

from app.models.ai import AiConversation, AiTurn, AiUsageDaily
from app.models.assessment import Checkpoint, Placement
from app.models.auth import AuthSession, PasswordResetToken, RefreshToken
from app.models.base import Base
from app.models.certification import (
    Appeal,
    HumanAudit,
    LevelAward,
    LevelExam,
    ProductionSubmission,
    RaterCalibration,
    RetentionAudit,
    RubricScore,
)
from app.models.gamification import (
    Badge,
    Cosmetic,
    GemLedger,
    League,
    LeagueMember,
    LearnerDay,
    NodeProgress,
    Streak,
    UnitProgress,
    XpEvent,
)
from app.models.learner import Learner, LearnerSettings
from app.models.media import MediaAsset, MediaUsageDaily, Recording, RecordingTombstone
from app.models.sessions import LearnerSession
from app.models.review import AnswerDispute, MemoryState, ReviewAttempt, ReviewIngestKey, ReviewLog

__all__ = [
    "Appeal",
    "HumanAudit",
    "LevelAward",
    "LevelExam",
    "ProductionSubmission",
    "RaterCalibration",
    "RetentionAudit",
    "RubricScore",
    "AiConversation",
    "AiTurn",
    "AiUsageDaily",
    "AnswerDispute",
    "AuthSession",
    "Badge",
    "Base",
    "Checkpoint",
    "Cosmetic",
    "GemLedger",
    "League",
    "LeagueMember",
    "LearnerDay",
    "NodeProgress",
    "Placement",
    "Streak",
    "UnitProgress",
    "XpEvent",
    "Learner",
    "LearnerSession",
    "MediaAsset",
    "MediaUsageDaily",
    "Recording",
    "RecordingTombstone",
    "LearnerSettings",
    "MemoryState",
    "PasswordResetToken",
    "RefreshToken",
    "ReviewAttempt",
    "ReviewIngestKey",
    "ReviewLog",
]
