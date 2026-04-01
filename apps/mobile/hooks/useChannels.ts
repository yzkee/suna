/**
 * React Query hooks for Channels management.
 * Mirrors the frontend's channels API against the backend /channels endpoints.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API_URL, getAuthToken } from '@/api/config';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ChannelType = 'telegram' | 'slack' | 'discord' | 'whatsapp' | 'teams' | 'voice' | 'email' | 'sms';

export interface ChannelConfig {
  channelConfigId: string;
  sandboxId: string | null;
  accountId: string;
  channelType: ChannelType;
  name: string;
  enabled: boolean;
  platformConfig: Record<string, unknown>;
  instructions: string | null;
  agentName: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  sandbox?: { name: string; status: string };
}

export interface CreateChannelData {
  name: string;
  channel_type: ChannelType;
  platform_config?: Record<string, unknown>;
  instructions?: string;
  agent_name?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateChannelData {
  name?: string;
  platform_config?: Record<string, unknown>;
  instructions?: string;
  agent_name?: string;
  metadata?: Record<string, unknown>;
}

// ─── API Helpers ─────────────────────────────────────────────────────────────

async function authFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getAuthToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers as Record<string, string>),
    },
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error?.message || body?.message || `Request failed (${res.status})`);
  }
  return body;
}

// ─── API Functions ───────────────────────────────────────────────────────────

async function listChannels(sandboxId?: string): Promise<ChannelConfig[]> {
  const query = sandboxId ? `?sandbox_id=${encodeURIComponent(sandboxId)}` : '';
  const envelope = await authFetch<{ success: boolean; data: ChannelConfig[] }>(
    `/channels${query}`,
  );
  return envelope.data || [];
}

async function getChannel(id: string): Promise<ChannelConfig> {
  const envelope = await authFetch<{ success: boolean; data: ChannelConfig }>(
    `/channels/${id}`,
  );
  return envelope.data;
}

async function createChannel(data: CreateChannelData): Promise<ChannelConfig> {
  const envelope = await authFetch<{ success: boolean; data: ChannelConfig }>(
    '/channels',
    { method: 'POST', body: JSON.stringify(data) },
  );
  return envelope.data;
}

async function updateChannel(id: string, data: UpdateChannelData): Promise<ChannelConfig> {
  const envelope = await authFetch<{ success: boolean; data: ChannelConfig }>(
    `/channels/${id}`,
    { method: 'PATCH', body: JSON.stringify(data) },
  );
  return envelope.data;
}

async function deleteChannel(id: string): Promise<void> {
  await authFetch(`/channels/${id}`, { method: 'DELETE' });
}

async function enableChannel(id: string): Promise<ChannelConfig> {
  const envelope = await authFetch<{ success: boolean; data: ChannelConfig }>(
    `/channels/${id}/enable`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return envelope.data;
}

async function disableChannel(id: string): Promise<ChannelConfig> {
  const envelope = await authFetch<{ success: boolean; data: ChannelConfig }>(
    `/channels/${id}/disable`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return envelope.data;
}

// ─── Query Keys ──────────────────────────────────────────────────────────────

export const channelKeys = {
  all: ['channels'] as const,
  list: (sandboxId?: string) => [...channelKeys.all, 'list', sandboxId] as const,
  detail: (id: string) => [...channelKeys.all, 'detail', id] as const,
};

// ─── Hooks ───────────────────────────────────────────────────────────────────

export function useChannels(sandboxId?: string) {
  return useQuery({
    queryKey: channelKeys.list(sandboxId),
    queryFn: () => listChannels(sandboxId),
    staleTime: 60 * 1000,
  });
}

export function useChannel(id: string) {
  return useQuery({
    queryKey: channelKeys.detail(id),
    queryFn: () => getChannel(id),
    enabled: !!id,
    staleTime: 60 * 1000,
  });
}

export function useCreateChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createChannel,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: channelKeys.all });
    },
  });
}

export function useUpdateChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateChannelData }) => updateChannel(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: channelKeys.all });
    },
  });
}

export function useDeleteChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteChannel,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: channelKeys.all });
    },
  });
}

export function useToggleChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      enabled ? enableChannel(id) : disableChannel(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: channelKeys.all });
    },
  });
}

// ─── Utilities ───────────────────────────────────────────────────────────────

export function getChannelTypeLabel(type: ChannelType): string {
  const labels: Record<ChannelType, string> = {
    telegram: 'Telegram',
    slack: 'Slack',
    discord: 'Discord',
    whatsapp: 'WhatsApp',
    teams: 'Teams',
    voice: 'Voice',
    email: 'Email',
    sms: 'SMS',
  };
  return labels[type] || type;
}

export function formatChannelDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
