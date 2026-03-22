import { useState, useCallback, useRef } from 'react';
import { backendApi } from '@/lib/api-client';
import { useSandboxPoller } from '@/hooks/platform/use-sandbox-poller';
import { markInstanceError } from '@/lib/api/billing';

export type SetupStep = 'checking' | 'subscription' | 'sandbox' | 'connect' | 'auto_topup' | 'success' | 'error';

interface SetupFlowOpts {
  instanceMode: boolean;
  instanceModeId: string | null;
  subscriptionSuccess: boolean;
  checkoutSessionId: string | null;
  mockMode: boolean;
  mockStartTime: number;
  requestedServerType: string | null;
  requestedLocation: string | null;
  isHetznerDefault: boolean;
  onDashboard: () => void;
  onSubscription: () => void;
}

export function useSetupFlow(opts: SetupFlowOpts) {
  const {
    instanceMode, instanceModeId, subscriptionSuccess, checkoutSessionId,
    mockMode, mockStartTime, requestedServerType, requestedLocation,
    isHetznerDefault, onDashboard, onSubscription,
  } = opts;

  const [step, setStep] = useState<SetupStep>('checking');
  const [error, setError] = useState('');
  const [planTier, setPlanTier] = useState<'free' | 'pro' | 'none'>('none');
  const isRunning = useRef(false);
  const runSeqRef = useRef(0);

  const primaryPoller = useSandboxPoller({ mockMode, mockStartTime });
  const instancePoller = useSandboxPoller({ sandboxId: instanceModeId, timeoutMs: 660000 });
  const activePoller = instanceMode ? instancePoller : primaryPoller;

  const waitForSandbox = useCallback(async (poller: typeof primaryPoller): Promise<boolean> => {
    setStep('sandbox');
    const result = await poller.poll();
    if (result.status === 'ready') return true;
    if (result.status === 'error') throw new Error(result.error || 'Provisioning failed');
    return false;
  }, []);

  const waitForPaidActivation = useCallback(async (isCurrentRun: () => boolean, timeoutMs = 60000): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    let reconcileAttempted = false;
    while (Date.now() < deadline && isCurrentRun()) {
      try {
        const res = await backendApi.get<any>('/billing/account-state', { showErrors: false, timeout: 10000 });
        if (res.success) {
          const tierKey = res.data?.subscription?.tier_key || res.data?.tier?.name;
          if (tierKey === 'pro') { setPlanTier('pro'); return true; }
          if (!reconcileAttempted && checkoutSessionId && tierKey !== 'pro') {
            reconcileAttempted = true;
            const confirmRes = await backendApi.post('/billing/confirm-checkout-session', {
              session_id: checkoutSessionId,
            }, { showErrors: false, timeout: 15000 });
            if (!confirmRes.success && (confirmRes.error as any)?.status === 400) return false;
          }
        }
      } catch { /* keep polling */ }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
  }, [checkoutSessionId]);

  const run = useCallback(async () => {
    if (isRunning.current) return;
    isRunning.current = true;
    const runSeq = ++runSeqRef.current;
    const isCurrentRun = () => runSeqRef.current === runSeq;
    setError('');

    try {
      if (mockMode) {
        setPlanTier('pro');
        setStep('checking');
        await new Promise((r) => setTimeout(r, 1500));
        if (!isCurrentRun()) return;
        setStep('subscription');
        await new Promise((r) => setTimeout(r, 1500));
        if (!isCurrentRun()) return;
        await waitForSandbox(primaryPoller);
        if (!isCurrentRun()) return;
        setStep('auto_topup');
        return;
      }

      if (instanceMode && instanceModeId) {
        setPlanTier('pro');
        try {
          const ready = await waitForSandbox(instancePoller);
          if (!isCurrentRun()) return;
          if (ready) { onDashboard(); return; }
        } catch (err) {
          if (!isCurrentRun()) return;
          const msg = err instanceof Error ? err.message : 'Provisioning failed';
          await markInstanceError(instanceModeId, msg).catch(() => {});
          throw err;
        }
        onDashboard();
        return;
      }

      // Resume check
      if (!subscriptionSuccess) {
        try {
          const resumed = await primaryPoller.resolveCurrentState();
          if (resumed) {
            if (resumed.status === 'ready') { onDashboard(); return; }
            if (resumed.status === 'polling') {
              setPlanTier('pro');
              const ready = await waitForSandbox(primaryPoller);
              if (!isCurrentRun()) return;
              if (ready) { onDashboard(); return; }
            }
          }
        } catch (err) {
          if (err instanceof Error && err.message.includes('failed')) throw err;
        }
      }

      // Step 1: Check account
      if (!isCurrentRun()) return;
      setStep('checking');

      if (!subscriptionSuccess) {
        try {
          const acctCheck = await backendApi.get<any>('/billing/account-state', { showErrors: false, timeout: 8000 });
          if (acctCheck.success) {
            const tierKey = acctCheck.data?.subscription?.tier_key || acctCheck.data?.tier?.name || '';
            if (!tierKey || tierKey === 'none') { onSubscription(); return; }
          }
        } catch { /* fall through */ }
      }

      if (subscriptionSuccess) {
        const activated = await waitForPaidActivation(isCurrentRun, 90000);
        if (!activated && isCurrentRun()) { onSubscription(); return; }
      }

      // Step 2: Initialize
      if (!isCurrentRun()) return;
      setStep('subscription');

      let response = await backendApi.post<{
        status: string; tier: string;
        sandbox: 'created' | 'exists' | 'provisioning' | 'failed' | 'none';
      }>('/billing/setup/initialize', {
        ...(requestedServerType && { server_type: requestedServerType }),
        ...(requestedLocation && { location: requestedLocation }),
      }, { timeout: 30000 });

      if (!response.success) {
        const status = (response.error as any)?.status;
        const message = (response.error as any)?.message || '';
        const isRetriable = status === 502 || /failed to fetch|network|gateway/i.test(String(message));
        if (isRetriable) {
          await new Promise((r) => setTimeout(r, 1500));
          response = await backendApi.post('/billing/setup/initialize', {
            ...(requestedServerType && { server_type: requestedServerType }),
            ...(requestedLocation && { location: requestedLocation }),
          }, { timeout: 30000 });
        }
      }

      if (!isCurrentRun()) return;
      if (!response.success) throw new Error(response.error?.message || 'Failed to initialize account');

      const data = response.data!;
      const tier = data.tier === 'pro' ? 'pro' : 'free';
      setPlanTier(tier);

      if (data.sandbox === 'none' || !data.sandbox) {
        if (!isCurrentRun()) return;
        const serversRes = await backendApi.get<Array<{ id: string }>>('/servers', { showErrors: false, timeout: 10000 });
        if (serversRes.success && Array.isArray(serversRes.data) && serversRes.data.length > 0) {
          onDashboard();
          return;
        }
        setStep('connect');
        return;
      }

      // Step 3: Wait for sandbox
      if (!isCurrentRun()) return;

      if (data.sandbox === 'exists') {
        const ready = await waitForSandbox(primaryPoller);
        if (!ready && isCurrentRun()) {
          console.warn('[setup] Existing sandbox not responding, proceeding to dashboard');
        }
      } else if (data.sandbox === 'provisioning' || data.sandbox === 'created') {
        const ready = await waitForSandbox(primaryPoller);
        if (!ready && isCurrentRun()) {
          console.warn('[setup] Sandbox polling timed out, proceeding to dashboard');
        }
      } else if (data.sandbox === 'failed') {
        throw new Error('Failed to create sandbox. Please try again.');
      }

      if (!isCurrentRun()) return;
      if (tier === 'pro') { setStep('auto_topup'); return; }
      onDashboard();
    } catch (err) {
      if (!isCurrentRun()) return;
      console.error('[setup] Error:', err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      setStep('error');
    } finally {
      if (isCurrentRun()) isRunning.current = false;
    }
  }, [
    mockMode, instanceMode, instanceModeId, subscriptionSuccess, checkoutSessionId,
    requestedServerType, requestedLocation, isHetznerDefault,
    primaryPoller, instancePoller, waitForSandbox, waitForPaidActivation,
    onDashboard, onSubscription,
  ]);

  const retry = useCallback(() => {
    primaryPoller.reset();
    instancePoller.reset();
    setStep('checking');
    isRunning.current = false;
    run();
  }, [run, primaryPoller, instancePoller]);

  return {
    step, error, planTier, activePoller,
    run, retry, setStep,
    continueToDashboard: onDashboard,
  };
}
