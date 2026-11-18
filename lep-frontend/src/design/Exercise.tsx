import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button, IconButton, Press3D, TextLink } from './Button';
import { Chip, ProgressBar } from './Bits';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';
import { tone, useTheme, type Tone } from './theme';
import { radius } from './tokens.generated';

// ---------------------------------------------------------------- WordTile
export type TileState = 'idle' | 'selected' | 'used' | 'correct' | 'wrong' | 'dim';

export function WordTile({
  children,
  state = 'idle',
  onPress,
  l1,
  size = 'md',
  accessibilityLabel,
  accessibilityHint,
  testID,
}: {
  children: string;
  state?: TileState;
  onPress?: () => void;
  l1?: boolean;
  size?: 'md' | 'lg';
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}) {
  const theme = useTheme();
  let fill = theme.c.surface;
  let border = theme.c['line-2'];
  let lip = theme.c.edge;
  let ink = theme.c.ink;
  if (state === 'selected') {
    fill = theme.c['primary-soft'];
    border = theme.c.primary;
    lip = theme.c['primary-lip'];
    ink = theme.c['primary-ink'];
  } else if (state === 'used') {
    fill = theme.c.disabled;
    border = theme.c.disabled;
    lip = theme.c.disabled;
    ink = 'transparent';
  } else if (state === 'correct') {
    fill = theme.c['success-soft'];
    border = theme.c.success;
    lip = theme.c['success-lip'];
    ink = theme.c['success-ink'];
  } else if (state === 'wrong') {
    fill = theme.c['danger-soft'];
    border = theme.c.danger;
    lip = theme.c['danger-lip'];
    ink = theme.c['danger-ink'];
  }
  return (
    <Press3D
      onPress={onPress}
      disabled={state === 'used' || !onPress}
      fill={fill}
      lipColor={lip}
      borderColor={border}
      borderRadius={radius.md}
      accessibilityLabel={accessibilityLabel ?? children}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected: state === 'selected', disabled: state === 'used' }}
      testID={testID}
      lang={l1 ? undefined : 'en'}
      style={{
        minHeight: size === 'lg' ? 60 : 50,
        paddingHorizontal: size === 'lg' ? 20 : 16,
        paddingVertical: 8,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: state === 'dim' ? 0.45 : 1,
      }}
    >
      <Txt
        variant={l1 ? 'title-s' : 'learn-m'}
        weight={l1 ? 700 : 400}
        rawColor={ink}
        lang={l1 ? undefined : 'en'}
        style={size === 'lg' ? { fontSize: 22, lineHeight: 28 } : undefined}
      >
        {children}
      </Txt>
    </Press3D>
  );
}

// ---------------------------------------------------------------- ChoiceCard
export type ChoiceState = 'idle' | 'selected' | 'correct' | 'wrong' | 'dim';

