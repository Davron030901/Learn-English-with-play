import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import {
  serverHasWriting,
  useAppeal,
  useSubmitWriting,
  useWritingTasks,
} from '@/api/queries/assessment';
import type { CefrBand } from '@/api/queries/gamification';
import type { ScoreOut, SubmissionOut, WritingTaskOut } from '@/api/types';
import {
  Button,
  Card,
  Chip,
  LevelBadge,
  Notice,
  Screen,
  ScreenHeader,
  SectionTitle,
  TextField,
  Txt,
} from '@/design';
import { ProblemNotice, asProblem } from '@/features/errors';

/** What the server counts: words separated by spaces (it accepts five or more). */
export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const SERVER_MIN_WORDS = 5;

/**
 * Writing for a level (docs/12 §5): one of the two halves of the production condition of the
 * level award. A task gives a prompt and a word range; the server rates the text once, on five
 * criteria, each with the learner's own sentences that justify its band — or keeps it until a
 * rater is available. A machine score from a rater that is not yet calibrated is practice
 * feedback and says so; a score near the level's band is checked by a person; any score may be
 * appealed once, to a person who does not see it.
 */
export function WritingTasks({ level, onDone }: { level: CefrBand; onDone: () => void }) {
  const { t } = useTranslation();
  const tasks = useWritingTasks(level);
  const [task, setTask] = useState<WritingTaskOut | null>(null);
  if (task) return <WritingEditor task={task} onBack={() => setTask(null)} onDone={onDone} />;

  const header = (
    <ScreenHeader
      title={t('writing.title', { level })}
      onBack={onDone}
      backLabel={t('common.back')}
    />
  );
  return (
    <Screen header={header} testID="writing-tasks">
      <View style={{ alignItems: 'center', gap: 10 }}>
        <LevelBadge level={level} />
        <Txt variant="body-l" color="ink-2" align="center">
          {t('writing.intro', { level })}
        </Txt>
      </View>
      {!serverHasWriting ? (
        <Notice icon="info">{t('writing.unavailable')}</Notice>
      ) : tasks.error ? (
        <ProblemNotice problem={asProblem(tasks.error)} onRetry={() => void tasks.refetch()} />
      ) : !tasks.data ? (
        <Txt color="ink-3">{t('common.loading')}</Txt>
      ) : tasks.data.length === 0 ? (
        <Notice icon="info">{t('writing.none', { level })}</Notice>
      ) : (
        tasks.data.map((task) => (
          <Card key={task.id}>
            <Txt variant="learn-m" lang="en">
              {task.prompt}
            </Txt>
            <Txt variant="caption" color="ink-3">
              {t('writing.range', { min: task.min_words, max: task.max_words })}
            </Txt>
            <Button icon="pencil" onPress={() => setTask(task)} testID={`writing-task-${task.id}`}>
              {t('writing.write')}
            </Button>
          </Card>
        ))
      )}
    </Screen>
  );
}

