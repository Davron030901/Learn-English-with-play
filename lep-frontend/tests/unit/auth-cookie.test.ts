import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/problem';
import { Session, type CookieTransport } from '@/api/session';
import { createMemoryTokenStorage } from '@/api/tokenStorage';
import type { FetchLike } from '@/api/transport';
import { uuidv7 } from '@/lib/uuid';

/**
 * The web's refresh cookie (DECISIONS F8, §22). The fake server below behaves like lep-backend
 * with LEP_WEB_REFRESH_COOKIE on: a request with `X-LEP-Token-Transport: cookie` and
 * credentials gets the refresh token as a cookie (here: the server's own jar) and
 * `refresh_token: null`; /refresh and /logout read the cookie; a reused token ends the session.
 */

const tick = () => new Promise<void>((r) => setTimeout(r, 2));
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const problem = (status: number, type: string) =>
  new Response(JSON.stringify({ type, title: 'x', status }), {
    status,
    headers: { 'content-type': 'application/problem+json', 'x-request-id': 'r' },
  });

function cookieServer(opts: { cookies: boolean } = { cookies: true }) {
  const state = {
    jar: null as string | null,
    seq: 0,
    used: new Set<string>(),
    access: new Set<string>(),
    revoked: false,
    calls: { refresh: 0, logout: 0 },
    seen: [] as {
      path: string;
      header: string | undefined;
      credentials: string | undefined;
      body: string;
    }[],
  };
  const issue = (cookie: boolean) => {
    state.seq += 1;
    const refresh = `lep_rt_${state.seq}`;
    const access = `access.${state.seq}`;
    state.access.add(access);
    if (cookie) state.jar = refresh;
    return {
      access_token: access,
      refresh_token: cookie ? null : refresh,
      token_type: 'bearer',
      expires_in: 900,
    };
  };
  const fetch: FetchLike = async (url, init) => {
    await tick();
    const path = new URL(url).pathname;
    const headers = (init.headers ?? {}) as Record<string, string>;
    const header = headers['X-LEP-Token-Transport'];
    const credentials = init.credentials;
    const body = typeof init.body === 'string' ? init.body : '';
    state.seen.push({ path, header, credentials, body });
    const wantsCookie = opts.cookies && header === 'cookie' && credentials === 'include';
    if (path === '/v1/auth/login') return json(200, issue(wantsCookie));
    if (path === '/v1/auth/refresh') {
      state.calls.refresh += 1;
      const sent =
        (JSON.parse(body || '{}') as { refresh_token?: string }).refresh_token ??
        (wantsCookie ? state.jar : null);
      if (!sent) return problem(422, 'validation_error');
      if (state.revoked) return problem(401, 'session_revoked');
      if (state.used.has(sent)) {
        state.revoked = true;
        return problem(401, 'session_revoked');
      }
      state.used.add(sent);
      return json(200, issue(wantsCookie));
    }
    if (path === '/v1/auth/logout') {
      state.calls.logout += 1;
      state.jar = null;
      return new Response(null, { status: 204 });
    }
    if (path === '/v1/me') {
      const token = headers.Authorization?.replace(/^Bearer /, '') ?? '';
      return state.access.has(token)
        ? json(200, { id: 'learner-1' })
        : problem(401, 'invalid_token');
    }
    return problem(404, 'not_found');
  };
  return { state, fetch };
}

