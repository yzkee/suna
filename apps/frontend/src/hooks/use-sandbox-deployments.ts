'use client';

import { useQuery } from '@tanstack/react-query';
import { authenticatedFetch } from '@/lib/auth-token';
import { useServerStore } from '@/stores/server-store';

// ============================================================================
// Types
// ============================================================================

export interface SandboxDeployment {
  deploymentId: string;
  port: number;
  pid: number;
  framework: string;
  sourcePath: string;
  startedAt: string;
  status: 'running' | 'stopped';
}

// ============================================================================
// Query Keys
// ============================================================================

export const deploymentKeys = {
  all: ['sandbox-deployments'] as const,
  list: (serverUrl: string) => ['sandbox-deployments', serverUrl, 'list'] as const,
};

// ============================================================================
// Hook
// ============================================================================

/**
 * Fetch running deployments from Kortix Master inside the sandbox.
 * Calls GET /kortix/deploy on the active server URL.
 */
export function useSandboxDeployments(options?: { enabled?: boolean }) {
  const serverUrl = useServerStore((s) => {
    const active = s.servers.find((srv) => srv.id === s.activeServerId);
    return active?.url || '';
  });

  return useQuery<SandboxDeployment[]>({
    queryKey: deploymentKeys.list(serverUrl),
    queryFn: async () => {
      if (!serverUrl) return [];
      try {
        const res = await authenticatedFetch(
          `${serverUrl}/kortix/deploy`,
          { signal: AbortSignal.timeout(5000) },
          { retryOnAuthError: false },
        );
        if (!res.ok) return [];
        const data = await res.json();
        return (data.deployments ?? []) as SandboxDeployment[];
      } catch {
        return [];
      }
    },
    enabled: (options?.enabled ?? true) && !!serverUrl,
    staleTime: 10_000, // 10s — poll relatively often
    gcTime: 60_000,
    refetchInterval: 10_000, // auto-poll every 10s
    refetchOnWindowFocus: false,
  });
}
