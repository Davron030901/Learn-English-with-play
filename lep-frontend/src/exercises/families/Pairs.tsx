import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View, type PressableStateCallbackType } from 'react-native';

import { sfx } from '@/audio/sfx';
import { l1PairGloss } from '@/content/l1';
import type { ItemOf } from '@/content/schemas';
import { Chip, Txt, useTheme, radius } from '@/design';

import { presentationOrder } from '../shuffle';
import type { ExerciseProps } from '../types';

type PairsItem = ItemOf<'tap_pairs' | 'memory_match' | 'word_race'>;
type State = PressableStateCallbackType & { focused?: boolean };

/** "xayr (norasmiy)" → main + a smaller parenthetical that is never truncated (brief §5.2). */
function GlossText({ text, color, lang }: { text: string; color: string; lang: string }) {
  const m = text.match(/^(.*?)\s*(\(.*\))\s*$/);
  if (!m) {
    return (
      <Txt variant="body-l" weight={700} rawColor={color} lang={lang} align="center">
        {text}
      </Txt>
    );
  }
  return (
    <Txt variant="body-l" weight={700} rawColor={color} lang={lang} align="center">
      {m[1]}
      <Txt variant="body-s" weight={600} rawColor={color} lang={lang}>{` ${m[2]}`}</Txt>
    </Txt>
  );
}

function PairTile({
  label,
  children,
  state,
  onPress,
  testID,
}: {
  label: string;
  children: React.ReactNode;
  state: 'idle' | 'selected' | 'matched' | 'wrong';
  onPress?: () => void;
  testID?: string;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const fill =
    state === 'selected'
      ? theme.c['primary-soft']
      : state === 'matched'
        ? theme.c['success-soft']
        : state === 'wrong'
          ? theme.c['danger-soft']
          : theme.c.surface;
  const border =
    state === 'selected'
      ? theme.c.primary
      : state === 'matched'
        ? theme.c.success
        : state === 'wrong'
          ? theme.c.danger
          : theme.c['line-2'];
  const lip =
    state === 'selected'
      ? theme.c['primary-lip']
      : state === 'matched'
        ? theme.c['success-lip']
        : state === 'wrong'
          ? theme.c['danger-lip']
          : theme.c.edge;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress || state === 'matched'}
      accessibilityRole="button"
      accessibilityLabel={state === 'matched' ? `${label}, ${t('lesson.matched')}` : label}
      accessibilityState={{ selected: state === 'selected', disabled: state === 'matched' }}
      testID={testID}
      style={(s: State) => ({
        minHeight: 56,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: radius.md,
        borderWidth: 2,
        borderColor: border,
        backgroundColor: fill,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 4,
        opacity: state === 'matched' ? 0.6 : 1,
        boxShadow:
          [
            s.pressed || state === 'matched' ? null : theme.lip(lip, 4),
            s.focused ? theme.focusRing : null,
          ]
            .filter(Boolean)
            .join(', ') || 'none',
        transform: [{ translateY: s.pressed && !theme.reduceMotion ? 4 : 0 }],
      })}
    >
      {children}
    </Pressable>
  );
}

/**
 * Family 5 — Pairs. Keyed by pair index; the gloss side is resolved to the learner's L1.
 * tap_pairs: both columns face up · word_race: the same under its clock (the runner owns the
 * clock) · memory_match: face-down concentration — or, for a screen-reader learner (no-vision
 * profile), the face-up list, because a visual-memory game has no non-visual equivalent.
 */
