/**
 * useSandboxPoller — monitors provisioning progress via HTTP polling.
 *
 * Adapted from the web frontend's useSandboxPoller hook.
 * Uses HTTP polling (GET /platform/sandbox/:id/status every 5s) instead of SSE
 * for simplicity and reliability on mobile.
 *
 * Includes time-based interpolation between stages for smooth progress animation.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { API_URL, getAuthToken } from '@/api/config';
import { log } from '@/lib/logger';
import {
  STAGE_PROGRESS_MAP,
  STAGE_DURATION_MS,
  type ProvisioningStageInfo,
} from './provisioning-stages';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SandboxPollerState {
  status: 'idle' | 'polling' | 'ready' | 'error';
  progress: number;
  stages: ProvisioningStageInfo[] | null;
  currentStage: string | null;
  machineInfo: { ip: string; serverType: string; location: string } | null;
  error: string | null;
  stageEnteredAt: number | null;
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
  enabled?: boolean;
  timeoutMs?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function initial(): SandboxPollerState {
  return {
    status: 'idle',
    progress: 0,
    stages: null,
    currentStage: null,
    machineInfo: null,
    error: null,
    stageEnteredAt: null,
  };
}

/** Interpolate progress within a stage based on elapsed time */
function interpolateProgress(stage: string, stageEnteredAt: number, baseProgress: number): number {
  const durationMs = STAGE_DURATION_MS[stage];
  if (!durationMs) return baseProgress;

  const nextStageKeys = Object.keys(STAGE_PROGRESS_MAP);
  const currentIdx = nextStageKeys.indexOf(stage);
  const nextStage = nextStageKeys[currentIdx + 1];
  const nextProgress = nextStage ? STAGE_PROGRESS_MAP[nextStage] : baseProgress + 5;

  const elapsed = Date.now() - stageEnteredAt;
  const fraction = Math.min(1, elapsed / durationMs);
  // ease-out: slow down as we approach the next stage
  const eased = 1 - Math.pow(1 - fraction, 2);
  const interpolated = Math.round(baseProgress + eased * (nextProgress - baseProgress - 1));
  // Never interpolate to 100 — that's reserved for truly ready
  return Math.min(interpolated, 99);
}

function getSandboxProxyUrl(sandboxId: string): string {
  const base = API_URL.replace('/v1', '');
  return `${base}/p/${sandboxId}/8000`;
}

