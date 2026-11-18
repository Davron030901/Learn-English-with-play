import { icuLocale } from '@/i18n';

/**
 * How a server-computed figure can be shown right now (brief §0 rule 8: showing nothing beats a
 * guess). `unavailable` covers a server without the endpoint, a signed-out session, an
 * unreachable server and an error alike: the screen then says "not available yet" and never
 * fills the gap with a number made on the device.
 */
export type ServerState = 'ready' | 'loading' | 'unavailable';

export function serverState(q: { data: unknown; isPending: boolean; fetchStatus: string }): ServerState {
  if (q.data !== undefined) return 'ready';
  if (q.isPending && q.fetchStatus === 'fetching') return 'loading';
  return 'unavailable';
}

const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

/** 3 Oct 2026 — a calendar day the server sent ('YYYY-MM-DD'), never shifted by the time zone. */
export function formatDay(day: string, language: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return day;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return safe(() => new Intl.DateTimeFormat(icuLocale(language), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d), day.slice(0, 10));
}

/** A server timestamp as a local date. */
export function formatDate(iso: string, language: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return safe(() => new Intl.DateTimeFormat(icuLocale(language), { day: 'numeric', month: 'short', year: 'numeric' }).format(d), iso.slice(0, 10));
}

/** 14:05 — the local time of a server snapshot. */
export function formatTime(iso: string, language: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return safe(() => new Intl.DateTimeFormat(icuLocale(language), { hour: '2-digit', minute: '2-digit' }).format(d), iso.slice(11, 16));
}

/** Monday … Sunday for ISO weekdays 1…7, in the interface language. */
export function weekdayName(iso: number, language: string, width: 'long' | 'short' = 'long'): string {
  // 1 Jan 2024 was a Monday.
  return safe(() => new Intl.DateTimeFormat(icuLocale(language), { weekday: width, timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, iso))), String(iso));
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a 'YYYY-MM-DD' calendar day. */
export function isoWeekday(day: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return null;
  const w = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return w === 0 ? 7 : w;
}

/** Formats a count the server sent for the interface language (1 234 / 1,234). */
export function formatNumber(n: number, language: string): string {
  return safe(() => new Intl.NumberFormat(icuLocale(language)).format(n), String(n));
}

/** A coverage share: whole percent from 10 % up, one decimal below. */
export function roundPercent(p: number): number {
  return p >= 10 ? Math.round(p) : Math.round(p * 10) / 10;
}
