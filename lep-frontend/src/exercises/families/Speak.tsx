import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { itemAudio, resolveAudio } from '@/audio/resolve';
import { timerSeconds } from '@/audio/policy';
import { useRecorder } from '@/audio/useRecorder';
import type { ItemOf } from '@/content/schemas';
import { Button, Card, Chip, MicButton, Notice, TextField, TextLink, Txt } from '@/design';
import { isBlank } from '@/grading/grade';

import { AudioControl, CheckButton, StoryScript } from '../parts';
import { PronunciationCard, usePronunciationCheck } from '../pronunciation';
import type { ExerciseProps } from '../types';

export type SpeakItem = ItemOf<
  'repeat_after' | 'speak_prompt' | 'read_aloud' | 'speak_roleplay' | 'speak_retell'
>;

/** docs/06 §4.3: every speaking task is explicitly fluency or accuracy, and the learner sees which. */
export function speakMode(item: SpeakItem): 'fluency' | 'accuracy' {
  return item.type_id === 'repeat_after' || item.type_id === 'read_aloud' ? 'accuracy' : 'fluency';
}

/**
 * Family 7 — Speak. Record (unlimited retakes, no live meter) or type instead — the text route
 * exists on every one of the 6,657 speaking items (brief Phase 5). A recording is never scored on
 * the device. It leaves the device only to have its pronunciation checked by the server — for
 * the items with a text to say, when the server has a scorer and the learner agreed to voice
 * recording (DECISIONS §25) — and the lesson never waits for that check. A typed answer is
 * graded as text (DECISIONS F20).
 */
