'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useQuery } from '@tanstack/react-query';
import { KortixLogo } from '@/components/sidebar/kortix-logo';
import { ProvisioningProgress } from '@/components/provisioning/provisioning-progress';
import { InstanceSetupFlow } from '@/components/instance/setup-flow';
import { useSandboxPoller } from '@/hooks/platform/use-sandbox-poller';
import { getSandboxById } from '@/lib/platform-client';
import { switchToInstanceAsync, getActiveOpenCodeUrl } from '@/stores/server-store';
import { buildInstancePath } from '@/lib/instance-routes';
import { authenticatedFetch } from '@/lib/auth-token';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { getEnv } from '@/lib/env-config';

// ─── State machine for the instance detail page ─────────────────────────────
// loading → provisioning → connecting → setup|redirecting
//                        → error
//         → connecting   → setup|redirecting
//         → error
//         → stopped

type PagePhase =
  | 'loading'        // Fetching sandbox info
  | 'provisioning'   // Machine being created
  | 'connecting'     // Sandbox active, waiting for services (port 8000) to come up
  | 'setup'          // Services ready, showing provider setup flow
  | 'redirecting'    // Setup done, navigating to dashboard
  | 'error'          // Provisioning or sandbox error
  | 'stopped';       // Sandbox stopped

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

  // ── Phase state machine ──
  const [phase, setPhase] = useState<PagePhase>('loading');
  const switchedRef = useRef(false);
  const connectingRef = useRef(false);

  // ── Local docker progress ──
  const [localProgress, setLocalProgress] = useState<{ progress: number; message: string } | null>(null);
  const localPollingRef = useRef(false);

  // ── Provisioning poller (cloud instances) — declared early so phase effects can reference it ──
  const isLocalDocker = sandbox?.provider === 'local_docker';
  const poller = useSandboxPoller({ sandboxId: isLocalDocker ? undefined : id });
  const autoStartedRef = useRef(false);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/auth');
  }, [authLoading, user, router]);

  const { data: sandbox, isLoading, error, refetch } = useQuery({
    queryKey: ['platform', 'sandbox', 'detail', id],
    queryFn: () => getSandboxById(id!),
    enabled: !!user && !!id,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 5000;
      if (data.status === 'provisioning') return 10_000;
      return false;
    },
  });

  // ── Derive phase from sandbox status ──
  useEffect(() => {
    if (!sandbox) return;

    if (sandbox.status === 'provisioning') {
      setPhase('provisioning');
    } else if (sandbox.status === 'error') {
      setPhase('error');
    } else if (sandbox.status === 'stopped') {
      setPhase('stopped');
    } else if (sandbox.status === 'active' && !switchedRef.current) {
      // Sandbox just became active — emit connecting stage into poller then start connecting
      poller.setConnecting?.();
      setPhase('connecting');
    }
    // If switchedRef.current is true, phase is managed by the connecting flow
  }, [sandbox, poller]);

  // ── Connecting phase: register server + wait for services + check setup ──
  useEffect(() => {
    if (phase !== 'connecting' || !sandbox || connectingRef.current) return;
    if (sandbox.status !== 'active' || !sandbox.external_id) return;

    connectingRef.current = true;

    (async () => {
      // 1. Register in server store (only once)
      if (!switchedRef.current) {
        switchedRef.current = true;
        const result = await switchToInstanceAsync(sandbox.sandbox_id);
        if (!result) {
          // switchToInstanceAsync failed — stay in connecting, it'll retry
          connectingRef.current = false;
          return;
        }
      }

      // 2. Wait for port 8000 to be reachable (services starting up)
      const url = getActiveOpenCodeUrl();
      if (!url) {
        // No URL yet — retry
        connectingRef.current = false;
        return;
      }

      const maxWaitMs = 120_000; // 2 minutes max
      const pollMs = 3_000;
      const start = Date.now();
      let servicesReady = false;

      while (Date.now() - start < maxWaitMs) {
        try {
          const res = await authenticatedFetch(`${url}/global/health`, {
            signal: AbortSignal.timeout(5_000),
          });
          if (res.ok || res.status === 503 || res.status === 401) {
            // 503 = Kortix Master is running but OpenCode still starting
            // 401 = services are up but auth token not yet accepted
            // Either way, the service is reachable — move on.
            servicesReady = true;
            break;
          }
        } catch {
          // Not reachable yet — keep waiting
        }
        await new Promise((r) => setTimeout(r, pollMs));
      }

      if (!servicesReady) {
        // Timed out waiting for services — show setup anyway (they might come up)
        console.warn('[instance-detail] Services did not become reachable within 2 minutes, proceeding to setup');
      }

      // 3. Check if setup was already completed
      try {
        const res = await authenticatedFetch(`${url}/env/INSTANCE_SETUP_COMPLETE`, {
          signal: AbortSignal.timeout(5_000),
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.INSTANCE_SETUP_COMPLETE === 'true') {
            setPhase('redirecting');
            router.replace(buildInstancePath(sandbox.sandbox_id, '/onboarding'));
            return;
          }
        }
      } catch {
        // Can't check — show setup to be safe
      }

      // 4. First boot → show setup flow
      setPhase('setup');
    })();
  }, [phase, sandbox, router]);

  const handleSetupComplete = useCallback(async () => {
    if (!sandbox) return;
    // Mark instance setup as done
    try {
      const url = getActiveOpenCodeUrl();
      if (url) {
        await authenticatedFetch(`${url}/env/INSTANCE_SETUP_COMPLETE`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: 'true' }),
        });
      }
    } catch { /* best effort */ }
    setPhase('redirecting');
    router.replace(buildInstancePath(sandbox.sandbox_id, '/onboarding'));
  }, [sandbox, router]);

  // ── Provisioning poller (cloud instances) ──
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

  // ── Local Docker: poll /platform/init/local/status for real pull progress ──
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

  // ── Title text based on phase ──
  const titleText = (() => {
    switch (phase) {
      case 'loading': return 'Loading';
      case 'provisioning': return 'Creating Workspace';
      case 'connecting': return 'Creating Workspace';
      case 'setup': return 'Instance Setup';
      case 'redirecting': return 'Opening Workspace';
      case 'error': return sandbox?.name || 'Instance';
      case 'stopped': return sandbox?.name || 'Instance';
      default: return sandbox?.name || 'Instance';
    }
  })();

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

          {/* Logo + title */}
          <div className="mb-12 flex flex-col items-center gap-3" style={{ animation: 'instance-fade-in 1s ease-out forwards' }}>
            <KortixLogo size={22} />
            <h1 className="text-[15px] font-normal text-foreground/30 tracking-[0.15em] uppercase">
              {titleText}
            </h1>
          </div>

          {/* Loading */}
          {phase === 'loading' && isLoading && !sandbox && (
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

          {/* Provisioning + Connecting — single unified progress view */}
          {(phase === 'provisioning' || phase === 'connecting') && sandbox && (
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

          {/* Setup flow — shown after services are ready but not yet configured */}
          {phase === 'setup' && (
            <InstanceSetupFlow onComplete={handleSetupComplete} />
          )}

          {/* Redirecting to dashboard */}
          {phase === 'redirecting' && (
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-5 w-5 animate-spin text-primary/70" />
              <p className="text-sm text-muted-foreground/50">Opening workspace...</p>
            </div>
          )}

          {/* Error */}
          {phase === 'error' && sandbox && (() => {
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
          {phase === 'stopped' && (
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
        </div>
      </div>
    </div>
  );
}