export function PairsExercise({
  item,
  ctx,
  result,
  onSubmit,
  onPartial,
}: ExerciseProps<PairsItem>) {
  const theme = useTheme();
  const { t } = useTranslation();
  const n = item.prompt.pairs.length;
  const leftOrder = useMemo(
    () => presentationOrder(n, `${item.id}:L`, ctx.seed),
    [n, item.id, ctx.seed],
  );
  const rightOrder = useMemo(
    () => presentationOrder(n, `${item.id}:R`, ctx.seed),
    [n, item.id, ctx.seed],
  );
  const [selLeft, setSelLeft] = useState<number | null>(null);
  const [selRight, setSelRight] = useState<number | null>(null);
  const [matched, setMatched] = useState<[number, number][]>([]);
  const [wrong, setWrong] = useState<[number, number] | null>(null);
  const mistakes = useRef(0);
  const attempts = useRef<[number, number][]>([]);
  const matchedRef = useRef<[number, number][]>([]);
  const locked = result !== null;
  const gloss = (i: number) =>
    l1PairGloss(item, i, ctx.l1, ctx.unit.lexemes) ?? item.prompt.pairs[i]?.[1] ?? '';
  const isMatch = (l: number, r: number) =>
    item.answer.mapping[item.prompt.pairs[l]?.[0] ?? ''] === item.prompt.pairs[r]?.[1];
  const leftDone = new Set(matched.map(([l]) => l));
  const rightDone = new Set(matched.map(([, r]) => r));

  useEffect(() => {
    if (!wrong) return;
    const id = setTimeout(() => setWrong(null), 600);
    return () => clearTimeout(id);
  }, [wrong]);

  const face = item.type_id === 'memory_match' && !ctx.profile.noVision;

  // Russian glosses can collide (two lexemes, one gloss): a right-hand tile whose gloss reads the
  // same as the partner's is an equally right answer. The canonical pair is what gets recorded.
  const sameGloss = (l: number, r: number) => r !== l && gloss(r) === gloss(l) && !rightDone.has(l);

  useEffect(() => {
    if (face) return;
    onPartial?.(() =>
      matchedRef.current.length === n
        ? null
        : {
            kind: 'pairs',
            matches: matchedRef.current,
            mistakes: mistakes.current,
            complete: false,
            attempts: attempts.current,
            timedOut: true,
          },
    );
    return () => onPartial?.(null);
  }, [onPartial, n, face]);

  const attempt = (l: number, r: number) => {
    setSelLeft(null);
    setSelRight(null);
    const canonical = isMatch(l, r) ? r : sameGloss(l, r) && isMatch(l, l) ? l : null;
    attempts.current = [...attempts.current, [l, canonical ?? r]];
    if (canonical !== null) {
      sfx('pop');
      const next: [number, number][] = [...matched, [l, canonical]];
      matchedRef.current = next;
      setMatched(next);
      if (next.length === n)
        onSubmit({
          kind: 'pairs',
          matches: next,
          mistakes: mistakes.current,
          complete: true,
          attempts: attempts.current,
        });
    } else {
      mistakes.current += 1;
      setWrong([l, r]);
    }
  };

  if (face)
    return (
      <MemoryGrid
        item={item}
        ctx={ctx}
        result={result}
        onSubmit={onSubmit}
        onPartial={onPartial}
        gloss={gloss}
        isMatch={isMatch}
      />
    );

  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Chip size="sm" icon="check">
          {t('lesson.found', { count: matched.length, total: n })}
        </Chip>
        <View accessibilityLiveRegion="polite">
          {wrong ? (
            <Txt variant="body-s" weight={800} color="danger-ink">
              {t('lesson.notAMatch')}
            </Txt>
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1, gap: 8 }} accessibilityLabel={t('lesson.pairsList')}>
          {leftOrder.map((l) => (
            <PairTile
              key={`l${l}`}
              label={item.prompt.pairs[l]?.[0] ?? ''}
              state={
                leftDone.has(l)
                  ? 'matched'
                  : wrong?.[0] === l
                    ? 'wrong'
                    : selLeft === l
                      ? 'selected'
                      : 'idle'
              }
              onPress={
                locked
                  ? undefined
                  : () =>
                      selRight !== null
                        ? attempt(l, selRight)
                        : setSelLeft(l === selLeft ? null : l)
              }
              testID={`left-${l}`}
            >
              <Txt variant="learn-m" lang="en" align="center">
                {item.prompt.pairs[l]?.[0] ?? ''}
              </Txt>
            </PairTile>
          ))}
        </View>
        <View style={{ flex: 1, gap: 8 }}>
          {rightOrder.map((r) => (
            <PairTile
              key={`r${r}`}
              label={gloss(r)}
              state={
                rightDone.has(r)
                  ? 'matched'
                  : wrong?.[1] === r
                    ? 'wrong'
                    : selRight === r
                      ? 'selected'
                      : 'idle'
              }
              onPress={
                locked
                  ? undefined
                  : () =>
                      selLeft !== null
                        ? attempt(selLeft, r)
                        : setSelRight(r === selRight ? null : r)
              }
              testID={`right-${r}`}
            >
              <GlossText text={gloss(r)} color={theme.c.ink} lang={ctx.l1} />
            </PairTile>
          ))}
        </View>
      </View>
    </View>
  );
}

