import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useCapabilities } from '@/api/queries/account';
import { useMe } from '@/api/queries/me';
import {
  fetchSpeechJob,
  serverHasSpeech,
  submitPronunciation,
  type SpeechJob,
} from '@/api/queries/speech';
import { ApiError, type ApiProblem } from '@/api/problem';
import { RECORDING_MIME, recordingBase64 } from '@/audio/recordingData';
import { Card, Notice, Txt } from '@/design';
import { log } from '@/lib/log';
import { isOnline, useOnlineStore } from '@/state/online';

/**
 * Pronunciation, scored on the server (frontend DECISIONS §25; backend §10.3–10.5). Only for the
 * items with a text to say (`repeat_after`, `read_aloud`), and only when the server has a scorer
 * (`GET /v1/capabilities`), the learner agreed to voice recording and has not paused data
 * collection, and the device is online — otherwise nothing is uploaded and speaking stays as it
 * was (self-assessment, or typing instead). The lesson never waits: the take is sent after the
 * answer, the job is polled for a minute at most, and the result appears beside the feedback.
 * One headline, at most two notes, each word — never a mark against an accent (docs/02 §10).
 */

const SCORED_TYPES: ReadonlySet<string> = new Set(['repeat_after', 'read_aloud']);
/** Waits between polls, in ms: about a minute in all, then the check is left to the server. */
const POLL_MS = [1_000, 1_500, 2_000, 3_000, 4_000, 6_000, 8_000, 10_000, 12_000, 12_000];
const MAX_NOTES = 2;

export interface Phone {
  expected: string;
  heard: string | null;
  substituted: boolean;
}
export interface WordScore {
  word: string;
  score: number | null;
  phones: Phone[];
}
export interface SpeechResult {
  headline: number;
  passed: boolean;
  notes: string[];
  words: WordScore[];
}

export type CheckState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'checking' }
  | { kind: 'scored'; result: SpeechResult; expiresAt: string }
  | { kind: 'failed'; problem: ApiProblem | null };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The server's result, read defensively: anything missing or malformed is no result. */
export function parseResult(raw: SpeechJob['result']): SpeechResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.headline !== 'number' || typeof r.passed !== 'boolean') return null;
  const words: WordScore[] = Array.isArray(r.words)
    ? r.words.flatMap((w) => {
        if (!w || typeof w !== 'object') return [];
        const o = w as Record<string, unknown>;
        if (typeof o.word !== 'string') return [];
        const phones: Phone[] = Array.isArray(o.phones)
          ? o.phones.flatMap((p) => {
              if (!p || typeof p !== 'object') return [];
              const q = p as Record<string, unknown>;
              if (typeof q.expected !== 'string') return [];
              return [
                {
                  expected: q.expected,
                  heard: typeof q.heard === 'string' ? q.heard : null,
                  substituted: q.substituted === true,
                },
              ];
            })
          : [];
        return [{ word: o.word, score: typeof o.score === 'number' ? o.score : null, phones }];
      })
    : [];
  const notes = Array.isArray(r.notes)
    ? r.notes.filter((n): n is string => typeof n === 'string')
    : [];
  return {
    headline: Math.round(Math.max(0, Math.min(100, r.headline))),
    passed: r.passed,
    notes,
    words,
  };
}

/** The sounds that came out as another sound, at most two: what the notes are built from. */
export function substitutions(
  result: SpeechResult,
): { word: string; expected: string; heard: string }[] {
  const out: { word: string; expected: string; heard: string }[] = [];
  for (const w of result.words) {
    for (const p of w.phones) {
      if (out.length === MAX_NOTES) return out;
      if (p.substituted && p.heard && p.heard !== p.expected)
        out.push({ word: w.word, expected: p.expected, heard: p.heard });
    }
  }
  return out;
}

