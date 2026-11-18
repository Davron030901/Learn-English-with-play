import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { api, publicApi, session } from '@/api/client';
import Forgot from '@/app/(auth)/forgot';
import ResetPassword from '@/app/reset-password';
import { ChangePassword } from '@/features/settings/ChangePassword';

import { renderUI } from './render';

/**
 * A forgotten, reset and changed password (backend DECISIONS §14.3, frontend §22). The forgot
 * screen says the same thing whatever the address; a refused password is explained by its
 * reason in the learner's language; a dead link offers a new one; a reset signs this device out.
 */

const TOKEN = 'a'.repeat(43);
const ok = <T,>(data: T, status = 200) => ({ data, error: undefined, response: { ok: true, status, headers: new Headers() } as Response });
const fail = (status: number, body: Record<string, unknown>) => ({
  data: undefined,
  error: { status, ...body },
  response: { ok: false, status, headers: new Headers() } as Response,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.spyOn(publicApi, 'GET').mockImplementation((async () => ok(null)) as never);
});
afterEach(() => jest.restoreAllMocks());

test('forgot: one answer for every address, with how long the link works', async () => {
  const post = jest.spyOn(publicApi, 'POST').mockImplementation((async () => ok({ accepted: true, expires_in_minutes: 30, detail: 'x' }, 202)) as never);
  await renderUI(<Forgot />);
  await fireEvent.changeText(screen.getByTestId('forgot-email'), 'not-an-email');
  await fireEvent.press(screen.getByTestId('forgot-submit'));
  expect(post).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByTestId('forgot-email'), ' dilnoza@example.uz ');
  await fireEvent.press(screen.getByTestId('forgot-submit'));
  await waitFor(() => expect(screen.getByTestId('forgot-sent')).toBeTruthy());
  expect(post).toHaveBeenCalledWith('/v1/auth/password/forgot', { body: { email: 'dilnoza@example.uz' } });
  expect(screen.getByText(/If an account uses dilnoza@example\.uz/)).toBeTruthy();
  expect(screen.getByText(/30 minutes/)).toBeTruthy();
});

test('forgot: a server without mail explains how to get help instead', async () => {
  jest.spyOn(publicApi, 'POST').mockImplementation((async () => fail(503, { type: 'password_reset_unavailable' })) as never);
  await renderUI(<Forgot />);
  await fireEvent.changeText(screen.getByTestId('forgot-email'), 'a@example.com');
  await fireEvent.press(screen.getByTestId('forgot-submit'));
  await waitFor(() => expect(screen.getByText(/isn't available on this server yet/)).toBeTruthy());
  expect(screen.queryByTestId('forgot-submit')).toBeNull();
});

test('reset: a refused password says why on the field, then the new one is saved', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ token: TOKEN });
  let call = 0;
  const post = jest.spyOn(publicApi, 'POST').mockImplementation((async () => {
    call += 1;
    return call === 1
      ? fail(422, { type: 'password_refused', reason: 'breached', errors: [{ field: 'new_password', message: 'x' }] })
      : { data: undefined, error: undefined, response: { ok: true, status: 204, headers: new Headers() } as Response };
  }) as never);
  await renderUI(<ResetPassword />);
  await fireEvent.changeText(screen.getByTestId('reset-new-password'), 'short');
  await fireEvent.press(screen.getByTestId('reset-submit'));
  expect(post).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByTestId('reset-new-password'), 'password from a breach');
  await fireEvent.press(screen.getByTestId('reset-submit'));
  await waitFor(() => expect(screen.getByText('That password has appeared in a data breach. Choose another.')).toBeTruthy());
  await fireEvent.changeText(screen.getByTestId('reset-new-password'), 'a quiet morning in samarkand');
  await fireEvent.press(screen.getByTestId('reset-submit'));
  await waitFor(() => expect(screen.getByTestId('reset-done')).toBeTruthy());
  expect(post).toHaveBeenLastCalledWith('/v1/auth/password/reset', { body: { token: TOKEN, new_password: 'a quiet morning in samarkand' } });
  await fireEvent.press(screen.getByTestId('reset-sign-in'));
  expect(router.replace).toHaveBeenCalledWith('/sign-in');
});

test('reset: a used or expired link, or none at all, offers a new one', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ token: TOKEN });
  jest.spyOn(publicApi, 'POST').mockImplementation((async () => fail(400, { type: 'reset_link_invalid' })) as never);
  await renderUI(<ResetPassword />);
  await fireEvent.changeText(screen.getByTestId('reset-new-password'), 'a quiet morning in samarkand');
  await fireEvent.press(screen.getByTestId('reset-submit'));
  await waitFor(() => expect(screen.getByTestId('reset-invalid')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('reset-ask-again'));
  expect(router.replace).toHaveBeenCalledWith('/forgot');
});

test('reset: a page opened without the link says where the link is', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({});
  await renderUI(<ResetPassword />);
  expect(screen.getByTestId('reset-invalid')).toBeTruthy();
  expect(screen.getByText(/needs the link from the email/)).toBeTruthy();
});

test('a reset signs this device out too', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ token: TOKEN });
  jest.spyOn(session, 'getStatus').mockReturnValue('signedIn');
  const signOut = jest.spyOn(session, 'signOut').mockResolvedValue(undefined);
  jest.spyOn(publicApi, 'POST').mockImplementation((async () => ({
    data: undefined,
    error: undefined,
    response: { ok: true, status: 204, headers: new Headers() } as Response,
  })) as never);
  await renderUI(<ResetPassword />);
  await fireEvent.changeText(screen.getByTestId('reset-new-password'), 'a quiet morning in samarkand');
  await fireEvent.press(screen.getByTestId('reset-submit'));
  await waitFor(() => expect(signOut).toHaveBeenCalledWith('revoked'));
});

test('change: the current password first, the reason for a refusal, then done and cleared', async () => {
  let call = 0;
  const post = jest.spyOn(api, 'POST').mockImplementation((async () => {
    call += 1;
    if (call === 1) return fail(422, { type: 'validation_error', errors: [{ field: 'current_password', message: 'x' }] });
    if (call === 2) return fail(422, { type: 'password_refused', reason: 'unchanged', errors: [{ field: 'new_password', message: 'x' }] });
    return { data: undefined, error: undefined, response: { ok: true, status: 204, headers: new Headers() } as Response };
  }) as never);
  await renderUI(<ChangePassword />);
  await fireEvent.changeText(screen.getByTestId('password-current'), 'wrong one');
  await fireEvent.changeText(screen.getByTestId('password-next'), 'a quiet morning in samarkand');
  await fireEvent.press(screen.getByTestId('password-submit'));
  await waitFor(() => expect(screen.getByText("That isn't your current password.")).toBeTruthy());
  await fireEvent.press(screen.getByTestId('password-submit'));
  await waitFor(() => expect(screen.getByText('Choose a password different from your current one.')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('password-submit'));
  await waitFor(() => expect(screen.getByTestId('password-changed')).toBeTruthy());
  expect(post).toHaveBeenLastCalledWith('/v1/me/password', {
    body: { current_password: 'wrong one', new_password: 'a quiet morning in samarkand' },
  });
  expect(screen.getByTestId('password-current').props.value).toBe('');
});
