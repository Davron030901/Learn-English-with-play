import { describe, expect, it } from 'vitest';

import { ApiError, SERVER_PROBLEM_TYPES, isKnownProblemType, problemFromResponse } from '@/api/problem';
import { joinUrl, send, type FetchLike } from '@/api/transport';
import { UUID_V7, uuidv7 } from '@/lib/uuid';

const res = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': typeof body === 'string' ? 'text/html' : 'application/problem+json', ...headers },
  });

describe('problem documents (RFC 9457, brief §4.2)', () => {
  it('keeps the type slug, status and request id — never title or detail', async () => {
    const p = await problemFromResponse(
      res(409, { type: 'email_taken', title: 'Email already registered', status: 409, detail: 'learner@example.com exists', request_id: 'req-9' }),
      'sent-1',
    );
    expect(p).toEqual({ type: 'email_taken', status: 409, requestId: 'req-9', errors: [], retryAfterS: null });
    expect(JSON.stringify(p)).not.toContain('learner@example.com');
  });

  it('keeps only field and message from errors[], never a submitted value', async () => {
    const p = await problemFromResponse(
      res(422, {
        type: 'validation_error',
        status: 422,
        errors: [
          { field: 'body.password', message: 'String should have at least 10 characters', input: 'hunter2' },
          { nonsense: true },
        ],
      }),
      null,
    );
    expect(p.errors).toEqual([{ field: 'body.password', message: 'String should have at least 10 characters' }]);
    expect(JSON.stringify(p)).not.toContain('hunter2');
  });

  it('reads Retry-After from the body or the header', async () => {
    expect((await problemFromResponse(res(429, { type: 'rate_limited', retry_after_s: 12 }), null)).retryAfterS).toBe(12);
    expect((await problemFromResponse(res(429, { type: 'rate_limited' }, { 'retry-after': '30' }), null)).retryAfterS).toBe(30);
  });

  it('falls back to the response header and then to the id we sent', async () => {
    expect((await problemFromResponse(res(500, { type: 'internal_error' }, { 'x-request-id': 'hdr-1' }), 'sent-1')).requestId).toBe('hdr-1');
    expect((await problemFromResponse(res(500, { type: 'internal_error' }), 'sent-1')).requestId).toBe('sent-1');
  });

  it('a proxy page with no problem body becomes a client type, not a crash', async () => {
    expect((await problemFromResponse(res(502, '<html>Bad gateway</html>'), 'sent-1')).type).toBe('client/bad-gateway');
    expect((await problemFromResponse(res(418, '<html>teapot</html>'), 'sent-1')).type).toBe('client/unknown');
  });

  it('an unknown slug passes through as itself and is not "known" (generic copy)', async () => {
    const p = await problemFromResponse(res(402, { type: 'http_402', status: 402 }), null);
    expect(p.type).toBe('http_402');
    expect(isKnownProblemType(p.type)).toBe(false);
    for (const t of SERVER_PROBLEM_TYPES) expect(isKnownProblemType(t)).toBe(true);
  });

  it("a refusal's reason is kept as a slug, never as text", async () => {
    const paused = await problemFromResponse(res(409, { type: 'assessment_conflict', status: 409, reason: 'paused', detail: 'data collection is paused' }), null);
    expect(paused.reason).toBe('paused');
    const prose = await problemFromResponse(res(409, { type: 'assessment_conflict', status: 409, reason: 'Some text from the server!' }), null);
    expect(prose.reason).toBeUndefined();
  });

  it('an ApiError message is the type only', () => {
    const e = new ApiError({ type: 'email_taken', status: 409, requestId: null, errors: [], retryAfterS: null });
    expect(e.message).toBe('email_taken');
  });
});

describe('transport (DECISIONS §7.3)', () => {
  it('sends one X-Request-ID (UUIDv7) and keeps it across GET retries', async () => {
    const seen: string[] = [];
    let n = 0;
    const fetch: FetchLike = (_url, init) => {
      seen.push((init.headers as Record<string, string>)['X-Request-ID'] ?? '');
      n += 1;
      if (n < 3) return Promise.reject(new TypeError('offline'));
      return Promise.resolve(new Response('{}', { status: 200 }));
    };
    const out = await send({ baseUrl: 'http://x', fetch, requestId: () => uuidv7(), sleep: () => Promise.resolve() }, { method: 'GET', path: '/v1/me' });
    expect(out.response.status).toBe(200);
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toMatch(UUID_V7);
  });

  it('never retries a POST on its own (the outbox owns replays)', async () => {
    let calls = 0;
    const fetch: FetchLike = () => {
      calls += 1;
      return Promise.reject(new TypeError('offline'));
    };
    const err = await send({ baseUrl: 'http://x', fetch, requestId: () => 'id', sleep: () => Promise.resolve() }, { method: 'POST', path: '/v1/auth/login', body: '' }).catch((e: unknown) => e);
    expect(calls).toBe(1);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).problem).toMatchObject({ type: 'client/offline', requestId: 'id' });
  });

  it('a timeout is client/timeout', async () => {
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const err = await send({ baseUrl: 'http://x', fetch, requestId: () => 'id' }, { method: 'POST', path: '/p', timeoutMs: 10 }).catch((e: unknown) => e);
    expect((err as ApiError).problem.type).toBe('client/timeout');
  });

  it('returns 4xx and 5xx responses to the caller untouched', async () => {
    const fetch: FetchLike = () => Promise.resolve(new Response('{}', { status: 503 }));
    const out = await send({ baseUrl: 'http://x/', fetch, requestId: () => 'id' }, { method: 'GET', path: '/ready', retries: 0 });
    expect(out.response.status).toBe(503);
    expect(joinUrl('http://x/', '/ready')).toBe('http://x/ready');
  });
});

describe('UUIDv7', () => {
  it('is a version-7 UUID that sorts by time', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(UUID_V7);
    expect(b).toMatch(UUID_V7);
    expect(a < b).toBe(true);
    expect(new Set(Array.from({ length: 1000 }, () => uuidv7())).size).toBe(1000);
  });
});
