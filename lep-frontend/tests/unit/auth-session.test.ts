import { beforeEach, describe, expect, it } from 'vitest';

import { ApiError } from '@/api/problem';
import { AuthEndedError, Session, subjectOf } from '@/api/session';
import { createMemoryTokenStorage, type RefreshTokenStorage } from '@/api/tokenStorage';
import { AI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, waitsForModel, type FetchLike } from '@/api/transport';
import { log } from '@/lib/log';
import { uuidv7 } from '@/lib/uuid';

/**
 * Phase 1 acceptance for the session (brief §4.1, DECISIONS §7.1):
 *   A3  20 concurrent requests with an expired access token → exactly 1 refresh, 0 sign-outs;
 *   A4  a revoked session → exactly 1 sign-out and no refresh storm;
 *   A5  a refresh answered 503, or lost to the network, signs no one out.
 * The fake server below rotates refresh tokens and treats a reused one as theft, exactly like
 * lep-backend (no grace window).
 */

const tick = () => new Promise<void>((r) => setTimeout(r, 2));

const problem = (status: number, type: string) =>
  new Response(JSON.stringify({ type, title: 'x', status, detail: 'human text', request_id: uuidv7() }), {
    status,
    headers: { 'content-type': 'application/problem+json', 'x-request-id': 'req-1' },
  });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fakeServer() {
  const state = {
    refresh: 'lep_rt_0',
    used: new Set<string>(),
    access: new Set<string>(),
    revoked: false,
    seq: 0,
    mode: 'ok' as 'ok' | '503' | 'lost' | 'lost_after_rotation' | '429',
    calls: { refresh: 0, me: 0, logout: 0, login: 0 },
    bodies: [] as string[],
  };
  const issue = () => {
    state.seq += 1;
    state.refresh = `lep_rt_${state.seq}`;
    const access = `access.${state.seq}`;
    state.access.add(access);
    return { access_token: access, refresh_token: state.refresh, token_type: 'bearer', expires_in: 900 };
  };
  const fetch: FetchLike = async (url, init) => {
    await tick();
    const path = new URL(url).pathname;
    const headers = (init.headers ?? {}) as Record<string, string>;
    if (typeof init.body === 'string') state.bodies.push(init.body);
    if (path === '/v1/auth/refresh') {
      state.calls.refresh += 1;
      if (state.mode === 'lost') throw new TypeError('Network request failed');
      if (state.mode === '503') return problem(503, 'dependency_unavailable');
      if (state.mode === '429') return problem(429, 'rate_limited');
      const { refresh_token } = JSON.parse(String(init.body)) as { refresh_token: string };
      if (state.revoked) return problem(401, 'session_revoked');
      if (state.used.has(refresh_token)) {
        state.revoked = true; // reuse = theft: the whole session ends
        return problem(401, 'session_revoked');
      }
      if (refresh_token !== state.refresh) return problem(401, 'invalid_token');
      state.used.add(refresh_token);
      const tokens = issue();
      if (state.mode === 'lost_after_rotation') {
        state.mode = 'ok';
        throw new TypeError('connection reset after the server rotated');
      }
      return json(200, tokens);
    }
    if (path === '/v1/auth/login') {
      state.calls.login += 1;
      return json(200, issue());
    }
    if (path === '/v1/auth/logout') {
      state.calls.logout += 1;
      return new Response(null, { status: 204 });
    }
    if (path === '/v1/me') {
      state.calls.me += 1;
      if (state.revoked) return problem(401, 'session_revoked');
      const token = headers.Authorization?.replace(/^Bearer /, '') ?? '';
      if (!state.access.has(token)) return problem(401, 'invalid_token');
      return json(200, { id: 'learner-1' });
    }
    return problem(404, 'not_found');
  };
  return { state, fetch };
}

function setup(storage: RefreshTokenStorage = createMemoryTokenStorage()) {
  const server = fakeServer();
  const statuses: string[] = [];
  const session = new Session({
    transport: { baseUrl: 'http://api.test', fetch: server.fetch, requestId: () => uuidv7(), sleep: () => Promise.resolve() },
    storage,
    onStatus: (s, r) => statuses.push(`${s}${r ? `:${r}` : ''}`),
  });
  return { server, session, storage, statuses };
}

const me = (session: Session) => session.fetchAuthed({ method: 'GET', path: '/v1/me', retries: 0 });

