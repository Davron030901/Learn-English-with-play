import type { CookieTransport } from './session';

/** Native builds keep the refresh token in the keystore (tokenStorage.native.ts): no cookie. */
export const cookieTransport: CookieTransport | undefined = undefined;
