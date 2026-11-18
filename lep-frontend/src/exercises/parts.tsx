import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { speedsFor } from '@/audio/policy';
import type { AudioSource } from '@/audio/resolve';
import {
  hasEnglishVoice,
  play,
  usePlayingKey,
  useSyntheticFallback,
  type Accent,
} from '@/audio/speech';
import type { CefrLevel, Story } from '@/content/schemas';
import { AudioButton, Button, Chip, Notice, Txt, useTheme } from '@/design';

/**
 * Audio for an exercise: 1.0× and 0.75× always, 0.5× at A1–A2 (docs/06 §1.1); the play cap when
 * one applies, announced before the last play is used; the "Synthetic voice" marker whenever the
 * device's synthesiser speaks (brief §7.4); an honest notice when a sound cannot be produced.
 */
export function AudioControl({
  source,
  audioKey,
  cefr,
  accent,
  plays,
  cap,
  onPlay,
  size = 'lg',
  showSlow = true,
}: {
  source: AudioSource;
  audioKey: string;
  cefr: CefrLevel;
  accent: Accent;
  plays: number;
  cap: number | null;
  onPlay: () => void;
  size?: 'lg' | 'md' | 'sm';
  showSlow?: boolean;
}) {
  const { t } = useTranslation();
  const playing = usePlayingKey();
  const fellBack = useSyntheticFallback(audioKey);
  const [voiceOk, setVoiceOk] = useState(true);
  useEffect(() => {
    let alive = true;
    void hasEnglishVoice().then((ok) => alive && setVoiceOk(ok));
    return () => {
      alive = false;
    };
  }, []);
  if (source.kind === 'unavailable') {
    return (
      <Notice icon="warning" tone="orange" title={t('audio.unavailable')}>
        {t('audio.unavailableBody')}
      </Notice>
    );
  }
  const left = cap === null ? null : Math.max(0, cap - plays);
  const exhausted = left === 0;
  const speeds = showSlow ? speedsFor(cefr) : [1];
  const run = (rate: number) => {
    if (exhausted) return;
    onPlay();
    void play(`${audioKey}@${rate}`, source, { rate, accent });
  };
  const playsSuffix = left === null ? '' : t('lesson.playA11yPlays', { count: left });
  return (
    <View style={{ gap: 10, alignItems: 'center' }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: 12,
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        {speeds.map((rate) => (
          <AudioButton
            key={rate}
            size={rate === 1 ? size : 'md'}
            speed={rate === 1 ? 'normal' : 'slow'}
            caption={rate === 1 ? undefined : `${rate}×`}
            playing={playing === `${audioKey}@${rate}`}
            disabled={exhausted}
            onPress={() => run(rate)}
            label={t('lesson.playA11y', { speed: `${rate}×`, plays: playsSuffix })}
            testID={`play-${rate}`}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        {source.kind === 'tts' || fellBack ? <SyntheticVoiceChip /> : null}
        {left !== null ? (
          <Chip icon="speaker" size="sm" tone={left <= 1 ? 'orange' : undefined}>
            {left === 1 ? t('lesson.lastPlay') : t('lesson.playsLeft', { count: left })}
          </Chip>
        ) : null}
      </View>
      {!voiceOk ? (
        <Notice icon="warning" tone="orange">
          {t('audio.notOnDevice')}
        </Notice>
      ) : null}
    </View>
  );
}

/** The marker every use of the device's own voice carries (brief §7.4). */
export function SyntheticVoiceChip() {
  const { t } = useTranslation();
  return (
    <Chip icon="info" size="sm" tone="purple">
      {t('common.syntheticVoice')}
    </Chip>
  );
}

/** A story episode as a script, never a paragraph (brief §2.3): speaker, then line. */
export function StoryScript({
  story,
  onLine,
  playingIndex,
  renderText,
}: {
  story: Story;
  onLine?: (index: number) => void;
  playingIndex?: number | null;
  renderText?: (text: string, index: number) => ReactNode;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <View style={{ gap: 12 }}>
      {story.body.map((line, i) => {
        const narrator = line.speaker === 'narrator';
        return (
          <View
            key={i}
            style={{
              flexDirection: 'row',
              gap: 10,
              padding: 10,
              borderRadius: 14,
              backgroundColor: playingIndex === i ? theme.c['primary-soft'] : 'transparent',
            }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="caption" weight={900} color={narrator ? 'ink-3' : 'primary-ink'}>
                {narrator ? t('story.narrator') : line.speaker}
              </Txt>
              {renderText ? (
                renderText(line.text, i)
              ) : (
                <Txt
                  variant="learn-s"
                  lang="en"
                  style={narrator ? { fontStyle: 'italic' } : undefined}
                >
                  {line.text}
                </Txt>
              )}
            </View>
            {onLine ? (
              <AudioButton
                size="sm"
                label={`${t('story.playLine')}: ${line.text}`}
                onPress={() => onLine(i)}
                playing={playingIndex === i}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** A sentence with a gap (`___`), the gap drawn as a slot and optionally filled. */
export function GapText({
  text,
  fill,
  state,
}: {
  text: string;
  fill?: string | null;
  state?: 'idle' | 'correct' | 'wrong';
}) {
  const theme = useTheme();
  const parts = text.split(/_{2,}/);
  const colour =
    state === 'correct'
      ? theme.c['success-ink']
      : state === 'wrong'
        ? theme.c['danger-ink']
        : theme.c['primary-ink'];
  return (
    <Txt
      variant="learn-l"
      lang="en"
      accessibilityLabel={text.replace(/_{2,}/g, fill ? ` ${fill} ` : ' blank ')}
    >
      {parts.map((p, i) => (
        <Txt key={i} variant="learn-l" lang="en">
          {p}
          {i < parts.length - 1 ? (
            <Txt
              variant="learn-l"
              lang="en"
              rawColor={colour}
              style={{ textDecorationLine: 'underline', fontFamily: theme.font('learn', 700) }}
            >
              {fill ? ` ${fill} ` : '     '}
            </Txt>
          ) : null}
        </Txt>
      ))}
    </Txt>
  );
}

export function CheckButton({
  disabled,
  onPress,
  label,
  testID = 'check',
}: {
  disabled: boolean;
  onPress: () => void;
  label?: string;
  testID?: string;
}) {
  const { t } = useTranslation();
  return (
    <Button size="lg" block disabled={disabled} onPress={onPress} testID={testID}>
      {label ?? t('lesson.check')}
    </Button>
  );
}

/** A prompt in the learner's L1 (UI font, its own lang); null when no string exists in that L1. */
export function L1Prompt({ text, l1 }: { text: string | null; l1: string }) {
  if (!text) return null;
  return (
    <Txt variant="display-m" lang={l1} testID="l1-prompt">
      {text}
    </Txt>
  );
}