function WritingEditor({
  task,
  onBack,
  onDone,
}: {
  task: WritingTaskOut;
  onBack: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const submit = useSubmitWriting();
  const count = wordCount(text);
  const header = (
    <ScreenHeader
      title={t('writing.title', { level: task.level })}
      onBack={submit.data ? onDone : onBack}
      backLabel={t('common.back')}
    />
  );

  if (submit.data) {
    return (
      <Screen header={header} testID="writing-result">
        <SubmissionView submission={submit.data} level={task.level} />
        <Button block onPress={onDone} testID="writing-done">
          {t('common.done')}
        </Button>
      </Screen>
    );
  }

  return (
    <Screen header={header} testID="writing-editor">
      <Card>
        <SectionTitle>{t('writing.task')}</SectionTitle>
        <Txt variant="learn-m" lang="en">
          {task.prompt}
        </Txt>
      </Card>
      <TextField
        label={t('writing.yourText')}
        value={text}
        onChangeText={setText}
        multiline
        learn
        autoCapitalize="sentences"
        autoCorrect={false}
        maxLength={6000}
        testID="writing-text"
      />
      <Txt
        variant="body-s"
        color={
          count > 0 && (count < task.min_words || count > task.max_words) ? 'orange-ink' : 'ink-3'
        }
        accessibilityLiveRegion="polite"
        testID="writing-count"
      >
        {t('writing.count', { count, min: task.min_words, max: task.max_words })}
      </Txt>
      {count > task.max_words ? (
        <Notice icon="info">{t('writing.tooLong', { max: task.max_words })}</Notice>
      ) : null}
      {submit.error ? <ProblemNotice problem={asProblem(submit.error)} /> : null}
      <Button
        block
        icon="arrow-right"
        busy={submit.isPending}
        disabled={count < SERVER_MIN_WORDS}
        onPress={() => submit.mutate({ taskId: task.id, text: text.trim() })}
        testID="writing-submit"
      >
        {t('writing.submit')}
      </Button>
      <Txt variant="caption" color="ink-3">
        {t('writing.once')}
      </Txt>
    </Screen>
  );
}

function SubmissionView({ submission, level }: { submission: SubmissionOut; level: string }) {
  const { t } = useTranslation();
  if (submission.status !== 'scored' || !submission.score) {
    return (
      <View testID="writing-awaiting">
        <Notice icon="check" title={t('writing.savedTitle')}>
          {t('writing.awaiting', { level })}
        </Notice>
      </View>
    );
  }
  return <ScoreView score={submission.score} level={level} />;
}

function ScoreView({ score, level }: { score: ScoreOut; level: string }) {
  const { t } = useTranslation();
  const appeal = useAppeal();
  const [reason, setReason] = useState('');
  const [appealing, setAppealing] = useState(false);
  return (
    <>
      <Card>
        <SectionTitle>{t('writing.scoreTitle')}</SectionTitle>
        <Txt variant="display-m" testID="writing-overall">
          {t('writing.band', { band: score.overall })}
        </Txt>
        <Txt variant="body-s" color="ink-2">
          {t('writing.bandNote', { level, need: bandFor(level) })}
        </Txt>
      </Card>
      {!score.certifying ? (
        <View testID="writing-formative">
          <Notice icon="info" tone="orange">
            {t('writing.formative')}
          </Notice>
        </View>
      ) : null}
      {score.borderline ? <Notice icon="info">{t('writing.borderline')}</Notice> : null}
      <Card>
        {score.criteria.map((c) => (
          <View key={c.criterion} style={{ gap: 4 }} testID={`writing-criterion-${c.criterion}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Txt variant="body-m" weight={800} style={{ flex: 1 }}>
                {t(`writing.criterion.${c.criterion}`, { defaultValue: c.criterion })}
              </Txt>
              <Chip size="sm">{t('writing.band', { band: c.band })}</Chip>
            </View>
            {c.evidence.map((quote, i) => (
              <Txt key={i} variant="body-s" color="ink-2" lang="en">
                {`“${quote}”`}
              </Txt>
            ))}
          </View>
        ))}
      </Card>
      {appeal.data ? (
        <View testID="writing-appealed">
          <Notice icon="check">{t('writing.appealed')}</Notice>
        </View>
      ) : appealing ? (
        <Card>
          <TextField
            label={t('writing.appealReason')}
            value={reason}
            onChangeText={setReason}
            multiline
            maxLength={2000}
            testID="writing-appeal-reason"
          />
          {appeal.error ? <ProblemNotice problem={asProblem(appeal.error)} /> : null}
          <Button
            busy={appeal.isPending}
            disabled={!reason.trim()}
            onPress={() => appeal.mutate({ scoreId: score.id, reason: reason.trim() })}
            testID="writing-appeal-send"
          >
            {t('writing.appealSend')}
          </Button>
        </Card>
      ) : (
        <Button
          variant="ghost"
          icon="flag"
          onPress={() => setAppealing(true)}
          testID="writing-appeal"
        >
          {t('writing.appeal')}
        </Button>
      )}
    </>
  );
}

/** docs/12 §5.1: band n is the nth CEFR level. */
function bandFor(level: string): number {
  return ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].indexOf(level.slice(0, 2)) + 1;
}
