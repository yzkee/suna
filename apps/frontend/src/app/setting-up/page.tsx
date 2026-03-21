'use client';

import { useEffect, useState, Suspense, lazy, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, AlertCircle, RefreshCw, Loader2 } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { backendApi } from '@/lib/api-client';
import { getEnv } from '@/lib/env-config';
import { configureAutoTopup, markInstanceError } from '@/lib/api/billing';
import { KortixLogo } from '@/components/sidebar/kortix-logo';
import { AnimatedCircularProgressBar } from '@/components/ui/animated-circular-progress';
import { TextMorph } from 'torph/react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useServerStore } from '@/stores/server-store';
import { useProviders } from '@/hooks/platform/use-sandbox';
import { getSandbox, getSandboxUrl, listSandboxes } from '@/lib/platform-client';
import { authenticatedFetch } from '@/lib/auth-token';

// Lazy load heavy components
const AnimatedBg = lazy(() => import('@/components/ui/animated-bg').then(mod => ({ default: mod.AnimatedBg })));

type SetupStep = 'checking' | 'subscription' | 'sandbox' | 'connect' | 'auto_topup' | 'success' | 'error';

interface StepInfo {
  label: string;
  detail: string;
}

const STEP_INFO: Record<Exclude<SetupStep, 'success' | 'error'>, StepInfo> = {
  checking:     { label: 'Checking account',         detail: 'Verifying your account status...' },
  subscription: { label: 'Creating subscription',    detail: 'Setting up your plan...' },
  sandbox:      { label: 'Preparing workspace',      detail: 'Provisioning your cloud sandbox...' },
  connect:      { label: 'Connect instance',         detail: 'Add your own local/custom instance to continue.' },
  auto_topup:   { label: 'Auto-topup (optional)',    detail: 'Enable automatic credit reloads when balance is low.' },
};

interface ProvisioningStageInfo {
  id: string;
  progress: number;
  message: string;
}

interface SetupStatusResponse {
  subscription: 'ready' | 'pending';
  sandbox: 'none' | 'provisioning' | 'ready' | 'error';
  stage: string | null;
  stageProgress: number | null;
  stageMessage: string | null;
  machineInfo: { ip: string; serverType: string; location: string } | null;
  stages: ProvisioningStageInfo[] | null;
}

