import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { sessionIdFor } from '@/runner/compose';
import type { Tier, UnitOutline } from '@/content/model';
import { Button, Chip, IconButton, Txt, useTheme, radius } from '@/design';

type NodeOutline = UnitOutline['nodes'][number];

/** About how long one node-tier takes: the unit's tier estimate shared out by item count. */
export function tierMinutes(unit: UnitOutline, node: NodeOutline, tier: Tier): number {
  const key = `t${tier}` as const;
  const total = unit.nodes.reduce((a, n) => a + (n.itemCounts[tier] ?? 0), 0);
  const mine = node.itemCounts[tier] ?? 0;
  if (!total || !mine) return 0;
  return Math.max(1, Math.round((unit.minutes[key] * mine) / total));
}

export function NodeSheet({
  unit,
  node,
  done,
  doneLabel,
  onClose,
}: {
  unit: UnitOutline;
  node: NodeOutline;
  done: readonly Tier[];
  /** How a done tier is labelled: "finished on this device" unless the account's record is in. */
  doneLabel?: string;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const kindLabel = t(`path.nodeKind.${node.kind}`);
  const go = (href: Parameters<typeof router.push>[0]) => {
    onClose();
    router.push(href);
  };
  return (
    <Modal transparent animationType={theme.reduceMotion ? 'none' : 'slide'} onRequestClose={onClose} visible>
      <Pressable accessibilityLabel={t('common.close')} onPress={onClose} style={{ flex: 1, backgroundColor: theme.c.scrim }} />
      <View
        testID="node-sheet"
        accessibilityViewIsModal
        style={{
          maxHeight: '80%',
          backgroundColor: theme.c.surface,
          borderTopStartRadius: radius.xl,
          borderTopEndRadius: radius.xl,
          paddingTop: 16,
          paddingHorizontal: 20,
          paddingBottom: Math.max(insets.bottom, 20),
          boxShadow: theme.floatShadow,
          width: '100%',
          maxWidth: 720,
          alignSelf: 'center',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Txt variant="overline" color="ink-3">
              {`${kindLabel} · ${t('common.unit', { n: unit.index })}`}
            </Txt>
            <Txt variant="title-l" accessibilityRole="header">
              {node.title}
            </Txt>
          </View>
          <IconButton icon="close" label={t('common.close')} onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={{ gap: 12, paddingTop: 12 }}>
          {node.kind === 'immersion' ? (
            <>
              <Txt variant="body-m" color="ink-2">
                {t('path.noItemsImmersion')}
              </Txt>
              {unit.story ? (
                <Button icon="book" block onPress={() => go({ pathname: '/story/[textId]', params: { textId: unit.story?.id ?? '' } })}>
                  {t('path.openLibrary')}
                </Button>
              ) : null}
            </>
          ) : node.kind === 'review' ? (
            <>
              <Txt variant="body-m" color="ink-2">
                {t('path.noItemsReview')}
              </Txt>
              <Button icon="cards" block onPress={() => go('/practice')}>
                {t('path.openPractice')}
              </Button>
            </>
          ) : (
            node.populatedTiers.map((tier) => {
              const isDone = done.includes(tier);
              return (
                <View key={tier} style={{ gap: 8, padding: 14, borderRadius: radius.lg, borderWidth: 2, borderColor: theme.c.line }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Txt variant="title-s" style={{ flex: 1 }}>
                      {t('path.tier', { n: tier })}
                    </Txt>
                    {isDone ? (
                      <Chip tone="success" icon="check" size="sm">
                        {doneLabel ?? t('path.tierDone')}
                      </Chip>
                    ) : null}
                  </View>
                  <Txt variant="body-s" color="ink-3">
                    {t('path.tierItems', { count: node.itemCounts[tier] ?? 0, minutes: tierMinutes(unit, node, tier) })}
                  </Txt>
                  <Button
                    variant={isDone ? 'secondary' : 'primary'}
                    block
                    icon={isDone ? 'refresh' : 'play'}
                    testID={`start-${node.id}-t${tier}`}
                    onPress={() => go({ pathname: '/lesson/[sessionId]', params: { sessionId: sessionIdFor(node.id, tier) } })}
                  >
                    {isDone ? t('path.practiseTier', { n: tier }) : t('path.startTier', { n: tier })}
                  </Button>
                </View>
              );
            })
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
