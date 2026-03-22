import { useState, useCallback, useRef, useEffect } from 'react';
import { backendApi } from '@/lib/api-client';
import { getEnv } from '@/lib/env-config';
import { getSandbox, getSandboxUrl, listSandboxes } from '@/lib/platform-client';
import { authenticatedFetch } from '@/lib/auth-token';
import type { ProvisioningStageInfo } from '@/components/provisioning/provisioning-progress';

export interface SandboxPollerState {
  status: 'idle' | 'polling' | 'ready' | 'error';
  phase: 'provisioning' | 'booting';
  progress: number;
  stages: ProvisioningStageInfo[] | null;
  currentStage: string | null;
  machineInfo: { ip: string; serverType: string; location: string } | null;
  error: string | null;
  version: string | null;
}

interface SetupStatusResponse {
  subscription: 'ready' | 'pending';
  sandbox: 'none' | 'provisioning' | 'ready' | 'error';
  stage: string | null;
  stageProgress: number | null;
  stageMessage: string | null;
  machineInfo: { ip: string; serverType: string; location: string } | null;
  stages: ProvisioningStageInfo[] | null;
  startedAt: string | null;
}

interface UseSandboxPollerOpts {
  sandboxId?: string | null;
  timeoutMs?: number;
  pollIntervalMs?: number;
  mockMode?: boolean;
  mockStartTime?: number;
}

function estimateProgress(elapsedSec: number): number {
  if (elapsedSec < 20) return 8 + (elapsedSec / 20) * 12;
  if (elapsedSec < 90) return 20 + ((elapsedSec - 20) / 70) * 35;
  if (elapsedSec < 150) return 55 + ((elapsedSec - 90) / 60) * 30;
  return Math.min(96, 85 + ((elapsedSec - 150) / 120) * 11);
}

interface HealthResult {
  version: string | null;
  starting: boolean;
}

async function checkSandboxHealth(sandboxId?: string): Promise<HealthResult> {
  try {
    let sandbox;
    if (sandboxId) {
      const all = await listSandboxes();
      sandbox = all.find((s) => s.sandbox_id === sandboxId);
    } else {
      sandbox = await getSandbox();
    }
    if (!sandbox?.external_id) return { version: null, starting: false };

    const sandboxUrl = getSandboxUrl(sandbox);
    const res = await authenticatedFetch(
      `${sandboxUrl}/kortix/health`,
      { signal: AbortSignal.timeout(5000) },
      { retryOnAuthError: false },
    );

    const health = await res.json().catch(() => null) as { version?: string; status?: string } | null;
    const version = typeof health?.version === 'string' ? health.version : '';
    const isStarting = health?.status === 'starting';

    if (res.ok && version && version !== '0.0.0') {
      return { version, starting: false };
    }
    return { version: null, starting: isStarting };
  } catch {
    return { version: null, starting: false };
  }
}

function initialState(): SandboxPollerState {
  return {
    status: 'idle',
    phase: 'provisioning',
    progress: 0,
    stages: null,
    currentStage: null,
    machineInfo: null,
    error: null,
    version: null,
  };
}

