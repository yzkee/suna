'use client';

import { useQuery } from '@tanstack/react-query';
import { getServerTypes, type ServerTypesResponse } from '@/lib/api/billing';

export function useServerTypes(location: string) {
  return useQuery<ServerTypesResponse>({
    queryKey: ['server-types', location],
    queryFn: () => getServerTypes(location),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}