function MemoryGrid({
  item,
  ctx,
  result,
  onSubmit,
  onPartial,
  gloss,
  isMatch,
}: Pick<ExerciseProps<PairsItem>, 'item' | 'ctx' | 'result' | 'onSubmit' | 'onPartial'> & {
  gloss: (i: number) => string;
  isMatch: (l: number, r: number) => boolean;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const n = item.prompt.pairs.length;
  // 2n cards: pair i contributes an English card (side 0) and a gloss card (side 1).
  const cards = useMemo(
    () =>
      presentationOrder(2 * n, `${item.id}:M`, ctx.seed).map((k) => ({
        pair: k % n,
        side: k < n ? 0 : 1,
      })),
    [n, item.id, ctx.seed],
  );
  const [open, setOpen] = useState<number[]>([]);
  const [matched, setMatched] = useState<[number, number][]>([]);
  const mistakes = useRef(0);
  const matchedRef = useRef<[number, number][]>([]);
  useEffect(() => {
    onPartial?.(() =>
      matchedRef.current.length === n
        ? null
        : {
            kind: 'pairs',
            matches: matchedRef.current,
            mistakes: mistakes.current,
            complete: false,
            timedOut: true,
          },
    );
    return () => onPartial?.(null);
  }, [onPartial, n]);
  const doneCards = new Set<number>();
  matched.forEach(([l, r]) => {
    cards.forEach((c, i) => {
      if ((c.side === 0 && c.pair === l) || (c.side === 1 && c.pair === r)) doneCards.add(i);
    });
  });

  // A wrong pair stays face up for a moment, then turns back over.
  useEffect(() => {
    if (open.length !== 2) return;
    const id = setTimeout(() => setOpen([]), 900);
    return () => clearTimeout(id);
  }, [open]);

  const flip = (i: number) => {
    if (open.length === 0) {
      setOpen([i]);
      return;
    }
    const a = open[0] as number;
    const ca = cards[a];
    const cb = cards[i];
    if (ca && cb && ca.side !== cb.side) {
      const [l, r] = ca.side === 0 ? [ca.pair, cb.pair] : [cb.pair, ca.pair];
      if (isMatch(l, r)) {
        sfx('pop');
        const next: [number, number][] = [...matched, [l, r]];
        matchedRef.current = next;
        setMatched(next);
        setOpen([]);
        if (next.length === n)
          onSubmit({ kind: 'pairs', matches: next, mistakes: mistakes.current, complete: true });
        return;
      }
    }
    mistakes.current += 1;
    setOpen([a, i]);
  };

  return (
    <View style={{ gap: 12 }}>
      <Chip size="sm" icon="check">
        {t('lesson.found', { count: matched.length, total: n })}
      </Chip>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
        {cards.map((c, i) => {
          const visible = open.includes(i) || doneCards.has(i) || result !== null;
          const text = c.side === 0 ? (item.prompt.pairs[c.pair]?.[0] ?? '') : gloss(c.pair);
          return (
            <View key={i} style={{ width: '30%', minWidth: 96, flexGrow: 1 }}>
              <PairTile
                label={
                  visible
                    ? t('lesson.cardShown', { n: i + 1, text })
                    : t('lesson.cardHidden', { n: i + 1 })
                }
                state={doneCards.has(i) ? 'matched' : open.includes(i) ? 'selected' : 'idle'}
                onPress={result !== null || visible || open.length >= 2 ? undefined : () => flip(i)}
                testID={`card-${i}`}
              >
                {visible ? (
                  c.side === 0 ? (
                    <Txt variant="learn-m" lang="en" align="center">
                      {text}
                    </Txt>
                  ) : (
                    <GlossText text={text} color={theme.c.ink} lang={ctx.l1} />
                  )
                ) : (
                  <Txt variant="title-m" color="ink-4">
                    ?
                  </Txt>
                )}
              </PairTile>
            </View>
          );
        })}
      </View>
    </View>
  );
}
