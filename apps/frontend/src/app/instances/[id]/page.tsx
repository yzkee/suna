'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useQuery } from '@tanstack/react-query';
import { KortixLogo } from '@/components/sidebar/kortix-logo';
import { ProvisioningProgress } from '@/components/provisioning/provisioning-progress';
import { InstanceSetupFlow } from '@/components/instance/setup-flow';
import { useSandboxPoller } from '@/hooks/platform/use-sandbox-poller';
import { listSandboxes } from '@/lib/platform-client';
import { switchToInstanceAsync } from '@/stores/server-store';
import { buildInstancePath } from '@/lib/instance-routes';
import { authenticatedFetch } from '@/lib/auth-token';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { getEnv } from '@/lib/env-config';

function LocalProvisioningView({ progress }: { progress: { progress: number; message: string } | null }) {
  const pct = progress?.progress ?? 0;
  const msg = progress?.message ?? 'Preparing your workspace...';

  return (
    <div className="w-full max-w-[340px] flex flex-col items-center gap-6">
      {/* Progress ring */}
      <div className="relative h-28 w-28">
        <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" fill="none" strokeWidth="4" className="stroke-foreground/[0.06]" />
          <circle
            cx="50" cy="50" r="42" fill="none" strokeWidth="4"
            strokeLinecap="round"
            className="stroke-primary transition-all duration-700 ease-out"
            strokeDasharray={`${2 * Math.PI * 42}`}
            strokeDashoffset={`${2 * Math.PI * 42 * (1 - pct / 100)}`}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xl font-light text-foreground/80 tabular-nums">{Math.round(pct)}%</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full space-y-2">
        <div className="w-full bg-foreground/[0.06] rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-primary h-full rounded-full transition-all duration-700 ease-out"
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        </div>
        <p className="text-[12px] text-muted-foreground/50 text-center">{msg}</p>
      </div>

      <p className="text-[11px] text-muted-foreground/30 text-center">
        First boot can take a few minutes while the image is pulled.
      </p>
    </div>
  );
}