function browser() {
  let hint = false;
  const exclusive = { calls: 0 };
  let queue = Promise.resolve();
  const cookie: CookieTransport = {
    expected: () => Promise.resolve(hint),
    remember: (on) => {
      hint = on;
    },
    exclusive: <T>(work: () => Promise<T>) => {
      exclusive.calls += 1;
      const run = queue.then(work);
      queue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
  return { cookie, hint: () => hint, exclusive };
}

function setup(server: ReturnType<typeof cookieServer>, cookie?: CookieTransport) {
  const storage = createMemoryTokenStorage();
  const statuses: string[] = [];
  const session = new Session({
    transport: {
      baseUrl: 'https://api.test',
      fetch: server.fetch,
      requestId: () => uuidv7(),
      sleep: () => Promise.resolve(),
    },
    storage,
    ...(cookie ? { cookie } : {}),
    onStatus: (s, r) => statuses.push(`${s}${r ? `:${r}` : ''}`),
  });
  return { session, storage, statuses };
}

const me = (session: Session) => session.fetchAuthed({ method: 'GET', path: '/v1/me', retries: 0 });

describe('§22 — the refresh token as an httpOnly cookie on the web', () => {
  it('signing in keeps no token in script, only the flag that a cookie session exists', async () => {
    const server = cookieServer();
    const web = browser();
    const { session, storage } = setup(server, web.cookie);
    await session.signIn('a@example.com', 'correct horse battery staple');
    expect(await storage.get()).toBeNull();
    expect(web.hint()).toBe(true);
    const login = server.state.seen.find((s) => s.path === '/v1/auth/login');
    expect(login).toMatchObject({ header: 'cookie', credentials: 'include' });
    expect((await me(session)).status).toBe(200);
  });

  it('a reload restores the session with one refresh through the cookie', async () => {
    const server = cookieServer();
    const web = browser();
    await setup(server, web.cookie).session.signIn('a@example.com', 'pw pw pw pw pw');
    // the page reloads: a new session object, the same browser
    const { session, statuses } = setup(server, web.cookie);
    await session.restore();
    expect(statuses).toEqual(['signedIn']);
    expect((await me(session)).status).toBe(200);
    const refresh = server.state.seen.filter((s) => s.path === '/v1/auth/refresh');
    expect(refresh).toHaveLength(1);
    expect(refresh[0]).toMatchObject({ body: '{}', header: 'cookie', credentials: 'include' });
    expect(web.exclusive.calls).toBe(1);
  });

  it('20 requests at once after a reload still share one refresh, inside the browser-wide lock', async () => {
    const server = cookieServer();
    const web = browser();
    await setup(server, web.cookie).session.signIn('a@example.com', 'pw pw pw pw pw');
    const { session } = setup(server, web.cookie);
    await session.restore();
    const responses = await Promise.all(Array.from({ length: 20 }, () => me(session)));
    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(server.state.calls.refresh).toBe(1);
    expect(server.state.revoked).toBe(false);
  });

  it('two tabs refreshing together take turns, so the shared cookie is never presented twice', async () => {
    const server = cookieServer();
    const web = browser();
    await setup(server, web.cookie).session.signIn('a@example.com', 'pw pw pw pw pw');
    const tab1 = setup(server, web.cookie).session;
    const tab2 = setup(server, web.cookie).session;
    await Promise.all([tab1.restore(), tab2.restore()]);
    const [a, b] = await Promise.all([me(tab1), me(tab2)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(server.state.revoked).toBe(false);
  });

  it('an ended cookie session signs out and forgets the flag', async () => {
    const server = cookieServer();
    const web = browser();
    await setup(server, web.cookie).session.signIn('a@example.com', 'pw pw pw pw pw');
    server.state.revoked = true;
    const { session, statuses } = setup(server, web.cookie);
    await session.restore();
    await expect(me(session)).rejects.toThrow();
    expect(statuses).toEqual(['signedIn', 'signedOut:revoked']);
    expect(web.hint()).toBe(false);
  });

  it('a browser with no cookie session does not refresh at start', async () => {
    const server = cookieServer();
    const { session, statuses } = setup(server, browser().cookie);
    await session.restore();
    expect(statuses).toEqual(['signedOut:no_token']);
    expect(server.state.calls.refresh).toBe(0);
  });

  it('signing out sends an empty body (the server reads and clears the cookie)', async () => {
    const server = cookieServer();
    const web = browser();
    const { session } = setup(server, web.cookie);
    await session.signIn('a@example.com', 'pw pw pw pw pw');
    await session.signOut('user');
    await tick();
    await tick();
    const logout = server.state.seen.find((s) => s.path === '/v1/auth/logout');
    expect(logout).toMatchObject({ body: '{}', header: 'cookie', credentials: 'include' });
    expect(server.state.jar).toBeNull();
    expect(web.hint()).toBe(false);
  });

  it('a server without the cookie flow answers with a body token: kept in memory, as before', async () => {
    const server = cookieServer({ cookies: false });
    const web = browser();
    const { session, storage } = setup(server, web.cookie);
    await session.signIn('a@example.com', 'pw pw pw pw pw');
    expect(await storage.get()).toBe('lep_rt_1');
    expect(web.hint()).toBe(false);
  });

  it('a native build never accepts a token it was not given', async () => {
    const server = cookieServer();
    // a misconfigured server answers a native sign-in with the cookie shape anyway
    const forced: FetchLike = (url, init) =>
      server.fetch(url, {
        ...init,
        credentials: 'include',
        headers: { ...(init.headers as object), 'X-LEP-Token-Transport': 'cookie' },
      });
    const native = new Session({
      transport: { baseUrl: 'https://api.test', fetch: forced, requestId: () => uuidv7() },
      storage: createMemoryTokenStorage(),
    });
    await expect(native.signIn('a@example.com', 'pw pw pw pw pw')).rejects.toBeInstanceOf(ApiError);
    expect(native.getStatus()).not.toBe('signedIn');
  });
});