export function SpeakExercise({
  item,
  ctx,
  result,
  plays,
  onPlay,
  onSubmit,
}: ExerciseProps<SpeakItem>) {
  const { t } = useTranslation();
  const maxSeconds = timerSeconds(item, ctx.cefr, { timers: ctx.timers, timedMode: ctx.timedMode });
  const rec = useRecorder(maxSeconds);
  const check = usePronunciationCheck(item);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const [showStory, setShowStory] = useState(false);
  const locked = result !== null;
  // docs/09 §6: speaking that reaches its limit stops and submits what was recorded — unless the
  // learner has switched to typing, whose answer is theirs to submit.
  const { send } = check;
  const submitVoice = useCallback(() => {
    onSubmit({ kind: 'speech', modality: 'voice' });
    // after the answer, never before it: the lesson does not wait for the check
    void send(rec.uri, rec.durationMs);
  }, [onSubmit, send, rec.uri, rec.durationMs]);
  useEffect(() => {
    if (rec.stoppedByLimit && !locked && !typing) submitVoice();
  }, [rec.stoppedByLimit, locked, typing, submitVoice]);
  const typeInstead = () => {
    // The microphone never stays on behind the text field — nor does a start still in progress.
    if (rec.phase === 'recording' || rec.phase === 'starting') void rec.cancel();
    setTyping(true);
  };
  const model =
    item.type_id === 'repeat_after'
      ? itemAudio(item)
      : item.type_id === 'read_aloud'
        ? resolveAudio(null, item.prompt.text)
        : null;

  let prompt: React.ReactNode;
  switch (item.type_id) {
    case 'repeat_after':
    case 'read_aloud':
      prompt = (
        <Txt variant="learn-xl" lang="en" align="center" testID="stem">
          {item.prompt.text}
        </Txt>
      );
      break;
    case 'speak_prompt':
      prompt = (
        <Txt variant="learn-l" lang="en" testID="stem">
          {item.prompt.text}
        </Txt>
      );
      break;
    case 'speak_roleplay':
      // Content defect C13: every roleplay prompt is the unit's can-do statement, so it is shown
      // as the learner's goal rather than dressed up as a scenario.
      prompt = (
        <Card soft>
          <Txt variant="overline" color="ink-3">
            {t('unit.canDo')}
          </Txt>
          <Txt variant="learn-l" lang="en" testID="stem">
            {item.prompt.text}
          </Txt>
        </Card>
      );
      break;
    case 'speak_retell':
      prompt = (
        <View style={{ gap: 10 }}>
          <Txt variant="learn-l" lang="en" testID="stem">
            {item.prompt.text}
          </Txt>
          <TextLink icon="book" onPress={() => setShowStory((v) => !v)}>
            {showStory ? t('lesson.hideTranscript') : t('lesson.readTheStory')}
          </TextLink>
          {showStory ? <StoryScript story={ctx.unit.story} /> : null}
        </View>
      );
      break;
  }

  const micLabel =
    rec.phase === 'recording'
      ? t('speak.listening')
      : rec.phase === 'done'
        ? t('speak.recorded')
        : t('speak.tapToSpeak');

  return (
    <View style={{ gap: 20 }}>
      <Chip
        tone={speakMode(item) === 'fluency' ? 'purple' : 'blue'}
        icon={speakMode(item) === 'fluency' ? 'chat' : 'target'}
        size="sm"
      >
        {speakMode(item) === 'fluency' ? t('lesson.fluencyHelp') : t('lesson.accuracyHelp')}
      </Chip>
      {prompt}
      {model && !ctx.profile.noAudio ? (
        <AudioControl
          source={model}
          audioKey={item.id}
          cefr={ctx.cefr}
          accent={ctx.accent}
          plays={plays}
          cap={null}
          onPlay={onPlay}
          size="md"
        />
      ) : null}

      {typing || rec.phase === 'denied' || rec.phase === 'unsupported' ? (
        <View style={{ gap: 12 }}>
          {rec.phase === 'denied' ? (
            <Notice icon="mic" tone="orange" title={t('speak.permissionTitle')}>
              {t('speak.permissionBody')}
            </Notice>
          ) : null}
          {rec.phase === 'unsupported' ? (
            <Notice icon="mic" tone="orange">
              {t('speak.unsupported')}
            </Notice>
          ) : null}
          <TextField
            label={t('lesson.yourAnswer')}
            value={text}
            onChangeText={setText}
            editable={!locked}
            learn
            multiline={item.type_id === 'speak_retell' || item.type_id === 'speak_roleplay'}
            autoCapitalize="sentences"
            autoCorrect={false}
            spellCheck={false}
            testID="speak-typed"
          />
          {locked ? null : (
            <>
              <CheckButton
                disabled={isBlank(text)}
                label={t('lesson.submit')}
                onPress={() => onSubmit({ kind: 'speech', modality: 'typed', text })}
              />
              {rec.phase !== 'denied' && rec.phase !== 'unsupported' ? (
                <TextLink icon="mic" onPress={() => setTyping(false)}>
                  {t('speak.speakInstead')}
                </TextLink>
              ) : null}
            </>
          )}
        </View>
      ) : (
        <View style={{ gap: 14, alignItems: 'center' }}>
          <MicButton
            state={rec.phase === 'recording' ? 'recording' : rec.phase === 'done' ? 'done' : 'idle'}
            label={micLabel}
            disabled={locked || rec.phase === 'starting'}
            testID="mic"
            onPress={() => {
              if (rec.phase === 'recording') void rec.stop();
              else if (rec.phase === 'done') void rec.retake();
              else void rec.start();
            }}
          />
          {ctx.whisper ? (
            <Chip size="sm" icon="mic">
              {t('speak.whisperHelp')}
            </Chip>
          ) : null}
          {maxSeconds ? (
            <Txt variant="caption" color="ink-3">
              {t('speak.maxTime', { seconds: maxSeconds })}
            </Txt>
          ) : null}
          {rec.phase === 'done' && !locked ? (
            <View style={{ gap: 10, alignSelf: 'stretch' }}>
              <View
                style={{
                  flexDirection: 'row',
                  gap: 10,
                  justifyContent: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <Button
                  variant="secondary"
                  size="sm"
                  icon="speaker"
                  onPress={() => void rec.playBack()}
                >
                  {t('speak.playMine')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon="refresh"
                  onPress={() => void rec.retake()}
                >
                  {t('speak.again')}
                </Button>
              </View>
              <CheckButton
                disabled={false}
                label={t('lesson.submit')}
                onPress={submitVoice}
                testID="speak-submit"
              />
            </View>
          ) : null}
          <Txt variant="caption" color="ink-3" align="center">
            {check.enabled ? t('speak.scoredPrivacy') : t('speak.private')}
          </Txt>
          {locked ? <PronunciationCard state={check.state} /> : null}
          {locked ? null : (
            <TextLink icon="keyboard" onPress={typeInstead} testID="type-instead">
              {t('speak.typeInstead')}
            </TextLink>
          )}
        </View>
      )}
    </View>
  );
}
