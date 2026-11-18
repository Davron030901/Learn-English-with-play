import { useMutation, useQuery } from '@tanstack/react-query';

import { api, publicApi, unwrap } from '../client';
import { serverOperations } from '../paths.generated';
import type { components } from '../schema.generated';

/**
 * What the server offers (GET /v1/capabilities, backend DECISIONS §14.6) and the account's
 * password routes (§14.3). Capabilities are public and cached for five minutes; when the server
 * has no such route or cannot be reached, every capability is "unknown" (null) and callers keep
 * the behaviour they had before the server could say.
 */

export type Capabilities = components['schemas']['CapabilitiesOut'];
export type PasswordForgotOut = components['schemas']['PasswordForgotOut'];

const operations = serverOperations as readonly string[];
export const serverHasCapabilities = operations.includes('GET /v1/capabilities');
export const serverHasPasswordReset = operations.includes('POST /v1/auth/password/forgot');
export const serverHasPasswordChange = operations.includes('POST /v1/me/password');

export function useCapabilities() {
  return useQuery<Capabilities | null>({
    queryKey: ['capabilities'],
    queryFn: async () =>
      serverHasCapabilities ? unwrap(await publicApi.GET('/v1/capabilities')) : null,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
  });
}

/** POST /v1/auth/password/forgot: 202 whatever the address — the answer says nothing more. */
export function useForgotPassword() {
  return useMutation<PasswordForgotOut, Error, string>({
    mutationFn: async (email) =>
      unwrap(await publicApi.POST('/v1/auth/password/forgot', { body: { email } })),
  });
}

/** POST /v1/auth/password/reset: 204; every session of the account ends on the server. */
export function useResetPassword() {
  return useMutation<void, Error, { token: string; password: string }>({
    mutationFn: async ({ token, password }) => {
      const result = await publicApi.POST('/v1/auth/password/reset', {
        body: { token, new_password: password },
      });
      if (!result.response.ok) unwrap(result);
    },
  });
}

/** POST /v1/me/password: 204; the sessions on other devices end, this one stays. */
export function useChangePassword() {
  return useMutation<void, Error, { current: string; next: string }>({
    mutationFn: async ({ current, next }) => {
      const result = await api.POST('/v1/me/password', {
        body: { current_password: current, new_password: next },
      });
      if (!result.response.ok) unwrap(result);
    },
  });
}
