import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { useAiAvailable, useCast } from '@/api/queries/ai';
import { CastPortrait, Chip, LevelBadge, Txt, castTone, radius, tone, useTheme } from '@/design';
import { usePrefs } from '@/state/prefs';

import { useCurrentUnitId } from './useCurrentUnit';

/**
 * The Library's "Chat with the cast" shelf (docs/16 E21 screen 1b): the characters met so far,
 * each labelled an AI character, and the current unit's scenario plus the two before it. Renders
 * nothing at all when the server has no model — no teaser for a feature that is not there.
 */
export function CastShelf() {
  const { t } = useTranslation();
  const theme = useTheme();
  const language = usePrefs((s) => s.interfaceLanguage);
  const available = useAiAvailable();
  const unitId = useCurrentUnitId();
  const cast = useCast(available ? unitId : null);
  if (!available || !cast.data || cast.data.characters.length === 0 || !unitId) return null;

  const open = (characterId: string, unit: string) =>
    router.push({ pathname: '/chat/[characterId]', params: { characterId, unit } });

  return (
    <View style={{ gap: 12 }} testID="cast-shelf">
      <View style={{ gap: 4 }}>
        <Txt variant="title-m" accessibilityRole="header">
          {t('chat.shelfTitle')}
        </Txt>
        <Txt variant="body-m" color="ink-2">
          {t('chat.shelfSub')}
        </Txt>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 12, paddingVertical: 2 }}
      >
        {cast.data.characters.map((c) => (
          <Pressable
            key={c.id}
            onPress={() => open(c.id, unitId)}
            accessibilityRole="button"
            accessibilityLabel={t('chat.talkWith', { name: c.name })}
            testID={`cast-${c.id}`}
            style={({ pressed }) => ({
              width: 112,
              alignItems: 'center',
              gap: 6,
              padding: 10,
              borderRadius: radius.lg,
              borderWidth: 2,
              borderColor: tone(theme, castTone(c.id)).soft,
              backgroundColor: pressed ? theme.c['bg-soft'] : theme.c.surface,
            })}
          >
            <CastPortrait id={c.id} size={56} />
            <Txt variant="body-m" weight={800} numberOfLines={1}>
              {c.name}
            </Txt>
            <Chip size="sm" tone={castTone(c.id)}>
              {t('chat.aiShort')}
            </Chip>
          </Pressable>
        ))}
      </ScrollView>
      {cast.data.scenarios.map((s) => (
        <Pressable
          key={s.unit_id}
          onPress={() => s.characters[0] && open(s.characters[0], s.unit_id)}
          disabled={!s.characters[0]}
          accessibilityRole="button"
          testID={`scenario-${s.unit_id}`}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            padding: 12,
            borderRadius: radius.lg,
            backgroundColor: pressed ? theme.c['bg-soft'] : theme.c['surface-2'],
          })}
        >
          <LevelBadge level={s.cefr} size="sm" />
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="body-m" weight={800} numberOfLines={1}>
              {s.title[language] ?? s.title.en ?? s.unit_id}
            </Txt>
            {s.can_do[0] ? (
              <Txt variant="body-s" color="ink-3" lang="en" numberOfLines={1}>
                {s.can_do[0]}
              </Txt>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row' }}>
            {s.characters.slice(0, 3).map((id, i) => (
              <View key={id} style={{ marginStart: i ? -10 : 0 }}>
                <CastPortrait id={id} size={32} />
              </View>
            ))}
          </View>
        </Pressable>
      ))}
    </View>
  );
}
