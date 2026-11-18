import { beforeEach, describe, expect, it } from 'vitest';

import { log, redact, redactString } from '@/lib/log';

/** DECISIONS §7.6: the logger never records passwords, tokens, emails, birth years or answer text. */
describe('log redaction', () => {
  beforeEach(() => log.clear());

  it('redacts sensitive keys at any depth', () => {
    const out = redact({
      password: 'correct horse battery',
      refresh_token: 'lep_rt_abc',
      nested: { Authorization: 'Bearer abc.def.ghi', birth_year: 2010, answer: 'I am Aziz', submission: { text: 'x' }, typed: 'x' },
      item: 'item.0000077',
    }) as Record<string, unknown>;
    expect(out.password).toBe('[redacted]');
    expect(out.refresh_token).toBe('[redacted]');
    expect(out.item).toBe('item.0000077');
    const nested = out.nested as Record<string, unknown>;
    for (const k of ['Authorization', 'birth_year', 'answer', 'submission', 'typed']) expect(nested[k]).toBe('[redacted]');
  });

  it('scrubs tokens and emails inside free text', () => {
    const s = redactString('failed for a@b.co with Bearer eyJhbGciOi.eyJzdWIi.c2lnbmF0dXJl and lep_rt_Zx9-1');
    expect(s).not.toContain('a@b.co');
    expect(s).not.toContain('eyJhbGciOi');
    expect(s).not.toContain('lep_rt_Zx9');
  });

  it('errors keep their name and a scrubbed message only', () => {
    expect(redact(new Error('user a@b.co not found'))).toEqual({ name: 'Error', message: 'user [email] not found' });
  });

  it('the ring holds what was logged, already redacted', () => {
    log.info('auth.test', { password: 'pw-123456789', ok: true });
    const entry = log.entries().at(-1);
    expect(entry?.event).toBe('auth.test');
    expect(JSON.stringify(entry)).not.toContain('pw-123456789');
  });
});
