'use client';

import { useQuery } from '@tanstack/react-query';
import { getServerTypes, type ServerTypesResponse, type ServerType } from '@/lib/api/billing';
import { isBillingEnabled } from '@/lib/config';

/** Static fallback — used when the API is unreachable (e.g. guest on homepage). */
const fb = (name: string, cores: number, memory: number, disk: number, price: number, markup: number): ServerType => ({
  name, description: '', cores, memory, disk, cpuType: 'shared', architecture: 'x86', priceMonthly: price, priceMonthlyMarkup: markup, location: 'hel1',
});

const FALLBACK_TYPES: ServerType[] = [
  fb('cpx11', 2, 4, 80, 10, 12),
  fb('cpx21', 4, 8, 160, 17.5, 21),
  fb('cpx31', 8, 16, 320, 32.5, 39),
  fb('cpx41', 12, 24, 480, 46.67, 56),
  fb('cpx51', 16, 32, 640, 64.17, 77),
];

const FALLBACK: ServerTypesResponse = {
  serverTypes: FALLBACK_TYPES,
  location: 'hel1',
  defaultServerType: 'cpx21',
  defaultLocation: 'hel1',
};

export function useServerTypes(location: string) {
  const query = useQuery<ServerTypesResponse>({
    queryKey: ['server-types', location],
    queryFn: () => getServerTypes(location),
    enabled: isBillingEnabled(),
    retry: 1,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  // If the query failed or returned empty, use static fallback
  const data = (query.data && query.data.serverTypes.length > 0) ? query.data : FALLBACK;

  return {
    ...query,
    data,
    isLoading: query.isLoading && !query.isError,
  };
}
