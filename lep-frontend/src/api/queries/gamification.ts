import { useMutation, useQuery } from '@tanstack/react-query';

import { serverOperations } from '../paths.generated';
import { api, session, unwrap } from '../client';
import { ApiError } from '../problem';
import { invalidateProgress, queryClient } from '../queryClient';
import type {
  LevelAwardOut,
  DueQueue,
  GamificationSummary,
  GardenBeds,
  GardenSummary,
  ProgressOut,
  SessionSummary,
  SettingsPatch,
} from '../types';
import type { Learner } from '../session';
import { useAuthStatus } from './me';
import type { AccessibilityProfile } from '@/a11y/profile';
import { log } from '@/lib/log';

/**
 * The server's view of the learner: coverage and progress first, then XP, the goal, the streak,
 * gems, quests and the garden (docs/10 §4.1). Every number here is computed by the server from
 * stored answers — the app never invents one (brief §0 rule 8). Memory-cached only.
 */

const noRetryOn4xx = (count: number, err: Error) =>
  !(err instanceof ApiError && err.problem.status >= 400 && err.problem.status < 500) && count < 1;

/** True when the running server offers the motivation layer (older servers do not). */
export const serverHasGamification = (serverOperations as readonly string[]).includes(
  'GET /v1/gamification/summary',
);

function useServerQuery<T>(key: readonly unknown[], fn: () => Promise<T>, staleTime = 30_000) {
  const status = useAuthStatus();
  return useQuery<T, Error>({
    queryKey: key,
    queryFn: fn,
    enabled: status === 'signedIn' && serverHasGamification,
    staleTime,
    gcTime: 10 * 60_000,
    retry: noRetryOn4xx,
  });
}

export function useGamificationSummary() {
  return useServerQuery<GamificationSummary>(['gamification', 'summary'], async () =>
    unwrap(await api.GET('/v1/gamification/summary')),
  );
}

export function useProgress() {
  return useServerQuery<ProgressOut>(
    ['progress'],
    async () => unwrap(await api.GET('/v1/progress')),
    60_000,
  );
}

export function useGardenSummary() {
  return useServerQuery<GardenSummary>(['garden', 'summary'], async () =>
    unwrap(await api.GET('/v1/garden/summary')),
  );
}

export function useGardenBeds(cursor = 0, unitId?: string) {
  return useServerQuery<GardenBeds>(['garden', 'beds', cursor, unitId ?? null], async () =>
    unwrap(
      await api.GET('/v1/garden/beds', {
        params: { query: { cursor, ...(unitId ? { unit_id: unitId } : {}) } },
      }),
    ),
  );
}

export function useDueReviews(limit = 20) {
  return useServerQuery<DueQueue>(
    ['due', limit],
    async () => unwrap(await api.GET('/v1/reviews/due', { params: { query: { limit } } })),
    15_000,
  );
}

export function useSessionSummary(sessionId: string | null) {
  const status = useAuthStatus();
  return useQuery<SessionSummary, Error>({
    queryKey: ['gamification', 'session', sessionId],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/sessions/{session_id}/summary', {
          params: { path: { session_id: sessionId ?? '' } },
        }),
      ),
    enabled: status === 'signedIn' && serverHasGamification && sessionId !== null,
    staleTime: 5_000,
    retry: noRetryOn4xx,
  });
}

// ------------------------------------------------------------------- mutations

function afterChange(summary: GamificationSummary): void {
  queryClient.setQueryData(['gamification', 'summary'], summary);
  invalidateProgress();
}

export function useRepairStreak() {
  return useMutation<GamificationSummary, Error>({
    mutationFn: async () => unwrap(await api.POST('/v1/gamification/streak/repair')),
    onSuccess: afterChange,
  });
}

export function usePauseStreak() {
  return useMutation<GamificationSummary, Error, number>({
    mutationFn: async (days) =>
      unwrap(await api.POST('/v1/gamification/streak/pause', { body: { days } })),
    onSuccess: afterChange,
  });
}

export function useResumeStreak() {
  return useMutation<GamificationSummary, Error>({
    mutationFn: async () => unwrap(await api.POST('/v1/gamification/streak/resume')),
    onSuccess: afterChange,
  });
}

export function useAcknowledgeReset() {
  return useMutation<void, Error>({
    mutationFn: async () => {
      const { response } = await api.POST('/v1/gamification/streak/reset-seen');
      if (!response.ok) throw new Error(`reset-seen ${response.status}`);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['gamification'] }),
  });
}

export function useMarkBadgesSeen() {
  return useMutation<void, Error, string[]>({
    mutationFn: async (ids) => {
      const { response } = await api.POST('/v1/gamification/badges/seen', { body: { ids } });
      if (!response.ok) throw new Error(`badges-seen ${response.status}`);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['gamification'] }),
  });
}

/** True when the running server keeps the account's settings (older servers show them only). */
export const serverHasSettings = (serverOperations as readonly string[]).includes(
  'PATCH /v1/me/settings',
);

