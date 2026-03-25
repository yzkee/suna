/**
 * useSandboxPoller — monitors provisioning progress via SSE + HTTP polling fallback.
 *
 * Primary: connects to GET /platform/sandbox/:id/provision-stream (SSE)
 *   - Real-time stage updates from backend event bus
 *   - Works with both webhooks AND the background provision-poller
 *
 * Fallback: if SSE fails or disconnects, falls back to HTTP polling
 *   GET /platform/sandbox/:id/status every 5s
 *
 * The backend provision-poller (sandbox-provision-poller.ts) polls JustAVPS
 * every 8s and emits events, so even without webhooks the SSE stream gets updates.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { getSupabaseAccessToken } from '@/lib/auth-token';
import { backendApi } from '@/lib/api-client';
import { getEnv } from '@/lib/env-config';
import type { ProvisioningStageInfo } from '@/lib/provisioning-stages';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SandboxPollerState {
  status: 'idle' | 'polling' | 'ready' | 'error';
  progress: number;
  stages: ProvisioningStageInfo[] | null;
  currentStage: string | null;
  machineInfo: { ip: string; serverType: string; location: string } | null;
  error: string | null;
}

interface StatusResponse {
  status: 'provisioning' | 'active' | 'error' | 'stopped' | 'archived' | 'not_found';
  stage: string | null;
  stageProgress: number | null;
  stageMessage: string | null;
  machineInfo: { ip: string; serverType: string; location: string } | null;
  stages: ProvisioningStageInfo[] | null;
  error?: string | null;
  startedAt: string | null;
}

interface UseSandboxPollerOpts {
  sandboxId?: string | null;
  timeoutMs?: number;
}

// ─── Stage → progress mapping (mirrors backend) ────────────────────────────

const STAGE_PROGRESS: Record<string, number> = {
  server_creating: 10,
  server_created: 25,
  cloud_init_running: 40,
  cloud_init_done: 55,
  docker_pulling: 65,
  docker_running: 80,
  services_starting: 90,
  services_ready: 100,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function initial(): SandboxPollerState {
  return { status: 'idle', progress: 0, stages: null, currentStage: null, machineInfo: null, error: null };
}

function getPlatformUrl(): string {
  return getEnv().BACKEND_URL || 'http://localhost:8008/v1';
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useSandboxPoller(opts: UseSandboxPollerOpts = {}) {
  const {
    sandboxId = null,
    timeoutMs = 660_000,
  } = opts;

  const [state, setState] = useState<SandboxPollerState>(initial);
  const stateRef = useRef<SandboxPollerState>(state);
  const stoppedRef = useRef(false);
  const pollingRef = useRef(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const set = useCallback((next: SandboxPollerState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const update = useCallback((patch: Partial<SandboxPollerState>) => {
    const next = { ...stateRef.current, ...patch };
    stateRef.current = next;
    setState(next);
  }, []);

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    pollingRef.current = false;
    cleanup();
  }, [cleanup]);

  const reset = useCallback(() => {
    stop();
    set(initial());
  }, [stop, set]);

  // ── HTTP polling fallback ────────────────────────────────────────────────

  const fetchStatus = useCallback(async (): Promise<StatusResponse | null> => {
    if (!sandboxId) return null;
    const res = await backendApi.get<StatusResponse>(`/platform/sandbox/${sandboxId}/status`, {
      showErrors: false,
      timeout: 10_000,
    });
    return res.success ? (res.data ?? null) : null;
  }, [sandboxId]);

  const startFallbackPolling = useCallback(() => {
    if (stoppedRef.current) return;

    const tick = async () => {
      if (stoppedRef.current) return;

      try {
        const d = await fetchStatus();
        if (!d || stoppedRef.current) {
          // No data — keep polling
        } else if (d.status === 'active') {
          set({ ...initial(), status: 'ready', progress: 100 });
          pollingRef.current = false;
          return; // Done — don't schedule next tick
        } else if (d.status === 'error') {
          set({ ...initial(), status: 'error', error: d.error || 'Provisioning failed' });
          pollingRef.current = false;
          return;
        } else {
          update({
            progress: d.stageProgress ?? stateRef.current.progress,
            stages: d.stages ?? stateRef.current.stages,
            currentStage: d.stage ?? stateRef.current.currentStage,
            machineInfo: d.machineInfo ?? stateRef.current.machineInfo,
          });
        }
      } catch {
        // Transient error — keep polling
      }

      if (!stoppedRef.current) {
        fallbackTimerRef.current = setTimeout(tick, 5_000);
      }
    };

    tick();
  }, [fetchStatus, set, update]);

  // ── SSE-first provisioning monitor ───────────────────────────────────────

  const poll = useCallback(async (): Promise<SandboxPollerState> => {
    if (pollingRef.current) return stateRef.current;
    if (!sandboxId) return stateRef.current;

    pollingRef.current = true;
    stoppedRef.current = false;
    cleanup();
    update({ status: 'polling' });

    // Global timeout
    timeoutTimerRef.current = setTimeout(() => {
      if (!stoppedRef.current && pollingRef.current) {
        set({ ...stateRef.current, status: 'error', error: 'Provisioning timed out.' });
        stop();
      }
    }, timeoutMs);

    // Try SSE first
    try {
      const token = await getSupabaseAccessToken();
      if (!token) throw new Error('No auth token');

      const baseUrl = getPlatformUrl();
      const sseUrl = `${baseUrl}/platform/sandbox/${sandboxId}/provision-stream?token=${encodeURIComponent(token)}`;

      const es = new EventSource(sseUrl);
      eventSourceRef.current = es;

      let sseConnected = false;

      es.addEventListener('status', (e) => {
        if (stoppedRef.current) return;
        sseConnected = true;
        try {
          const data = JSON.parse(e.data);
          if (data.status === 'active') {
            set({ ...initial(), status: 'ready', progress: 100 });
            pollingRef.current = false;
            cleanup();
          } else if (data.status === 'error') {
            set({ ...initial(), status: 'error', error: data.message || 'Provisioning failed' });
            pollingRef.current = false;
            cleanup();
          } else if (data.provisioning_stage) {
            const progress = STAGE_PROGRESS[data.provisioning_stage] ?? stateRef.current.progress;
            update({ progress, currentStage: data.provisioning_stage });
          }
        } catch { /* malformed SSE data */ }
      });

      es.addEventListener('stage', (e) => {
        if (stoppedRef.current) return;
        try {
          const data = JSON.parse(e.data);

          if (data.status === 'ready' || data.stage === 'services_ready') {
            set({ ...initial(), status: 'ready', progress: 100 });
            pollingRef.current = false;
            cleanup();
            return;
          }

          if (data.status === 'error') {
            set({ ...initial(), status: 'error', error: data.message || 'Provisioning failed' });
            pollingRef.current = false;
            cleanup();
            return;
          }

          if (data.stage) {
            const progress = STAGE_PROGRESS[data.stage] ?? stateRef.current.progress;
            update({
              progress: Math.max(stateRef.current.progress, progress), // Never go backward
              currentStage: data.stage,
            });
          }
        } catch { /* malformed SSE data */ }
      });

      es.addEventListener('done', () => {
        // Stream completed — if we're still in polling state, check final status via HTTP
        if (pollingRef.current && !stoppedRef.current && stateRef.current.status === 'polling') {
          cleanup();
          startFallbackPolling();
        }
      });

      es.onerror = () => {
        if (stoppedRef.current) return;
        // SSE failed — fall back to HTTP polling
        console.warn('[useSandboxPoller] SSE connection failed, falling back to HTTP polling');
        cleanup();
        if (pollingRef.current) {
          startFallbackPolling();
        }
      };

      // If SSE doesn't connect within 5s, fall back
      setTimeout(() => {
        if (!sseConnected && pollingRef.current && !stoppedRef.current) {
          console.warn('[useSandboxPoller] SSE did not connect within 5s, falling back to HTTP polling');
          cleanup();
          startFallbackPolling();
        }
      }, 5_000);

    } catch {
      // SSE setup failed entirely — fall back to HTTP polling
      console.warn('[useSandboxPoller] SSE setup failed, using HTTP polling');
      startFallbackPolling();
    }

    return stateRef.current;
  }, [sandboxId, timeoutMs, cleanup, update, set, stop, startFallbackPolling]);

  // Cleanup on unmount
  useEffect(() => () => {
    stoppedRef.current = true;
    cleanup();
  }, [cleanup]);

  return { ...state, poll, stop, reset };
}
