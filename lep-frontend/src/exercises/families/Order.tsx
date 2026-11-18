import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { playsCap, transcriptMode, transcriptVisible } from '@/audio/policy';
import { itemAudio } from '@/audio/resolve';
import type { ItemOf } from '@/content/schemas';
import { IconButton, Txt, useTheme, radius, TextLink } from '@/design';

import { AudioControl, CheckButton, StoryScript } from '../parts';
import { presentationOrder } from '../shuffle';
import type { ExerciseProps } from '../types';

type OrderItem = ItemOf<'listen_order_events'>;

/**
 * Family 4 — Order. Exact sequence equality. "Move up" / "Move down" buttons are the accessible
 * route and the only one; nothing depends on dragging (brief §5.2, §12). The options are always
 * shuffled: one of the 186 is stored already in the keyed order.
 */
export function OrderExercise({
  item,
  ctx,
  result,
  plays,
  onPlay,
  onSubmit,
}: ExerciseProps<OrderItem>) {
  const theme = useTheme();
  const { t } = useTranslation();
  const initial = useMemo(
    () => presentationOrder(item.prompt.options.length, item.id, ctx.seed),
    [item.id, item.prompt.options.length, ctx.seed],
  );
  const [order, setOrder] = useState<number[]>(initial);
  const [asked, setAsked] = useState(false);
  const locked = result !== null;
  const audio = itemAudio(item);
  const tMode = transcriptMode(item, ctx.cefr, ctx.profile.noAudio);
  const showTranscript = transcriptVisible(tMode, plays, asked, locked);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return;
    setOrder((o) => {
      const next = [...o];
      const [x] = next.splice(from, 1);
      if (x !== undefined) next.splice(to, 0, x);
      return next;
    });
  };

  return (
    <View style={{ gap: 20 }}>
      {audio && !ctx.profile.noAudio ? (
        <AudioControl
          source={audio}
          audioKey={item.id}
          cefr={ctx.cefr}
          accent={ctx.accent}
          plays={plays}
          cap={playsCap(item, ctx.cefr)}
          onPlay={onPlay}
        />
      ) : null}
      {showTranscript ? (
        <StoryScript story={ctx.unit.story} />
      ) : tMode === 'on_demand' ||
        ((tMode === 'after_1' || tMode === 'after_2') && plays >= (tMode === 'after_1' ? 1 : 2)) ? (
        <TextLink icon="eye" onPress={() => setAsked(true)}>
          {t('lesson.showTranscript')}
        </TextLink>
      ) : null}
      <View style={{ gap: 10 }} testID="order-list">
        {order.map((canonical, pos) => {
          const ok = result?.elements?.[pos];
          const border = result ? (ok ? theme.c.success : theme.c.danger) : theme.c['line-2'];
          return (
            <View
              key={canonical}
              accessible
              accessibilityLabel={`${t('lesson.position', { n: pos + 1, total: order.length })}: ${item.prompt.options[canonical] ?? ''}`}
              // A grouped row hides its buttons from VoiceOver: the moves are offered as actions
              // (rotor on iOS, the actions menu on Android) as well as the visible buttons.
              accessibilityActions={
                locked
                  ? undefined
                  : [
                      ...(pos > 0 ? [{ name: 'moveUp', label: t('lesson.moveUp') }] : []),
                      ...(pos < order.length - 1
                        ? [{ name: 'moveDown', label: t('lesson.moveDown') }]
                        : []),
                    ]
              }
              onAccessibilityAction={(e) => {
                if (e.nativeEvent.actionName === 'moveUp') move(pos, pos - 1);
                if (e.nativeEvent.actionName === 'moveDown') move(pos, pos + 1);
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                padding: 8,
                paddingStart: 14,
                borderRadius: radius.md,
                borderWidth: 2,
                borderColor: border,
                backgroundColor: theme.c.surface,
              }}
            >
              <Txt variant="caption" weight={900} color="ink-3" style={{ width: 20 }}>
                {String(pos + 1)}
              </Txt>
              <Txt variant="learn-s" lang="en" style={{ flex: 1 }}>
                {item.prompt.options[canonical] ?? ''}
              </Txt>
              {locked ? null : (
                <View style={{ flexDirection: 'row' }}>
                  <IconButton
                    icon="chevron-down"
                    label={`${t('lesson.moveDown')}: ${item.prompt.options[canonical] ?? ''}`}
                    onPress={() => move(pos, pos + 1)}
                    disabled={pos === order.length - 1}
                  />
                  <IconButton
                    icon="chevron-down"
                    rotate="180deg"
                    label={`${t('lesson.moveUp')}: ${item.prompt.options[canonical] ?? ''}`}
                    onPress={() => move(pos, pos - 1)}
                    disabled={pos === 0}
                  />
                </View>
              )}
            </View>
          );
        })}
      </View>
      {locked ? null : (
        <CheckButton disabled={false} onPress={() => onSubmit({ kind: 'order', indices: order })} />
      )}
    </View>
  );
}