export function useSandboxPoller(opts: UseSandboxPollerOpts = {}) {
  const {
    sandboxId = null,
    timeoutMs = 660000,
    pollIntervalMs = 2500,
    mockMode = false,
    mockStartTime = 0,
  } = opts;

  const [state, setState] = useState<SandboxPollerState>(initialState);
  const stateRef = useRef<SandboxPollerState>(state);
  const stoppedRef = useRef(false);
  const pollingRef = useRef(false);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    pollingRef.current = false;
  }, []);

  const reset = useCallback(() => {
    stop();
    const init = initialState();
    setState(init);
    stateRef.current = init;
  }, [stop]);

  const setStateTracked = useCallback((updater: SandboxPollerState | ((prev: SandboxPollerState) => SandboxPollerState)) => {
    setState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      stateRef.current = next;
      return next;
    });
  }, []);

  const updateState = useCallback((patch: Partial<SandboxPollerState>) => {
    setStateTracked((prev) => ({ ...prev, ...patch }));
  }, [setStateTracked]);

  const pollStatus = useCallback(async (): Promise<{ success: boolean; data?: SetupStatusResponse }> => {
    if (mockMode) {
      const res = await fetch(
        `${getEnv().BACKEND_URL}/billing/setup/status?mock=true&t=${mockStartTime}`,
        { signal: AbortSignal.timeout(10000) },
      );
      return res.ok ? { success: true, data: await res.json() } : { success: false };
    }
    const params = sandboxId ? `?sandbox_id=${sandboxId}` : '';
    return backendApi.get<SetupStatusResponse>(`/billing/setup/status${params}`, {
      showErrors: false,
      timeout: 10000,
    });
  }, [mockMode, mockStartTime, sandboxId]);

  const resolveFromStatus = useCallback(async (res: { success: boolean; data?: SetupStatusResponse }): Promise<SandboxPollerState | null> => {
    if (!res.success || !res.data) return null;
    const d = res.data;

    if (d.sandbox === 'error') {
      return { ...initialState(), status: 'error', error: 'Provisioning failed' };
    }
    if (d.sandbox === 'ready') {
      const health = await checkSandboxHealth(sandboxId ?? undefined);
      if (health.version) {
        return { ...initialState(), status: 'ready', progress: 100, phase: 'booting', version: health.version };
      }
      return {
        ...initialState(),
        status: 'polling',
        progress: health.starting ? 95 : (d.stageProgress ?? 90),
        phase: 'booting',
        stages: d.stages,
        currentStage: d.stage,
        machineInfo: d.machineInfo,
      };
    }
    if (d.sandbox === 'provisioning') {
      return {
        ...initialState(),
        status: 'polling',
        progress: d.stageProgress ?? 10,
        phase: 'provisioning',
        stages: d.stages,
        currentStage: d.stage,
        machineInfo: d.machineInfo,
      };
    }
    return null;
  }, [sandboxId]);

  const resolveCurrentState = useCallback(async (): Promise<SandboxPollerState | null> => {
    try {
      const res = await pollStatus();
      return resolveFromStatus(res);
    } catch {
      return null;
    }
  }, [sandboxId, pollStatus, resolveFromStatus]);

  const poll = useCallback(async (): Promise<SandboxPollerState> => {
    if (pollingRef.current) return stateRef.current;
    pollingRef.current = true;
    stoppedRef.current = false;

    const resumed = await resolveCurrentState();
    if (resumed) {
      if (resumed.status === 'ready' || resumed.status === 'error') {
        setStateTracked(resumed);
        pollingRef.current = false;
        return resumed;
      }
      updateState({
        status: 'polling',
        phase: resumed.phase,
        stages: resumed.stages,
        currentStage: resumed.currentStage,
        machineInfo: resumed.machineInfo,
      });
    } else {
      updateState({ status: 'polling' });
    }
    const deadline = Date.now() + timeoutMs;
    let provisioningStartedAt: number | null = null;

    while (Date.now() < deadline && !stoppedRef.current) {
      try {
        const statusRes = await pollStatus();
        const resolved = await resolveFromStatus(statusRes);

        if (statusRes.data?.startedAt && !provisioningStartedAt) {
          provisioningStartedAt = new Date(statusRes.data.startedAt).getTime();
        }
        const elapsedSec = provisioningStartedAt
          ? Math.floor((Date.now() - provisioningStartedAt) / 1000)
          : 0;

        if (resolved) {
          if (resolved.status === 'ready' || resolved.status === 'error') {
            setStateTracked(resolved);
            pollingRef.current = false;
            return stateRef.current;
          }
          const progress = resolved.progress > 0
            ? resolved.progress
            : Math.max(2, Math.min(96, estimateProgress(elapsedSec)));
          updateState({
            phase: resolved.phase,
            progress,
            stages: resolved.stages ?? stateRef.current.stages,
            currentStage: resolved.currentStage ?? stateRef.current.currentStage,
            machineInfo: resolved.machineInfo ?? stateRef.current.machineInfo,
          });
        } else {
          updateState({ progress: Math.max(2, Math.min(96, estimateProgress(elapsedSec))) });
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('failed')) {
          setStateTracked((prev) => ({ ...prev, status: 'error', error: err.message }));
          pollingRef.current = false;
          return stateRef.current;
        }
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    if (!stoppedRef.current) {
      setStateTracked((prev) => ({
        ...prev,
        status: 'error',
        error: 'Provisioning timed out. Please wait and try again.',
      }));
    }
    pollingRef.current = false;
    return stateRef.current;
  }, [timeoutMs, pollIntervalMs, pollStatus, resolveFromStatus, resolveCurrentState, updateState, setStateTracked]);

  useEffect(() => {
    return () => { stoppedRef.current = true; };
  }, []);

  return {
    ...state,
    poll,
    stop,
    reset,
    isPolling: pollingRef.current,
    resolveCurrentState,
  };
}