export function ChoiceCard({
  children,
  state = 'idle',
  index,
  sub,
  layout = 'row',
  font = 'learn',
  lang = 'en',
  onPress,
  accessibilityLabel,
  disabled,
  testID,
  trailing,
}: {
  children: string;
  state?: ChoiceState;
  index?: number;
  sub?: string;
  layout?: 'row' | 'tile';
  font?: 'learn' | 'ui';
  lang?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
  testID?: string;
  trailing?: ReactNode;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  let fill = theme.c.surface;
  let border = theme.c['line-2'];
  let lip = theme.c.edge;
  let ink = theme.c.ink;
  let keyFill = 'transparent';
  let keyInk = theme.c['ink-3'];
  let keyBorder = theme.c['line-2'];
  if (state === 'selected') {
    fill = theme.c['primary-soft'];
    border = theme.c.primary;
    lip = theme.c['primary-lip'];
    ink = theme.c['primary-ink'];
    keyFill = theme.c.primary;
    keyInk = theme.c['on-primary'];
    keyBorder = theme.c.primary;
  } else if (state === 'correct') {
    fill = theme.c['success-soft'];
    border = theme.c.success;
    lip = theme.c['success-lip'];
    ink = theme.c['success-ink'];
    keyFill = theme.c.success;
    keyInk = theme.c['on-success'];
    keyBorder = theme.c.success;
  } else if (state === 'wrong') {
    fill = theme.c['danger-soft'];
    border = theme.c.danger;
    lip = theme.c['danger-lip'];
    ink = theme.c['danger-ink'];
    keyFill = theme.c.danger;
    keyInk = theme.c['on-danger'];
    keyBorder = theme.c.danger;
  }
  const tile = layout === 'tile';
  const verdict = state === 'correct' ? t('feedback.correctAlt') : state === 'wrong' ? t('feedback.incorrect') : '';
  return (
    <Press3D
      onPress={onPress}
      disabled={disabled}
      fill={fill}
      lipColor={lip}
      borderColor={border}
      borderRadius={16}
      accessibilityRole="radio"
      accessibilityLabel={[accessibilityLabel ?? children, sub, verdict].filter(Boolean).join(', ')}
      accessibilityState={{ checked: state === 'selected' || state === 'correct' || state === 'wrong', disabled: !!disabled }}
      testID={testID}
      style={{
        flexDirection: tile ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: tile ? 'center' : 'flex-start',
        gap: tile ? 6 : 14,
        minHeight: tile ? 148 : 64,
        paddingVertical: tile ? 18 : 12,
        paddingHorizontal: tile ? 12 : 16,
        opacity: state === 'dim' ? 0.5 : 1,
        alignSelf: 'stretch',
      }}
    >
      {index !== undefined ? (
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            backgroundColor: keyFill,
            borderWidth: 2,
            borderColor: keyBorder,
            alignItems: 'center',
            justifyContent: 'center',
            ...(tile ? { position: 'absolute', top: 10, start: 10 } : null),
          }}
        >
          <Txt variant="caption" weight={900} rawColor={keyInk} style={{ fontSize: 14 }}>
            {String(index)}
          </Txt>
        </View>
      ) : null}
      <View style={{ flex: tile ? 0 : 1, minWidth: 0, gap: 2, alignItems: tile ? 'center' : 'flex-start' }}>
        <Txt
          variant={font === 'learn' ? 'learn-m' : 'body-l'}
          weight={font === 'learn' ? 400 : 700}
          rawColor={ink}
          lang={font === 'learn' ? lang : undefined}
          align={tile ? 'center' : undefined}
          style={tile && font === 'learn' ? { fontSize: 30, lineHeight: 38 } : font === 'learn' ? { lineHeight: 27 } : { fontSize: 17, lineHeight: 23 }}
        >
          {children}
        </Txt>
        {sub ? (
          <Txt variant="body-s" rawColor={state === 'idle' || state === 'dim' ? theme.c['ink-3'] : ink}>
            {sub}
          </Txt>
        ) : null}
      </View>
      {trailing}
      {!tile && (state === 'correct' || state === 'wrong') ? (
        <Icon name={state === 'correct' ? 'check-circle' : 'x-circle'} size={26} color={ink} />
      ) : null}
    </Press3D>
  );
}

