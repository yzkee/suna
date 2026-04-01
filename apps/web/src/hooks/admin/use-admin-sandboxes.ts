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

export interface AdminSandboxesParams {
  search?: string;
  status?: string;
  provider?: string;
  page?: number;
  limit?: number;
}

interface AdminSandboxesResponse {
  sandboxes: AdminSandbox[];
  total: number;
  page: number;
  limit: number;
  error?: string;
}

export function useAdminSandboxes(params: AdminSandboxesParams = {}) {
  const { search = '', status = '', provider = '', page = 1, limit = 50 } = params;

  return useQuery<AdminSandboxesResponse>({
    queryKey: ['admin', 'sandboxes', search, status, provider, page, limit],
    queryFn: async () => {
      const q = new URLSearchParams();
      if (search)   q.set('search', search);
      if (status)   q.set('status', status);
      if (provider) q.set('provider', provider);
      q.set('page', String(page));
      q.set('limit', String(limit));

      const response = await backendApi.get<AdminSandboxesResponse>(
        `/admin/api/sandboxes?${q.toString()}`
      );
      if (response.error) throw new Error(response.error.message);
      return response.data!;
    },
    staleTime: 15_000,
    placeholderData: (prev) => prev, // keep previous data while fetching next page
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
      queryClient.invalidateQueries({ queryKey: ['admin', 'sandboxes'] });
    },
  });
}
