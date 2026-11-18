import { log } from '@/lib/log';

import { ApiError, clientProblem, problemFromResponse, type ApiProblem } from './problem';
import type { components, paths } from './schema.generated';
import type { RefreshTokenStorage } from './tokenStorage';
import { AUTH_TIMEOUT_MS, send, type SendOptions, type TransportConfig } from './transport';

/**
 * A refresh — the request, its one retry and reading the body — never takes longer than this.
 * The transport's own timer stops at the response headers, and a body that stalls after them
 * would otherwise hold the single-flight refresh, and every request waiting on it, forever.
 */
export const REFRESH_DEADLINE_MS = 2 * AUTH_TIMEOUT_MS + 5_000;

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ApiError(clientProblem('client/timeout'))), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Tokens, sign-in and the single-flight refresh (brief §4.1, DECISIONS §7.1, F2).
 *
 * The backend rotates refresh tokens on every use and revokes the whole session when an
 * already-rotated token is presented again (strict reuse detection, no grace window). Two
 * requests that each refresh on their own would therefore log the learner out. So:
 *
 *   * exactly one refresh is ever in flight — a module-level promise every caller awaits;
 *   * the new refresh token is written to storage *before* that promise resolves;
 *   * a refresh answered 401 (invalid_token / session_revoked) signs out, once;
 *   * a refresh answered 503/429, or lost to the network, keeps the session and signs no one out;
 *   * a request answered `session_revoked` is a sign-out, never a refresh trigger;
 *   * a request answered `invalid_token` refreshes (once, shared) and is retried once.
 *
 * On the web (DECISIONS F8, §22) the refresh token may live in an httpOnly cookie the server
 * sets instead: the auth requests ask for it (`X-LEP-Token-Transport: cookie`), the body then
 * carries `refresh_token: null`, and script never holds the token. The device remembers only
 * that a cookie session is expected, so a reload restores it with one refresh. Every tab of a
 * browser shares that cookie, so each refresh also holds a browser-wide lock: two tabs that
 * refreshed at once would present the same token twice, and the server ends the session.
 */

type TokenResponse = components['schemas']['TokenResponse'];
type RegisterRequest = components['schemas']['RegisterRequest'];
type RegisterResponse = components['schemas']['RegisterResponse'];
export type Learner = components['schemas']['LearnerOut'];

/** Endpoint paths, checked against the generated schema at compile time. */
const PATH = {
  login: '/v1/auth/login',
  register: '/v1/auth/register',
  refresh: '/v1/auth/refresh',
  logout: '/v1/auth/logout',
} as const satisfies Record<string, keyof paths>;

export type AuthStatus = 'restoring' | 'signedOut' | 'signedIn';
export type SignOutReason = 'user' | 'revoked' | 'expired' | 'no_token';

export interface SessionEvents {
  onStatus?: (status: AuthStatus, reason?: SignOutReason) => void;
  /** Client events for the backend's future event endpoint (DECISIONS F2). */
  onClientEvent?: (name: 'refresh_response_lost') => void;
}

/** The web's refresh cookie (DECISIONS §22). Native builds have none. */
export interface CookieTransport {
  /** Whether a cookie session is expected after a reload — a flag, never the token. */
  expected(): Promise<boolean>;
  remember(expected: boolean): void;
  /** Runs `work` while no other tab of this browser refreshes. */
  exclusive<T>(work: () => Promise<T>): Promise<T>;
}

export interface SessionDeps extends SessionEvents {
  transport: TransportConfig;
  storage: RefreshTokenStorage;
  cookie?: CookieTransport;
  now?: () => number;
}

/** Refresh this long before the access token's stated expiry (read for timing only). */
const EARLY_REFRESH_MS = 60_000;

export class AuthEndedError extends Error {
  readonly reason: SignOutReason;
  constructor(reason: SignOutReason) {
    super(`auth ended: ${reason}`);
    this.name = 'AuthEndedError';
    this.reason = reason;
  }
}

