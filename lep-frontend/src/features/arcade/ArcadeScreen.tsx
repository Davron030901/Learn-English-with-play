import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { resolveAudio } from '@/audio/resolve';
import { play, stopAudio } from '@/audio/speech';
import { useCourse, useUnit } from '@/content/queries';
import {
  AudioButton,
  Button,
  Card,
  Chip,
  Icon,
  LevelBadge,
  Mascot,
  Notice,
  ProgressBar,
  Screen,
  ScreenHeader,
  SectionTitle,
  TextField,
  Txt,
  useTheme,
  type IconName,
} from '@/design';
import { SyntheticVoiceChip } from '@/exercises/parts';
import { ProblemNotice, asProblem } from '@/features/errors';
import { usePrefs } from '@/state/prefs';

import { makeQuestions, normalizeAnswer, type GameMode, type GameQuestion } from './engine';

const MODES: { id: GameMode; icon: IconName }[] = [
  { id: 'meaning', icon: 'cards' },
  { id: 'spelling', icon: 'pencil' },
  { id: 'listening', icon: 'speaker' },
];

export default function ArcadeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const course = useCourse();
  const [section, setSection] = useState(0);
  const [unitId, setUnitId] = useState<string | undefined>();
  const units = course.data?.sections[section]?.units ?? [];
  const selectedId = unitId ?? units[0]?.id;
  const unit = useUnit(selectedId);
  const [language, setLanguage] = useState<'uz' | 'ru'>('uz');
  const [mode, setMode] = useState<GameMode>('meaning');
  const [questions, setQuestions] = useState<GameQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [checked, setChecked] = useState(false);
  const [results, setResults] = useState<boolean[]>([]);
  const [active, setActive] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const submitted = useRef(false);
  const speed = usePrefs((s) => s.speed);
  const noAudio = usePrefs((s) => s.noAudio);
  const question = questions[index];
  const finished = active && index >= questions.length;
  const correct = !!question && normalizeAnswer(answer) === normalizeAnswer(question.answer);
  const hits = results.filter(Boolean).length;

  useEffect(
    () => () => {
      void stopAudio();
    },
    [],
  );

  function begin(next: GameQuestion[]) {
    setEmpty(next.length === 0);
    if (!next.length) return;
    setQuestions(next);
    setIndex(0);
    setAnswer('');
    setChecked(false);
    setResults([]);
    setRevealed(false);
    setActive(true);
    submitted.current = false;
  }

  function check(value = answer) {
    if (submitted.current || !question || !value.trim()) return;
    submitted.current = true;
    setAnswer(value);
    setChecked(true);
    setResults((previous) => [
      ...previous,
      !revealed && normalizeAnswer(value) === normalizeAnswer(question.answer),
    ]);
  }

  function next() {
    void stopAudio();
    setIndex((value) => value + 1);
    setAnswer('');
    setChecked(false);
    setRevealed(false);
    submitted.current = false;
  }

  const leave = () => {
    void stopAudio();
    if (active) {
      setActive(false);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <Screen
      key={active ? `round-${index}` : 'choose'}
      background="bg-soft"
      testID="arcade"
      header={
        <ScreenHeader title={t('arcade.title')} backLabel={t('common.back')} onBack={leave} />
      }
      footer={
        !active ? (
          <View style={{ gap: 8, paddingTop: 12 }}>
            <Txt variant="caption" align="center" color="ink-2">
              {unit.data?.title.en ?? t('common.loading')}
            </Txt>
            <Button
              size="lg"
              icon="play"
              block
              testID="arcade-start"
              busy={unit.isFetching}
              disabled={!unit.data || unit.isFetching || (mode === 'listening' && noAudio)}
              onPress={() => {
                if (unit.data) begin(makeQuestions(unit.data.lexemes, language, mode));
              }}
            >
              {t('arcade.start')}
            </Button>
          </View>
        ) : undefined
      }
    >
      {!active ? (
        <>
          <Card
            style={{
              backgroundColor: theme.c['primary-soft'],
              borderColor: theme.c['primary-soft'],
              padding: 24,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <View style={{ flex: 1, gap: 10 }}>
                <Chip tone="primary">{t('arcade.eyebrow')}</Chip>
                <Txt variant="display-m">{t('arcade.hero')}</Txt>
                <Txt color="ink-2">{t('arcade.subtitle')}</Txt>
              </View>
              <Mascot pose="cheer" size={88} />
            </View>
          </Card>
          <SectionTitle overline={t('arcade.stepOne')}>{t('arcade.chooseGame')}</SectionTitle>
          <View style={{ gap: 12 }}>
            {MODES.map((game) => (
              <Card
                key={game.id}
                style={{ borderColor: mode === game.id ? theme.c.primary : theme.c.line }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <Icon name={game.icon} color={theme.c['primary-ink']} size={30} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Txt variant="title-s">{t(`arcade.${game.id}`)}</Txt>
                    <Txt variant="body-s" color="ink-2">
                      {t(`arcade.${game.id}Sub`)}
                    </Txt>
                  </View>
                </View>
                <Button
                  variant={mode === game.id ? 'primary' : 'secondary'}
                  disabled={game.id === 'listening' && noAudio}
                  onPress={() => setMode(game.id)}
                  testID={`mode-${game.id}`}
                >
                  {t(mode === game.id ? 'arcade.selected' : 'arcade.select')}
                </Button>
              </Card>
            ))}
          </View>
          {noAudio ? <Notice icon="info">{t('arcade.audioOff')}</Notice> : null}
          <SectionTitle overline={t('arcade.stepTwo')}>{t('arcade.chooseTopic')}</SectionTitle>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {course.data?.sections.map((level, i) => (
              <Button
                key={level.id}
                variant={section === i ? 'primary' : 'secondary'}
                onPress={() => {
                  setSection(i);
                  setUnitId(undefined);
                  setEmpty(false);
                }}
              >
                {level.cefr}
              </Button>
            ))}
          </View>
          {course.isError ? (
            <ProblemNotice
              problem={asProblem(course.error)}
              onRetry={() => void course.refetch()}
            />
          ) : null}
          {course.isPending ? <Txt>{t('common.loading')}</Txt> : null}
          <View style={{ gap: 8 }}>
            {units.map((item) => (
              <Button
                key={item.id}
                variant={selectedId === item.id ? 'primary' : 'secondary'}
                onPress={() => {
                  setUnitId(item.id);
                  setEmpty(false);
                }}
              >{`${item.index}. ${item.title.en}`}</Button>
            ))}
          </View>
          <SectionTitle>{t('arcade.translation')}</SectionTitle>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Button
              variant={language === 'uz' ? 'primary' : 'secondary'}
              onPress={() => setLanguage('uz')}
            >
              O‘zbekcha
            </Button>
            <Button
              variant={language === 'ru' ? 'primary' : 'secondary'}
              onPress={() => setLanguage('ru')}
            >
              Русский
            </Button>
          </View>
          {unit.isError ? (
            <ProblemNotice problem={asProblem(unit.error)} onRetry={() => void unit.refetch()} />
          ) : null}
          {empty ? <Notice icon="info">{t('arcade.empty')}</Notice> : null}
          <Txt variant="caption" color="ink-3">
            {t('arcade.note')}
          </Txt>
        </>
      ) : finished ? (
        <>
          <View style={{ alignItems: 'center', gap: 16, paddingVertical: 24 }}>
            <Mascot pose="cheer" size={130} />
            <Chip tone="primary">{t('arcade.complete')}</Chip>
            <Txt variant="display-m" align="center">
              {t('arcade.result', { correct: hits, total: questions.length })}
            </Txt>
            <Txt align="center" color="ink-2">
              {t('arcade.resultNote')}
            </Txt>
          </View>
          {questions.some((_, i) => !results[i]) ? (
            <>
              <SectionTitle>{t('arcade.review')}</SectionTitle>
              {questions
                .filter((_, i) => !results[i])
                .map((item) => (
                  <Card key={item.word.id}>
                    <Txt variant="learn-m">{item.word.lemma}</Txt>
                    <Txt color="ink-2">{item.clue}</Txt>
                    {item.word.examples[0] ? (
                      <Txt variant="body-s">{item.word.examples[0]}</Txt>
                    ) : null}
                  </Card>
                ))}
              <Button block onPress={() => begin(questions.filter((_, i) => !results[i]))}>
                {t('arcade.retryMistakes')}
              </Button>
            </>
          ) : null}
          <Button block variant="secondary" onPress={() => setActive(false)}>
            {t('arcade.playAgain')}
          </Button>
        </>
      ) : question ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <ProgressBar
              value={index}
              max={questions.length}
              label={t('arcade.round', { current: index + 1, total: questions.length })}
            />
            <Chip>{`${index + 1} / ${questions.length}`}</Chip>
            {unit.data ? <LevelBadge level={unit.data.cefr} size="sm" /> : null}
          </View>
          <Txt variant="title-m">{t(`arcade.${mode}Prompt`)}</Txt>
          <Card style={{ padding: 28, alignItems: 'center', gap: 20 }}>
            {mode !== 'listening' || revealed || checked ? (
              <Txt variant="display-m" align="center" lang={mode === 'spelling' ? language : 'en'}>
                {mode === 'spelling' ? question.clue : question.word.lemma}
              </Txt>
            ) : (
              <Icon name="speaker" size={64} color={theme.c.primary} />
            )}
            {!noAudio && mode !== 'spelling' ? (
              <>
                <AudioButton
                  label={t('arcade.listen')}
                  onPress={() =>
                    void play(
                      `arcade:${question.word.id}`,
                      resolveAudio(null, question.word.lemma),
                      { rate: speed, accent: 'us' },
                    )
                  }
                />
                <SyntheticVoiceChip />
              </>
            ) : null}
            {mode === 'listening' && !checked && !revealed ? (
              <Button variant="secondary" onPress={() => setRevealed(true)}>
                {t('arcade.reveal')}
              </Button>
            ) : null}
          </Card>
          {mode === 'spelling' ? (
            <>
              <TextField
                label={t('arcade.typeAnswer')}
                learn
                value={answer}
                onChangeText={setAnswer}
                editable={!checked}
                autoCorrect={false}
                autoCapitalize="none"
                onSubmitEditing={() => check()}
                testID="arcade-answer"
              />
              {!checked ? (
                <Button disabled={!answer.trim()} block onPress={() => check()}>
                  {t('arcade.check')}
                </Button>
              ) : null}
            </>
          ) : (
            <View style={{ gap: 12 }}>
              {question.options.map((option, i) => (
                <Button
                  key={option}
                  block
                  variant={checked && option === question.answer ? 'primary' : 'secondary'}
                  disabled={checked}
                  onPress={() => check(option)}
                  testID={`arcade-choice-${i}`}
                >
                  {option}
                </Button>
              ))}
            </View>
          )}
          {checked ? (
            <Card style={{ backgroundColor: theme.c[correct ? 'success-soft' : 'danger-soft'] }}>
              <View accessibilityLiveRegion="polite">
                <Txt variant="title-s">
                  {t(
                    correct
                      ? revealed
                        ? 'arcade.withHint'
                        : 'arcade.correct'
                      : 'arcade.incorrect',
                  )}
                </Txt>
                <Txt variant="learn-m">{question.word.lemma}</Txt>
                <Txt>{question.clue}</Txt>
              </View>
              {question.word.examples[0] ? (
                <Txt variant="body-s" color="ink-2">
                  {question.word.examples[0]}
                </Txt>
              ) : null}
              <Button block onPress={next} testID="arcade-next">
                {t(index === questions.length - 1 ? 'arcade.finish' : 'common.continue')}
              </Button>
            </Card>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
