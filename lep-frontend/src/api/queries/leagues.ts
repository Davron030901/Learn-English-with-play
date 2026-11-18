import { useMutation, useQuery } from '@tanstack/react-query';

import { serverOperations } from '../paths.generated';
import { api, unwrap } from '../client';
import { ApiError } from '../problem';
import { queryClient } from '../queryClient';
import type { GamificationSummary, LeagueStatusOut } from '../types';
import { useAuthStatus } from './me';

/**
 * Opt-in weekly leagues (docs/16 E23). Off by default: only the learner turns them on, with a
 * display name, and the server refuses a learner who might be under 18. The table, the tier and
 * a finished week's result all come from the server; nothing here is computed on the device.
 */

/** True when the running server offers leagues (older servers do not). */
export const serverHasLeagues = (serverOperations as readonly string[]).includes(
  'GET /v1/leagues/current',
);

const KEY = ['leagues', 'current'] as const;

export function useLeagueStatus(enabled = true) {
  const status = useAuthStatus();
  return useQuery<LeagueStatusOut, Error>({
    queryKey: KEY,
    queryFn: async () => unwrap(await api.GET('/v1/leagues/current')),
    enabled: enabled && status === 'signedIn' && serverHasLeagues,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    retry: (count, err) =>
      !(err instanceof ApiError && err.problem.status >= 400 && err.problem.status < 500) &&
      count < 1,
  });
}

function afterSettings(summary: GamificationSummary): void {
  queryClient.setQueryData(['gamification', 'summary'], summary);
  void queryClient.invalidateQueries({ queryKey: ['me'] });
  void queryClient.invalidateQueries({ queryKey: ['leagues'] });
}

/** Joins with the display name others will see (it may be new or the one already kept). */
export function useJoinLeagues() {
  return useMutation<GamificationSummary, Error, string>({
    mutationFn: async (displayName) =>
      unwrap(
        await api.PATCH('/v1/me/settings', {
          body: { leagues_opt_in: true, display_name: displayName },
        }),
      ),
    onSuccess: afterSettings,
  });
}

export function useLeaveLeagues() {
  return useMutation<GamificationSummary, Error, void>({
    mutationFn: async () =>
      unwrap(await api.PATCH('/v1/me/settings', { body: { leagues_opt_in: false } })),
    onSuccess: afterSettings,
  });
}

export function useRenameForLeagues() {
  return useMutation<GamificationSummary, Error, string>({
    mutationFn: async (displayName) =>
      unwrap(await api.PATCH('/v1/me/settings', { body: { display_name: displayName } })),
    onSuccess: afterSettings,
  });
}

/** The finished week's result was shown: the server stops returning it. */
export function useLeagueResultSeen() {
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      const { response } = await api.POST('/v1/leagues/result-seen');
      if (!response.ok) throw new Error(`result-seen ${response.status}`);
    },
    onSuccess: () => {
      queryClient.setQueryData<LeagueStatusOut>(KEY, (old) =>
        old ? { ...old, result: null } : old,
      );
    },
  });
}

/**
 * The server's rules for a display name, mirrored so the learner hears about a mistake before
 * sending it: 2–24 letters (any script), digits, spaces, `_`, `-` or apostrophes, at least one
 * letter, no `@` and no dot. The server checks again and its answer wins.
 */
export function displayNameProblem(raw: string): 'length' | 'characters' | null {
  const name = raw.normalize('NFKC').trim().split(/\s+/).join(' ');
  if (name.length < 2 || name.length > 24) return 'length';
  if (!/^[\p{L}\p{M}\p{Nd} _'-]+$/u.test(name)) return 'characters';
  if (!/[\p{Lu}\p{Ll}\p{Lt}\p{Lo}]/u.test(name)) return 'characters';
  return null;
}