export class Session {
  private readonly deps: SessionDeps;
  private readonly now: () => number;
  private access: { token: string; expiresAt: number } | null = null;
  private refreshing: Promise<string> | null = null;
  private status: AuthStatus = 'restoring';
  private generation = 0;
  /** The current session's refresh token is in the browser's httpOnly cookie. */
  private cookieSession = false;
  private readonly listeners = new Set<(s: AuthStatus, r?: SignOutReason) => void>();

  /** Counters the concurrency tests read; never shown to learners. */
  readonly stats = { refreshCalls: 0, signOuts: 0 };

  /**
   * The learner id the current access token was issued for (its `sub` claim, read without
   * verification — the server verifies; GET /v1/me confirms). It lets the device key the
   * learner's data the moment a session exists, before /v1/me has answered.
   */
  private learnerHint: string | null = null;
  private readonly learnerListeners = new Set<(learnerId: string) => void>();

  constructor(deps: SessionDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  getStatus(): AuthStatus {
    return this.status;
  }

  /** Called with the signed-in learner's id as soon as a token for it exists (and again if it changes). */
  onLearner(fn: (learnerId: string) => void): () => void {
    this.learnerListeners.add(fn);
    if (this.learnerHint) fn(this.learnerHint);
    return () => this.learnerListeners.delete(fn);
  }

  subscribe(fn: (s: AuthStatus, r?: SignOutReason) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setStatus(s: AuthStatus, reason?: SignOutReason) {
    if (this.status === s) return;
    this.status = s;
    this.deps.onStatus?.(s, reason);
    for (const fn of this.listeners) fn(s, reason);
  }

  /**
   * App start. A stored refresh token means "signed in" at once — the path renders from local
   * content without waiting for the network — and a refresh starts in the background. If the
   * server then says the session is over, the learner is signed out.
   */
  async restore(): Promise<void> {
    let stored: string | null = null;
    try {
      stored = await this.deps.storage.get();
    } catch (e) {
      log.warn('auth.restore.storage_failed', e);
    }
    if (!stored && (await this.cookieExpected())) this.cookieSession = true;
    if (!stored && !this.cookieSession) {
      this.setStatus('signedOut', 'no_token');
      return;
    }
    this.setStatus('signedIn');
    this.refresh().catch((e: unknown) => {
      if (!(e instanceof AuthEndedError))
        log.info('auth.restore.refresh_deferred', { type: typeOf(e) });
    });
  }

  async signIn(email: string, password: string): Promise<void> {
    const form = new URLSearchParams({ grant_type: 'password', username: email, password });
    const { response, requestId } = await this.post(
      PATH.login,
      form.toString(),
      'application/x-www-form-urlencoded',
    );
    if (!response.ok) throw new ApiError(await problemFromResponse(response, requestId));
    await this.accept((await response.json()) as TokenResponse);
    this.setStatus('signedIn');
  }

  async register(body: RegisterRequest): Promise<Learner> {
    const { response, requestId } = await this.post(
      PATH.register,
      JSON.stringify(body),
      'application/json',
    );
    if (!response.ok) throw new ApiError(await problemFromResponse(response, requestId));
    const out = (await response.json()) as RegisterResponse;
    await this.accept(out.tokens);
    this.setStatus('signedIn');
    return out.learner;
  }

  /** Signs out locally at once; tells the server best-effort. */
  async signOut(reason: SignOutReason = 'user'): Promise<void> {
    if (this.status === 'signedOut') return;
    this.generation += 1;
    this.stats.signOuts += 1;
    const token = await this.deps.storage.get().catch(() => null);
    const cookie = this.cookieSession;
    this.setCookieSession(false);
    this.access = null;
    this.learnerHint = null;
    await this.deps.storage
      .clear()
      .catch((e: unknown) => log.warn('auth.signout.storage_failed', e));
    this.setStatus('signedOut', reason);
    if (reason === 'user' && (token || cookie)) {
      // with the cookie the body is empty: the server ends the session the cookie names and
      // clears the cookie
      this.post(PATH.logout, refreshBody(token), 'application/json').catch(() => {
        // The session ends server-side at its expiry anyway; nothing to tell the learner.
      });
    }
  }

  /** A usable access token, refreshing first (single-flight) when it is missing or expiring. */
  async accessToken(): Promise<string> {
    if (this.status === 'signedOut') throw new AuthEndedError('no_token');
    if (this.access && this.access.expiresAt - EARLY_REFRESH_MS > this.now())
      return this.access.token;
    return this.refresh();
  }

  /** The single-flight refresh. Every concurrent caller receives the same promise. */
  refresh(): Promise<string> {
    if (this.refreshing) return this.refreshing;
    const generation = this.generation;
    this.refreshing = withDeadline(this.doRefresh(generation), REFRESH_DEADLINE_MS).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(generation: number): Promise<string> {
    const token = await this.deps.storage.get();
    if (!token && !this.cookieSession) {
      await this.signOut('no_token');
      throw new AuthEndedError('no_token');
    }
    this.stats.refreshCalls += 1;
    const body = refreshBody(token);
    const exchange = async () => {
      try {
        return await this.post(PATH.refresh, body, 'application/json');
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        // F2: the response may have been lost after the server rotated the token. Retry once
        // with the same token: it either succeeds, or the server treats it as reuse and ends
        // the session.
        this.deps.onClientEvent?.('refresh_response_lost');
        log.info('auth.refresh.response_lost', { type: e.problem.type });
        return this.post(PATH.refresh, body, 'application/json');
      }
    };
    // a cookie is shared by every tab: one refresh at a time across the browser
    const sent =
      this.cookieSession && this.deps.cookie
        ? await this.deps.cookie.exclusive(exchange)
        : await exchange();
    const { response, requestId } = sent;
    if (generation !== this.generation) {
      // Signed out while the refresh was in flight: end the rotated session too, best-effort.
      if (response.ok) {
        const late = (await response.json()) as TokenResponse;
        this.post(PATH.logout, refreshBody(late.refresh_token), 'application/json').catch(
          () => undefined,
        );
      }
      throw new AuthEndedError('user');
    }
    if (response.ok) {
      const tokens = (await response.json()) as TokenResponse;
      await this.accept(tokens, generation);
      return tokens.access_token;
    }
    const problem = await problemFromResponse(response, requestId);
    if (response.status === 401) {
      const reason: SignOutReason = problem.type === 'session_revoked' ? 'revoked' : 'expired';
      await this.signOut(reason);
      throw new AuthEndedError(reason);
    }
    // 503 (the server's Redis is down: auth fails closed), 429, 5xx: keep the session.
    throw new ApiError(problem);
  }

  private async accept(tokens: TokenResponse, generation: number = this.generation): Promise<void> {
    // A sign-out that landed while the response body was read: this session is over. Make sure
    // its rotated token is neither kept nor left alive on the server.
    if (generation !== this.generation) return this.discardLate(tokens);
    if (tokens.refresh_token === null) {
      // the server set it as an httpOnly cookie: only a browser that asked may accept that
      if (!this.deps.cookie) throw new ApiError(clientProblem('client/unknown'));
      this.setCookieSession(true);
      await this.deps.storage
        .clear()
        .catch((e: unknown) => log.warn('auth.cookie.clear_failed', e));
    } else {
      // Written before anyone is told the new access token exists (DECISIONS §7.1).
      await this.deps.storage.set(tokens.refresh_token);
      // a server without the cookie flow answered with a body token: memory, as before
      if (this.cookieSession) this.setCookieSession(false);
    }
    if (generation !== this.generation) {
      // …or while it was being stored: undo the write the sign-out could not see.
      await this.deps.storage
        .clear()
        .catch((e: unknown) => log.warn('auth.late_token.clear_failed', e));
      return this.discardLate(tokens);
    }
    this.access = { token: tokens.access_token, expiresAt: this.now() + tokens.expires_in * 1000 };
    const sub = subjectOf(tokens.access_token);
    if (sub && sub !== this.learnerHint) {
      this.learnerHint = sub;
      for (const fn of this.learnerListeners) fn(sub);
    }
  }

  private discardLate(tokens: TokenResponse): never {
    this.post(PATH.logout, refreshBody(tokens.refresh_token), 'application/json').catch(
      () => undefined,
    );
    throw new AuthEndedError('user');
  }

  private setCookieSession(on: boolean) {
    this.cookieSession = on;
    this.deps.cookie?.remember(on);
  }

  private async cookieExpected(): Promise<boolean> {
    if (!this.deps.cookie) return false;
    try {
      return await this.deps.cookie.expected();
    } catch (e) {
      log.warn('auth.cookie.hint_failed', e);
      return false;
    }
  }

  private post(path: string, body: string, contentType: string) {
    const cookie = Boolean(this.deps.cookie);
    const opts: SendOptions = {
      method: 'POST',
      path,
      body,
      headers: {
        'Content-Type': contentType,
        ...(cookie ? { 'X-LEP-Token-Transport': 'cookie' } : {}),
      },
      timeoutMs: AUTH_TIMEOUT_MS,
      retries: 0,
      ...(cookie ? { credentials: 'include' as const } : {}),
    };
    return send(this.deps.transport, opts);
  }

  /**
   * An authenticated request with the refresh rules above. Returns the final Response (any
   * status); throws ApiError when no response arrived and AuthEndedError when the session is over.
   */
  async fetchAuthed(opts: SendOptions): Promise<Response> {
    const token = await this.accessToken();
    const first = await this.sendWith(opts, token);
    if (first.status !== 401) return first;

    const problem = await problemFromResponse(first.clone(), null);
    if (problem.type === 'session_revoked') {
      await this.signOut('revoked');
      throw new AuthEndedError('revoked');
    }
    if (problem.type !== 'invalid_token' && problem.type !== 'unauthorized') return first;

    // Someone else may already have refreshed while this request was in flight.
    const fresh =
      this.access && this.access.token !== token ? this.access.token : await this.refresh();
    return this.sendWith(opts, fresh);
  }

  private async sendWith(opts: SendOptions, token: string): Promise<Response> {
    const { response, requestId } = await send(this.deps.transport, {
      ...opts,
      headers: { ...opts.headers, Authorization: `Bearer ${token}` },
    });
    if (response.headers.has('x-request-id')) return response;
    // A proxy answered without our id: put it back, so the error still shows a reference. The
    // body is read first — on native, fetch's body is a ReadableStream that the polyfilled
    // Response constructor would turn into the text "[object ReadableStream]".
    const headers = new Headers(response.headers);
    headers.set('x-request-id', requestId);
    const body = await response.arrayBuffer();
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

/** The `sub` claim of a JWT, decoded without verification (base64url JSON). Null if absent. */
export function subjectOf(jwt: string): string | null {
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    const json = decodeBase64Url(part);
    const claims = JSON.parse(json) as { sub?: unknown };
    return typeof claims.sub === 'string' && claims.sub.length > 0 ? claims.sub : null;
  } catch {
    return null;
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function decodeBase64Url(s: string): string {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of s.replace(/=+$/, '')) {
    const v = B64.indexOf(ch === '+' ? '-' : ch === '/' ? '_' : ch);
    if (v < 0) throw new Error('not base64url');
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return utf8(bytes);
}

/** UTF-8 bytes to a string, without relying on TextDecoder (not on every JS engine the app runs on). */
function utf8(bytes: readonly number[]): string {
  let out = '';
  let i = 0;
  const next = () => (bytes[i++] ?? 0) & 0x3f;
  while (i < bytes.length) {
    const b = bytes[i++] ?? 0;
    if (b < 0x80) out += String.fromCharCode(b);
    else if (b < 0xe0) out += String.fromCharCode(((b & 0x1f) << 6) | next());
    else if (b < 0xf0) out += String.fromCharCode(((b & 0x0f) << 12) | (next() << 6) | next());
    else out += String.fromCodePoint(((b & 0x07) << 18) | (next() << 12) | (next() << 6) | next());
  }
  return out;
}

/** A refresh or logout body: the token when script holds one, else empty (the cookie). */
function refreshBody(token: string | null): string {
  return token ? JSON.stringify({ refresh_token: token }) : '{}';
}

function typeOf(e: unknown): string {
  return e instanceof ApiError ? e.problem.type : e instanceof Error ? e.name : 'unknown';
}

export function offlineProblem(): ApiProblem {
  return clientProblem('client/offline');
}
