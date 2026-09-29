import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import type { Option } from './form';

export type LookupType =
  | 'employees'
  | 'managers'
  | 'departments'
  | 'designations'
  | 'branches'
  | 'shifts'
  | 'locations'
  | 'projects'
  | 'clients'
  | 'interns'
  | 'candidates'
  | 'jobs'
  | 'leaveTypes'
  | 'rooms'
  | 'ledgers'
  | 'teams';

/**
 * Dropdown options for forms. Backed by GET /lookups?types=a,b (implemented by the
 * People module; each domain registers its own lookup types there).
 */
export function useLookups(types: LookupType[]) {
  return useQuery({
    queryKey: ['lookups', ...types],
    queryFn: () => get<Record<string, Option[]>>('/lookups', { types: types.join(',') }),
    staleTime: 60_000,
  });
}

export function opts(data: Record<string, Option[]> | undefined, type: LookupType): Option[] {
  return data?.[type] ?? [];
}
