/**
 * Kortix Projects hooks.
 *
 * Fetches from kortix-master's /kortix/projects API, proxied through
 * kortix-api at /v1/kortix/projects. This is the frontend's source
 * of truth for project data — NOT the OpenCode SDK.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerStore } from '@/stores/server-store';
import { authenticatedFetch } from '@/lib/auth-token';
import { getEnv } from '@/lib/env-config';

// ── Types ────────────────────────────────────────────────────────────────────

export interface KortixProject {
  id: string;
  name: string;
  path: string;
  description: string;
  created_at: string;
  opencode_id: string | null;
  sessionCount?: number;
  delegationStats?: Record<string, number>;
}

export interface KortixProjectDetail extends KortixProject {
  delegations: Array<{
    session_id: string;
    project_id: string;
    prompt: string;
    agent: string;
    status: string;
    result: string | null;
    created_at: string;
    completed_at: string | null;
  }>;
}

// ── Fetch helper ─────────────────────────────────────────────────────────────

function getBackendUrl(): string {
  return (getEnv().BACKEND_URL || 'http://localhost:8008/v1').replace(/\/+$/, '');
}

async function kortixFetch<T>(apiPath: string, init?: RequestInit): Promise<T> {
  const url = `${getBackendUrl()}/kortix/projects${apiPath}`;
  const res = await authenticatedFetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Kortix API ${res.status}: ${text.slice(0, 100)}`);
  }
  return res.json();
}

// ── Query keys ───────────────────────────────────────────────────────────────

export const kortixKeys = {
  projects: () => ['kortix', 'projects'] as const,
  project: (id: string) => ['kortix', 'projects', id] as const,
};

// ── Hooks ────────────────────────────────────────────────────────────────────

export function useKortixProjects() {
  const serverVersion = useServerStore((s) => s.serverVersion);
  return useQuery<KortixProject[]>({
    queryKey: [...kortixKeys.projects(), serverVersion],
    queryFn: () => kortixFetch<KortixProject[]>(''),
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
  });
}

export function useKortixProject(id: string) {
  const serverVersion = useServerStore((s) => s.serverVersion);
  return useQuery<KortixProjectDetail>({
    queryKey: [...kortixKeys.project(id), serverVersion],
    queryFn: () => kortixFetch<KortixProjectDetail>(`/${encodeURIComponent(id)}`),
    enabled: !!id,
    staleTime: 15_000,
    gcTime: 5 * 60 * 1000,
    retry: 2,
  });
}

/**
 * Fetch sessions linked to a specific project.
 * Returns OpenCode session objects enriched with title, time, etc.
 */
export function useKortixProjectSessions(projectId: string) {
  const serverVersion = useServerStore((s) => s.serverVersion);
  return useQuery<any[]>({
    queryKey: ['kortix', 'projects', projectId, 'sessions', serverVersion],
    queryFn: () => kortixFetch<any[]>(`/${encodeURIComponent(projectId)}/sessions`),
    enabled: !!projectId,
    staleTime: 15_000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    retry: 2,
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; description?: string }) =>
      kortixFetch<KortixProject>(`/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: kortixKeys.project(vars.id) });
      qc.invalidateQueries({ queryKey: kortixKeys.projects() });
    },
  });
}
