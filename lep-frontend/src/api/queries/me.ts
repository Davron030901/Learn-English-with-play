import { useMutation, useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

import { api, session, unwrap } from '../client';
import { serverOperations } from '../paths.generated';
import { ApiError } from '../problem';
import type { AuthStatus, Learner } from '../session';

export function useAuthStatus(): AuthStatus {
  return useSyncExternalStore(
    (fn) => session.subscribe(fn),
    () => session.getStatus(),
    () => session.getStatus(),
  );
}

/**
 * GET /v1/me. Kept in the query cache only (memory): `is_minor` is derived by the server on
 * every read and is never persisted or cached past the session (brief §4.1).
 */
export function useMe() {
  const status = useAuthStatus();
  return useQuery<Learner, Error>({
    queryKey: ['me'],
    queryFn: async () => unwrap(await api.GET('/v1/me')),
    enabled: status === 'signedIn',
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: (count, err) => {
      if (err instanceof ApiError && err.problem.status >= 400 && err.problem.status < 500)
        return false;
      return count < 1;
    },
  });
}

// ------------------------------------------------------------------- the learner's data controls

const operations = serverOperations as readonly string[];
/** The account's own data controls (docs/11 §10); hidden on a server that does not offer them. */
export const serverHasAccountExport = operations.includes('GET /v1/me/export');
export const serverHasAccountDelete = operations.includes('POST /v1/me/delete');
export const serverHasRecordingsDelete = operations.includes('DELETE /v1/me/recordings');

/** Everything the server holds about the learner (recordings as base64), for the export file. */
export async function fetchAccountExport(): Promise<unknown> {
  return unwrap(await api.GET('/v1/me/export'));
}

/** Every voice recording deleted now; the server answers with how many there were. */
export function useDeleteRecordings() {
  return useMutation<number, Error, void>({
    mutationFn: async () => unwrap(await api.DELETE('/v1/me/recordings')).deleted,
  });
}

/** The account and everything in it, deleted on the server once the password is confirmed. */
export function useDeleteAccount() {
  return useMutation<void, Error, string>({
    mutationFn: async (password) => {
      const r = await api.POST('/v1/me/delete', { body: { password } });
      if (!r.response.ok) unwrap(r);
    },
  });
}
