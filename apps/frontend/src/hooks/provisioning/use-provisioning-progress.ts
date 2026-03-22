'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { backendApi } from '@/lib/api-client';
import { authenticatedFetch } from '@/lib/auth-token';
import { getSandboxUrl, listSandboxes } from '@/lib/platform-client';
import type { ProvisioningStageInfo } from '@/components/provisioning/provisioning-progress';

interface MachineInfo {
  ip: string;
  serverType: string;
  location: string;
}

interface UseProvisioningProgressResult {
  progress: number;
  phase: 'provisioning' | 'booting';
  stages: ProvisioningStageInfo[] | null;
  currentStage: string | null;
  machineInfo: MachineInfo | null;
  error: string | null;
  isReady: boolean;
}

function getProvisioningProgress(elapsedSec: number): number {
  if (elapsedSec < 20) return 8 + (elapsedSec / 20) * 12;
  if (elapsedSec < 90) return 20 + ((elapsedSec - 20) / 70) * 35;
  if (elapsedSec < 150) return 55 + ((elapsedSec - 90) / 60) * 30;
  return Math.min(96, 85 + ((elapsedSec - 150) / 120) * 11);
}

export function useProvisioningProgress(sandboxId: string | null): UseProvisioningProgressResult {
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<'provisioning' | 'booting'>('provisioning');
  const [stages, setStages] = useState<ProvisioningStageInfo[] | null>(null);
  const [currentStage, setCurrentStage] = useState<string | null>(null);
  const [machineInfo, setMachineInfo] = useState<MachineInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const pollingRef = useRef(false);
  const startedRef = useRef(0);

  const poll = useCallback(async () => {
    if (!sandboxId || pollingRef.current) return;
    pollingRef.current = true;
    startedRef.current = Date.now();

    const TIMEOUT_MS = 660000;
    const deadline = startedRef.current + TIMEOUT_MS;

    while (Date.now() < deadline && pollingRef.current) {
      const elapsedSec = Math.floor((Date.now() - startedRef.current) / 1000);
      setProgress(Math.max(2, Math.min(96, getProvisioningProgress(elapsedSec))));

      try {
        const res = await backendApi.get<any>('/billing/account-state', { showErrors: false, timeout: 10000 });
        if (res.success && Array.isArray(res.data?.instances)) {
          const inst = res.data.instances.find((i: any) => i.sandbox_id === sandboxId);

          if (inst?.status === 'error') {
            const detail = inst?.error_message ? ` ${inst.error_message}` : '';
            setError(`Instance provisioning failed.${detail}`);
            pollingRef.current = false;
            return;
          }

          if (inst?.status === 'active') {
            setPhase('booting');
            try {
              const all = await listSandboxes();
              const sandbox = all.find((s) => s.sandbox_id === sandboxId);
              if (sandbox?.external_id) {
                const sandboxUrl = getSandboxUrl(sandbox);
                const healthRes = await authenticatedFetch(
                  `${sandboxUrl}/kortix/health`,
                  { signal: AbortSignal.timeout(5000) },
                  { retryOnAuthError: false },
                );
                if (healthRes.ok) {
                  const health = (await healthRes.json().catch(() => null)) as { version?: string } | null;
                  const version = typeof health?.version === 'string' ? health.version : '';
                  if (version && version !== '0.0.0') {
                    setProgress(100);
                    setIsReady(true);
                    pollingRef.current = false;
                    return;
                  }
                }
              }
            } catch {
              // Not reachable yet
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('provisioning failed')) {
          setError(err.message);
          pollingRef.current = false;
          return;
        }
      }

      await new Promise((r) => setTimeout(r, 2500));
    }

    if (pollingRef.current) {
      setError('Provisioning timed out. Try a different location or retry.');
      pollingRef.current = false;
    }
  }, [sandboxId]);

  useEffect(() => {
    if (sandboxId) {
      setProgress(0);
      setPhase('provisioning');
      setStages(null);
      setCurrentStage(null);
      setMachineInfo(null);
      setError(null);
      setIsReady(false);
      poll();
    }

    return () => {
      pollingRef.current = false;
    };
  }, [sandboxId, poll]);

  return { progress, phase, stages, currentStage, machineInfo, error, isReady };
}
