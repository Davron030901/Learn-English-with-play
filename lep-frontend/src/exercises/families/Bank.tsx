import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { l1Prompt } from '@/content/l1';
import type { ItemOf } from '@/content/schemas';
import { Button, Txt, WordTile, useTheme, radius } from '@/design';

import { CheckButton, L1Prompt } from '../parts';
import { presentationOrder } from '../shuffle';
import type { ExerciseProps } from '../types';

export type BankItem = ItemOf<'word_bank_build' | 'sentence_reorder'>;

/**
 * Family 3 — Bank: ordered token assembly. Tiles are keyed by index (a bank can hold the same
 * surface twice); the answer may be a subsequence, so there is no "used every tile" rule. Tapping
 * builds the sentence in order — the linear, announceable route is the only route, so it works
 * the same with a screen reader, a switch or a finger (brief §12: build the button path first).
 */
export function BankExercise({ item, ctx, result, onSubmit }: ExerciseProps<BankItem>) {
  const theme = useTheme();
  const { t } = useTranslation();
  const bank = item.prompt.bank;
  const shown = useMemo(
    () => presentationOrder(bank.length, item.id, ctx.seed),
    [bank.length, item.id, ctx.seed],
  );
  const [chosen, setChosen] = useState<number[]>([]);
  const locked = result !== null;
  const prompt =
    item.type_id === 'word_bank_build' ? l1Prompt(item, ctx.l1, ctx.unit.lexemes) : null;

  return (
    <View style={{ gap: 20 }}>
      {/* Content defect C6: every word_bank_build prompt is empty; nothing is invented in its place. */}
      {prompt ? <L1Prompt text={prompt} l1={ctx.l1} /> : null}
      <View
        accessibilityLabel={t('lesson.yourAnswer')}
        style={{
          minHeight: 72,
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
          padding: 10,
          borderRadius: radius.md,
          borderWidth: 2,
          borderStyle: 'dashed',
          borderColor: result
            ? result.verdict === 'correct'
              ? theme.c.success
              : theme.c.danger
            : theme.c['line-2'],
        }}
        testID="bank-answer"
      >
        {chosen.length === 0 ? (
          <Txt variant="body-m" color="ink-4" style={{ padding: 8 }}>
            {t('lesson.yourAnswer')}
          </Txt>
        ) : (
          chosen.map((bankIndex, pos) => (
            <WordTile
              key={`${bankIndex}-${pos}`}
              state={result ? (result.verdict === 'correct' ? 'correct' : 'wrong') : 'selected'}
              onPress={locked ? undefined : () => setChosen((c) => c.filter((_, i) => i !== pos))}
              accessibilityLabel={`${bank[bankIndex] ?? ''}, ${t('lesson.position', { n: pos + 1, total: chosen.length })}`}
              accessibilityHint={t('lesson.undo')}
              testID={`chosen-${pos}`}
            >
              {bank[bankIndex] ?? ''}
            </WordTile>
          ))
        )}
      </View>
      <View
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}
        testID="bank-tiles"
      >
        {shown.map((bankIndex, i) => {
          const used = chosen.includes(bankIndex);
          return (
            <WordTile
              key={i}
              state={used ? 'used' : 'idle'}
              onPress={locked || used ? undefined : () => setChosen((c) => [...c, bankIndex])}
              accessibilityLabel={used ? t('lesson.selected') : (bank[bankIndex] ?? '')}
              testID={`tile-${bankIndex}`}
            >
              {bank[bankIndex] ?? ''}
            </WordTile>
          );
        })}
      </View>
      {locked ? null : (
        <View style={{ gap: 10 }}>
          {chosen.length > 0 ? (
            <Button variant="ghost" size="sm" icon="refresh" onPress={() => setChosen([])}>
              {t('lesson.clear')}
            </Button>
          ) : null}
          <CheckButton
            disabled={chosen.length === 0}
            onPress={() => onSubmit({ kind: 'tiles', indices: chosen })}
          />
        </View>
      )}
    </View>
  );
}
