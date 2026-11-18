import createClient from 'openapi-fetch';

import { uuidv7 } from '@/lib/uuid';
import { countEvent } from '@/state/clientEvents';
import { useOnlineStore } from '@/state/online';

import { API_BASE_URL } from './config';
import { cookieTransport } from './cookieTransport';
import { ApiError, problemFromBody } from './problem';
import type { paths } from './schema.generated';
import { Session } from './session';
import { tokenStorage } from './tokenStorage';
import {
  AI_TIMEOUT_MS,
  send,
  type SendOptions,
  type TransportConfig,
  waitsForModel,
} from './transport';

/**
 * The app's singletons: the transport, the auth session and the typed API client generated
 * from the server's OpenAPI document (brief §4: never hand-written URLs).
 */
export const transport: TransportConfig = {
  baseUrl: API_BASE_URL,
  fetch: (url, init) => fetch(url, init),
  requestId: () => uuidv7(),
  onReachability: (up) => useOnlineStore.getState().setServerReachable(up),
};

// web: the refresh token as an httpOnly cookie when the server offers it (DECISIONS §22)
export const session = new Session({
  transport,
  storage: tokenStorage,
  ...(cookieTransport ? { cookie: cookieTransport } : {}),
  // counted on the device and sent with the others (DECISIONS F2, §23)
  onClientEvent: countEvent,
});

const METHODS = new Set(['GET', 'POST', 'PATCH', 'DELETE']);

async function sendOptions(request: Request): Promise<SendOptions> {
  const method = request.method.toUpperCase();
  if (!METHODS.has(method)) throw new Error(`unsupported method ${method}`);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const body = method === 'GET' ? undefined : await request.text();
  return {
    method: method as SendOptions['method'],
    path: request.url,
    headers,
    ...(body ? { body } : {}),
    ...(waitsForModel(method, request.url) ? { timeoutMs: AI_TIMEOUT_MS } : {}),
  };
}

/** openapi-fetch hands us a Request; the session re-sends it with auth, id, timeout, retries. */
async function authedFetch(request: Request): Promise<Response> {
  return session.fetchAuthed(await sendOptions(request));
}

/** The same, for the few routes anyone may call (capabilities, a forgotten password): no token. */
async function publicFetch(request: Request): Promise<Response> {
  const { response } = await send(transport, await sendOptions(request));
  return response;
}

export const api = createClient<paths>({ baseUrl: API_BASE_URL, fetch: authedFetch });
export const publicApi = createClient<paths>({ baseUrl: API_BASE_URL, fetch: publicFetch });

/**
 * Unwraps an openapi-fetch result: data on success, an ApiError (typed problem, request id,
 * never `detail`/`title`) otherwise.
 */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.response.ok && result.data !== undefined) return result.data;
  throw new ApiError(problemFromBody(result.error, result.response, null));
}
