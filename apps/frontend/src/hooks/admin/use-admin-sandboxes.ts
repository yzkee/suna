import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { backendApi } from '@/lib/api-client';

export interface AdminSandbox {
  sandboxId: string;
  accountId: string | null;
  name: string | null;
  provider: string | null;
  externalId: string | null;
  status: string | null;
  baseUrl: string | null;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  accountName: string | null;
  ownerEmail: string | null;
}

interface AdminSandboxesResponse {
  sandboxes: AdminSandbox[];
  error?: string;
}

const QUERY_KEY = ['admin', 'sandboxes'];

export function useAdminSandboxes() {
  return useQuery<AdminSandbox[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const response = await backendApi.get<AdminSandboxesResponse>('/admin/api/sandboxes');
      if (response.error) throw new Error(response.error.message);
      return response.data?.sandboxes ?? [];
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useDeleteAdminSandbox() {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean; sandboxId: string }, Error, string>({
    mutationFn: async (sandboxId: string) => {
      const response = await backendApi.delete<{ success: boolean; sandboxId: string }>(
        `/admin/api/sandboxes/${sandboxId}`
      );
      if (response.error) throw new Error(response.error.message);
      return response.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
