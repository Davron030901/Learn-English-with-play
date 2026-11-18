import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { resolveAudio } from '@/audio/resolve';
import { play, usePlayingKey, type Accent } from '@/audio/speech';
import { CONTENT_L1 } from '@/content/l1';
import type { Unit, UnitOutline } from '@/content/model';
import { AudioButton, Card, Chip, Icon, LevelBadge, ListRow, SectionTitle, Txt, useTheme, type IconName } from '@/design';
import { SyntheticVoiceChip } from '@/exercises/parts';
import { NodeSheet } from '@/features/path/NodeSheet';
import { completedMap, useLearner } from '@/state/learner';
import { usePrefs } from '@/state/prefs';

const NODE_ICON: Record<string, IconName> = {
  lesson: 'letters',
  story: 'book',
  speak: 'mic',
  immersion: 'headphones',
  review: 'refresh',
  clinic: 'target',
  checkpoint: 'flag',
};

/**
 * A unit's notes (brief Phase 2): what the unit promises (its can-do statements), its lessons,
 * and everything it teaches — words with their meaning in the learner's language, grammar with
 * form, explanation and a right/wrong pair, sounds, and useful phrases. Read-only reference: no
 * exercise lives here.
 */
export function UnitNotes({ unit, outline }: { unit: Unit; outline: UnitOutline }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const playing = usePlayingKey();
  const speed = usePrefs((s) => s.speed);
  const data = useLearner((s) => s.data);
  const l1 = data.profile?.l1 ?? CONTENT_L1;
  const accent: Accent = data.profile?.spellingVariant ?? 'us';
  const completed = completedMap(data);
  const [sheet, setSheet] = useState<string | null>(null);
  const say = (key: string, text: string) => void play(key, resolveAudio(null, text), { rate: speed, accent });
  const l1Title = l1 in unit.title ? unit.title[l1] : undefined;
  const sheetNode = outline.nodes.find((n) => n.id === sheet);

  return (
    <View style={{ gap: 22 }} testID={`unit-notes-${unit.id}`}>
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <LevelBadge level={unit.cefr} />
          <Txt variant="overline" color="ink-3">
            {t('common.sectionUnit', { section: Number(unit.sectionId.slice(1)), unit: unit.index })}
          </Txt>
        </View>
        <Txt variant="display-m" accessibilityRole="header" lang="en">
          {unit.title.en}
        </Txt>
        {l1Title && l1Title !== unit.title.en ? (
          <Txt variant="title-s" color="ink-3" lang={l1}>
            {l1Title}
          </Txt>
        ) : null}
      </View>

      <Card soft>
        <Txt variant="overline" color="ink-3">
          {t('unit.canDo')}
        </Txt>
        {unit.canDo.map((c, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            <Icon name="check-circle" size={20} color={theme.c['success-ink']} />
            <Txt variant="body-m" lang="en" style={{ flex: 1 }}>
              {c}
            </Txt>
          </View>
        ))}
      </Card>

      <View style={{ gap: 10 }}>
        <SectionTitle>{t('unit.nodes')}</SectionTitle>
        <Card padded={false}>
          {outline.nodes.map((n) => {
            const done = completed.get(n.id) ?? [];
            const finished = n.populatedTiers.filter((x) => done.includes(x)).length;
            return (
              <ListRow
                key={n.id}
                icon={NODE_ICON[n.kind] ?? 'letters'}
                title={n.title}
                sub={t(`path.nodeKind.${n.kind}`)}
                value={n.populatedTiers.length ? `${finished}/${n.populatedTiers.length}` : undefined}
                chevron
                onPress={() => setSheet(n.id)}
                testID={`notes-node-${n.id}`}
              />
            );
          })}
        </Card>
        <Txt variant="caption" color="ink-3">
          {t('path.progressNote')}
        </Txt>
      </View>

      {outline.story ? (
        <ListRow
          icon="book"
          title={outline.story.title}
          sub={t('unit.readStory')}
          chevron
          onPress={() => router.push({ pathname: '/story/[textId]', params: { textId: outline.story?.id ?? '' } })}
          testID="notes-story"
        />
      ) : null}

      <View style={{ gap: 10 }}>
        <SectionTitle overline={t('common.words', { count: unit.lexemes.length })}>{t('unit.vocabulary')}</SectionTitle>
        <View style={{ alignItems: 'flex-start' }}>
          <SyntheticVoiceChip />
        </View>
        <Card padded={false}>
          {unit.lexemes.map((l, i) => {
            const gloss = l.gloss[l1];
            return (
              <View
                key={l.id}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: theme.c.line }}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <Txt variant="learn-m" lang="en">
                      {l.lemma}
                    </Txt>
                    <Txt variant="ipa" color="ink-3" accessibilityLabel={`/${l.ipa}/`}>{`/${l.ipa}/`}</Txt>
                    <Chip size="sm">{l.pos}</Chip>
                  </View>
                  {gloss ? (
                    <Txt variant="body-s" color="ink-2" lang={l1}>
                      {gloss}
                    </Txt>
                  ) : null}
                  {l.definitionEn ? (
                    <Txt variant="body-s" color="ink-3" lang="en">
                      {l.definitionEn}
                    </Txt>
                  ) : null}
                </View>
                <AudioButton size="sm" label={t('unit.play', { text: l.lemma })} playing={playing === `notes:${l.id}`} onPress={() => say(`notes:${l.id}`, l.lemma)} />
              </View>
            );
          })}
        </Card>
      </View>

      {unit.grammar.length ? (
        <View style={{ gap: 10 }}>
          <SectionTitle>{t('unit.grammar')}</SectionTitle>
          {unit.grammar.map((g) => {
            const explanation = (l1 in g.explanation ? g.explanation[l1] : undefined) ?? g.explanation.en;
            return (
              <Card key={g.id}>
                <Txt variant="title-s">{g.label}</Txt>
                <View style={{ gap: 2 }}>
                  <Txt variant="overline" color="ink-3">
                    {t('unit.form')}
                  </Txt>
                  <Txt variant="learn-m" lang="en">
                    {g.form}
                  </Txt>
                </View>
                <Txt variant="body-m" color="ink-2" lang={explanation === g.explanation.en ? 'en' : l1}>
                  {explanation}
                </Txt>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                  <Icon name="check-circle" size={20} color={theme.c['success-ink']} title={t('unit.right')} />
                  <Txt variant="learn-s" lang="en" style={{ flex: 1 }}>
                    {g.positive_example}
                  </Txt>
                  <AudioButton size="sm" label={t('unit.play', { text: g.positive_example })} onPress={() => say(`notes:g:${g.id}`, g.positive_example)} />
                </View>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                  <Icon name="x-circle" size={20} color={theme.c['danger-ink']} title={t('unit.wrong')} />
                  <Txt variant="learn-s" lang="en" color="ink-3" style={{ flex: 1, textDecorationLine: 'line-through' }}>
                    {g.negative_example}
                  </Txt>
                </View>
              </Card>
            );
          })}
        </View>
      ) : null}

      {unit.phonology.length ? (
        <View style={{ gap: 10 }}>
          <SectionTitle>{t('unit.phonology')}</SectionTitle>
          <Card>
            {unit.phonology.map((p) => (
              <View key={p.id} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Icon name="wave" size={20} color={theme.c['primary-ink']} />
                <Txt variant="body-m" style={{ flex: 1 }}>
                  {p.label}
                </Txt>
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      {unit.functions.length ? (
        <View style={{ gap: 10 }}>
          <SectionTitle>{t('unit.functions')}</SectionTitle>
          {unit.functions.map((f) => (
            <Card key={f.id}>
              <Txt variant="title-s">{f.label}</Txt>
              {f.exponents.map((e, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt variant="learn-s" lang="en">
                      {e.text}
                    </Txt>
                    {e.formality ? (
                      <Txt variant="caption" color="ink-3">
                        {t(`unit.formality.${e.formality}`, { defaultValue: e.formality })}
                      </Txt>
                    ) : null}
                  </View>
                  <AudioButton size="sm" label={t('unit.play', { text: e.text })} onPress={() => say(`notes:f:${f.id}:${i}`, e.text)} />
                </View>
              ))}
            </Card>
          ))}
        </View>
      ) : null}

      <Txt variant="caption" color="ink-3">
        {t('common.syntheticVoiceHelp')}
      </Txt>

      {sheetNode ? <NodeSheet unit={outline} node={sheetNode} done={completed.get(sheetNode.id) ?? []} onClose={() => setSheet(null)} /> : null}
    </View>
  );
}
