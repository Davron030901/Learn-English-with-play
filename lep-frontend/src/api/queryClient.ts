import { QueryClient } from '@tanstack/react-query';

/** The app's one query cache (memory only; nothing server-derived is persisted). */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

/**
 * Every query a synced answer can change: numbers, the path, the garden, the due queue, and this
 * week's league (an answer can put the learner in a group and moves their weekly XP).
 */
export const SERVER_PROGRESS_KEYS = [
  ['gamification'],
  ['progress'],
  ['garden'],
  ['due'],
  ['leagues'],
] as const;

export function invalidateProgress(): void {
  for (const key of SERVER_PROGRESS_KEYS)
    void queryClient.invalidateQueries({ queryKey: [...key] });
}