export function useUpdateSettings() {
  return useMutation<GamificationSummary, Error, SettingsPatch>({
    mutationFn: async (patch) => unwrap(await api.PATCH('/v1/me/settings', { body: patch })),
    onSuccess: (summary) => {
      afterChange(summary);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

// ------------------------------------------------------------------- the accessibility profile

/**
 * The accessibility switches belong to this device: they decide how an exercise is shown. The
 * account keeps a copy because the server also chooses exercises where the app does not name the
 * profile — the due queue, the offline window — and credits node-tiers it did not compose by it
 * (DECISIONS §21). The device's switches are the source; the copy follows them.
 */
export function a11yPatch(profile: AccessibilityProfile): SettingsPatch {
  return { a11y_no_audio: profile.noAudio, a11y_no_vision: profile.noVision };
}

type SavedA11y = Pick<Learner['settings'], 'a11y_no_audio' | 'a11y_no_vision'>;

/**
 * True when the account's settings (GET /v1/me) carry the profile. An older server's carry none:
 * it keeps no copy, and nothing is sent to it.
 */
export function keepsA11yProfile(saved: SavedA11y | undefined): saved is SavedA11y {
  return saved?.a11y_no_audio !== undefined && saved.a11y_no_vision !== undefined;
}

/**
 * The change that brings the account's copy in line with this device, or null when the two agree
 * — or when the server's settings carry no profile at all (an older server).
 */
export function a11yDrift(profile: AccessibilityProfile, saved: SavedA11y): SettingsPatch | null {
  if (!keepsA11yProfile(saved)) return null;
  const same = saved.a11y_no_audio === profile.noAudio && saved.a11y_no_vision === profile.noVision;
  return same ? null : a11yPatch(profile);
}

/**
 * Sends this device's profile to the account, in the background: no switch waits for it, and a
 * failure is logged and never reaches the learner (the next start tries again, useBootstrap).
 * `failed`: the server could not be reached (offline, a 5xx), worth another try; `refused`: it
 * answered no (an older server that keeps no profile), not worth one.
 */
export async function saveA11yProfile(
  profile: AccessibilityProfile,
): Promise<'saved' | 'refused' | 'failed'> {
  try {
    afterChange(unwrap(await api.PATCH('/v1/me/settings', { body: a11yPatch(profile) })));
    void queryClient.invalidateQueries({ queryKey: ['me'] });
    return 'saved';
  } catch (e) {
    log.info('settings.a11y_save_failed', {
      type: e instanceof ApiError ? e.problem.type : 'network',
    });
    const refused = e instanceof ApiError && e.problem.status >= 400 && e.problem.status < 500;
    return refused ? 'refused' : 'failed';
  }
}

/**
 * The account's copy as this app run last saw it (GET /v1/me) or sent it ahead of answers; null
 * when /v1/me showed a server that keeps none (an older server).
 */
const accountCopy = new Map<string, string | null>();
const copyKey = (p: AccessibilityProfile) => `${p.noAudio}:${p.noVision}`;

/** What GET /v1/me shows the learner's account holding (useA11yProfileSync). */
export function noteA11yCopy(learnerId: string, saved: SavedA11y): void {
  accountCopy.set(
    learnerId,
    keepsA11yProfile(saved)
      ? copyKey({ noAudio: saved.a11y_no_audio, noVision: saved.a11y_no_vision })
      : null,
  );
}

/**
 * Runs before the outbox sends answers (outbox/syncer.ts). The server credits a node-tier it did
 * not compose — one played offline — by the account's copy, when its answers arrive: a tier played
 * without its sound exercises counts only if the copy says so by then. So with a switch on, the
 * copy goes first unless the account is known to hold it — a change made offline, or one /v1/me
 * has not confirmed yet. Never throws; the answers go either way, and a copy the server could not
 * be reached for is tried again before the next sync. Nothing is sent signed out (a sync timer
 * can outlive the session) or to a server /v1/me showed keeping no profile.
 */
export async function a11yCopyFirst(
  learnerId: string,
  profile: AccessibilityProfile,
): Promise<void> {
  const key = copyKey(profile);
  if (!serverHasSettings || !(profile.noAudio || profile.noVision)) return;
  if (session.getStatus() !== 'signedIn') return;
  const copy = accountCopy.get(learnerId);
  if (copy === key || copy === null) return;
  if ((await saveA11yProfile(profile)) !== 'failed') accountCopy.set(learnerId, key);
}

export const serverHasLevelAward = (serverOperations as readonly string[]).includes(
  'GET /v1/progress/level/{level}',
);
export type CefrBand = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

/** The four conditions of a level award, each with the server's computed value (docs/00 §7). */
export function useLevelConditions(level: CefrBand | null) {
  const status = useAuthStatus();
  return useQuery<LevelAwardOut, Error>({
    queryKey: ['progress', 'level', level],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/progress/level/{level}', {
          params: { path: { level: level as CefrBand } },
        }),
      ),
    enabled: status === 'signedIn' && serverHasLevelAward && level !== null,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    retry: noRetryOn4xx,
  });
}