export function usePronunciationCheck(item: { id: string; type_id: string }) {
  const capabilities = useCapabilities();
  const me = useMe();
  const online = useOnlineStore(isOnline);
  const settings = me.data?.settings;
  const enabled =
    SCORED_TYPES.has(item.type_id) &&
    serverHasSpeech &&
    capabilities.data?.speech_scoring === true &&
    settings?.voice_consent === true &&
    settings.data_collection_paused !== true &&
    online;
  const [state, setState] = useState<CheckState>({ kind: 'idle' });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const send = useCallback(
    async (uri: string | null, durationMs: number) => {
      if (!enabled || !uri) return;
      setState({ kind: 'sending' });
      try {
        const audio = await recordingBase64(uri);
        const job = await submitPronunciation({
          itemId: item.id,
          audioBase64: audio,
          mime: RECORDING_MIME,
          seconds: durationMs / 1000,
        });
        if (!mounted.current) return;
        setState({ kind: 'checking' });
        for (const wait of POLL_MS) {
          await sleep(wait);
          // the learner moved on: the server still scores it; the screen no longer asks
          if (!mounted.current) return;
          const now = await fetchSpeechJob(job.id);
          if (now.status === 'scored') {
            const result = parseResult(now.result);
            setState(
              result
                ? { kind: 'scored', result, expiresAt: now.expires_at }
                : { kind: 'failed', problem: null },
            );
            return;
          }
          if (now.status === 'failed') {
            setState({ kind: 'failed', problem: null });
            return;
          }
        }
        if (mounted.current) setState({ kind: 'failed', problem: null });
      } catch (e) {
        log.info('speech.check_failed', {
          type: e instanceof ApiError ? e.problem.type : 'network',
        });
        if (mounted.current)
          setState({ kind: 'failed', problem: e instanceof ApiError ? e.problem : null });
      }
    },
    [enabled, item.id],
  );

  return { enabled, state, send };
}

export function PronunciationCard({ state }: { state: CheckState }) {
  const { t, i18n } = useTranslation();
  if (state.kind === 'idle') return null;
  if (state.kind === 'sending' || state.kind === 'checking') {
    return (
      <Txt
        variant="body-s"
        color="ink-3"
        accessibilityLiveRegion="polite"
        testID="pronunciation-checking"
      >
        {t('pronunciation.checking')}
      </Txt>
    );
  }
  if (state.kind === 'failed') {
    const p = state.problem;
    const text =
      p?.type === 'media_refused' && p.reason
        ? t(`errors.media_refused_${p.reason}`, { defaultValue: t('pronunciation.failed') })
        : t('pronunciation.failed');
    return (
      <View testID="pronunciation-failed">
        <Notice icon="info">{text}</Notice>
      </View>
    );
  }
  const { result, expiresAt } = state;
  const notes = substitutions(result).map((s) => t('pronunciation.note', s));
  const until = new Date(expiresAt);
  return (
    <View testID="pronunciation-result">
      <Card soft>
        <Txt variant="title-m" accessibilityLiveRegion="polite" testID="pronunciation-headline">
          {t('pronunciation.headline', { value: result.headline })}
        </Txt>
        <Txt variant="body-m" color="ink-2">
          {result.passed ? t('pronunciation.clear') : t('pronunciation.practise')}
        </Txt>
        {notes.map((n) => (
          <Txt key={n} variant="body-m" testID="pronunciation-note">
            {n}
          </Txt>
        ))}
        {result.words.length ? (
          <Txt variant="body-s" color="ink-2" lang="en" testID="pronunciation-words">
            {result.words
              .map((w) => (w.score === null ? w.word : `${w.word} ${Math.round(w.score)}`))
              .join(' · ')}
          </Txt>
        ) : null}
        <Txt variant="caption" color="ink-3">
          {t('pronunciation.kept', {
            date: Number.isNaN(until.getTime()) ? '' : until.toLocaleDateString(i18n.language),
          })}
        </Txt>
      </Card>
    </View>
  );
}
