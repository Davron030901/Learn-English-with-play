import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { resolveAudio } from '@/audio/resolve';
import { play, usePlayingKey, type Accent } from '@/audio/speech';
import type { Unit } from '@/content/model';
import { AudioButton, Button, Card, Chip, Icon, Txt, useTheme } from '@/design';
import { StoryScript, SyntheticVoiceChip } from '@/exercises/parts';
import type { PresentCard as Card_ } from '@/runner/phases';

/**
 * Phase 3, NEW INPUT: presentation with a "got it" affordance — never a test (brief §6.1: building
 * it as an exercise is the most common way this architecture goes wrong). Nothing is graded here.
 */
export function PresentCard({
  card,
  unit,
  l1,
  accent,
  onGotIt,
}: {
  card: Card_;
  unit: Unit;
  l1: string;
  accent: Accent;
  onGotIt: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const playing = usePlayingKey();
  const say = (key: string, text: string) => void play(key, resolveAudio(null, text), { rate: 1, accent });

  let body: React.ReactNode;
  switch (card.type) {
    case 'lexeme': {
      const l = card.lexeme;
      const gloss = l.gloss[l1] ?? null;
      body = (
        <>
          <Chip tone="blue" icon="letters" size="sm">
            {t('lesson.newWord')}
          </Chip>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Txt variant="learn-xl" lang="en" style={{ flex: 1 }} testID="present-word">
              {l.lemma}
            </Txt>
            <AudioButton size="md" label={t('unit.play', { text: l.lemma })} playing={playing === `lex:${l.id}`} onPress={() => say(`lex:${l.id}`, l.lemma)} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Txt variant="ipa" color="ink-3" accessibilityLabel={`${l.lemma}: /${l.ipa}/`}>{`/${l.ipa}/`}</Txt>
            <Chip size="sm">{l.pos}</Chip>
          </View>
          {gloss ? (
            <Txt variant="title-m" lang={l1}>
              {gloss}
            </Txt>
          ) : null}
          {l.examples.slice(0, 2).map((ex, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Txt variant="learn-s" lang="en" color="ink-2" style={{ flex: 1 }}>
                {ex}
              </Txt>
              <AudioButton size="sm" label={t('unit.play', { text: ex })} playing={playing === `ex:${l.id}:${i}`} onPress={() => say(`ex:${l.id}:${i}`, ex)} />
            </View>
          ))}
        </>
      );
      break;
    }
    case 'grammar': {
      const g = card.point;
      const explanation = (l1 in g.explanation ? g.explanation[l1 as 'uz'] : undefined) ?? g.explanation.en;
      body = (
        <>
          <Chip tone="orange" icon="blocks" size="sm">
            {t('lesson.newGrammar')}
          </Chip>
          <Txt variant="title-l">{g.label}</Txt>
          <View style={{ gap: 4 }}>
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
            <Icon name="check-circle" size={22} color={theme.c['success-ink']} title={t('unit.right')} />
            <Txt variant="learn-m" lang="en" style={{ flex: 1 }}>
              {g.positive_example}
            </Txt>
            <AudioButton size="sm" label={t('unit.play', { text: g.positive_example })} onPress={() => say(`g:${g.id}`, g.positive_example)} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            <Icon name="x-circle" size={22} color={theme.c['danger-ink']} title={t('unit.wrong')} />
            <Txt variant="learn-m" lang="en" color="ink-3" style={{ flex: 1, textDecorationLine: 'line-through' }}>
              {g.negative_example}
            </Txt>
          </View>
        </>
      );
      break;
    }
    case 'function': {
      const f = card.fn;
      body = (
        <>
          <Chip tone="purple" icon="chat" size="sm">
            {t('lesson.newPhrases')}
          </Chip>
          <Txt variant="title-l">{f.label}</Txt>
          {f.exponents.map((e, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="learn-m" lang="en">
                  {e.text}
                </Txt>
                {e.formality ? (
                  <Txt variant="caption" color="ink-3">
                    {t(`unit.formality.${e.formality}`, { defaultValue: e.formality })}
                  </Txt>
                ) : null}
              </View>
              <AudioButton size="sm" label={t('unit.play', { text: e.text })} onPress={() => say(`f:${f.id}:${i}`, e.text)} />
            </View>
          ))}
        </>
      );
      break;
    }
    case 'story': {
      body = (
        <>
          <Chip tone="lagoon" icon="book" size="sm">
            {t('lesson.readTheStory')}
          </Chip>
          <Txt variant="title-l">{card.story.title}</Txt>
          <Txt variant="body-m" color="ink-2">
            {t('lesson.readStoryBody')}
          </Txt>
          <StoryScript
            story={card.story}
            playingIndex={(() => {
              const m = playing?.match(/^story:(\d+)$/);
              return m ? Number(m[1]) : null;
            })()}
            onLine={(i) => say(`story:${i}`, card.story.body[i]?.text ?? '')}
          />
        </>
      );
      break;
    }
  }

  return (
    <View style={{ gap: 20 }} testID={`present-${card.type}`}>
      <Card>{body}</Card>
      <View style={{ alignItems: 'center', gap: 6 }}>
        <SyntheticVoiceChip />
        <Txt variant="caption" color="ink-3" align="center">
          {t('common.syntheticVoiceHelp')}
        </Txt>
      </View>
      <Button size="lg" block onPress={onGotIt} testID="got-it">
        {card.type === 'story' ? t('lesson.readIt') : t('lesson.gotIt')}
      </Button>
    </View>
  );
}

export type { Unit };