async function waitForOpenCodeHealthy(
  sandboxId: string,
  signal: AbortSignal,
): Promise<boolean> {
  const url = getSandboxProxyUrl(sandboxId);
  const timeout = 180_000; // 3 minutes
  const interval = 3_000;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    if (signal.aborted) return false;
    try {
      const token = await getAuthToken();
      const res = await fetch(`${url}/global/health`, {
        signal,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.healthy === true) return true;
      }
    } catch {
      // Transient error — keep retrying
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useSandboxPoller(opts: UseSandboxPollerOpts = {}) {
  const {
    sandboxId = null,
    enabled = true,
    timeoutMs = 660_000,
  } = opts;

  const [state, setState] = useState<SandboxPollerState>(initial);
  const stateRef = useRef<SandboxPollerState>(state);
  const stoppedRef = useRef(false);
  const pollingRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interpolationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const healthAbortRef = useRef<AbortController | null>(null);

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
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
    if (interpolationRef.current) {
      clearInterval(interpolationRef.current);
      interpolationRef.current = null;
    }
    if (healthAbortRef.current) {
      healthAbortRef.current.abort();
      healthAbortRef.current = null;
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

  // ── Fetch sandbox status ───────────────────────────────────────────────

  const fetchStatus = useCallback(async (): Promise<StatusResponse | null> => {
    if (!sandboxId) return null;
    try {
      const token = await getAuthToken();
      if (!token) return null;

      const res = await fetch(`${API_URL}/platform/sandbox/${sandboxId}/status`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      if (!res.ok) return null;
      const data = await res.json();
      return data?.data ?? data;
    } catch {
      return null;
    }
  }, [sandboxId]);

  // ── Polling loop ────────────────────────────────────────────────────────

  const startPolling = useCallback(() => {
    if (stoppedRef.current || !sandboxId) return;

    pollingRef.current = true;
    update({ status: 'polling', stageEnteredAt: Date.now() });

    // Start interpolation interval (smooth progress between polls)
    if (!interpolationRef.current) {
      interpolationRef.current = setInterval(() => {
        const s = stateRef.current;
        if (s.status !== 'polling' || !s.currentStage || s.stageEnteredAt === null) return;
        const base = STAGE_PROGRESS_MAP[s.currentStage] ?? s.progress;
        const interpolated = interpolateProgress(s.currentStage, s.stageEnteredAt, base);
        if (interpolated > s.progress) {
          const next = { ...s, progress: interpolated };
          stateRef.current = next;
          setState(next);
        }
      }, 500);
    }

    // Global timeout
    timeoutTimerRef.current = setTimeout(() => {
      if (!stoppedRef.current && pollingRef.current) {
        set({ ...stateRef.current, status: 'error', error: 'Provisioning timed out.' });
        stop();
      }
    }, timeoutMs);

    // Polling tick
    const tick = async () => {
      if (stoppedRef.current) return;

      try {
        const d = await fetchStatus();
        if (!d || stoppedRef.current) {
          // No data — keep polling
        } else if (d.status === 'active') {
          log.log('[SandboxPoller] Sandbox active, verifying health...');
          update({
            status: 'polling',
            currentStage: 'verifying_opencode',
            progress: STAGE_PROGRESS_MAP.verifying_opencode,
            stageEnteredAt: Date.now(),
          });

          healthAbortRef.current?.abort();
          const ac = new AbortController();
          healthAbortRef.current = ac;

          waitForOpenCodeHealthy(sandboxId, ac.signal).then((healthy) => {
            if (stoppedRef.current) return;
            if (healthy) {
              log.log('[SandboxPoller] Health check passed — ready!');
              set({ ...initial(), status: 'ready', progress: 100 });
            } else {
              log.error('[SandboxPoller] Health check failed');
              set({ ...stateRef.current, status: 'error', error: 'Workspace services failed to start.' });
            }
            pollingRef.current = false;
            cleanup();
          });
          return; // Don't schedule next poll — health check takes over
        } else if (d.status === 'error') {
          set({ ...initial(), status: 'error', error: d.error || 'Provisioning failed' });
          pollingRef.current = false;
          cleanup();
          return;
        } else {
          // Still provisioning — update state
          const isNewStage = d.stage !== null && d.stage !== stateRef.current.currentStage;
          update({
            progress: Math.max(stateRef.current.progress, d.stageProgress ?? stateRef.current.progress),
            stages: d.stages ?? stateRef.current.stages,
            currentStage: d.stage ?? stateRef.current.currentStage,
            machineInfo: d.machineInfo ?? stateRef.current.machineInfo,
            stageEnteredAt: isNewStage ? Date.now() : stateRef.current.stageEnteredAt,
          });
        }
      } catch {
        // Transient error — keep polling
      }

      if (!stoppedRef.current) {
        pollTimerRef.current = setTimeout(tick, 5_000);
      }
    };

    tick();
  }, [sandboxId, timeoutMs, cleanup, update, set, stop, fetchStatus]);

  // ── Start/stop based on enabled + sandboxId ────────────────────────────

  useEffect(() => {
    if (enabled && sandboxId && !pollingRef.current) {
      stoppedRef.current = false;
      startPolling();
    }

    return () => {
      stoppedRef.current = true;
      cleanup();
    };
  }, [enabled, sandboxId, startPolling, cleanup]);

  // ── Pause/resume on app background/foreground ──────────────────────────

  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === 'active' && enabled && sandboxId && !pollingRef.current && stateRef.current.status !== 'ready') {
        log.log('[SandboxPoller] App foregrounded, resuming polling');
        stoppedRef.current = false;
        startPolling();
      } else if (nextState === 'background') {
        log.log('[SandboxPoller] App backgrounded, pausing polling');
        stoppedRef.current = true;
        pollingRef.current = false;
        cleanup();
      }
    };

    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [enabled, sandboxId, startPolling, cleanup]);

  return { ...state, stop, reset };
}
