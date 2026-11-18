import { useQuery } from '@tanstack/react-query';

import { ContentRepository } from './repository';
import { appContentSource } from './source.app';

/**
 * Content is read through TanStack Query like any server resource (brief §3: never server data
 * in a global store), so replacing the packed assets with `GET /v1/course` and
 * `GET /v1/units/{id}` later changes the query functions and nothing else.
 */
export const content = new ContentRepository(appContentSource);

const forever = { staleTime: Infinity, gcTime: 30 * 60_000, retry: 1 } as const;

export function useCourse() {
  return useQuery({ queryKey: ['content', 'course'], queryFn: () => content.loadCourse(), ...forever });
}

export function useUnit(unitId: string | undefined) {
  return useQuery({
    queryKey: ['content', 'unit', unitId],
    queryFn: () => content.loadUnit(unitId as string),
    enabled: !!unitId,
    ...forever,
  });
}

export function useWords() {
  return useQuery({ queryKey: ['content', 'words'], queryFn: () => content.loadWords(), ...forever });
}

export function useLexicon(enabled = true) {
  return useQuery({ queryKey: ['content', 'lexicon'], queryFn: () => content.loadLexicon(), enabled, ...forever });
}
