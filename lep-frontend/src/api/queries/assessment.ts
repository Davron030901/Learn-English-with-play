import { useMutation, useQuery } from '@tanstack/react-query';

import { serverOperations } from '../paths.generated';
import { api, unwrap } from '../client';
import { ApiError } from '../problem';
import { invalidateProgress, queryClient } from '../queryClient';
import type {
  AppealOut,
  CheckpointOut,
  CheckpointResultOut,
  ExamOut,
  ExamReportOut,
  ExamResultOut,
  PlacementOut,
  RetentionAuditOut,
  ShopOut,
  SubmissionOut,
  WritingTaskOut,
} from '../types';
import { useAuthStatus } from './me';

/**
 * Test-out checkpoints, "Find your level" and the cosmetic shop (docs/16 E14, E17, E20). The
 * server forms and grades every assessment and owns the gem balance; the app renders items and
 * reports answers, nothing more (brief §0 rule 8).
 */

const operations = serverOperations as readonly string[];
export const serverHasAssessment = operations.includes('POST /v1/assessment/checkpoints');
export const serverHasShop = operations.includes('GET /v1/shop');
export const serverHasExam = operations.includes('POST /v1/assessment/exams');
export const serverHasWriting = operations.includes('POST /v1/assessment/writing');
export const serverHasAudit = operations.includes('POST /v1/assessment/audit');

export function useStartCheckpoint() {
  return useMutation<CheckpointOut, Error, string>({
    mutationFn: async (unitId) =>
      unwrap(await api.POST('/v1/assessment/checkpoints', { body: { unit_id: unitId } })),
  });
}

/** Grades a test-out from the answers already synced under its id; a pass completes the unit. */
export function useCompleteCheckpoint() {
  return useMutation<CheckpointResultOut, Error, string>({
    mutationFn: async (checkpointId) =>
      unwrap(
        await api.POST('/v1/assessment/checkpoints/{checkpoint_id}/complete', {
          params: { path: { checkpoint_id: checkpointId } },
        }),
      ),
    onSuccess: (result) => {
      if (result.passed) invalidateProgress();
      void queryClient.invalidateQueries({ queryKey: ['gamification'] });
      void queryClient.invalidateQueries({ queryKey: ['shop'] });
    },
  });
}

export function useStartPlacement() {
  return useMutation<PlacementOut, Error>({
    mutationFn: async () => unwrap(await api.POST('/v1/assessment/placement')),
  });
}

export function useAnswerPlacement() {
  return useMutation<
    PlacementOut,
    Error,
    { placementId: string; answers: Record<string, Record<string, unknown>> }
  >({
    mutationFn: async ({ placementId, answers }) =>
      unwrap(
        await api.POST('/v1/assessment/placement/{placement_id}/answers', {
          params: { path: { placement_id: placementId } },
          body: { answers },
        }),
      ),
  });
}

// ------------------------------------------------------------------- the level exam

/** Starts the level exam (docs/12 §4), or resumes the one still open: the server forms it. */
export function useStartExam() {
  return useMutation<ExamOut, Error, 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'>({
    mutationFn: async (level) =>
      unwrap(await api.POST('/v1/assessment/exams', { body: { level } })),
  });
}

export type { ExamReportOut } from '../types';

/** The full report on a completed exam (docs/12 §9.2): the same whenever it is asked for. */
export function useExamReport(examId: string) {
  return useQuery<ExamReportOut, Error>({
    queryKey: ['exam-report', examId],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/assessment/exams/{exam_id}/report', {
          params: { path: { exam_id: examId } },
        }),
      ),
    staleTime: 10 * 60_000,
    retry: (count, err) => !(err instanceof ApiError && err.problem.status < 500) && count < 1,
  });
}

/** Scores the exam from the answers the server received under its id before it ended. */
export function useCompleteExam() {
  return useMutation<ExamResultOut, Error, string>({
    mutationFn: async (examId) =>
      unwrap(
        await api.POST('/v1/assessment/exams/{exam_id}/complete', {
          params: { path: { exam_id: examId } },
        }),
      ),
    onSuccess: () => {
      // the exam condition of the level award has a new value
      void queryClient.invalidateQueries({ queryKey: ['progress', 'level'] });
    },
  });
}

