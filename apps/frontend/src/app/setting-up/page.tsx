'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { KortixLogo } from '@/components/sidebar/kortix-logo';
import { ProvisioningProgress } from '@/components/provisioning/provisioning-progress';
import { useProviders } from '@/hooks/platform/use-sandbox';
import {
  SetupChecking,
  SetupConnect,
  SetupAutoTopup,
  SetupSuccess,
  SetupError,
  useSetupFlow,
} from '@/components/setup';

export default function SettingUpPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { data: providersInfo } = useProviders();

  const [paramsReady, setParamsReady] = useState(false);
  const [mockMode, setMockMode] = useState(false);
  const [subscriptionSuccess, setSubscriptionSuccess] = useState(false);
  const [checkoutSessionId, setCheckoutSessionId] = useState<string | null>(null);
  const [instanceMode, setInstanceMode] = useState(false);
  const [instanceModeId, setInstanceModeId] = useState<string | null>(null);
  const [requestedServerType, setRequestedServerType] = useState<string | null>(null);
  const [requestedLocation, setRequestedLocation] = useState<string | null>(null);
  const mockStartRef = useRef(0);
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
    if (params.get('server_type')) setRequestedServerType(params.get('server_type'));
    if (params.get('location')) setRequestedLocation(params.get('location'));
    setParamsReady(true);
  }, []);

  const isHetznerDefault = providersInfo?.default === 'hetzner';

  const onSubscription = useCallback(() => {
    router.replace('/subscription');
  }, [router]);

  const setStepRef = useRef<((s: any) => void) | null>(null);
  const onDashboard = useCallback(() => {
    setStepRef.current?.('success');
    setTimeout(() => router.push('/dashboard'), 500);
  }, [router]);

  const flow = useSetupFlow({
    instanceMode,
    instanceModeId,
    subscriptionSuccess,
    checkoutSessionId,
    mockMode,
    mockStartTime: mockStartRef.current,
    requestedServerType,
    requestedLocation,
    isHetznerDefault,
    onDashboard,
    onSubscription,
  });

  useEffect(() => { setStepRef.current = flow.setStep; }, [flow.setStep]);

  useEffect(() => {
    if (!paramsReady || autoStartedRef.current) return;
    if (!mockMode && !user) return;
    autoStartedRef.current = true;
    flow.run();
  }, [user, paramsReady, mockMode, flow.run]);

  const title = flow.step === 'checking' || flow.step === 'subscription'
    ? 'Setting Up'
    : flow.step === 'connect'
    ? 'Connect Instance'
    : flow.step === 'auto_topup'
    ? 'Auto-Topup'
    : 'Creating Workspace';

  return (
    <div className="w-full relative overflow-hidden min-h-screen bg-background">
      <style>{`
        @keyframes setting-up-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>

      <div className="relative flex flex-col items-center w-full px-4 sm:px-6 min-h-screen justify-center">
        <div className="relative z-10 w-full max-w-[400px] flex flex-col items-center">

          <div className="mb-12 flex flex-col items-center gap-3" style={{ animation: 'setting-up-fade-in 1s ease-out forwards' }}>
            <KortixLogo size={22} className="opacity-50" />
            <h1 className="text-[15px] font-normal text-foreground/30 tracking-[0.15em] uppercase">
              {title}
            </h1>
          </div>

          {(flow.step === 'checking' || flow.step === 'subscription') && (
            <SetupChecking phase={flow.step} />
          )}

          {flow.step === 'sandbox' && (
            <ProvisioningProgress
              progress={flow.activePoller.progress}
              phase={flow.activePoller.phase}
              stages={flow.activePoller.stages}
              currentStage={flow.activePoller.currentStage}
              machineInfo={flow.activePoller.machineInfo}
            />
          )}

          {flow.step === 'connect' && (
            <SetupConnect onConnected={onDashboard} error={flow.error} />
          )}

          {flow.step === 'auto_topup' && (
            <SetupAutoTopup
              onContinue={onDashboard}
              onSkip={onDashboard}
              error={flow.error}
            />
          )}

          {flow.step === 'success' && <SetupSuccess />}

          {flow.step === 'error' && (
            <SetupError
              message={flow.error}
              instanceMode={instanceMode}
              onRetry={flow.retry}
              onNavigate={(path) => router.push(path)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
