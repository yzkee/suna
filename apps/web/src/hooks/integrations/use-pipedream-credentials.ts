'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { backendApi } from '@/lib/api-client';

export interface PipedreamCredentialStatus {
  configured: boolean;
  source: 'account' | 'default';
  provider: string;
}

export const pipedreamCredentialKeys = {
  status: ['pipedream-credentials'] as const,
};

export function usePipedreamCredentialStatus() {
  return useQuery({
    queryKey: pipedreamCredentialKeys.status,
    queryFn: async (): Promise<PipedreamCredentialStatus> => {
      const res = await backendApi.get<PipedreamCredentialStatus>('/pipedream/credentials');
      if (!res.success) throw new Error(res.error?.message || 'Failed to fetch credential status');
      return res.data!;
    },
    staleTime: 30_000,
  });
}

export function useSavePipedreamCredentials() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (creds: {
      client_id: string;
      client_secret: string;
      project_id: string;
      environment?: string;
    }) => {
      const res = await backendApi.put<{ success: boolean }>('/pipedream/credentials', creds);
      if (!res.success) throw new Error(res.error?.message || 'Failed to save credentials');
      return res.data!;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pipedreamCredentialKeys.status });
      qc.invalidateQueries({ queryKey: ['integration-apps'] });
      qc.invalidateQueries({ queryKey: ['integration-connections'] });
    },
  });
}

export function useDeletePipedreamCredentials() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await backendApi.delete<{ success: boolean }>('/pipedream/credentials');
      if (!res.success) throw new Error(res.error?.message || 'Failed to delete credentials');
      return res.data!;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pipedreamCredentialKeys.status });
      qc.invalidateQueries({ queryKey: ['integration-apps'] });
    },
  });
}
