import { useMemo } from 'react';
import { navMatches, sortSearchGroups, type SearchGroupDto } from '@lexisora/shared';
import { useMe } from '@/lib/auth';
import { useSearch } from './api';

/**
 * Header/global search results: server groups (people, tasks, projects… — each domain registers a
 * permission-aware provider on core /search) plus a client-side "Go to" group of sidebar screens the
 * user can open. `perGroup` caps each group (dropdown shows 5; the results page shows everything).
 */
export function useSearchGroups(q: string, perGroup = 5) {
  const me = useMe();
  const term = q.trim();
  const res = useSearch(term);
  const groups = useMemo<SearchGroupDto[]>(() => {
    if (term.length < 2) return [];
    const granted = new Set(me.permissions);
    const goto = navMatches(term, granted, perGroup).map((n) => ({ type: 'goto', id: n.id, title: n.label, subtitle: n.group, link: n.path }));
    // Stale results from the previous term are hidden until the new ones arrive.
    const server = res.data && !res.isPlaceholderData ? res.data : [];
    return sortSearchGroups([...(goto.length ? [{ type: 'goto', hits: goto }] : []), ...server.map((g) => ({ type: g.type, hits: g.hits.slice(0, perGroup) }))]);
  }, [term, me.permissions, res.data, res.isPlaceholderData, perGroup]);
  return { groups, loading: term.length >= 2 && (res.isFetching || res.isPlaceholderData), error: res.error };
}
