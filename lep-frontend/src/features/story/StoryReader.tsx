import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolveAudio } from '@/audio/resolve';
import { play, stopAudio, usePlayingKey, type Accent } from '@/audio/speech';
import { CONTENT_L1 } from '@/content/l1';
import type { Course, Tier, Unit, UnitOutline } from '@/content/model';
import type { LexiconEntry, LexiconIndex } from '@/content/repository';
import { Button, Card, Chip, GlossCard, Notice, Txt, radius, useTheme } from '@/design';
import { StoryScript } from '@/exercises/parts';
import { sessionIdFor } from '@/runner/compose';
import { completedMap, useLearner } from '@/state/learner';
import { usePrefs } from '@/state/prefs';

/** The unit whose episode this is (story ids are `txt.00001` … `txt.00168`). */
export function unitOfStory(course: Course, textId: string): UnitOutline | null {
  for (const s of course.sections) for (const u of s.units) if (u.story?.id === textId) return u;
  return null;
}

/**
 * The lexeme a tapped word belongs to: among the matches, the one taught most recently at or
 * before this episode's unit (what the learner has met), else the earliest. No match, no gloss
 * (brief §0 rule 9: never a guessed meaning).
 */
export function pickEntry(entries: readonly LexiconEntry[], unitId: string): LexiconEntry | null {
  if (entries.length === 0) return null;
  const sorted = [...entries].sort((a, b) => a.unitId.localeCompare(b.unitId));
  const met = sorted.filter((e) => e.unitId.localeCompare(unitId) <= 0);
  return met[met.length - 1] ?? sorted[0] ?? null;
}

const TOKEN = /(\s+)/;

/**
 * Reading an episode (brief §2.3): a script — speaker, then line — with every line playable in
 * the synthetic voice, every word tappable for its meaning in the learner's language, and the
 * comprehension questions one tap away (they live in the unit's story node, N4).
 */
