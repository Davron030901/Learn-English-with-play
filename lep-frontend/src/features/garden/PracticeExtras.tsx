import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { resolveAudio } from '@/audio/resolve';
import { play, type Accent } from '@/audio/speech';
import { CONTENT_L1 } from '@/content/l1';
import type { Tier } from '@/content/model';
import { content, useLexicon } from '@/content/queries';
import { AudioButton, Button, Card, Mascot, Notice, SectionTitle, TextLink, Txt, useTheme } from '@/design';
import { SyntheticVoiceChip } from '@/exercises/parts';
import { ProblemNotice, asProblem } from '@/features/errors';
import { unitIdOfNode } from '@/features/path/position';
import { log } from '@/lib/log';
import { composePracticeSession } from '@/runner/compose';
import { handOver } from '@/runner/pending';
import { useLearner } from '@/state/learner';
import { usePrefs } from '@/state/prefs';

/** How many of the most recently practised units a mixed session draws from. */
const RECENT_UNITS = 6;
const PRACTICE_SIZE = 12;

/**
 * The practice that lives beside the garden: a short interleaved mix of items from lessons
 * finished on this device, and the learner's saved words. Neither is the review queue — which
 * words are due is the server scheduler's to decide (brief §0 rule 6); watering does that.
 */
export function PracticeExtras() {
  const { t } = useTranslation();
  const theme = useTheme();
  const data = useLearner((s) => s.data);
  const toggleSaved = useLearner((s) => s.toggleSavedWord);
  const speed = usePrefs((s) => s.speed);
  const noAudio = usePrefs((s) => s.noAudio);
  const noVision = usePrefs((s) => s.noVision);
  const l1 = data.profile?.l1 ?? CONTENT_L1;
  const accent: Accent = data.profile?.spellingVariant ?? 'us';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [nothing, setNothing] = useState(false);
  const lexicon = useLexicon(data.savedWords.length > 0);

  // Most recent first, by when each node-tier was finished.
  const recent = useMemo(() => {
    const rows: { nodeId: string; tier: Tier; at: string }[] = [];
    for (const [nodeId, tiers] of Object.entries(data.completed)) {
      for (const [tier, at] of Object.entries(tiers)) if (at) rows.push({ nodeId, tier: Number(tier) as Tier, at });
    }
    return rows.sort((a, b) => b.at.localeCompare(a.at));
  }, [data.completed]);

  const start = async () => {
    setBusy(true);
    setError(null);
    setNothing(false);
    try {
      const unitIds: string[] = [];
      for (const r of recent) {
        const u = unitIdOfNode(r.nodeId);
        if (!unitIds.includes(u)) unitIds.push(u);
        if (unitIds.length >= RECENT_UNITS) break;
      }
      const units = await Promise.all(unitIds.map((id) => content.loadUnit(id)));
      const completed = new Map<string, Tier[]>();
      for (const r of recent) completed.set(r.nodeId, [...(completed.get(r.nodeId) ?? []), r.tier]);
      const session = composePracticeSession(units, completed, {
        profile: { noAudio, noVision },
        seed: Math.floor(Math.random() * 2 ** 30),
        size: PRACTICE_SIZE,
      });
      if (!session) {
        log.info('practice.empty_pool');
        setNothing(true);
        return;
      }
      router.push({ pathname: '/lesson/[sessionId]', params: { sessionId: handOver(session) } });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const saved = [...data.savedWords].sort((a, b) => b.savedAt.localeCompare(a.savedAt));

  return (
    <View style={{ gap: 16 }}>
      <SectionTitle>{t('garden.morePractice')}</SectionTitle>
      <Card>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          <Mascot pose="cheer" size={64} />
          <View style={{ flex: 1, gap: 4 }}>
            <Txt variant="title-m">{t('practice.mixed')}</Txt>
            <Txt variant="body-s" color="ink-2">
              {recent.length ? t('practice.mixedSub') : t('practice.mixedEmpty')}
            </Txt>
          </View>
        </View>
        <Button variant="secondary" block icon="play" disabled={!recent.length} busy={busy} onPress={() => void start()} testID="practice-start">
          {t('practice.start')}
        </Button>
      </Card>
      {error ? <ProblemNotice problem={asProblem(error)} onRetry={() => void start()} /> : null}
      {nothing ? <Notice icon="info">{t('practice.nothingToMix')}</Notice> : null}

      <View style={{ gap: 10 }}>
        <SectionTitle overline={saved.length ? t('common.words', { count: saved.length }) : undefined}>{t('practice.savedWords')}</SectionTitle>
        {saved.length === 0 ? (
          <Txt variant="body-m" color="ink-3">
            {t('practice.savedWordsEmpty')}
          </Txt>
        ) : (
          <Card padded={false}>
            {saved.map((w, i) => {
              const entry = lexicon.data?.lookup(w.lemma).find((x) => x.id === w.lexemeId);
              const gloss = entry?.gloss[l1];
              return (
                <View
                  key={w.lexemeId}
                  testID={`saved-${w.lexemeId}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: theme.c.line }}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt variant="learn-m" lang="en">
                      {w.lemma}
                    </Txt>
                    {gloss ? (
                      <Txt variant="body-s" color="ink-2" lang={l1}>
                        {gloss}
                      </Txt>
                    ) : null}
                  </View>
                  <AudioButton size="sm" label={t('unit.play', { text: w.lemma })} onPress={() => void play(`saved:${w.lexemeId}`, resolveAudio(null, w.lemma), { rate: speed, accent })} />
                  <TextLink onPress={() => toggleSaved({ lexemeId: w.lexemeId, lemma: w.lemma })}>{t('practice.remove')}</TextLink>
                </View>
              );
            })}
          </Card>
        )}
        {saved.length ? (
          <View style={{ gap: 8, alignItems: 'flex-start' }}>
            <SyntheticVoiceChip />
            <Txt variant="caption" color="ink-3">
              {t('gloss.savedNote')}
            </Txt>
          </View>
        ) : null}
      </View>
    </View>
  );
}
