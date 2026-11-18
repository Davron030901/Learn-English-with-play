import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { stopAudio, type Accent } from '@/audio/speech';
import { discardAllRecordings } from '@/audio/useRecorder';
import { CONTENT_L1 } from '@/content/l1';
import type { Unit } from '@/content/model';
import type { Item } from '@/content/schemas';
import { contentVersion } from '@/content/version.generated';
import { Button, Mascot, TextLink, Txt, useTheme } from '@/design';
import { ExerciseView, instructionText } from '@/exercises/ExerciseView';
import type { ExerciseContext } from '@/exercises/types';
import { gradeContextFor, toSubmissionRecord } from '@/features/lesson/record';
import { grade, type Submission } from '@/grading/grade';
import { log } from '@/lib/log';
import { uuidv7 } from '@/lib/uuid';
import { getOutbox } from '@/outbox';
import { clampRt } from '@/runner/machine';
import { useLearner } from '@/state/learner';
import { useOnboarding } from '@/state/onboarding';
import { usePrefs } from '@/state/prefs';

/** The item the brief's step 8 names: S01U01's read-aloud "Hello! My name is Aziz." */
export const FIRST_SENTENCE_ITEM = 'item.0000077';

export function firstSentenceItem(unit: Unit): Item | null {
  const all = unit.nodes.flatMap((n) => Object.values(n.tiers).flat());
  return (
    all.find((it) => it?.id === FIRST_SENTENCE_ITEM) ??
    all.find((it) => it?.type_id === 'read_aloud') ??
    all.find((it) => it?.type_id === 'repeat_after') ??
    null
  );
}

/**
 * Onboarding step 8 (brief §9, DECISIONS F21): the learner's first English sentence, spoken (or
 * typed — the text route is always there), right after the account exists. Recording stays on
 * the device and is deleted when this screen is left; nothing is scored. The time from the start
 * of onboarding to this sentence is kept on the device for the 90-second target.
 */
export function FirstSentence({
  unit,
  instructions,
  words,
  onDone,
}: {
  unit: Unit;
  instructions: Readonly<Record<string, readonly [string, string]>>;
  words: ReadonlySet<string>;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const item = useMemo(() => firstSentenceItem(unit), [unit]);
  const learnerId = useLearner((s) => s.learnerId);
  const profile = useLearner((s) => s.data.profile);
  const update = useLearner((s) => s.update);
  const prefs = usePrefs();
  const [said, setSaid] = useState(false);
  const [plays, setPlays] = useState(0);
  const [shownAtMs] = useState(() => Date.now());
  const startedAt = useOnboarding((s) => s.startedAt);
  const l1 = profile?.l1 ?? CONTENT_L1;
  const accent: Accent = profile?.spellingVariant ?? 'us';

  const ctx = useMemo<ExerciseContext>(
    () => ({
      unit,
      cefr: unit.cefr,
      l1,
      english: words,
      profile: { noAudio: prefs.noAudio, noVision: prefs.noVision },
      accent,
      speed: prefs.speed,
      timers: prefs.timers,
      timedMode: prefs.timedMode,
      whisper: prefs.whisper,
      seed: 1,
      reduceMotion: theme.reduceMotion,
    }),
    [unit, l1, words, prefs.noAudio, prefs.noVision, accent, prefs.speed, prefs.timers, prefs.timedMode, prefs.whisper, theme.reduceMotion],
  );

  const finish = useCallback(() => {
    void stopAudio();
    discardAllRecordings();
    onDone();
  }, [onDone]);

  const onSubmit = useCallback(
    (sub: Submission) => {
      if (!item || said) return;
      const now = Date.now();
      const result = grade(item, sub, gradeContextFor(item, unit, words));
      setSaid(true);
      update((d) => ({ ...d, onboarding: { ...d.onboarding, firstSentenceMs: now - (startedAt ?? shownAtMs) } }));
      if (learnerId) {
        const clientUuid = uuidv7(now);
        void getOutbox(learnerId)
          .enqueue({
            kind: 'review',
            client_uuid: clientUuid,
            created_at: new Date(now).toISOString(),
            monotonic_ms: now - shownAtMs,
            payload: {
              item_id: item.id,
              session_id: uuidv7(shownAtMs),
              submission: toSubmissionRecord(item, sub),
              rt_ms: clampRt(now - shownAtMs),
              hints_used: 0,
              plays_used: plays,
              started_at: new Date(shownAtMs).toISOString(),
              content_version: contentVersion,
              local_verdict: result.verdict,
              local_typo: result.typo !== null,
            },
          })
          .catch((e: unknown) => log.error('outbox.enqueue_failed', e));
      }
      log.info('onboarding.first_sentence', { verdict: result.verdict, ms: now - (startedAt ?? shownAtMs) });
    },
    [item, said, unit, words, update, startedAt, learnerId, plays, shownAtMs],
  );

  if (!item) {
    // The content no longer has a read-aloud item in unit 1: go straight to the path rather than invent one.
    return (
      <View style={{ gap: 16, alignItems: 'center', paddingTop: 32 }}>
        <Mascot pose="wave" size={120} />
        <Button onPress={finish}>{t('onboarding.first.toPath')}</Button>
      </View>
    );
  }

  if (said) {
    return (
      <View style={{ gap: 18, alignItems: 'center', paddingTop: 24 }} testID="first-sentence-done">
        <Mascot pose="cheer" size={140} />
        <Txt variant="display-m" align="center" accessibilityRole="header">
          {t('onboarding.first.done')}
        </Txt>
        <Txt variant="learn-l" lang="en" align="center">
          {item.type_id === 'read_aloud' || item.type_id === 'repeat_after' ? item.prompt.text : ''}
        </Txt>
        <Txt variant="body-l" color="ink-2" align="center">
          {t('onboarding.first.doneBody')}
        </Txt>
        <Button size="lg" block onPress={finish} testID="first-sentence-path">
          {t('onboarding.first.toPath')}
        </Button>
      </View>
    );
  }

  return (
    <View style={{ gap: 18 }} testID="first-sentence">
      <View style={{ gap: 6 }}>
        <Txt variant="display-m" accessibilityRole="header">
          {t('onboarding.first.title')}
        </Txt>
        <Txt variant="body-l" color="ink-2">
          {t('onboarding.first.body')}
        </Txt>
      </View>
      <ExerciseView
        item={item}
        ctx={ctx}
        result={null}
        plays={plays}
        onPlay={() => setPlays((p) => p + 1)}
        hint={null}
        onSubmit={onSubmit}
        instruction={instructionText(instructions, item.instruction_key, prefs.interfaceLanguage)}
      />
      <Txt variant="caption" color="ink-3" align="center">
        {t('common.syntheticVoiceHelp')}
      </Txt>
      <View style={{ alignItems: 'center' }}>
        <TextLink onPress={finish} testID="first-sentence-skip">
          {t('common.skip')}
        </TextLink>
      </View>
    </View>
  );
}
