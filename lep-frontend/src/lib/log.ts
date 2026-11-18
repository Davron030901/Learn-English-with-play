/**
 * The client's only logger. DECISIONS §7.6: it never records passwords, tokens, Authorization
 * headers, email addresses, birth years or answer text — for anyone, because before /v1/me the
 * client cannot know whether the learner is a minor, and it must not cache that afterwards.
 *
 * Entries live in a small in-memory ring (for "Report this" diagnostics) and go to the console
 * in development builds only. There is no third-party analytics or crash SDK.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  at: string;
  level: LogLevel;
  event: string;
  data?: unknown;
}

const SENSITIVE_KEY =
  /pass(word)?|token|authori[sz]ation|cookie|secret|email|username|birth|answer|submission|typed|transcript|recording|audio_uri/i;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const REFRESH = /\blep_rt_[A-Za-z0-9_-]+/g;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function redactString(s: string): string {
  return s
    .replace(JWT, '[jwt]')
    .replace(REFRESH, '[refresh-token]')
    .replace(BEARER, 'Bearer [redacted]')
    .replace(EMAIL, '[email]');
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

const RING_SIZE = 200;
const ring: LogEntry[] = [];

function write(level: LogLevel, event: string, data?: unknown) {
  const entry: LogEntry = { at: new Date().toISOString(), level, event };
  if (data !== undefined) entry.data = redact(data);
  ring.push(entry);
  if (ring.length > RING_SIZE) ring.shift();
  const dev = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';
  if (dev && process.env.NODE_ENV !== 'test') {
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(`[lep] ${event}`, entry.data ?? '');
  }
}

export const log = {
  debug: (event: string, data?: unknown) => write('debug', event, data),
  info: (event: string, data?: unknown) => write('info', event, data),
  warn: (event: string, data?: unknown) => write('warn', event, data),
  error: (event: string, data?: unknown) => write('error', event, data),
  entries: (): readonly LogEntry[] => ring.slice(),
  clear: () => {
    ring.length = 0;
  },
};
