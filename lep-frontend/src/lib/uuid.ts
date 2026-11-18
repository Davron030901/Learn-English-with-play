import { randomBytes } from './random';

const hex = (b: number) => b.toString(16).padStart(2, '0');

/**
 * RFC 9562 UUIDv7: 48-bit Unix-millisecond timestamp, then random bits.
 * Used for X-Request-ID (36 characters, inside the backend's `[A-Za-z0-9._:-]` set once the
 * hyphens are counted — they are allowed) and for every outbox row's `client_uuid`, where the
 * time-ordering makes replays sort naturally.
 */
export function uuidv7(now: number = Date.now(), rand: Uint8Array = randomBytes(10)): string {
  if (rand.length < 10) throw new Error('uuidv7 needs 10 random bytes');
  const b = new Uint8Array(16);
  let ts = Math.max(0, Math.floor(now));
  for (let i = 5; i >= 0; i -= 1) {
    b[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  b[6] = 0x70 | ((rand[0] ?? 0) & 0x0f);
  b[7] = rand[1] ?? 0;
  b[8] = 0x80 | ((rand[2] ?? 0) & 0x3f);
  for (let i = 9; i < 16; i += 1) b[i] = rand[i - 6] ?? 0;
  const s = Array.from(b, hex).join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

export const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