// ---------------------------------------------------------------- AudioButton
export function AudioButton({
  onPress,
  speed = 'normal',
  size = 'lg',
  label,
  caption,
  disabled,
  playing,
  testID,
}: {
  onPress: () => void;
  speed?: 'normal' | 'slow';
  size?: 'lg' | 'md' | 'sm';
  label: string;
  caption?: string;
  disabled?: boolean;
  playing?: boolean;
  testID?: string;
}) {
  const theme = useTheme();
  const slow = speed === 'slow';
  const t = tone(theme, 'primary');
  const fill = disabled ? theme.c.disabled : slow ? theme.c.surface : t.c;
  const lip = disabled ? theme.c['line-2'] : slow ? theme.c.edge : t.lip;
  const on = disabled ? theme.c['ink-4'] : slow ? theme.c['primary-ink'] : t.on;
  const dims = size === 'lg' ? { w: 96, h: 88, r: 24, i: 42, lip: 5 } : size === 'md' ? { w: 64, h: 60, r: 18, i: 30, lip: 5 } : { w: 48, h: 44, r: 14, i: 24, lip: 4 };
  return (
    <Press3D
      onPress={onPress}
      disabled={disabled}
      fill={fill}
      lipColor={lip}
      lipHeight={dims.lip}
      borderColor={slow && !disabled ? theme.c['line-2'] : undefined}
      borderRadius={dims.r}
      accessibilityLabel={label}
      accessibilityState={{ busy: !!playing, disabled: !!disabled }}
      testID={testID}
      style={{ width: dims.w, height: dims.h, alignItems: 'center', justifyContent: 'center', gap: 4 }}
    >
      <Icon name={slow ? 'turtle' : playing ? 'wave' : 'speaker'} size={dims.i} color={on} />
      {caption ? (
        <Txt variant="caption" weight={900} rawColor={on} style={{ fontSize: 12, lineHeight: 14 }}>
          {caption}
        </Txt>
      ) : null}
    </Press3D>
  );
}

// ---------------------------------------------------------------- MicButton
export function MicButton({
  state = 'idle',
  onPress,
  label,
  size = 'lg',
  disabled,
  testID,
}: {
  state?: 'idle' | 'recording' | 'done';
  onPress: () => void;
  label: string;
  size?: 'lg' | 'md';
  disabled?: boolean;
  testID?: string;
}) {
  const theme = useTheme();
  const tn: Tone = state === 'recording' ? 'purple' : state === 'done' ? 'success' : 'primary';
  const t = tone(theme, tn);
  const d = size === 'md' ? 68 : 92;
  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      <Press3D
        onPress={onPress}
        disabled={disabled}
        fill={disabled ? theme.c.disabled : t.c}
        lipColor={disabled ? theme.c['line-2'] : t.lip}
        lipHeight={6}
        borderRadius={radius.full}
        accessibilityLabel={label}
        accessibilityState={{ checked: state === 'recording' }}
        testID={testID}
        style={{
          width: d,
          height: d,
          alignItems: 'center',
          justifyContent: 'center',
          ...(state === 'recording' ? { boxShadow: `${theme.lip(t.lip, 6)}, 0px 0px 0px 8px ${theme.c.bg}, 0px 0px 0px 14px ${theme.c['purple-soft']}` } : null),
        }}
      >
        <Icon
          name={state === 'recording' ? 'wave' : state === 'done' ? 'check' : 'mic'}
          size={size === 'md' ? 32 : 42}
          color={disabled ? theme.c['ink-4'] : t.on}
          strokeWidth={state === 'done' ? 3 : 2.2}
        />
      </Press3D>
      <Txt variant="body-s" weight={800} color="ink-3" align="center" aria-hidden>
        {label}
      </Txt>
    </View>
  );
}

// ---------------------------------------------------------------- FeedbackSheet
export type FeedbackTone = 'correct' | 'incorrect' | 'neutral';

/**
 * The bottom sheet after an answer (brief §5.5): verdict stated warmly, the right form, one line
 * of why, the L1 note, the grammar-note link, and "I think my answer was right" on every sheet.
 * It is a live region, so a screen reader announces the verdict. No celebration lives here —
 * confetti on every correct answer is banned (brief §8.4 guardrail 5).
 */
