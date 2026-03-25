/**
 * Platform API Client for Kortix Computer Mobile
 *
 * Communicates with the Computer backend to manage sandbox lifecycle
 * and provides the sandbox URL for OpenCode session operations.
 *
 * All sandbox operations are proxied through:
 *   {BACKEND_URL}/p/{sandboxId}/{containerPort}
 */

import { API_URL, getAuthToken } from '@/api/config';
import { log } from '@/lib/logger';

// ─── Port Constants ──────────────────────────────────────────────────────────

export const SANDBOX_PORTS = {
  DESKTOP: '6080',
  DESKTOP_HTTPS: '6081',
  OPENCODE_UI: '3111',
  KORTIX_MASTER: '8000',
  BROWSER_STREAM: '9223',
  SSH: '22',
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export type SandboxProviderName = 'daytona' | 'local_docker' | 'justavps';

export interface SandboxInfo {
  sandbox_id: string;
  external_id: string;
  name: string;
  provider: SandboxProviderName;
  base_url: string;
  status: string;
  version?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface PlatformResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  created?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build the OpenCode server URL for a sandbox.
 * Pattern: {BACKEND_URL}/p/{externalId}/8000
 */
export function getSandboxUrl(sandboxExternalId: string): string {
  return `${API_URL}/p/${sandboxExternalId}/${SANDBOX_PORTS.KORTIX_MASTER}`;
}

/**
 * Build a URL to any port on the sandbox.
 */
export function getSandboxPortUrl(sandboxExternalId: string, port: string): string {
  return `${API_URL}/p/${sandboxExternalId}/${port}`;
}

async function platformFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<PlatformResponse<T>> {
  const token = await getAuthToken();
  if (!token) {
    throw new Error('Not authenticated');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...(options.headers as Record<string, string>),
  };

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  const body = await res.json();

  if (!res.ok) {
    throw new Error(body?.error || body?.message || `Platform API error ${res.status}`);
  }

  return body as PlatformResponse<T>;
}

// ─── API Methods ─────────────────────────────────────────────────────────────

/**
 * Ensure the user has a sandbox provisioned. Creates one if needed.
 * POST /platform/init
 */
export async function ensureSandbox(opts?: {
  provider?: SandboxProviderName;
}): Promise<{ sandbox: SandboxInfo; created: boolean }> {
  log.log('📦 [Platform] Ensuring sandbox...');
  const result = await platformFetch<SandboxInfo>('/platform/init', {
    method: 'POST',
    body: opts?.provider ? JSON.stringify({ provider: opts.provider }) : undefined,
  });

  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to ensure sandbox');
  }

  log.log('✅ [Platform] Sandbox ensured:', result.data.external_id);
  return { sandbox: result.data, created: result.created ?? false };
}

/**
 * Get user's active sandbox.
 * GET /platform/sandbox
 */
export async function getActiveSandbox(): Promise<SandboxInfo | null> {
  try {
    const result = await platformFetch<SandboxInfo>('/platform/sandbox', {
      method: 'GET',
    });

    if (!result.success || !result.data) {
      return null;
    }

    return result.data;
  } catch {
    return null;
  }
}

/**
 * List all sandboxes for the user.
 * GET /platform/sandbox/list
 */
export async function listSandboxes(): Promise<SandboxInfo[]> {
  const result = await platformFetch<SandboxInfo[]>('/platform/sandbox/list', {
    method: 'GET',
  });

  if (!result.success || !result.data) {
    return [];
  }

  return result.data;
}

/**
 * Restart the active sandbox.
 * POST /platform/sandbox/restart
 */
export async function restartSandbox(): Promise<void> {
  await platformFetch<void>('/platform/sandbox/restart', {
    method: 'POST',
  });
}

/**
 * Stop the active sandbox.
 * POST /platform/sandbox/stop
 */
export async function stopSandbox(): Promise<void> {
  await platformFetch<void>('/platform/sandbox/stop', {
    method: 'POST',
  });
}

/**
 * Delete/archive a sandbox by ID.
 * DELETE /platform/sandbox/:sandboxId
 */
export async function deleteSandbox(sandboxId: string): Promise<void> {
  await platformFetch<void>(`/platform/sandbox/${sandboxId}`, {
    method: 'DELETE',
  });
}

/**
 * Get available sandbox providers.
 * GET /platform/providers
 */
export async function getProviders(): Promise<string[]> {
  const result = await platformFetch<any>('/platform/providers', {
    method: 'GET',
  });
  const data = result.data;
  if (Array.isArray(data)) return data;
  // Some backends return { providers: [...] }
  if (data && Array.isArray(data.providers)) return data.providers;
  return [];
}

/**
 * Initialize a local Docker sandbox.
 * POST /platform/init/local
 */
export interface LocalSandboxProgress {
  status: string;
  progress: number;
  message: string;
}

export async function initLocalSandbox(
  name?: string,
  onProgress?: (progress: LocalSandboxProgress) => void,
): Promise<SandboxInfo> {
  const token = await getAuthToken();
  if (!token) throw new Error('Not authenticated');

  onProgress?.({ status: 'starting', progress: 0, message: 'Initializing...' });

  const res = await fetch(`${API_URL}/platform/init/local`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: name ? JSON.stringify({ name }) : undefined,
  });

  const body = await res.json();
  if (!res.ok) throw new Error(body?.error || body?.message || 'Failed to init local sandbox');

  // If already ready, return immediately
  if (body.data?.status === 'ready' || body.data?.status === 'running') {
    onProgress?.({ status: 'ready', progress: 100, message: 'Connected' });
    return body.data as SandboxInfo;
  }

  // Poll for progress
  for (let i = 0; i < 360; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const statusRes = await fetch(`${API_URL}/platform/init/local/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const statusBody = await statusRes.json();
    const data = statusBody.data;
    const status = data?.status;

    if (status === 'ready' || status === 'running') {
      onProgress?.({ status: 'ready', progress: 100, message: 'Connected' });
      return data as SandboxInfo;
    }
    if (status === 'error') {
      throw new Error(data?.message || 'Local sandbox creation failed');
    }

    // Report progress from backend or estimate
    const pct = data?.progress ?? Math.min(Math.round((i / 180) * 95), 95);
    const msg = data?.message || (i < 10 ? 'Pulling sandbox image...' : 'Setting up sandbox...');
    onProgress?.({ status: status || 'pulling', progress: pct, message: msg });
  }
  throw new Error('Timed out while pulling sandbox image');
}

/**
 * Add a custom URL instance to the server store.
 * POST /platform/sandbox with custom URL.
 * For now this is a local-only operation — custom URLs are stored on-device.
 */
export interface CustomInstance {
  id: string;
  label: string;
  url: string;
}

export async function checkInstanceHealth(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${url}/kortix/health`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.version ?? null;
  } catch {
    return null;
  }
}