// ------------------------------------------------------------------- writing and appeals

const noRetryOn4xx = (count: number, err: Error) =>
  !(err instanceof ApiError && err.problem.status >= 400 && err.problem.status < 500) && count < 1;

type Band = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

/** The writing tasks of a level (docs/12 §5): a prompt and a word range each. */
export function useWritingTasks(level: Band | null) {
  const status = useAuthStatus();
  return useQuery<WritingTaskOut[], Error>({
    queryKey: ['writing', 'tasks', level],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/assessment/writing-tasks', {
          params: { query: { level: level as Band } },
        }),
      ),
    enabled: status === 'signedIn' && serverHasWriting && level !== null,
    staleTime: 60 * 60_000,
    retry: noRetryOn4xx,
  });
}

/** Sends a piece of writing; the server rates it once, with evidence for every criterion. */
export function useSubmitWriting() {
  return useMutation<SubmissionOut, Error, { taskId: string; text: string }>({
    mutationFn: async ({ taskId, text }) =>
      unwrap(await api.POST('/v1/assessment/writing', { body: { task_id: taskId, text } })),
    onSuccess: () => {
      // the production condition of the level award has a new value
      void queryClient.invalidateQueries({ queryKey: ['progress', 'level'] });
    },
  });
}

/** Appeals a score (once): a person who does not see the machine score rates it again. */
export function useAppeal() {
  return useMutation<AppealOut, Error, { scoreId: string; reason: string }>({
    mutationFn: async ({ scoreId, reason }) =>
      unwrap(await api.POST('/v1/assessment/appeals', { body: { score_id: scoreId, reason } })),
  });
}

// ------------------------------------------------------------------- the monthly memory check

/** Starts the retention check (docs/08 §9): about 20 well-known items, answered cold. */
export function useStartAudit() {
  return useMutation<RetentionAuditOut, Error, void>({
    mutationFn: async () => unwrap(await api.POST('/v1/assessment/audit')),
  });
}

/** Compares what was remembered with what the memory model predicted. */
export function useCompleteAudit() {
  return useMutation<RetentionAuditOut, Error, string>({
    mutationFn: async (auditId) =>
      unwrap(
        await api.POST('/v1/assessment/audit/{audit_id}/complete', {
          params: { path: { audit_id: auditId } },
        }),
      ),
    onSuccess: () => {
      // coverage is now checked, and due dates may have moved with a raised retention target
      invalidateProgress();
      void queryClient.invalidateQueries({ queryKey: ['due'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

// ------------------------------------------------------------------- the shop

export function useShop() {
  const status = useAuthStatus();
  return useQuery<ShopOut, Error>({
    queryKey: ['shop'],
    queryFn: async () => unwrap(await api.GET('/v1/shop')),
    enabled: status === 'signedIn' && serverHasShop,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    retry: noRetryOn4xx,
  });
}

function afterShop(shop: ShopOut): void {
  queryClient.setQueryData(['shop'], shop);
  // the balance shown in the HUD comes from the summary
  void queryClient.invalidateQueries({ queryKey: ['gamification', 'summary'] });
}

export function usePurchase() {
  return useMutation<ShopOut, Error, string>({
    mutationFn: async (itemId) =>
      unwrap(await api.POST('/v1/shop/purchase', { body: { item_id: itemId } })),
    onSuccess: afterShop,
  });
}

export function useEquip() {
  return useMutation<ShopOut, Error, string>({
    mutationFn: async (itemId) =>
      unwrap(await api.POST('/v1/shop/equip', { body: { item_id: itemId } })),
    onSuccess: afterShop,
  });
}

/** The outfit Pip wears, from the cached shop (null until the shop was loaded once). */
export function useEquippedOutfit(): string | null {
  const shop = useShop();
  return shop.data?.items.find((i) => i.kind === 'pip_outfit' && i.equipped)?.id ?? null;
}
