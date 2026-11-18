import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, session } from '@/api/client';
import { a11yCopyFirst, a11yDrift, keepsA11yProfile, noteA11yCopy, saveA11yProfile } from '@/api/queries/gamification';
import { log } from '@/lib/log';

/**
 * The accessibility switches belong to the device; the account keeps a copy for the exercises the
 * server chooses on its own (the due queue, the offline window) and for crediting node-tiers it did
 * not compose. The copy follows the device, is sent only when it differs, goes ahead of answers when
 * the account is not known to hold it, and a failure to send it never reaches the learner.
 */

const ok = (data: unknown) => ({ data, error: undefined, response: { ok: true, status: 200, headers: new Headers() } as Response });
const refused = () => ({
  data: undefined,
  error: { type: 'validation_error', title: 'x', status: 422 },
  response: { ok: false, status: 422, headers: new Headers() } as Response,
});

describe("the account's copy of the accessibility profile", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is sent only when it differs from the device, and never to a server that keeps none', () => {
    expect(a11yDrift({ noAudio: true, noVision: false }, { a11y_no_audio: true, a11y_no_vision: false })).toBeNull();
    expect(a11yDrift({ noAudio: true, noVision: false }, { a11y_no_audio: false, a11y_no_vision: false })).toEqual({ a11y_no_audio: true, a11y_no_vision: false });
    expect(a11yDrift({ noAudio: false, noVision: false }, { a11y_no_audio: false, a11y_no_vision: true })).toEqual({ a11y_no_audio: false, a11y_no_vision: false });
    // an older server's settings carry no profile: nothing to bring in line
    expect(a11yDrift({ noAudio: true, noVision: true }, {} as { a11y_no_audio: boolean; a11y_no_vision: boolean })).toBeNull();
    expect(keepsA11yProfile({ a11y_no_audio: false, a11y_no_vision: false })).toBe(true);
    expect(keepsA11yProfile({} as { a11y_no_audio: boolean; a11y_no_vision: boolean })).toBe(false);
    // /v1/me has not answered yet: not known to keep one
    expect(keepsA11yProfile(undefined)).toBe(false);
  });

  it("sends the device's two switches with PATCH /v1/me/settings", async () => {
    const patch = vi.spyOn(api, 'PATCH').mockResolvedValue(ok({}) as never);
    await expect(saveA11yProfile({ noAudio: true, noVision: true })).resolves.toBe('saved');
    expect(patch).toHaveBeenCalledWith('/v1/me/settings', { body: { a11y_no_audio: true, a11y_no_vision: true } });
  });

  it('a failure is logged, never thrown', async () => {
    vi.spyOn(api, 'PATCH').mockRejectedValue(new TypeError('Network request failed'));
    await expect(saveA11yProfile({ noAudio: true, noVision: false })).resolves.toBe('failed');
    expect(log.entries().some((e) => e.event === 'settings.a11y_save_failed')).toBe(true);
    vi.spyOn(api, 'PATCH').mockResolvedValue(refused() as never);
    await expect(saveA11yProfile({ noAudio: true, noVision: false })).resolves.toBe('refused');
  });
});

describe('the copy goes ahead of answers', () => {
  beforeEach(() => {
    vi.spyOn(session, 'getStatus').mockReturnValue('signedIn');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('with a switch on, is sent before answers unless the account is known to hold it', async () => {
    const patch = vi.spyOn(api, 'PATCH').mockResolvedValue(ok({}) as never);
    // nothing seen on /v1/me yet (a change made offline, or the first start after an update)
    await a11yCopyFirst('learner-ahead-1', { noAudio: true, noVision: false });
    expect(patch).toHaveBeenCalledWith('/v1/me/settings', { body: { a11y_no_audio: true, a11y_no_vision: false } });
    // sent and arrived: the next sync sends nothing more
    await a11yCopyFirst('learner-ahead-1', { noAudio: true, noVision: false });
    expect(patch).toHaveBeenCalledTimes(1);

    // /v1/me already shows it: nothing to send
    noteA11yCopy('learner-ahead-2', { a11y_no_audio: true, a11y_no_vision: false });
    await a11yCopyFirst('learner-ahead-2', { noAudio: true, noVision: false });
    expect(patch).toHaveBeenCalledTimes(1);
    // /v1/me shows another copy (changed elsewhere, or before an offline change): sent first
    noteA11yCopy('learner-ahead-2', { a11y_no_audio: false, a11y_no_vision: false });
    await a11yCopyFirst('learner-ahead-2', { noAudio: true, noVision: false });
    expect(patch).toHaveBeenCalledTimes(2);
  });

  it('with every switch off, nothing is sent: the device left nothing out for a profile', async () => {
    const patch = vi.spyOn(api, 'PATCH').mockResolvedValue(ok({}) as never);
    await a11yCopyFirst('learner-ahead-3', { noAudio: false, noVision: false });
    expect(patch).not.toHaveBeenCalled();
  });

  it('is tried again when the server could not be reached, not when it refused', async () => {
    const patch = vi.spyOn(api, 'PATCH').mockRejectedValue(new TypeError('Network request failed'));
    await expect(a11yCopyFirst('learner-ahead-4', { noAudio: true, noVision: false })).resolves.toBeUndefined();
    await a11yCopyFirst('learner-ahead-4', { noAudio: true, noVision: false });
    expect(patch).toHaveBeenCalledTimes(2);

    patch.mockResolvedValue(refused() as never);
    await a11yCopyFirst('learner-ahead-5', { noAudio: true, noVision: false });
    await a11yCopyFirst('learner-ahead-5', { noAudio: true, noVision: false });
    expect(patch).toHaveBeenCalledTimes(3);
  });

  it('sends nothing to a server whose settings keep no profile (an older one)', async () => {
    const patch = vi.spyOn(api, 'PATCH').mockResolvedValue(ok({}) as never);
    noteA11yCopy('learner-ahead-6', {} as { a11y_no_audio: boolean; a11y_no_vision: boolean });
    await a11yCopyFirst('learner-ahead-6', { noAudio: true, noVision: false });
    expect(patch).not.toHaveBeenCalled();
  });

  it('sends nothing signed out (a sync timer can outlive the session)', async () => {
    vi.spyOn(session, 'getStatus').mockReturnValue('signedOut');
    const patch = vi.spyOn(api, 'PATCH').mockResolvedValue(ok({}) as never);
    await a11yCopyFirst('learner-ahead-7', { noAudio: true, noVision: false });
    expect(patch).not.toHaveBeenCalled();
  });
});
