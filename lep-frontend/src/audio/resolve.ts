import { notationKind } from '@/content/notation';
import type { Item } from '@/content/schemas';

/**
 * brief §7.4: no audio has been recorded yet, and swapping real recordings in later must be a
 * configuration change, not a refactor.
 *
 *   resolveAudio(path, text) → { kind: 'asset', url, fallbackText }   when a CDN is configured
 *                            | { kind: 'tts', text }                  otherwise
 *                            | { kind: 'unavailable', reason }        never synthesise these
 *
 * The TTS branch is the platform speech synthesiser only — no credential, nothing leaves the
 * device — always shown with the "Synthetic voice" marker. The server-proxied TTS of brief §7.4
 * (`POST /v1/media/tts`) is not in the running server's schema yet; when it is, it becomes a
 * third branch here. No provider key exists anywhere in this app (guardrail test).
 */
export type AudioSource =
  | { kind: 'asset'; url: string; fallbackText: string | null }
  | { kind: 'tts'; text: string }
  | { kind: 'unavailable'; reason: 'notation' | 'no_text' };

/** Base URL of recorded audio, once it exists (a URL, never a key). */
const AUDIO_BASE = (process.env.EXPO_PUBLIC_AUDIO_BASE_URL ?? '').replace(/\/+$/, '');

function assetUrl(path: string): string {
  return `${AUDIO_BASE}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** Recovers the spoken text of a word-audio path: `a/w_meet.opus` → "meet" (brief §7.4). */
export function wordFromPath(path: string): string | null {
  const m = path.match(/^a\/(?:w|mp)_(.+)\.opus$/);
  if (!m?.[1]) return null;
  return m[1].replace(/_/g, ' ');
}

export function resolveAudio(path: string | null | undefined, text: string | null | undefined): AudioSource {
  const spoken = text?.trim() || (path ? wordFromPath(path) : null);
  if (spoken && notationKind(spoken)) return { kind: 'unavailable', reason: 'notation' };
  if (AUDIO_BASE && path) return { kind: 'asset', url: assetUrl(path), fallbackText: spoken ?? null };
  if (!spoken) return { kind: 'unavailable', reason: 'no_text' };
  return { kind: 'tts', text: spoken };
}

/** The prompt audio of an item (the packer resolved `say`; phoneme_id options resolve by path). */
export function itemAudio(item: Item): AudioSource | null {
  if (!('audio' in item.prompt) || !item.prompt.audio) return null;
  return resolveAudio(item.prompt.audio, item.say);
}

export function optionAudio(item: Extract<Item, { type_id: 'phoneme_id' }>, index: number): AudioSource {
  const path = item.prompt.option_audio[index];
  return resolveAudio(path, path ? wordFromPath(path) : item.prompt.options[index]);
}
