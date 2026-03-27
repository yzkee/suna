'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useQuery } from '@tanstack/react-query';
import { KortixLogo } from '@/components/sidebar/kortix-logo';
import { ProvisioningProgress } from '@/components/provisioning/provisioning-progress';
import { useSandboxPoller } from '@/hooks/platform/use-sandbox-poller';
import { getSandboxById } from '@/lib/platform-client';
import { switchToInstanceAsync } from '@/stores/server-store';
import { buildInstancePath } from '@/lib/instance-routes';
import { authenticatedFetch } from '@/lib/auth-token';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import { getEnv } from '@/lib/env-config';

// ─── State machine ────────────────────────────────────────────────────────────
// loading → provisioning → redirecting
//         → active      → redirecting
//         → error
//         → stopped

type PagePhase = 'loading' | 'provisioning' | 'active' | 'redirecting' | 'error' | 'stopped';

function LocalProvisioningView({ progress }: { progress: { progress: number; message: string } | null }) {
  const pct = progress?.progress ?? 0;
  const msg = progress?.message ?? 'Preparing your workspace...';
  return (
    <div className="w-full max-w-[340px] flex flex-col items-center gap-6">
      <div className="relative h-28 w-28">
        <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" fill="none" strokeWidth="4" className="stroke-foreground/[0.06]" />
          <circle cx="50" cy="50" r="42" fill="none" strokeWidth="4" strokeLinecap="round"
            className="stroke-primary transition-all duration-700 ease-out"
            strokeDasharray={`${2 * Math.PI * 42}`}
            strokeDashoffset={`${2 * Math.PI * 42 * (1 - pct / 100)}`}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xl font-light text-foreground/80 tabular-nums">{Math.round(pct)}%</span>
        </div>
      </div>
      <div className="w-full space-y-2">
        <div className="w-full bg-foreground/[0.06] rounded-full h-1.5 overflow-hidden">
          <div className="bg-primary h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${Math.max(pct, 2)}%` }} />
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

  const [phase, setPhase] = useState<PagePhase>('loading');
  const redirectedRef = useRef(false);

  // Local docker pull progress
  const [localProgress, setLocalProgress] = useState<{ progress: number; message: string } | null>(null);
  const localPollingRef = useRef(false);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/auth');
  }, [authLoading, user, router]);

  const { data: sandbox, isLoading, refetch } = useQuery({
    queryKey: ['platform', 'sandbox', 'detail', id],
    queryFn: () => getSandboxById(id!),
    enabled: !!user && !!id,
    staleTime: 0,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      if (s === 'provisioning') return 10_000;
      return false;
    },
  });

  // Provisioning poller — only active when sandbox is provisioning
  const isLocalDocker = sandbox?.provider === 'local_docker';
  const poller = useSandboxPoller({ sandboxId: isLocalDocker ? undefined : id });
  const autoStartedRef = useRef(false);

  // ── Derive phase ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sandbox) return;
    if (sandbox.status === 'provisioning') setPhase('provisioning');
    else if (sandbox.status === 'active')   setPhase('active');
    else if (sandbox.status === 'error')    setPhase('error');
    else if (sandbox.status === 'stopped')  setPhase('stopped');
  }, [sandbox]);

  // ── Active → register + redirect immediately ──────────────────────────────
  useEffect(() => {
    if (phase !== 'active' || !sandbox || redirectedRef.current) return;
    redirectedRef.current = true;
    setPhase('redirecting');

    (async () => {
      await switchToInstanceAsync(sandbox.sandbox_id);
      router.replace(buildInstancePath(sandbox.sandbox_id, '/onboarding'));
    })();
  }, [phase, sandbox, router]);

  // ── Start provisioning poller ──────────────────────────────────────────────
  useEffect(() => {
    if (!sandbox || autoStartedRef.current || isLocalDocker) return;
    if (sandbox.status === 'provisioning') {
      autoStartedRef.current = true;
      const knownStage = (sandbox.metadata as Record<string, unknown> | null)?.provisioningStage as string | undefined;
      if (knownStage) poller.seedStage?.(knownStage);
      poller.poll();
    }
  }, [sandbox, poller, isLocalDocker]);

  // When poller says ready, refetch sandbox (will flip to active → redirect)
  useEffect(() => {
    if (poller.status === 'ready') refetch();
  }, [poller.status, refetch]);

  // ── Local Docker pull progress ─────────────────────────────────────────────
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
          message: data.status === 'creating' ? 'Creating container...' : data.message || 'Pulling sandbox image...',
        });
        if (!stopped) setTimeout(poll, 2000);
      } catch {
        if (!stopped) setTimeout(poll, 3000);
      }
    };

    poll();
    return () => { stopped = true; localPollingRef.current = false; };
  }, [sandbox, isLocalDocker, refetch]);

  const titleText = phase === 'provisioning' ? 'Creating Workspace'
    : phase === 'active' || phase === 'redirecting' ? 'Opening Workspace'
    : phase === 'error' ? 'Something went wrong'
    : phase === 'stopped' ? sandbox?.name || 'Instance'
    : 'Loading';

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
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          )}

          {/* Not found */}
          {!isLoading && !sandbox && (
            <div className="flex flex-col items-center gap-4">
              <AlertCircle className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Instance not found</p>
              <Button variant="outline" size="sm" onClick={() => router.push('/instances')}>Back to Instances</Button>
            </div>
          )}

          {/* Provisioning progress */}
          {phase === 'provisioning' && sandbox && (
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

          {/* Active / Redirecting */}
          {(phase === 'active' || phase === 'redirecting') && (
            <Loader2 className="h-5 w-5 animate-spin text-primary/70" />
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
