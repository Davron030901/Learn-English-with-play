import { router } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Course, UnitOutline } from '@/content/model';
import { useCourse } from '@/content/queries';
import { CONTENT_MAX, LevelBadge, ListRow, Notice, Txt, useTheme } from '@/design';
import { CastShelf } from '@/features/chat/CastShelf';
import { ProblemNotice, asProblem } from '@/features/errors';

type Row =
  | { kind: 'head'; key: string }
  | { kind: 'section'; key: string; n: number; cefr: string }
  | { kind: 'story'; key: string; unit: UnitOutline; story: { id: string; title: string } };

function rowsOf(course: Course): Row[] {
  const rows: Row[] = [{ kind: 'head', key: 'head' }];
  course.sections.forEach((s, i) => {
    rows.push({ kind: 'section', key: s.id, n: i + 1, cefr: s.cefr });
    for (const u of s.units) if (u.story) rows.push({ kind: 'story', key: u.story.id, unit: u, story: u.story });
  });
  return rows;
}

/**
 * The Library (brief Phase 2/4): today, the course's serial story — one episode per unit, 168
 * in all — readable at any time. Graded readers, podcasts, video and news (the Immersion Engine,
 * docs/06 §7) do not exist as content yet, and the screen says so instead of faking shelves.
 */
export default function LibraryScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const course = useCourse();
  const rows = useMemo(() => (course.data ? rowsOf(course.data) : []), [course.data]);

  if (course.error) {
    return (
      <SafeAreaView style={{ flex: 1, padding: 20, backgroundColor: theme.c.bg }}>
        <ProblemNotice problem={asProblem(course.error)} onRetry={() => void course.refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.c.bg }} testID="library">
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        initialNumToRender={20}
        contentContainerStyle={{ paddingBottom: 40 }}
        ListEmptyComponent={
          <Txt color="ink-3" style={{ padding: 20 }}>
            {t('common.loading')}
          </Txt>
        }
        renderItem={({ item: row }) => {
          const wrap = { width: '100%' as const, maxWidth: CONTENT_MAX, alignSelf: 'center' as const, paddingHorizontal: 20 };
          if (row.kind === 'head') {
            return (
              <View style={[wrap, { gap: 14, paddingTop: 16 }]}>
                <Txt variant="display-m" accessibilityRole="header">
                  {t('library.title')}
                </Txt>
                <CastShelf />
                <View style={{ gap: 4 }}>
                  <Txt variant="title-m">{t('library.stories')}</Txt>
                  <Txt variant="body-m" color="ink-2">
                    {t('library.storiesSub')}
                  </Txt>
                </View>
                <Notice icon="headphones">{t('library.more')}</Notice>
              </View>
            );
          }
          if (row.kind === 'section') {
            return (
              <View style={[wrap, { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 24, paddingBottom: 8 }]}>
                <LevelBadge level={row.cefr} />
                <Txt variant="title-s" color="ink-2" accessibilityRole="header">
                  {t('library.section', { n: row.n })}
                </Txt>
              </View>
            );
          }
          return (
            <View style={wrap}>
              <ListRow
                icon="book"
                title={row.story.title}
                sub={t('story.episode', { n: row.unit.index })}
                chevron
                onPress={() => router.push({ pathname: '/story/[textId]', params: { textId: row.story.id } })}
                testID={`story-${row.story.id}`}
              />
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}
