import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { Tier, UnitOutline } from '@/content/model';
import { CONTENT_MAX, PathNode, UnitBanner, type PathNodeKind } from '@/design';

function pathKind(node: UnitOutline['nodes'][number]): PathNodeKind {
  if (node.kind !== 'lesson') return node.kind;
  if (node.focus === 'lexis' || node.focus === 'grammar' || node.focus === 'mixed') return node.focus;
  return 'lesson';
}

/** Zig-zag offset of the n-th node (logical: positive = towards the end edge). */
const OFFSETS = [0, 44, 70, 44, 0, -44, -70, -44];

export interface UnitRowProps {
  unit: UnitOutline;
  /** Finished tiers per node: the server's record merged with this device's (see merge.ts). */
  completed: ReadonlyMap<string, readonly Tier[]>;
  /** The node the Continue button opens, when it is in this unit. */
  currentNodeId: string | null;
  started: boolean;
  /** The learner's current unit: highlighted, "You are here". */
  isCurrent: boolean;
  /** Complete on the account, or every tier finished: "Unit complete", no test-out. */
  isDone: boolean;
  /** Offer the free test-out key (docs/16 E14) — the server supports it and the unit is not done. */
  canTestOut: boolean;
  /** The ticks include the account's record (the labels then stop saying "on this device"). */
  serverBacked: boolean;
  onNode: (unit: UnitOutline, nodeId: string) => void;
  onNotes: (unitId: string) => void;
  onTestOut: (unitId: string) => void;
}

/**
 * One unit on the path (docs/16 E08 §3, §7): its banner — with where the learner is, a finished
 * unit's trophy, or the quiet "Test out" key — and its eight nodes on the zig-zag. Nothing is
 * locked (DECISIONS F22): the server decides locks, and until it does every unit opens.
 */
export const UnitRow = memo(function UnitRow({
  unit: u,
  completed,
  currentNodeId,
  started,
  isCurrent,
  isDone,
  canTestOut,
  serverBacked,
  onNode,
  onNotes,
  onTestOut,
}: UnitRowProps) {
  const { t } = useTranslation();
  const callout = started ? t('path.continue') : t('path.start');
  return (
    <View style={{ width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 12, gap: 18 }} testID={`unit-${u.id}`}>
      <UnitBanner
        overline={t('common.sectionUnit', { section: Number(u.sectionId.slice(1)), unit: u.index })}
        title={u.title.en}
        cando={u.canDo[0]}
        level={u.cefr}
        actionLabel={t('path.notes')}
        onAction={() => onNotes(u.id)}
        highlight={isCurrent && !isDone}
        status={isDone ? { icon: 'trophy', label: t('hud.path.unitDone') } : isCurrent ? { icon: 'map', label: t('hud.path.current') } : undefined}
        secondary={
          canTestOut && !isDone
            ? {
                icon: 'flag',
                label: t('testOut.title'),
                accessibilityLabel: t('hud.path.testOutA11y', { n: u.index, title: u.title.en }),
                onPress: () => onTestOut(u.id),
                testID: `testout-${u.id}`,
              }
            : undefined
        }
        testID={`banner-${u.id}`}
      />
      <View style={{ alignItems: 'center', gap: 22 }}>
        {u.nodes.map((n, i) => {
          const tiers = completed.get(n.id) ?? [];
          const done = n.populatedTiers.filter((tier) => tiers.includes(tier)).length;
          const isCurrentNode = currentNodeId === n.id;
          return (
            <View key={n.id} style={{ transform: [{ translateX: OFFSETS[i % OFFSETS.length] ?? 0 }] }}>
              <PathNode
                kind={pathKind(n)}
                level={u.cefr}
                state={isCurrentNode ? 'current' : 'open'}
                populated={n.populatedTiers.length}
                done={done}
                callout={isCurrentNode ? callout : undefined}
                caption={n.title}
                testID={`node-${n.id}`}
                accessibilityLabel={t(serverBacked ? 'hud.path.nodeA11y' : 'path.nodeA11y', {
                  kind: t(`path.nodeKind.${n.kind}`),
                  title: n.title,
                  done,
                  total: n.populatedTiers.length,
                })}
                onPress={() => onNode(u, n.id)}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
});
