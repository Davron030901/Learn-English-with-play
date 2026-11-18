import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Modal, Platform, ScrollView, View } from 'react-native';

import type { Unit } from '@/content/model';
import type { Item } from '@/content/schemas';
import { Button, FeedbackSheet, Txt, useTheme, radius, type FeedbackTone } from '@/design';
import { speakMode } from '@/exercises/families/Speak';
import type { FeedbackContent } from '@/grading/feedback';
import type { GradeResult } from '@/grading/grade';

/**
 * The feedback sheet for one answer (brief §5.5), with the correction policy of docs/07 §6.2:
 * accuracy work gets the right form and one line of why; fluency speaking gets no correction —
 * only "you said it" and one way a speaker might put it. No celebration is reachable from here.
 */
export function FeedbackPanel({
  item,
  unit,
  result,
  content,
  l1,
  onContinue,
  onDispute,
}: {
  item: Item;
  unit: Unit;
  result: GradeResult;
  content: FeedbackContent;
  l1: string;
  onContinue: () => void;
  onDispute: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [disputed, setDisputed] = useState<string | null>(null);
  const [note, setNote] = useState(false);

  const fluency = (item.type_id === 'speak_prompt' || item.type_id === 'speak_roleplay' || item.type_id === 'speak_retell') && speakMode(item) === 'fluency';
  let tone: FeedbackTone = result.verdict === 'correct' ? 'correct' : result.verdict === 'incorrect' ? 'incorrect' : 'neutral';
  let title: string;
  let answerLabel: string | undefined;
  let answer = content.expected;
  let why = content.why;
  if (result.verdict === 'correct') {
    title = t('feedback.correct');
  } else if (result.verdict === 'incorrect' && result.elements && (item.type_id === 'tap_pairs' || item.type_id === 'memory_match' || item.type_id === 'word_race')) {
    // A pairs game: say what was matched, never "here's the answer" with nothing under it.
    const matched = result.elements.filter(Boolean).length;
    title = content.timeout ? t('feedback.pairsTimeUp', { count: matched, total: item.prompt.pairs.length }) : t('feedback.pairsMixedUp');
    why = null;
  } else if (result.verdict === 'incorrect') {
    title = content.timeout ? t('feedback.timeout') : t('feedback.incorrectWarm');
    answerLabel = t('feedback.correctAnswer');
  } else if (fluency || result.reason === 'voice') {
    tone = 'neutral';
    title = result.reason === 'voice' && !fluency ? t('feedback.voiceSaved') : t('feedback.fluencyDone');
    answerLabel = answer ? t('feedback.oneWay') : undefined;
    why = fluency ? null : why;
  } else {
    title = t('feedback.ungraded');
    why = t('feedback.ungradedBody');
    answer = null;
  }

  // VoiceOver has no live regions: on iOS the verdict is announced when the sheet appears (on
  // Android and the web the sheet's live region already speaks, so announcing would say it twice).
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AccessibilityInfo.announceForAccessibility(answer ? `${title}. ${answerLabel ?? ''} ${answer}` : title);
    // once, when the sheet appears
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const explain = content.explainRef ? (content.explainRef.kind === 'grammar' ? unit.grammar.find((g) => g.id === content.explainRef?.id) : null) : null;

  return (
    <>
      <FeedbackSheet
        testID="feedback"
        tone={tone}
        title={title}
        answerLabel={answerLabel}
        answer={answer}
        why={why}
        l1Label={t('feedback.l1Note')}
        l1Note={content.l1Note}
        extra={
          <>
            {content.diagnosis ? (
              <Txt variant="body-s" weight={800} color="ink-2">
                {t('feedback.diagnosis', { code: t(`feedback.code.${content.diagnosis}`) })}
              </Txt>
            ) : null}
            {content.typo ? (
              <Txt variant="body-s" weight={700} color="ink-2" testID="watch-spelling">
                {t('feedback.watchSpelling', { typed: content.typo.typed, expected: content.typo.expected })}
              </Txt>
            ) : null}
          </>
        }
        noteLabel={content.explainRef ? (content.explainRef.kind === 'grammar' ? t('feedback.grammarNote') : t('feedback.soundNote')) : undefined}
        onNote={content.explainRef ? () => setNote(true) : undefined}
        onDispute={() => {
          onDispute();
          setDisputed(`${t('feedback.disputeThanks')} ${t('feedback.disputeSaved')}`);
        }}
        disputed={disputed}
        actionLabel={t('feedback.continue')}
        onAction={onContinue}
      />
      {note && content.explainRef ? (
        <Modal transparent visible animationType={theme.reduceMotion ? 'none' : 'fade'} onRequestClose={() => setNote(false)}>
          <View style={{ flex: 1, backgroundColor: theme.c.scrim, justifyContent: 'flex-end' }}>
            <View style={{ maxHeight: '75%', backgroundColor: theme.c.surface, borderTopStartRadius: radius.xl, borderTopEndRadius: radius.xl, padding: 20, gap: 12, width: '100%', maxWidth: 720, alignSelf: 'center' }}>
              <ScrollView contentContainerStyle={{ gap: 10 }}>
                <Txt variant="title-l" accessibilityRole="header">
                  {content.explainRef.label}
                </Txt>
                {explain ? (
                  <>
                    <Txt variant="learn-m" lang="en">
                      {explain.form}
                    </Txt>
                    <Txt variant="body-m" color="ink-2">
                      {(l1 in explain.explanation ? explain.explanation[l1 as 'uz'] : undefined) ?? explain.explanation.en}
                    </Txt>
                    <Txt variant="learn-m" lang="en" color="success-ink">
                      {`✓ ${explain.positive_example}`}
                    </Txt>
                    <Txt variant="learn-m" lang="en" color="ink-3" style={{ textDecorationLine: 'line-through' }}>
                      {explain.negative_example}
                    </Txt>
                  </>
                ) : null}
              </ScrollView>
              <Button block onPress={() => setNote(false)}>
                {t('common.close')}
              </Button>
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}