export default function InstanceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const autoStartedRef = useRef(false);
  const [showSetup, setShowSetup] = useState(false);
  const [booting, setBooting] = useState(true); // brief "connecting" state before setup
  const switchedRef = useRef(false);
  const [localProgress, setLocalProgress] = useState<{ progress: number; message: string } | null>(null);
  const localPollingRef = useRef(false);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/auth');
  }, [authLoading, user, router]);

  const { data: sandbox, isLoading, error, refetch } = useQuery({
    queryKey: ['platform', 'sandbox', 'detail', id],
    queryFn: async () => {
      const all = await listSandboxes();
      return all.find((s) => s.sandbox_id === id) ?? null;
    },
    enabled: !!user && !!id,
    refetchInterval: 5000,
  });

  // When sandbox becomes active, register it in server store.
  // Then check if setup is needed (first boot = no ONBOARDING_COMPLETE).
  useEffect(() => {
    if (!sandbox || switchedRef.current) return;
    if (sandbox.status !== 'active' || !sandbox.external_id) return;

    switchedRef.current = true;
    switchToInstanceAsync(sandbox.sandbox_id).then(async (result) => {
      if (!result) return;

      // Check if initial setup (provider config) was already done
      try {
        const { authenticatedFetch } = await import('@/lib/auth-token');
        const { getActiveOpenCodeUrl } = await import('@/stores/server-store');
        const url = getActiveOpenCodeUrl();
        if (url) {
          const res = await authenticatedFetch(`${url}/env/INSTANCE_SETUP_COMPLETE`, {
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            const data = await res.json();
            if (data?.INSTANCE_SETUP_COMPLETE === 'true') {
              // Setup done — go to dashboard (onboarding handles itself there)
              router.replace(buildInstancePath(sandbox.sandbox_id, '/dashboard'));
              return;
            }
          }
        }
      } catch {
        // Can't check — show setup to be safe
      }

      // First boot — show brief "connecting" then setup flow
      setBooting(true);
      await new Promise((r) => setTimeout(r, 1500));
      setBooting(false);
      setShowSetup(true);
    });
  }, [sandbox, router]);

  const handleSetupComplete = useCallback(async () => {
    if (!sandbox) return;
    // Mark instance setup (provider config) as done — separate from ONBOARDING_COMPLETE
    try {
      const { authenticatedFetch } = await import('@/lib/auth-token');
      const { getActiveOpenCodeUrl } = await import('@/stores/server-store');
      const url = getActiveOpenCodeUrl();
      if (url) {
        await authenticatedFetch(`${url}/env/INSTANCE_SETUP_COMPLETE`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: 'true' }),
        });
      }
    } catch { /* best effort */ }
    // Go to dashboard — the dashboard layout will redirect to onboarding if needed
    router.replace(buildInstancePath(sandbox.sandbox_id, '/dashboard'));
  }, [sandbox, router]);

  // Provisioning poller — cloud instances use the sandbox status endpoint
  const isLocalDocker = sandbox?.provider === 'local_docker';
  const poller = useSandboxPoller({ sandboxId: isLocalDocker ? undefined : id });

  useEffect(() => {
    if (!sandbox || autoStartedRef.current || isLocalDocker) return;
    if (sandbox.status === 'provisioning') {
      autoStartedRef.current = true;
      poller.poll();
    }
  }, [sandbox, poller, isLocalDocker]);

  useEffect(() => {
    if (poller.status === 'ready') refetch();
  }, [poller.status, refetch]);

  // Local Docker: poll /platform/init/local/status for real pull progress
  useEffect(() => {
    if (!sandbox || !isLocalDocker || sandbox.status !== 'provisioning') return;
    if (localPollingRef.current) return;
    localPollingRef.current = true;

    let stopped = false;
    const backendUrl = getEnv().BACKEND_URL || 'http://localhost:8008/v1';

    const poll = async () => {
      if (stopped) return;
      try {
        const res = await authenticatedFetch(`${backendUrl}/platform/init/local/status`);
        const data = await res.json();

        if (data.status === 'ready') {
          setLocalProgress({ progress: 100, message: 'Ready' });
          localPollingRef.current = false;
          refetch();
          return;
        }
        if (data.status === 'error') {
          setLocalProgress(null);
          localPollingRef.current = false;
          refetch();
          return;
        }

        setLocalProgress({
          progress: data.progress || 0,
          message: data.status === 'creating'
            ? 'Creating container...'
            : data.message || 'Pulling sandbox image...',
        });

        if (!stopped) setTimeout(poll, 2000);
      } catch {
        if (!stopped) setTimeout(poll, 3000);
      }
    };

    poll();
    return () => { stopped = true; localPollingRef.current = false; };
  }, [sandbox, isLocalDocker, refetch]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="w-full relative overflow-hidden min-h-screen bg-background">
      <style>{`@keyframes instance-fade-in { from { opacity: 0; } to { opacity: 1; } }`}</style>

      <div className="absolute top-4 left-4 z-20">
        <Button variant="ghost" size="sm" onClick={() => router.push('/instances')} className="gap-1.5 text-muted-foreground/50 hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          Instances
        </Button>
      </div>

      <div className="relative flex flex-col items-center w-full px-4 sm:px-6 min-h-screen justify-center py-12">
        <div className="relative z-10 w-full max-w-[600px] flex flex-col items-center">

          {/* Logo */}
          <div className="mb-12 flex flex-col items-center gap-3" style={{ animation: 'instance-fade-in 1s ease-out forwards' }}>
            <KortixLogo size={22} />
            <h1 className="text-[15px] font-normal text-foreground/30 tracking-[0.15em] uppercase">
              {showSetup ? 'Instance Setup'
                : booting ? 'Connecting'
                : sandbox?.status === 'provisioning' ? 'Creating Workspace'
                : sandbox?.name || 'Instance'}
            </h1>
          </div>

          {/* Loading */}
          {isLoading && !sandbox && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Not found */}
          {!isLoading && !sandbox && (
            <div className="flex flex-col items-center gap-4">
              <AlertCircle className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Instance not found</p>
              <Button variant="outline" size="sm" onClick={() => router.push('/instances')}>Back to Instances</Button>
            </div>
          )}

          {/* Provisioning */}
          {sandbox?.status === 'provisioning' && (
            isLocalDocker ? (
              <LocalProvisioningView progress={localProgress} />
            ) : (
              <ProvisioningProgress
                progress={poller.progress}
                stages={poller.stages}
                currentStage={poller.currentStage}
                machineInfo={poller.machineInfo}
              />
            )
          )}

          {/* Booting — brief transition before setup */}
          {booting && sandbox?.status === 'active' && !showSetup && (
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-5 w-5 animate-spin text-primary/60" />
              <p className="text-[13px] text-muted-foreground/50">Connecting to workspace...</p>
            </div>
          )}

          {/* Setup flow — shown after sandbox is active but not yet configured */}
          {showSetup && (
            <InstanceSetupFlow onComplete={handleSetupComplete} />
          )}

          {/* Error */}
          {sandbox?.status === 'error' && (() => {
            const meta = (sandbox.metadata as Record<string, unknown>) ?? {};
            const errorMsg = poller.error || (meta.provisioningError as string) || 'Something went wrong.';
            const location = meta.location as string | undefined;
            const serverType = meta.serverType as string | undefined;
            return (
              <div className="flex flex-col items-center gap-5 w-full max-w-[400px]">
                <div className="h-12 w-12 rounded-full bg-red-500/10 flex items-center justify-center">
                  <AlertCircle className="h-6 w-6 text-red-400" />
                </div>
                <div className="text-center">
                  <h2 className="text-base font-semibold text-foreground">Provisioning Failed</h2>
                  {(serverType || location) && (
                    <p className="text-xs text-muted-foreground/40 mt-1 font-mono">{[serverType, location].filter(Boolean).join(' · ')}</p>
                  )}
                </div>
                <div className="w-full rounded-lg border border-red-500/15 bg-red-500/[0.04] px-4 py-3">
                  <p className="text-[13px] text-red-400/90 text-center break-words leading-relaxed">{errorMsg}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => router.push('/instances')}>Back to Instances</Button>
              </div>
            );
          })()}

          {/* Stopped */}
          {sandbox?.status === 'stopped' && (
            <div className="flex flex-col items-center gap-5">
              <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center">
                <div className="h-3.5 w-3.5 rounded-full bg-muted-foreground/30" />
              </div>
              <div className="text-center">
                <h2 className="text-base font-semibold text-foreground">Instance Stopped</h2>
                <p className="text-sm text-muted-foreground/50 mt-1">This instance is currently stopped.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => router.push('/instances')}>Back to Instances</Button>
            </div>
          )}

          {/* Active but redirecting (setup already done) */}
          {sandbox?.status === 'active' && !showSetup && switchedRef.current && (
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-5 w-5 animate-spin text-primary/70" />
              <p className="text-sm text-muted-foreground/50">Opening workspace...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