export function FeedbackSheet({
  tone: ft,
  title,
  answerLabel,
  answer,
  why,
  whyLang,
  l1Label,
  l1Note,
  extra,
  noteLabel,
  onNote,
  onDispute,
  disputed,
  actionLabel,
  onAction,
  testID,
}: {
  tone: FeedbackTone;
  title: string;
  answerLabel?: string;
  answer?: string | null;
  why?: string | null;
  whyLang?: string;
  l1Label?: string;
  l1Note?: string | null;
  extra?: ReactNode;
  noteLabel?: string;
  onNote?: () => void;
  onDispute: () => void;
  disputed?: string | null;
  actionLabel: string;
  onAction: () => void;
  testID?: string;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const tn: Tone = ft === 'correct' ? 'success' : ft === 'incorrect' ? 'danger' : 'primary';
  const c = tone(theme, tn);
  const badge: IconName = ft === 'correct' ? 'check' : ft === 'incorrect' ? 'close' : 'info';
  return (
    <View
      testID={testID}
      accessibilityLiveRegion="polite"
      role="status"
      style={{
        gap: 14,
        paddingTop: 20,
        paddingHorizontal: 20,
        paddingBottom: 24,
        backgroundColor: c.soft,
        borderTopStartRadius: radius.xl,
        borderTopEndRadius: radius.xl,
        boxShadow: theme.floatShadow,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 40, height: 40, borderRadius: radius.full, backgroundColor: c.c, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={badge} size={26} color={c.on} strokeWidth={3} />
        </View>
        <Txt variant="title-m" weight={900} rawColor={c.ink} style={{ flex: 1 }} accessibilityRole="header">
          {title}
        </Txt>
      </View>
      {answer ? (
        <View style={{ gap: 3 }}>
          {answerLabel ? (
            <Txt variant="overline" rawColor={c.ink}>
              {answerLabel}
            </Txt>
          ) : null}
          <Txt variant="learn-m" lang="en" style={{ fontSize: 21, lineHeight: 28 }}>
            {answer}
          </Txt>
        </View>
      ) : null}
      {why ? (
        <Txt variant="body-m" color="ink-2" lang={whyLang}>
          {why}
        </Txt>
      ) : null}
      {extra}
      {l1Note ? (
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: theme.c.surface, borderWidth: 2, borderColor: theme.c.line }}>
          <Icon name="globe" size={22} color={theme.c['primary-ink']} />
          <Txt variant="body-s" color="ink-2" style={{ flex: 1, fontSize: 15, lineHeight: 21 }}>
            {l1Label ? <Txt variant="body-s" weight={800}>{`${l1Label} `}</Txt> : null}
            {l1Note}
          </Txt>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, marginHorizontal: -6 }}>
        {noteLabel && onNote ? <TextLink icon="book" onPress={onNote} color={c.ink}>{noteLabel}</TextLink> : null}
        <View style={{ flex: 1 }} />
        {disputed ? null : (
          <TextLink icon="flag" onPress={onDispute} color={c.ink} testID="dispute">
            {t('feedback.dispute')}
          </TextLink>
        )}
      </View>
      {disputed ? (
        <Txt variant="body-s" color="ink-2" accessibilityLiveRegion="polite">
          {disputed}
        </Txt>
      ) : null}
      <Button variant={ft === 'incorrect' ? 'danger' : ft === 'correct' ? 'success' : 'primary'} size="lg" block onPress={onAction} testID="feedback-continue">
        {actionLabel}
      </Button>
    </View>
  );
}

// ---------------------------------------------------------------- LessonHeader
export function LessonHeader({
  progress,
  onClose,
  closeLabel,
  mode,
  tone: tn = 'primary',
  progressLabel,
}: {
  progress: number;
  onClose: () => void;
  closeLabel: string;
  mode?: 'fluency' | 'accuracy';
  tone?: Tone;
  progressLabel: string;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingStart: 8, paddingEnd: 16 }}>
      <IconButton icon="close" label={closeLabel} onPress={onClose} testID="lesson-close" />
      <ProgressBar value={progress} max={1} tone={tn} label={progressLabel} />
      {mode ? (
        <Chip tone={mode === 'fluency' ? 'purple' : 'blue'} icon={mode === 'fluency' ? 'chat' : 'target'} size="sm">
          {mode === 'fluency' ? t('lesson.fluency') : t('lesson.accuracy')}
        </Chip>
      ) : null}
    </View>
  );
}