describe('A3 — single-flight refresh', () => {
  it('20 concurrent requests at launch share one refresh and nobody is signed out', async () => {
    const { server, session, storage } = setup();
    await storage.set('lep_rt_0');
    await session.restore();
    const responses = await Promise.all(Array.from({ length: 20 }, () => me(session)));
    expect(responses.map((r) => r.status)).toEqual(Array(20).fill(200));
    expect(server.state.calls.refresh).toBe(1);
    expect(session.stats.refreshCalls).toBe(1);
    expect(session.stats.signOuts).toBe(0);
    expect(session.getStatus()).toBe('signedIn');
  });

  it('20 concurrent requests whose access token the server rejects share one refresh', async () => {
    const { server, session, storage } = setup();
    await storage.set('lep_rt_0');
    await session.restore();
    await me(session); // warm: one refresh, a valid access token
    server.state.access.clear(); // the server no longer accepts it
    const before = server.state.calls.refresh;
    const responses = await Promise.all(Array.from({ length: 20 }, () => me(session)));
    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(server.state.calls.refresh - before).toBe(1);
    expect(session.stats.signOuts).toBe(0);
    // The server never saw a reused refresh token.
    expect(server.state.revoked).toBe(false);
  });

  it('stores the rotated refresh token before anyone is told the refresh finished', async () => {
    const order: string[] = [];
    const inner = createMemoryTokenStorage();
    const storage: RefreshTokenStorage = {
      persistent: false,
      get: () => inner.get(),
      clear: () => inner.clear(),
      set: async (t) => {
        await inner.set(t);
        order.push(`stored:${t}`);
      },
    };
    const { session } = setup(storage);
    await inner.set('lep_rt_0');
    await session.restore();
    await session.refresh().then(() => order.push('resolved'));
    expect(order[0]).toBe('stored:lep_rt_1');
    expect(order).toContain('resolved');
    expect(order.indexOf('stored:lep_rt_1')).toBeLessThan(order.indexOf('resolved'));
  });
});

describe('A4 — revoked sessions end once', () => {
  it('a request answered session_revoked signs out once and never refreshes', async () => {
    const { server, session, storage, statuses } = setup();
    await storage.set('lep_rt_0');
    await session.restore();
    await me(session);
    const refreshesBefore = server.state.calls.refresh;
    server.state.revoked = true;
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => me(session)));
    expect(results.every((r) => r.status === 'rejected' && r.reason instanceof AuthEndedError)).toBe(true);
    expect(server.state.calls.refresh).toBe(refreshesBefore);
    expect(session.stats.signOuts).toBe(1);
    expect(statuses.filter((s) => s.startsWith('signedOut'))).toEqual(['signedOut:revoked']);
    expect(await storage.get()).toBeNull();
  });

  it('a refresh answered session_revoked signs out once', async () => {
    const { server, session, storage } = setup();
    await storage.set('lep_rt_0');
    server.state.revoked = true;
    await session.restore();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => me(session)));
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(server.state.calls.refresh).toBe(1);
    expect(session.stats.signOuts).toBe(1);
    expect(session.getStatus()).toBe('signedOut');
  });
});

describe('A5 — the server or the network failing is not a sign-out', () => {
  it('a refresh answered 503 keeps the session', async () => {
    const { server, session, storage } = setup();
    await storage.set('lep_rt_0');
    server.state.mode = '503';
    await session.restore();
    const r = await me(session).catch((e: unknown) => e);
    expect(r).toBeInstanceOf(ApiError);
    expect((r as ApiError).problem.type).toBe('dependency_unavailable');
    expect(session.getStatus()).toBe('signedIn');
    expect(session.stats.signOuts).toBe(0);
    expect(await storage.get()).toBe('lep_rt_0');
  });

  it('a refresh answered 429 keeps the session', async () => {
    const { server, session, storage } = setup();
    await storage.set('lep_rt_0');
    server.state.mode = '429';
    await session.restore();
    await expect(me(session)).rejects.toBeInstanceOf(ApiError);
    expect(session.getStatus()).toBe('signedIn');
  });

  it('a refresh lost to the network is retried once with the same token, then reported, never a sign-out', async () => {
    const { server, session, storage } = setup();
    await storage.set('lep_rt_0');
    server.state.mode = 'lost';
    await session.restore();
    const r = await me(session).catch((e: unknown) => e);
    expect((r as ApiError).problem.type).toBe('client/offline');
    expect(server.state.calls.refresh).toBe(2);
    expect(session.getStatus()).toBe('signedIn');
    expect(session.stats.signOuts).toBe(0);
    // Back online: the same stored token still works.
    server.state.mode = 'ok';
    expect((await me(session)).status).toBe(200);
  });

  it('a response lost after the server rotated: the retry is reuse, and the server ends the session (F2)', async () => {
    const { server, session, storage } = setup();
    await storage.set('lep_rt_0');
    server.state.mode = 'lost_after_rotation';
    await session.restore();
    await expect(me(session)).rejects.toBeInstanceOf(AuthEndedError);
    expect(server.state.calls.refresh).toBe(2);
    expect(session.stats.signOuts).toBe(1);
  });
});

