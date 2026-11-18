import { useMutation, useQuery } from '@tanstack/react-query';

import { serverOperations } from '../paths.generated';
import { api, unwrap } from '../client';
import { ApiError } from '../problem';
import { queryClient } from '../queryClient';
import type { AiStatusOut, CastOut, ConversationOut, SummaryOut, TurnOut } from '../types';
import { useAuthStatus } from './me';

/**
 * The AI conversation partner (docs/16 E21). Every call goes to our server, which alone holds
 * the model key; the app only ever sees the character's words. The feature exists when the
 * server offers the endpoints *and* `GET /v1/ai/status` says a model is configured — otherwise
 * it is hidden entirely, with no teaser.
 */

export const serverHasAi = (serverOperations as readonly string[]).includes('GET /v1/ai/status');

const noRetryOn4xx = (count: number, err: Error) =>
  !(err instanceof ApiError && err.problem.status >= 400 && err.problem.status < 500) && count < 1;

export function useAiStatus() {
  const status = useAuthStatus();
  return useQuery<AiStatusOut, Error>({
    queryKey: ['ai', 'status'],
    queryFn: async () => unwrap(await api.GET('/v1/ai/status')),
    enabled: status === 'signedIn' && serverHasAi,
    staleTime: 60_000,
    retry: noRetryOn4xx,
  });
}

/** True only when the partner can actually be used right now. */
export function useAiAvailable(): boolean {
  return useAiStatus().data?.available === true;
}

export function useCast(unitId: string | null) {
  const status = useAuthStatus();
  return useQuery<CastOut, Error>({
    queryKey: ['ai', 'cast', unitId],
    queryFn: async () =>
      unwrap(await api.GET('/v1/ai/characters', { params: { query: { unit_id: unitId ?? '' } } })),
    enabled: status === 'signedIn' && serverHasAi && unitId !== null,
    staleTime: 10 * 60_000,
    retry: noRetryOn4xx,
  });
}

export type ChatMode = 'fluency' | 'accuracy';

/** Starting a chat; retried with the same `clientUuid`, the server returns the same chat, charged once. */
export function useStartConversation() {
  return useMutation<
    ConversationOut,
    Error,
    { characterId: string; unitId: string; mode: ChatMode; clientUuid: string }
  >({
    mutationFn: async ({ characterId, unitId, mode, clientUuid }) =>
      unwrap(
        await api.POST('/v1/ai/conversations', {
          body: { character_id: characterId, unit_id: unitId, mode, client_uuid: clientUuid },
        }),
      ),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['ai', 'status'] }),
  });
}

/** One learner turn; retried with the same `clientUuid`, the server never answers it twice. */
export function useSendTurn() {
  return useMutation<
    TurnOut,
    Error,
    { conversationId: string; clientUuid: string; text: string; rtMs: number | null }
  >({
    mutationFn: async ({ conversationId, clientUuid, text, rtMs }) =>
      unwrap(
        await api.POST('/v1/ai/conversations/{conversation_id}/turns', {
          params: { path: { conversation_id: conversationId } },
          body: { client_uuid: clientUuid, text, ...(rtMs !== null ? { rt_ms: rtMs } : {}) },
        }),
      ),
    onSuccess: (turn) => {
      if (turn.awards.xp > 0) void queryClient.invalidateQueries({ queryKey: ['gamification'] });
    },
  });
}

export function useEndConversation() {
  return useMutation<SummaryOut, Error, string>({
    mutationFn: async (conversationId) =>
      unwrap(
        await api.POST('/v1/ai/conversations/{conversation_id}/end', {
          params: { path: { conversation_id: conversationId } },
        }),
      ),
  });
}

export function useDeleteConversation() {
  return useMutation<void, Error, string>({
    mutationFn: async (conversationId) => {
      const r = await api.DELETE('/v1/ai/conversations/{conversation_id}', {
        params: { path: { conversation_id: conversationId } },
      });
      if (!r.response.ok) unwrap(r);
    },
  });
}
