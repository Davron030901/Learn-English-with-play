import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { ItemOf } from '@/content/schemas';
import { Icon, Segmented, Txt, useTheme } from '@/design';

import { CheckButton } from '../parts';
import type { ExerciseProps } from '../types';

type BinsItem = ItemOf<'sort_bins'>;

/**
 * Family 6 — Bins. Every word must land in a bin before submitting. The accessible route is the
 * primary one: a segmented control per word (brief §5.2), never drag-only.
 */
export function BinsExercise({ item, result, onSubmit }: ExerciseProps<BinsItem>) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [assignment, setAssignment] = useState<Record<number, number>>({});
  const locked = result !== null;
  const complete = item.prompt.options.every((_, i) => assignment[i] !== undefined);
  return (
    <View style={{ gap: 16 }}>
      {item.prompt.options.map((word, i) => {
        const ok = result?.elements?.[i];
        return (
          <View key={i} style={{ gap: 6 }} testID={`bin-row-${i}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Txt variant="learn-m" lang="en" style={{ flex: 1 }}>
                {word}
              </Txt>
              {result ? (
                <Icon
                  name={ok ? 'check-circle' : 'x-circle'}
                  size={24}
                  color={ok ? theme.c['success-ink'] : theme.c['danger-ink']}
                  title={ok ? t('feedback.correctAlt') : t('feedback.incorrect')}
                />
              ) : null}
            </View>
            <Segmented
              label={t('lesson.chooseBin', { word })}
              showLabel={false}
              value={assignment[i] ?? -1}
              onChange={(b) => {
                if (!locked) setAssignment((a) => ({ ...a, [i]: b }));
              }}
              options={item.prompt.bins.map((bin, b) => ({ value: b, label: bin }))}
            />
          </View>
        );
      })}
      {locked ? null : (
        <CheckButton disabled={!complete} onPress={() => onSubmit({ kind: 'bins', assignment })} />
      )}
    </View>
  );
}
