import type { components } from './schema.generated';

/** Named shorthands for the generated server schemas (never hand-written shapes). */
type S = components['schemas'];

export type AwardsOut = S['AwardsOut'];
export type SyncResponse = S['SyncResponse'];
export type RecordResult = S['RecordResult'];
export type GamificationSummary = S['GamificationSummary'];
export type QuestOut = S['QuestOut'];
export type StreakOut = S['StreakOut'];
export type GoalOut = S['Goal'];
export type BadgeOut = S['BadgeOut'];
export type ProgressOut = S['ProgressOut'];
export type GardenSummary = S['GardenSummary'];
export type GardenBeds = S['GardenBeds'];
export type Plant = S['Plant'];
export type DueQueue = S['DueQueue'];
export type LevelAwardOut = S['LevelAwardOut'];
export type ExamOut = S['ExamOut'];
export type ExamResultOut = S['ExamResultOut'];
/** `error_norms` is always null (no norms exist yet) and openapi-fetch drops null-only keys. */
export type ExamReportOut = Omit<S['ExamReportOut'], 'error_norms'>;
export type WritingTaskOut = S['WritingTaskOut'];
export type SubmissionOut = S['SubmissionOut'];
export type ScoreOut = S['ScoreOut'];
export type AppealOut = S['AppealOut'];
export type RetentionAuditOut = S['RetentionAuditOut'];
export type ConditionOut = S['ConditionOut'];
export type SessionSummary = S['SessionSummary'];
export type SettingsPatch = S['SettingsPatch'];
export type LeagueStatusOut = S['LeagueStatusOut'];
export type LeagueRow = S['LeagueRow'];
export type LeagueResultOut = S['LeagueResultOut'];
export type CheckpointOut = S['CheckpointOut'];
export type CheckpointResultOut = S['CheckpointResultOut'];
export type PlacementOut = S['PlacementOut'];
export type ShopOut = S['ShopOut'];
export type ShopItemOut = S['ShopItemOut'];
export type AiStatusOut = S['AiStatusOut'];
export type CastOut = S['CastOut'];
export type CharacterOut = S['CharacterOut'];
export type ScenarioOut = S['ScenarioOut'];
export type ConversationOut = S['ConversationOut'];
export type TurnOut = S['TurnOut'];
export type RecastOut = S['RecastOut'];
export type SummaryOut = S['SummaryOut'];
export type SessionOut = S['SessionOut'];
