'use client';

import { useQuery } from '@tanstack/react-query';
import { authenticatedFetch } from '@/lib/auth-token';
import { getEnv } from '@/lib/env-config';

export interface KortixConnector {
  _dir: string;
  name: string;
  description?: string;
  source?: string;
  [key: string]: string | undefined;
}

function getBackendUrl(): string {
  return (getEnv().BACKEND_URL || 'http://localhost:8008/v1').replace(/\/+$/, '');
}

export function useKortixConnectors() {
  return useQuery({
    queryKey: ['kortix', 'connectors'],
    queryFn: async (): Promise<KortixConnector[]> => {
      const url = `${getBackendUrl()}/kortix/connectors`;
      const res = await authenticatedFetch(url);
      if (!res.ok) throw new Error(`Failed to fetch connectors: ${res.status}`);
      const data = await res.json();
      return data.connectors ?? [];
    },
    staleTime: 30_000,
  });
}
