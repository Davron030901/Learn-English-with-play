import { ApiError, clientProblem } from './problem';

/**
 * The one place a request leaves the app (DECISIONS §7.3):
 *   * every request carries an X-Request-ID (UUIDv7) that is kept across its retries;
 *   * timeouts by AbortController — 15 s by default, 20 s for auth;
 *   * only GETs are retried on network failure, twice, with jittered backoff; a POST is never
 *     retried automatically (the durable outbox owns replays);
 *   * a request with no response becomes an ApiError with a `client/*` type — never a raw
 *     TypeError — so screens have one error path.
 * Any HTTP status, 4xx and 5xx included, is returned to the caller as a Response.
 */

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface TransportConfig {
  baseUrl: string;
  fetch: FetchLike;
  requestId: () => string;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Told whether the server answered at all; feeds the app's one `online` state. */
  onReachability?: (reachable: boolean) => void;
}

export interface SendOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Network retries. Defaults to 2 for GET and 0 for everything else. */
  retries?: number;
  requestId?: string;
  signal?: AbortSignal;
  /** 'include' only for the web's refresh cookie (DECISIONS §22); otherwise the fetch default. */
  credentials?: 'include';
}

export interface Sent {
  response: Response;
  requestId: string;
}

export const DEFAULT_TIMEOUT_MS = 15_000;
export const AUTH_TIMEOUT_MS = 20_000;
/**
 * Starting a chat and sending a turn wait for the model: a reply held to the learner's level can
 * take two model calls. Both are idempotent (client_uuid), so a timeout is retried safely, but a
 * timeout shorter than the server's work only produces retries that answer 409 ai_busy.
 */
export const AI_TIMEOUT_MS = 90_000;

/** Starting a chat and sending a turn wait for the model (AI_TIMEOUT_MS). */
export function waitsForModel(method: string, url: string): boolean {
  if (method !== 'POST') return false;
  const path = url.replace(/^https?:\/\/[^/]+/i, '').split('?')[0] ?? '';
  return /\/v1\/ai\/conversations(\/[^/]+\/turns)?$/.test(path);
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function joinUrl(base: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export async function send(cfg: TransportConfig, opts: SendOptions): Promise<Sent> {
  const requestId = opts.requestId ?? cfg.requestId();
  const retries = opts.retries ?? (opts.method === 'GET' ? 2 : 0);
  const sleep = cfg.sleep ?? defaultSleep;
  const random = cfg.random ?? Math.random;
  const url = joinUrl(cfg.baseUrl, opts.path);

  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const onCallerAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onCallerAbort);
    try {
      const response = await cfg.fetch(url, {
        method: opts.method,
        headers: { Accept: 'application/json', ...opts.headers, 'X-Request-ID': requestId },
        body: opts.body,
        signal: controller.signal,
        ...(opts.credentials ? { credentials: opts.credentials } : {}),
      });
      cfg.onReachability?.(true);
      return { response, requestId };
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      const type = timedOut ? 'client/timeout' : 'client/offline';
      if (attempt < retries) {
        const backoff = 300 * 2 ** attempt;
        await sleep(backoff / 2 + random() * backoff);
        continue;
      }
      cfg.onReachability?.(false);
      throw new ApiError(clientProblem(type, requestId));
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onCallerAbort);
    }
  }
}