export default function SettingUpPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { data: providersInfo } = useProviders();
  const [step, setStep] = useState<SetupStep>('checking');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [sandboxProgress, setSandboxProgress] = useState(0);
  const [planTier, setPlanTier] = useState<'free' | 'pro' | 'none'>('none');
  const [instanceUrl, setInstanceUrl] = useState('http://localhost:8008/v1/p/kortix-sandbox/8000');
  const [instanceLabel, setInstanceLabel] = useState('Local Instance');
  const [isConnectingInstance, setIsConnectingInstance] = useState(false);
  const [autoTopupEnabled, setAutoTopupEnabled] = useState(false);
  const [autoTopupThreshold, setAutoTopupThreshold] = useState(5);
  const [autoTopupAmount, setAutoTopupAmount] = useState(15);
  const [isSavingAutoTopup, setIsSavingAutoTopup] = useState(false);
  const [sandboxPhase, setSandboxPhase] = useState<'provisioning' | 'booting'>('provisioning');
  const [provisioningStages, setProvisioningStages] = useState<ProvisioningStageInfo[] | null>(null);
  const [currentStage, setCurrentStage] = useState<string | null>(null);
  const [machineInfo, setMachineInfo] = useState<{ ip: string; serverType: string; location: string } | null>(null);
  const [subscriptionSuccess, setSubscriptionSuccess] = useState(false);
  const [checkoutSessionId, setCheckoutSessionId] = useState<string | null>(null);
  // mode=instance: provisioning an additional instance (skip subscription/auto-topup steps)
  const [instanceMode, setInstanceMode] = useState(false);
  const [instanceModeId, setInstanceModeId] = useState<string | null>(null);
  const [paramsReady, setParamsReady] = useState(false);
  const [mockMode, setMockMode] = useState(false);
  const mockStartRef = useRef(0);
  const isRunning = useRef(false);
  const runSeqRef = useRef(0);
  const autoStartedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    setSubscriptionSuccess(params.get('subscription') === 'success');
    setCheckoutSessionId(params.get('session_id'));
    if (params.get('mock') === 'true') {
      setMockMode(true);
      mockStartRef.current = Math.floor(Date.now() / 1000);
    }
    if (params.get('mode') === 'instance' && params.get('sandbox_id')) {
      setInstanceMode(true);
      setInstanceModeId(params.get('sandbox_id'));
    }
    setParamsReady(true);
  }, []);

  const isHetznerDefault = providersInfo?.default === 'hetzner';
  const stepInfo = {
    ...STEP_INFO,
    sandbox: {
      label: isHetznerDefault ? 'Preparing Hetzner VPS' : STEP_INFO.sandbox.label,
      detail: isHetznerDefault
        ? 'Provisioning from snapshot (cold starts usually 2-3 minutes)...'
        : STEP_INFO.sandbox.detail,
    },
  };

  const getHetznerProvisioningProgress = useCallback((elapsedSec: number): number => {
    if (elapsedSec < 20) return 8 + (elapsedSec / 20) * 12;
    if (elapsedSec < 90) return 20 + ((elapsedSec - 20) / 70) * 35;
    if (elapsedSec < 150) return 55 + ((elapsedSec - 90) / 60) * 30;
    return Math.min(96, 85 + ((elapsedSec - 150) / 120) * 11);
  }, []);

  /** Poll GET /billing/setup/status until sandbox is ready, then health-check it. */
  const pollSandboxReady = useCallback(async (
    isCurrentRun: () => boolean,
    timeoutMs = 240000,
  ): Promise<boolean> => {
    const started = Date.now();
    const deadline = started + timeoutMs;

    while (Date.now() < deadline && isCurrentRun()) {
      const elapsedSec = Math.floor((Date.now() - started) / 1000);

      try {
        let statusRes: { success: boolean; data?: SetupStatusResponse };

        if (mockMode) {
          // Direct fetch — bypass backendApi which requires auth session
          const res = await fetch(`${getEnv().BACKEND_URL}/billing/setup/status?mock=true&t=${mockStartRef.current}`, {
            signal: AbortSignal.timeout(10000),
          });
          statusRes = res.ok ? { success: true, data: await res.json() } : { success: false };
        } else {
          statusRes = await backendApi.get<SetupStatusResponse>(
            '/billing/setup/status',
            { showErrors: false, timeout: 10000 },
          );
        }

        if (statusRes.success && statusRes.data) {
          const d = statusRes.data;
          if (d.stages) setProvisioningStages(d.stages);
          if (d.stage) setCurrentStage(d.stage);
          if (d.machineInfo) setMachineInfo(d.machineInfo);
          if (d.stageProgress != null) {
            setSandboxProgress(d.stageProgress);
          } else if (isHetznerDefault) {
            setSandboxProgress(Math.max(2, Math.min(96, getHetznerProvisioningProgress(elapsedSec))));
          } else {
            setSandboxProgress(Math.min(90, 10 + elapsedSec * 2));
          }
        }

        if (statusRes.success && statusRes.data?.sandbox === 'error') {
          throw new Error('Cloud instance provisioning failed. Please try again.');
        }

        if (statusRes.success && statusRes.data?.sandbox === 'ready') {
          // Sandbox is ready in DB — switch to booting phase and health-check via proxy route
          setSandboxPhase('booting');
          try {
            const sandbox = await getSandbox();
            if (sandbox?.external_id) {
              const sandboxUrl = getSandboxUrl(sandbox);
              const healthRes = await authenticatedFetch(
                `${sandboxUrl}/kortix/health`,
                { signal: AbortSignal.timeout(5000) },
                { retryOnAuthError: false },
              );
              if (healthRes.ok) {
                const health = await healthRes.json().catch(() => null) as { version?: string } | null;
                const version = typeof health?.version === 'string' ? health.version : '';
                if (version && version !== '0.0.0') {
                  setSandboxProgress(100);
                  return true;
                }
              }
            }
          } catch {
            // Sandbox not reachable yet — keep polling
          }
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('provisioning failed')) {
          throw err;
        }
        // Network error polling status — keep trying
      }

      await new Promise((r) => setTimeout(r, 2500));
    }

    return false;
  }, [isHetznerDefault, getHetznerProvisioningProgress, mockMode]);

  /**
   * Poll a specific additional instance (by sandbox_id) until it's active + healthy.
   * Used when mode=instance (add-instance flow).
   */
  const pollAdditionalInstanceReady = useCallback(async (
    sandboxId: string,
    isCurrentRun: () => boolean,
    timeoutMs = 660000,
  ): Promise<boolean> => {
    const started = Date.now();
    const deadline = started + timeoutMs;

    while (Date.now() < deadline && isCurrentRun()) {
      const elapsedSec = Math.floor((Date.now() - started) / 1000);
      setSandboxProgress(Math.max(2, Math.min(96, getHetznerProvisioningProgress(elapsedSec))));

      try {
        // Poll account-state instances to find this sandbox's status
        const acctRes = await backendApi.get<any>('/billing/account-state', { showErrors: false, timeout: 10000 });
        if (acctRes.success && Array.isArray(acctRes.data?.instances)) {
          const inst = acctRes.data.instances.find((i: any) => i.sandbox_id === sandboxId);
          if (inst?.status === 'error') {
            const detail = inst?.error_message ? ` ${inst.error_message}` : '';
            throw new Error(`Instance provisioning failed.${detail}`);
          }
          if (inst?.status === 'active') {
            // DB says active — switch to booting phase and health-check it
            setSandboxPhase('booting');
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
                  const health = await healthRes.json().catch(() => null) as { version?: string } | null;
                  const version = typeof health?.version === 'string' ? health.version : '';
                  if (version && version !== '0.0.0') {
                    setSandboxProgress(100);
                    return true;
                  }
                }
              }
            } catch {
              // Not reachable yet — keep polling
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('provisioning failed')) throw err;
      }

      if (elapsedSec > 0 && elapsedSec % 60 === 0) {
        console.log(`[setting-up/instance] ${elapsedSec}s elapsed, still waiting...`);
      }
      await new Promise((r) => setTimeout(r, 2500));
    }

    return false;
  }, [getHetznerProvisioningProgress]);

  const waitForPaidActivation = useCallback(async (isCurrentRun: () => boolean, timeoutMs = 60000): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    let reconcileAttempted = false;

    while (Date.now() < deadline && isCurrentRun()) {
      try {
        const res = await backendApi.get<any>('/billing/account-state', { showErrors: false, timeout: 10000 });
        if (res.success) {
          const tierKey = res.data?.subscription?.tier_key || res.data?.tier?.name;
          if (tierKey === 'pro') {
            setPlanTier('pro');
            return true;
          }

          if (!reconcileAttempted && checkoutSessionId && tierKey !== 'pro') {
            reconcileAttempted = true;
            const confirmRes = await backendApi.post('/billing/confirm-checkout-session', {
              session_id: checkoutSessionId,
            }, { showErrors: false, timeout: 15000 });
            // If confirm hard-fails (not just pending), bail to subscription page immediately
            if (!confirmRes.success && (confirmRes.error as any)?.status === 400) {
              return false;
            }
          }
        }
      } catch {
        // Keep polling.
      }

      await new Promise((r) => setTimeout(r, 2000));
    }

    return false;
  }, [checkoutSessionId]);

  const continueToDashboard = useCallback(() => {
    setStep('success');
    setTimeout(() => {
      router.push('/dashboard');
    }, 500);
  }, [router]);

  const handleConnectInstance = useCallback(async () => {
    const trimmedUrl = instanceUrl.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(trimmedUrl)) {
      setErrorMessage('Instance URL must start with http:// or https://');
      return;
    }

    setIsConnectingInstance(true);
    setErrorMessage('');
    try {
      const id = (globalThis.crypto?.randomUUID?.() ?? `server_${Date.now()}`) as string;
      const label = instanceLabel.trim() || trimmedUrl.replace(/^https?:\/\//, '');

      await backendApi.post('/servers', {
        id,
        label,
        url: trimmedUrl,
        isDefault: false,
      });

      // Update local store immediately for smooth first dashboard load.
      useServerStore.setState((state) => ({
        servers: state.servers.some((s) => s.id === id)
          ? state.servers
          : [...state.servers, { id, label, url: trimmedUrl, isDefault: false }],
        activeServerId: id,
        userSelected: true,
      }));

      continueToDashboard();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to connect instance');
    } finally {
      setIsConnectingInstance(false);
    }
  }, [instanceUrl, instanceLabel, continueToDashboard]);

  const saveAutoTopupSettings = useCallback(async (): Promise<boolean> => {
    if (!autoTopupEnabled) return true;
    if (autoTopupThreshold < 5) {
      setErrorMessage('Auto-topup threshold must be at least $5.');
      return false;
    }
    if (autoTopupAmount < 15) {
      setErrorMessage('Auto-topup amount must be at least $15.');
      return false;
    }
    if (autoTopupAmount < autoTopupThreshold * 2) {
      setErrorMessage('Auto-topup amount must be at least 2x the threshold.');
      return false;
    }

    try {
      await configureAutoTopup({
        enabled: true,
        threshold: autoTopupThreshold,
        amount: autoTopupAmount,
      });
      return true;
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save auto-topup settings');
      return false;
    }
  }, [autoTopupEnabled, autoTopupThreshold, autoTopupAmount]);

  const handleAutoTopupContinue = useCallback(async () => {
    setIsSavingAutoTopup(true);
    setErrorMessage('');
    try {
      const ok = await saveAutoTopupSettings();
      if (ok) continueToDashboard();
    } finally {
      setIsSavingAutoTopup(false);
    }
  }, [saveAutoTopupSettings, continueToDashboard]);

  const runSetup = useCallback(async () => {
    if (isRunning.current) return;
    if (!mockMode && !user) return;
    isRunning.current = true;
    const runSeq = ++runSeqRef.current;
    const isCurrentRun = () => runSeqRef.current === runSeq;
    setErrorMessage('');

    try {
      // Mock mode: skip auth/billing, just show provisioning stages
      if (mockMode) {
        setPlanTier('pro');
        setStep('checking');
        await new Promise((r) => setTimeout(r, 1500));
        if (!isCurrentRun()) return;
        setStep('subscription');
        await new Promise((r) => setTimeout(r, 1500));
        if (!isCurrentRun()) return;
        setStep('sandbox');
        setSandboxProgress(0);
        setSandboxPhase('provisioning');
        await pollSandboxReady(isCurrentRun, 120000);
        if (!isCurrentRun()) return;
        setStep('auto_topup');
        return;
      }
      // ── Instance mode: provisioning an additional Hetzner instance ──────────
      // Skip subscription/auto-topup steps — just wait for the sandbox to be ready.
      if (instanceMode && instanceModeId) {
        setStep('sandbox');
        setPlanTier('pro');
        setSandboxProgress(0);
        setSandboxPhase('provisioning');

        const ready = await pollAdditionalInstanceReady(instanceModeId, isCurrentRun);
        if (!isCurrentRun()) return;
        if (!ready) {
          const timeoutMsg = 'Computer booted but services did not respond in time. Try a different location or retry.';
          // Mark the sandbox as error in DB so the Retry button appears in Settings
          await markInstanceError(instanceModeId, timeoutMsg).catch(() => {});
          throw new Error(timeoutMsg);
        }
        continueToDashboard();
        return;
      }

      // Step 1: Check account status
      if (!isCurrentRun()) return;
      setStep('checking');

      // Early-exit: if user has no subscription at all (tier_key: 'none') and they didn't
      // just complete a Stripe checkout, send them to /subscription to pick a plan.
      // This prevents getting stuck at "Checking account" for users who land here directly.
      if (!subscriptionSuccess) {
        try {
          const acctCheck = await backendApi.get<any>('/billing/account-state', { showErrors: false, timeout: 8000 });
          if (acctCheck.success) {
            const tierKey = acctCheck.data?.subscription?.tier_key || acctCheck.data?.tier?.name || '';
            if (!tierKey || tierKey === 'none') {
              router.replace('/subscription');
              return;
            }
          }
        } catch {
          // Can't reach backend — fall through and let initialize handle it
        }
      }

      // Checkout success redirects can arrive before webhooks finish.
      // Wait for the paid tier to be reflected before running initialize,
      // otherwise we'd accidentally initialize as free.
      if (subscriptionSuccess) {
        const activated = await waitForPaidActivation(isCurrentRun, 90000);
        if (!activated && isCurrentRun()) {
          router.replace('/subscription');
          return;
        }
      }

      // Step 2: Call initialize — returns fast, kicks off sandbox in background
      if (!isCurrentRun()) return;
      setStep('subscription');

      const initResponse = await backendApi.post<{
        status: string;
        tier: string;
        sandbox: 'created' | 'exists' | 'provisioning' | 'failed' | 'none';
      }>('/billing/setup/initialize', undefined, {
        timeout: 30000, // Should return in <2s now, but generous timeout
      });

      // Retry once on transient failure
      let response = initResponse;
      if (!response.success) {
        const status = (response.error as any)?.status;
        const message = (response.error as any)?.message || '';
        const isRetriable = status === 502 || /failed to fetch|network|gateway/i.test(String(message));
        if (isRetriable) {
          await new Promise((r) => setTimeout(r, 1500));
          response = await backendApi.post<{
            status: string;
            tier: string;
            sandbox: 'created' | 'exists' | 'provisioning' | 'failed' | 'none';
          }>('/billing/setup/initialize', undefined, { timeout: 30000 });
        }
      }

      if (!isCurrentRun()) return;

      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to initialize account');
      }

      const data = response.data!;
      const tier = data.tier === 'pro' ? 'pro' : 'free';
      setPlanTier(tier);

      // Free tier: require at least one connected custom/local instance.
      if (data.sandbox === 'none' || !data.sandbox) {
        if (!isCurrentRun()) return;

        const serversRes = await backendApi.get<Array<{ id: string }>>('/servers', {
          showErrors: false,
          timeout: 10000,
        });

        if (serversRes.success && Array.isArray(serversRes.data) && serversRes.data.length > 0) {
          continueToDashboard();
          return;
        }

        setStep('connect');
        return;
      }

      // Step 3: Poll for sandbox readiness (Pro users)
      if (!isCurrentRun()) return;
      setStep('sandbox');
      setSandboxProgress(0);
      setSandboxPhase('provisioning');

      if (data.sandbox === 'exists') {
        // Sandbox already existed — just verify it's healthy
        setSandboxProgress(80);
        const ready = await pollSandboxReady(isCurrentRun, 30000);
        if (!ready && isCurrentRun()) {
          // Already exists but not responding — let dashboard handle it
          console.warn('[setting-up] Existing sandbox not responding, proceeding to dashboard');
        }
      } else if (data.sandbox === 'provisioning' || data.sandbox === 'created') {
        // Provisioning in progress — poll until ready
        const ready = await pollSandboxReady(isCurrentRun, 660000);
        if (!ready && isCurrentRun()) {
          throw new Error(
            isHetznerDefault
              ? 'Hetzner sandbox is still provisioning. It can take up to ~10 minutes on first boot. Please wait and try again.'
              : 'Sandbox is still being prepared. Please wait and try again.'
          );
        }
      } else if (data.sandbox === 'failed') {
        throw new Error('Failed to create sandbox. Please try again.');
      }

      if (!isCurrentRun()) return;

      // Pro users get optional auto-topup setup before entering dashboard.
      if (tier === 'pro') {
        setStep('auto_topup');
        return;
      }

      continueToDashboard();
    } catch (err) {
      if (!isCurrentRun()) return;
      console.error('[setting-up] Setup error:', err);
      setErrorMessage(err instanceof Error ? err.message : 'An unexpected error occurred');
      setStep('error');
    } finally {
      if (isCurrentRun()) {
        isRunning.current = false;
      }
    }
  }, [user, isHetznerDefault, pollSandboxReady, pollAdditionalInstanceReady, continueToDashboard, subscriptionSuccess, waitForPaidActivation, instanceMode, instanceModeId]);

  useEffect(() => {
    if (!paramsReady || autoStartedRef.current) return;
    if (!mockMode && !user) return;
    autoStartedRef.current = true;
    runSetup();
  }, [user, paramsReady, mockMode, runSetup]);

  const handleRetry = () => {
    setStep('checking');
    runSetup();
  };

  // Human-friendly stage messages (translate internal IDs to user-facing copy)
  const stageDisplayText = (() => {
    if (step !== 'sandbox') return stepInfo[step as keyof typeof stepInfo]?.detail || 'Please wait...';
    if (sandboxPhase === 'booting') return 'Starting your workspace';
    if (!currentStage) return 'Preparing your workspace';
    const map: Record<string, string> = {
      server_creating: 'Spinning up your machine',
      server_created: 'Machine ready, configuring',
      cloud_init_running: 'Installing dependencies',
      cloud_init_done: 'Environment configured',
      docker_pulling: 'Preparing your workspace image',
      docker_running: 'Starting services',
      services_starting: 'Almost there',
      services_ready: 'Finishing up',
    };
    return map[currentStage] || 'Preparing your workspace';
  })();

  const stageCount = provisioningStages?.length || 0;
  const currentStageIdx = provisioningStages?.findIndex(s => s.id === currentStage) ?? -1;
  const completedCount = sandboxPhase === 'booting' ? stageCount : Math.max(0, currentStageIdx);

  return (
    <div className="w-full relative overflow-hidden min-h-screen bg-background">
      {/* Inline keyframes for animations */}
      <style>{`
        @keyframes setting-up-text-in {
          from { opacity: 0; transform: translateY(8px); filter: blur(4px); }
          to { opacity: 1; transform: translateY(0); filter: blur(0); }
        }
        @keyframes setting-up-dot-pop {
          0% { transform: scale(1); }
          50% { transform: scale(1.8); }
          100% { transform: scale(1); }
        }
        @keyframes setting-up-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .setting-up-text-enter {
          animation: setting-up-text-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .setting-up-dot-complete {
          animation: setting-up-dot-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
      `}</style>

      <div className="relative flex flex-col items-center w-full px-4 sm:px-6 min-h-screen justify-center">
        <div className="relative z-10 w-full max-w-[400px] flex flex-col items-center">

          {/* Top branding */}
          <div className="mb-12 flex flex-col items-center gap-3" style={{ animation: 'setting-up-fade-in 1s ease-out forwards' }}>
            <KortixLogo size={22} className="opacity-50" />
            <h1 className="text-[15px] font-normal text-foreground/30 tracking-[0.15em] uppercase">
              {step === 'checking' || step === 'subscription' ? 'Setting Up' : step === 'connect' ? 'Connect Instance' : step === 'auto_topup' ? 'Auto-Topup' : 'Creating Workspace'}
            </h1>
          </div>

          {(step === 'connect' || step === 'auto_topup') && errorMessage && (
            <p className="text-sm text-red-400 text-center mb-6">{errorMessage}</p>
          )}

          {step !== 'success' && step !== 'error' && (
            <>
              {(step === 'checking' || step === 'subscription') && (
                <div className="w-full flex flex-col items-center gap-6">
                  <div className="relative h-10 w-10 flex items-center justify-center">
                    <Loader2 className="size-5 text-primary animate-spin" />
                  </div>
                  <div className="space-y-3 text-center">
                    <div className="flex items-center justify-center gap-3">
                      {step === 'checking' ? (
                        <Loader2 className="size-3.5 text-primary animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-3.5 text-primary/50" />
                      )}
                      <span className={`text-[13px] ${step === 'checking' ? 'text-foreground/90 font-medium' : 'text-foreground/30'}`}>
                        Verifying account
                      </span>
                    </div>
                    <div className="flex items-center justify-center gap-3">
                      {step === 'subscription' ? (
                        <Loader2 className="size-3.5 text-primary animate-spin" />
                      ) : step === 'checking' ? (
                        <div className="h-1 w-1 rounded-full bg-foreground/15" />
                      ) : (
                        <CheckCircle2 className="size-3.5 text-primary/50" />
                      )}
                      <span className={`text-[13px] ${step === 'subscription' ? 'text-foreground/90 font-medium' : step === 'checking' ? 'text-foreground/15' : 'text-foreground/30'}`}>
                        Setting up subscription
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {step === 'sandbox' && (
                <div className="w-full flex flex-col items-center">
                  <div className="relative" style={{ animation: 'setting-up-fade-in 0.6s ease-out forwards' }}>
                    <AnimatedCircularProgressBar
                      value={sandboxProgress}
                      gaugePrimaryColor="var(--color-primary)"
                      gaugeSecondaryColor="var(--color-primary)"
                      className="size-36 [&>span]:hidden [&_circle:first-of-type]:opacity-15"
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <TextMorph className="text-2xl font-light text-foreground/90 tabular-nums">
                        {`${Math.round(sandboxProgress)}%`}
                      </TextMorph>
                    </div>
                  </div>

                  {provisioningStages && provisioningStages.length > 0 ? (
                    <div className="mt-8 w-full max-w-[300px] relative h-[108px]" style={{ overflow: 'hidden', clipPath: 'inset(0)' }}>
                      {/* Fade masks */}
                      <div className="absolute top-0 left-0 right-0 h-10 bg-gradient-to-b from-background via-background/80 to-transparent z-20 pointer-events-none" />
                      <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-background via-background/80 to-transparent z-20 pointer-events-none" />

                      {/* Scrolling list */}
                      <div
                        className="absolute left-0 right-0 flex flex-col transition-transform duration-700 ease-out"
                        style={{
                          transform: `translateY(${36 - (completedCount * 36)}px)`,
                        }}
                      >
                        {provisioningStages.map((ps, i) => {
                          const isDone = i < completedCount || sandboxPhase === 'booting';
                          const isActive = i === completedCount && sandboxPhase !== 'booting';

                          return (
                            <div key={ps.id} className="flex items-center justify-center gap-3 h-9 shrink-0 w-full">
                              <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                                {isDone ? (
                                  <CheckCircle2 className="size-3.5 text-primary/50" />
                                ) : isActive ? (
                                  <Loader2 className="size-3.5 text-primary animate-spin" />
                                ) : (
                                  <div className="h-1 w-1 rounded-full bg-foreground/15" />
                                )}
                              </div>
                              <span className={`text-[13px] transition-all duration-500 ${
                                isActive ? 'text-foreground/90 font-medium' : isDone ? 'text-foreground/25' : 'text-foreground/15'
                              }`}>
                                {ps.message}
                              </span>
                            </div>
                          );
                        })}
                        {sandboxPhase === 'booting' && (
                          <div className="flex items-center justify-center gap-3 h-9 shrink-0 w-full">
                            <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                              <Loader2 className="size-3.5 text-primary animate-spin" />
                            </div>
                            <span className="text-[13px] text-foreground/90 font-medium">Starting workspace...</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="mt-6 relative min-h-[24px] flex items-center justify-center">
                        <h2
                          key={stageDisplayText}
                          className="setting-up-text-enter text-[16px] font-normal text-foreground/70 text-center"
                        >
                          {stageDisplayText}
                        </h2>
                      </div>
                      <p className="mt-1 text-[12px] text-foreground/20">
                        This usually takes about a minute
                      </p>
                    </>
                  )}

                  <div className="mt-6 w-12 h-px bg-foreground/[0.06]" />

                  {stageCount > 0 && (
                    <div className="mt-6 flex items-center gap-[6px]">
                      {provisioningStages!.map((ps, i) => {
                        const isDone = i < completedCount;
                        const isActive = i === completedCount && sandboxPhase !== 'booting';
                        const allDone = sandboxPhase === 'booting';

                        return (
                          <div
                            key={ps.id}
                            className={`rounded-full transition-all duration-700 ease-out ${
                              isDone || allDone
                                ? 'h-[5px] w-[5px] bg-primary/50 setting-up-dot-complete'
                                : isActive
                                  ? 'h-[7px] w-[7px] bg-primary/80'
                                  : 'h-[5px] w-[5px] bg-foreground/[0.06]'
                            }`}
                            style={isDone ? { animationDelay: `${i * 60}ms` } : undefined}
                          />
                        );
                      })}
                    </div>
                  )}

                  {machineInfo?.ip && (
                    <div
                      className="mt-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-foreground/[0.03] border border-foreground/[0.06]"
                      style={{ animation: 'setting-up-fade-in 0.8s ease-out forwards' }}
                    >
                      <div className="h-1.5 w-1.5 rounded-full bg-primary/50" />
                      <span className="text-[11px] text-foreground/30 font-mono tracking-wide">
                        {machineInfo.location?.toLowerCase().includes('us') || machineInfo.location?.toLowerCase().includes('hil') ? 'US' : 'EU'} · {machineInfo.ip}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {step === 'connect' && (
                <Card className="w-full bg-card border border-border py-0 gap-0">
                  <CardContent className="p-6 space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs text-foreground/70">Instance URL</label>
                      <input
                        value={instanceUrl}
                        onChange={(e) => setInstanceUrl(e.target.value)}
                        className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm"
                        placeholder="http://localhost:8008/v1/p/kortix-sandbox/8000"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-foreground/70">Label (optional)</label>
                      <input
                        value={instanceLabel}
                        onChange={(e) => setInstanceLabel(e.target.value)}
                        className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm"
                        placeholder="My local instance"
                      />
                    </div>
                    <Button onClick={handleConnectInstance} disabled={isConnectingInstance} className="w-full">
                      {isConnectingInstance ? 'Connecting...' : 'Connect Instance & Continue'}
                    </Button>
                  </CardContent>
                </Card>
              )}

              {step === 'auto_topup' && (
                <div className="w-full flex flex-col items-center gap-6">
                  <button
                    type="button"
                    onClick={() => setAutoTopupEnabled(!autoTopupEnabled)}
                    className={`w-full rounded-xl border p-4 text-left transition-colors ${
                      autoTopupEnabled ? 'border-primary/30 bg-primary/5' : 'border-border bg-card hover:bg-muted/40'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Enable Auto-Topup</p>
                        <p className="text-xs text-foreground/40 mt-0.5">Never run out of credits mid-task</p>
                      </div>
                      <div className={`h-5 w-9 rounded-full transition-colors flex items-center px-0.5 ${
                        autoTopupEnabled ? 'bg-primary justify-end' : 'bg-foreground/10 justify-start'
                      }`}>
                        <div className="h-4 w-4 rounded-full bg-white shadow-sm transition-all" />
                      </div>
                    </div>
                  </button>

                  {autoTopupEnabled && (
                    <div className="w-full grid grid-cols-2 gap-3" style={{ animation: 'setting-up-fade-in 0.3s ease-out forwards' }}>
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-foreground/40 uppercase tracking-wider">When balance drops below</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground/30">$</span>
                          <input
                            type="number"
                            min={1}
                            value={autoTopupThreshold}
                            onChange={(e) => setAutoTopupThreshold(Number(e.target.value || 0))}
                            className="w-full h-10 pl-7 pr-3 rounded-lg border border-border bg-card text-sm tabular-nums"
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-foreground/40 uppercase tracking-wider">Reload amount</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground/30">$</span>
                          <input
                            type="number"
                            min={5}
                            value={autoTopupAmount}
                            onChange={(e) => setAutoTopupAmount(Number(e.target.value || 0))}
                            className="w-full h-10 pl-7 pr-3 rounded-lg border border-border bg-card text-sm tabular-nums"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="w-full flex gap-3 pt-2">
                    <Button variant="outline" className="flex-1 h-10" onClick={continueToDashboard}>
                      Skip
                    </Button>
                    <Button className="flex-1 h-10" onClick={handleAutoTopupContinue} disabled={isSavingAutoTopup}>
                      {autoTopupEnabled ? (isSavingAutoTopup ? 'Saving...' : 'Save & Continue') : 'Continue'}
                    </Button>
                  </div>
                </div>
              )}

            </>
          )}

          {step === 'success' && (
            <div className="flex flex-col items-center gap-4">
              <CheckCircle2 className="h-10 w-10 text-primary/70" />
              <h1 className="text-[24px] font-normal tracking-tight text-foreground text-center">
                You&apos;re All Set
              </h1>
              <p className="text-[14px] text-foreground/40 text-center">
                Redirecting to your workspace...
              </p>
            </div>
          )}

          {step === 'error' && (
            <>
              <h1 className="text-[43px] font-normal tracking-tight text-foreground leading-none text-center">
                {instanceMode ? 'Provisioning Failed' : 'Setup Issue'}
              </h1>

              <Card className="w-full min-h-24 bg-card border border-border">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col gap-1">
                        <div className='flex items-center gap-2'>
                          <div className="h-2.5 w-2.5 bg-red-500 rounded-full"></div>
                          <span className="text-base font-medium text-red-400">
                            {instanceMode ? 'Instance Error' : 'Setup Error'}
                          </span>
                        </div>
                        <p className="text-sm text-gray-400">
                          {errorMessage || (instanceMode
                            ? 'The instance could not be provisioned.'
                            : 'Please try again or choose a plan manually.')}
                        </p>
                      </div>
                    </div>
                    <div className="h-12 w-12 flex items-center justify-center">
                      <AlertCircle className="h-6 w-6 text-red-500" />
                    </div>
                  </div>
                  <div className="flex gap-3 mt-4">
                    {instanceMode ? (
                      <>
                        <Button
                          onClick={() => router.push('/dashboard?open_add_instance=1')}
                          className="flex-1"
                          variant="default"
                        >
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Try Different Location
                        </Button>
                        <Button
                          onClick={() => router.push('/dashboard')}
                          className="flex-1"
                          variant="outline"
                        >
                          Go to Dashboard
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          onClick={handleRetry}
                          className="flex-1"
                          variant="default"
                        >
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Try Again
                        </Button>
                        <Button
                          onClick={() => router.push('/subscription')}
                          className="flex-1"
                          variant="outline"
                        >
                          Choose a Plan
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {/* <div
          className="absolute inset-0 opacity-[0.15] pointer-events-none z-50"
          style={{
            backgroundImage: 'url(/grain-texture.png)',
            backgroundRepeat: 'repeat',
            mixBlendMode: 'overlay'
          }}
        /> */}

      </div>
    </div>
  );
}

/** Order for step-completion checks. */
function getStepOrder(s: SetupStep): number {
  switch (s) {
    case 'checking': return 0;
    case 'subscription': return 1;
    case 'sandbox': return 2;
    case 'connect': return 3;
    case 'auto_topup': return 4;
    case 'success': return 5;
    case 'error': return -1;
    default: return -1;
  }
}
