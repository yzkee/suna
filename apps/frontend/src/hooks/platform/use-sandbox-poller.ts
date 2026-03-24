/**
 * useSandboxPoller — polls GET /platform/sandbox/:id/status for provisioning progress.
 *
 * Single source of truth. Backend does the health check. Frontend just reads status.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { backendApi } from '@/lib/api-client';
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
  pollIntervalMs?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function initial(): SandboxPollerState {
  return { status: 'idle', progress: 0, stages: null, currentStage: null, machineInfo: null, error: null };
}

function estimateProgress(elapsedSec: number): number {
  if (elapsedSec < 20) return 8 + (elapsedSec / 20) * 12;
  if (elapsedSec < 90) return 20 + ((elapsedSec - 20) / 70) * 35;
  if (elapsedSec < 150) return 55 + ((elapsedSec - 90) / 60) * 30;
  return Math.min(96, 85 + ((elapsedSec - 150) / 120) * 11);
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useSandboxPoller(opts: UseSandboxPollerOpts = {}) {
  const {
    sandboxId = null,
    timeoutMs = 660_000,
    pollIntervalMs = 2500,
  } = opts;

  const [state, setState] = useState<SandboxPollerState>(initial);
  const stateRef = useRef<SandboxPollerState>(state);
  const stoppedRef = useRef(false);
  const pollingRef = useRef(false);

  const set = useCallback((next: SandboxPollerState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const update = useCallback((patch: Partial<SandboxPollerState>) => {
    const next = { ...stateRef.current, ...patch };
    stateRef.current = next;
    setState(next);
  }, []);

  const stop = useCallback(() => { stoppedRef.current = true; pollingRef.current = false; }, []);
  const reset = useCallback(() => { stop(); set(initial()); }, [stop, set]);

  const fetchStatus = useCallback(async (): Promise<StatusResponse | null> => {
    if (!sandboxId) return null;
    const res = await backendApi.get<StatusResponse>(`/platform/sandbox/${sandboxId}/status`, {
      showErrors: false,
      timeout: 10_000,
    });
    return res.success ? (res.data ?? null) : null;
  }, [sandboxId]);

  const poll = useCallback(async (): Promise<SandboxPollerState> => {
    if (pollingRef.current) return stateRef.current;
    if (!sandboxId) return stateRef.current;

    pollingRef.current = true;
    stoppedRef.current = false;
    update({ status: 'polling' });

    const deadline = Date.now() + timeoutMs;
    let startedAt: number | null = null;

    while (Date.now() < deadline && !stoppedRef.current) {
      try {
        const d = await fetchStatus();

        if (d?.startedAt && !startedAt) startedAt = new Date(d.startedAt).getTime();
        const elapsed = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;

        if (!d) {
          update({ progress: Math.max(2, estimateProgress(elapsed)) });
        } else if (d.status === 'active') {
          set({ ...initial(), status: 'ready', progress: 100 });
          pollingRef.current = false;
          return stateRef.current;
        } else if (d.status === 'error') {
          set({ ...initial(), status: 'error', error: d.error || 'Provisioning failed' });
          pollingRef.current = false;
          return stateRef.current;
        } else {
          update({
            progress: d.stageProgress ?? Math.max(2, estimateProgress(elapsed)),
            stages: d.stages ?? stateRef.current.stages,
            currentStage: d.stage ?? stateRef.current.currentStage,
            machineInfo: d.machineInfo ?? stateRef.current.machineInfo,
          });
        }
      } catch {
        // Transient error — keep polling
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    if (!stoppedRef.current) {
      set({ ...stateRef.current, status: 'error', error: 'Provisioning timed out.' });
    }
    pollingRef.current = false;
    return stateRef.current;
  }, [sandboxId, timeoutMs, pollIntervalMs, fetchStatus, set, update]);

  useEffect(() => () => { stoppedRef.current = true; }, []);

  return { ...state, poll, stop, reset };
}