export function StoryReader({ unit, outline, course, lexicon }: { unit: Unit; outline: UnitOutline; course: Course; lexicon: LexiconIndex | undefined }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const playing = usePlayingKey();
  const speed = usePrefs((s) => s.speed);
  const data = useLearner((s) => s.data);
  const toggleSaved = useLearner((s) => s.toggleSavedWord);
  const l1 = data.profile?.l1 ?? CONTENT_L1;
  const accent: Accent = data.profile?.spellingVariant ?? 'us';
  const [open, setOpen] = useState<{ word: string; entry: LexiconEntry | null } | null>(null);
  const [all, setAll] = useState(false);
  const runToken = useRef(0);

  useEffect(
    () => () => {
      runToken.current += 1;
      void stopAudio();
    },
    [],
  );

  const playLine = useCallback(
    (i: number) => {
      runToken.current += 1;
      setAll(false);
      void play(`story:${i}`, resolveAudio(null, unit.story.body[i]?.text ?? ''), { rate: speed, accent });
    },
    [unit.story.body, speed, accent],
  );

  const playAll = async () => {
    const token = ++runToken.current;
    setAll(true);
    for (let i = 0; i < unit.story.body.length; i += 1) {
      if (runToken.current !== token) return;
      await play(`story:${i}`, resolveAudio(null, unit.story.body[i]?.text ?? ''), { rate: speed, accent });
    }
    if (runToken.current === token) setAll(false);
  };

  const stopAll = () => {
    runToken.current += 1;
    setAll(false);
    void stopAudio();
  };

  const storyNode = unit.nodes.find((n) => n.kind === 'story');
  const done = completedMap(data).get(storyNode?.id ?? '') ?? [];
  const questionsTier: Tier | undefined = storyNode ? (storyNode.populatedTiers.find((x) => !done.includes(x)) ?? storyNode.populatedTiers[0]) : undefined;

  const renderLine = useCallback(
    function renderLine(text: string, i: number) {
      if (!lexicon) return null;
      const narrator = unit.story.body[i]?.speaker === 'narrator';
      return (
        <Txt variant="learn-s" lang="en" style={narrator ? { fontStyle: 'italic' } : undefined}>
          {text.split(TOKEN).map((tok, k) =>
            TOKEN.test(tok) || !/[A-Za-z]/.test(tok) ? (
              tok
            ) : (
              <Txt
                key={k}
                variant="learn-s"
                lang="en"
                accessibilityRole="button"
                accessibilityHint={t('story.tapWord')}
                onPress={() => setOpen({ word: tok.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, ''), entry: pickEntry(lexicon.lookup(tok), unit.id) })}
                style={{ textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: theme.c['line-2'] }}
              >
                {tok}
              </Txt>
            ),
          )}
        </Txt>
      );
    },
    [lexicon, unit, t, theme],
  );

  const playingIndex = (() => {
    const m = playing?.match(/^story:(\d+)$/);
    return m ? Number(m[1]) : null;
  })();

  const entry = open?.entry ?? null;
  const gloss = entry ? entry.gloss[l1] || null : null;
  const taughtIn = entry ? course.unitsById.get(entry.unitId)?.index : undefined;
  const saved = entry ? data.savedWords.some((w) => w.lexemeId === entry.id) : false;

  return (
    <View style={{ gap: 18 }} testID="story">
      <View style={{ gap: 6 }}>
        <Txt variant="overline" color="ink-3">
          {`${t('story.episode', { n: outline.index })} · ${t('common.sectionUnit', { section: Number(outline.sectionId.slice(1)), unit: outline.index })}`}
        </Txt>
        <Txt variant="display-m" accessibilityRole="header">
          {unit.story.title}
        </Txt>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Chip size="sm" icon="speaker">
            {t('common.syntheticVoice')}
          </Chip>
          <Chip size="sm" tone="lagoon">
            {outline.cefr}
          </Chip>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
        {all ? (
          <Button variant="secondary" icon="pause" onPress={stopAll} testID="story-stop">
            {t('story.stop')}
          </Button>
        ) : (
          <Button variant="secondary" icon="play" onPress={() => void playAll()} testID="story-play-all">
            {t('story.playAll')}
          </Button>
        )}
      </View>
      <Txt variant="caption" color="ink-3">
        {lexicon ? t('story.tapWord') : t('common.loading')}
      </Txt>
      <Card>
        <StoryScript story={unit.story} playingIndex={playingIndex} onLine={playLine} renderText={lexicon ? renderLine : undefined} />
      </Card>
      <Txt variant="caption" color="ink-3">
        {t('common.syntheticVoiceHelp')}
      </Txt>
      {storyNode && questionsTier ? (
        <Button
          size="lg"
          block
          icon="check"
          testID="story-questions"
          onPress={() => router.push({ pathname: '/lesson/[sessionId]', params: { sessionId: sessionIdFor(storyNode.id, questionsTier) } })}
        >
          {t('story.questions')}
        </Button>
      ) : null}

      {open ? (
        <Modal transparent visible animationType={theme.reduceMotion ? 'none' : 'slide'} onRequestClose={() => setOpen(null)}>
          <Pressable accessibilityLabel={t('common.close')} onPress={() => setOpen(null)} style={{ flex: 1, backgroundColor: theme.c.scrim }} />
          <View
            accessibilityViewIsModal
            testID="gloss-sheet"
            style={{
              backgroundColor: theme.c.surface,
              borderTopStartRadius: radius.xl,
              borderTopEndRadius: radius.xl,
              padding: 20,
              paddingBottom: Math.max(insets.bottom, 20),
              gap: 12,
              width: '100%',
              maxWidth: 720,
              alignSelf: 'center',
            }}
          >
            {entry ? (
              <GlossCard
                word={entry.lemma}
                ipa={entry.ipa}
                pos={entry.pos}
                gloss={gloss ?? t('gloss.noGloss')}
                glossLang={gloss ? l1 : undefined}
                example={entry.example}
                hearLabel={t('unit.play', { text: entry.lemma })}
                onHear={() => void play(`gloss:${entry.id}`, resolveAudio(null, entry.lemma), { rate: speed, accent })}
                footer={
                  taughtIn ? (
                    <Txt variant="caption" color="ink-3">
                      {t('gloss.taughtIn', { n: taughtIn })}
                    </Txt>
                  ) : null
                }
                saveLabel={saved ? t('gloss.saved') : t('gloss.save')}
                saved={saved}
                onSave={() => toggleSaved({ lexemeId: entry.id, lemma: entry.lemma })}
              />
            ) : (
              <Notice icon="info" title={open.word}>
                {t('gloss.noGloss')}
              </Notice>
            )}
            {saved ? (
              <Txt variant="caption" color="ink-3">
                {t('gloss.savedNote')}
              </Txt>
            ) : null}
            <Button variant="secondary" block onPress={() => setOpen(null)} testID="gloss-close">
              {t('common.close')}
            </Button>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}