describe('sign-in and sign-out', () => {
  beforeEach(() => log.clear());

  it('signs in with the OAuth2 password form and never logs the password or tokens', async () => {
    const { server, session, storage } = setup();
    await session.signIn('learner@example.com', 'correct horse battery');
    expect(session.getStatus()).toBe('signedIn');
    expect(await storage.get()).toBe('lep_rt_1');
    const form = new URLSearchParams(server.state.bodies[0]);
    expect(form.get('grant_type')).toBe('password');
    expect(form.get('username')).toBe('learner@example.com');
    const logged = JSON.stringify(log.entries());
    expect(logged).not.toContain('correct horse battery');
    expect(logged).not.toContain('lep_rt_');
    expect(logged).not.toContain('learner@example.com');
  });

  it('signing out clears the token locally at once and tells the server best-effort', async () => {
    const { server, session, storage } = setup();
    await session.signIn('a@b.co', 'correct horse battery');
    await session.signOut('user');
    expect(session.getStatus()).toBe('signedOut');
    expect(await storage.get()).toBeNull();
    await tick();
    await tick();
    expect(server.state.calls.logout).toBe(1);
    await expect(session.accessToken()).rejects.toBeInstanceOf(AuthEndedError);
  });

  it('a sign-out that lands while the refresh response is being read still sticks', async () => {
    const storage = createMemoryTokenStorage();
    await storage.set('lep_rt_0');
    const logouts: string[] = [];
    let releaseBody: () => void = () => undefined;
    const fetch: FetchLike = (url, init) => {
      const path = new URL(url).pathname;
      if (path === '/v1/auth/logout') {
        logouts.push(String(init.body));
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      // The refresh answers at once, but its body arrives only when released.
      const body = new Promise<unknown>((resolve) => {
        releaseBody = () => resolve({ access_token: 'access.9', refresh_token: 'lep_rt_9', token_type: 'bearer', expires_in: 900 });
      });
      return Promise.resolve({ ok: true, status: 200, headers: new Headers(), json: () => body, clone: () => undefined } as unknown as Response);
    };
    const session = new Session({ transport: { baseUrl: 'http://api.test', fetch, requestId: () => uuidv7() }, storage });
    await session.restore();
    const pending = session.refresh().catch((e: unknown) => e);
    await tick();
    await session.signOut('user');
    releaseBody();
    expect(await pending).toBeInstanceOf(AuthEndedError);
    await tick();
    expect(await storage.get()).toBeNull();
    expect(session.getStatus()).toBe('signedOut');
    expect(logouts.some((b) => b.includes('lep_rt_9'))).toBe(true);
  });

  it('a sign-out that lands while the new token is being stored is not undone by the write', async () => {
    const inner = createMemoryTokenStorage();
    await inner.set('lep_rt_0');
    let session: Session | null = null;
    const storage: RefreshTokenStorage = {
      persistent: true,
      get: () => inner.get(),
      clear: () => inner.clear(),
      set: async (t) => {
        // The learner taps "Sign out" exactly while the rotated token is being written.
        if (t === 'lep_rt_1') await session?.signOut('user');
        await inner.set(t);
      },
    };
    const { fetch } = fakeServer();
    session = new Session({ transport: { baseUrl: 'http://api.test', fetch, requestId: () => uuidv7() }, storage });
    await session.restore();
    await expect(session.refresh()).rejects.toBeInstanceOf(AuthEndedError);
    expect(await inner.get()).toBeNull();
    expect(session.getStatus()).toBe('signedOut');
  });

  it('knows whose session it is as soon as a token exists (the token’s sub), before /v1/me', async () => {
    const claims = Buffer.from(JSON.stringify({ sub: '0199a3b4-1111-7222-8333-444455556666', iss: 'lep' })).toString('base64url');
    expect(subjectOf(`eyJhbGciOiJIUzI1NiJ9.${claims}.sig`)).toBe('0199a3b4-1111-7222-8333-444455556666');
    expect(subjectOf('not-a-jwt')).toBeNull();
    expect(subjectOf('a.!!!.c')).toBeNull();
    const seen: string[] = [];
    const fetch: FetchLike = () =>
      Promise.resolve(
        new Response(JSON.stringify({ access_token: `h.${claims}.s`, refresh_token: 'lep_rt_1', token_type: 'bearer', expires_in: 900 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    const session = new Session({ transport: { baseUrl: 'http://api.test', fetch, requestId: () => uuidv7() }, storage: createMemoryTokenStorage() });
    session.onLearner((id) => seen.push(id));
    await session.signIn('a@b.co', 'correct horse battery');
    expect(seen).toEqual(['0199a3b4-1111-7222-8333-444455556666']);
  });

  it('signing out while a refresh is in flight ends the rotated session too', async () => {
    const { server, session, storage } = setup();
    await storage.set('lep_rt_0');
    await session.restore();
    const pending = session.refresh().catch((e: unknown) => e);
    await session.signOut('user');
    expect(await pending).toBeInstanceOf(AuthEndedError);
    await tick();
    await tick();
    expect(server.state.calls.logout).toBeGreaterThanOrEqual(1);
    expect(session.getStatus()).toBe('signedOut');
  });
});

describe('requests that wait for the model', () => {
  it('starting a chat and sending a turn get the long timeout; nothing else does', () => {
    expect(AI_TIMEOUT_MS).toBeGreaterThan(DEFAULT_TIMEOUT_MS);
    expect(waitsForModel('POST', 'https://api.example.org/v1/ai/conversations')).toBe(true);
    expect(waitsForModel('POST', '/v1/ai/conversations/0193a/turns')).toBe(true);
    expect(waitsForModel('POST', '/v1/ai/conversations/0193a/end')).toBe(false);
    expect(waitsForModel('GET', '/v1/ai/conversations/0193a')).toBe(false);
    expect(waitsForModel('POST', '/v1/sync/reviews')).toBe(false);
  });
});
