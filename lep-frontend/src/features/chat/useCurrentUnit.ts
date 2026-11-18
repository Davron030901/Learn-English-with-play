import { useMemo } from 'react';

import { useProgress } from '@/api/queries/gamification';
import { useCourse } from '@/content/queries';
import { mergeTiers, serverPathOf } from '@/features/path/merge';
import { currentPosition } from '@/features/path/position';
import { completedMap, useLearner } from '@/state/learner';

/**
 * The unit the learner is on — the same answer the path gives (server progress first, then the
 * tiers this device finished). Chats are offered from here and the two units before it, so a
 * character never talks about what the learner has not met yet.
 */
export function useCurrentUnitId(): string | null {
  const course = useCourse();
  const data = useLearner((s) => s.data);
  const progress = useProgress();
  return useMemo(() => {
    if (!course.data) return null;
    const server = serverPathOf(progress.data);
    const completed = mergeTiers(course.data, completedMap(data), server);
    const position = currentPosition(
      course.data,
      completed,
      data.startSection,
      server ? { fromUnit: server.currentUnit, doneUnits: server.doneUnits } : undefined,
    );
    if (position) return position.unit.id;
    if (server?.currentUnit && course.data.unitsById.has(server.currentUnit))
      return server.currentUnit;
    return course.data.sections[0]?.units[0]?.id ?? null;
  }, [course.data, data, progress.data]);
}
