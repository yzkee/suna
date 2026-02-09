'use client';

import { useQuery } from '@tanstack/react-query';
import { useServerStore } from '@/stores/server-store';
import { getFileStatus } from '../api/opencode-files';
import type { FileStatus } from '../types';

export const fileStatusKeys = {
  all: ['opencode-files', 'status'] as const,
  server: (serverUrl: string) =>
    ['opencode-files', 'status', serverUrl] as const,
};

/**
 * Fetch git status for all tracked/modified files in the project.
 *
 * Uses GET /file/status which returns FileStatus[] (added/modified/deleted).
 * Polls every 10s so the UI stays in sync with agent-driven changes.
 */
export function useFileStatus(options?: { enabled?: boolean }) {
  const serverUrl = useServerStore((s) => s.getActiveServerUrl());

  return useQuery<FileStatus[]>({
    queryKey: fileStatusKeys.server(serverUrl),
    queryFn: getFileStatus,
    enabled: options?.enabled !== false,
    staleTime: 5_000,
    gcTime: 2 * 60_000,
    refetchInterval: 10_000,
    refetchOnWindowFocus: false,
    retry: 2,
    retryDelay: 2000,
  });
}

/**
 * Build a lookup map from file path to its git status.
 * Useful for rendering status badges next to files in the browser.
 */
export function useFileStatusMap() {
  const { data: statuses } = useFileStatus();

  if (!statuses) return new Map<string, FileStatus>();

  const map = new Map<string, FileStatus>();
  for (const s of statuses) {
    map.set(s.path, s);
  }
  return map;
}
