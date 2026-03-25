'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useQuery } from '@tanstack/react-query';
import { KortixLogo } from '@/components/sidebar/kortix-logo';
import {
  listSandboxes,
  ensureSandbox,
  type SandboxInfo,
} from '@/lib/platform-client';
import { isBillingEnabled } from '@/lib/config';
import { useServerStore, type ServerEntry } from '@/stores/server-store';

import { NewInstanceModal } from '@/components/billing/pricing/new-instance-modal';
import { Button } from '@/components/ui/button';
import {
  Server,
  Cloud,
  Container,
  Box,
  Plus,
  Loader2,
  LogOut,
  AlertCircle,
  ExternalLink,
  MapPin,
  Cpu,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { clearUserLocalStorage } from '@/lib/utils/clear-local-storage';
import { INSTANCE_CONFIG } from '@/components/instance/config';
import { WorldMap } from '@/components/ui/world-map';

// ─── Status helpers ─────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; dotColor: string }> = {
  active:       { label: 'Active',        color: 'text-emerald-500', dotColor: 'bg-emerald-500' },
  provisioning: { label: 'Provisioning',  color: 'text-amber-500',   dotColor: 'bg-amber-400' },
  stopped:      { label: 'Stopped',       color: 'text-muted-foreground', dotColor: 'bg-muted-foreground/40' },
  error:        { label: 'Error',         color: 'text-red-400',     dotColor: 'bg-red-400' },
  available:    { label: 'Available',     color: 'text-blue-500',    dotColor: 'bg-blue-500' },
  archived:     { label: 'Archived',      color: 'text-muted-foreground/50', dotColor: 'bg-muted-foreground/20' },
};

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] ?? { label: status, color: 'text-muted-foreground', dotColor: 'bg-muted-foreground/30' };
}

const PROVIDER_CONFIG: Record<string, { label: string; icon: typeof Server; badgeCls: string }> = {
  justavps:     { label: 'VPS',   icon: Server,    badgeCls: 'text-orange-500/70 bg-orange-500/10' },
  daytona:      { label: 'Cloud', icon: Cloud,     badgeCls: 'text-violet-500/70 bg-violet-500/10' },
  local_docker: { label: 'Local', icon: Container, badgeCls: 'text-blue-500/70 bg-blue-500/10' },
  custom:       { label: 'Custom', icon: Box,      badgeCls: 'text-muted-foreground/70 bg-muted/50' },
};

function getProviderConfig(provider: string) {
  return PROVIDER_CONFIG[provider] ?? { label: provider, icon: Box, badgeCls: 'text-muted-foreground/70 bg-muted/50' };
}

// ─── Instance Card ──────────────────────────────────────────────────────────

function getRegionInfo(locationId: string | null) {
  if (!locationId) return null;
  return INSTANCE_CONFIG.regions.find((r) => r.id === locationId) ?? null;
}

function InstanceCard({ sandbox, onClick }: { sandbox: SandboxInfo; onClick: () => void }) {
  const status = getStatusConfig(sandbox.status);
  const provider = getProviderConfig(sandbox.provider);
  const meta = sandbox.metadata as Record<string, unknown> | undefined;
  const location = (meta?.location as string) || null;
  const serverType = (meta?.serverType as string) || null;
  const region = getRegionInfo(location);

  
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl border border-border/50 hover:border-border bg-card hover:bg-card/80 transition-all p-4 cursor-pointer group"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/60">
          <span className={cn('h-1.5 w-1.5 rounded-full', status.dotColor,
            sandbox.status === 'provisioning' && 'animate-pulse',
          )} />
          {status.label}
        </span>
        <ExternalLink className="h-3 w-3 text-muted-foreground/0 group-hover:text-muted-foreground/40 transition-colors" />
      </div>

      <p className="text-sm font-semibold text-foreground truncate">
        {sandbox.name || sandbox.sandbox_id}
      </p>

      <div className="flex items-center gap-2 mt-2 text-[11px] text-muted-foreground/50">
        <span className={cn('px-1.5 py-0.5 rounded-md text-[10px] font-medium uppercase tracking-wider', provider.badgeCls)}>
          {provider.label}
        </span>
        {region && <span>{region.icon} {region.label}</span>}
        {!region && location && <span>{location}</span>}
        {serverType && <span className="font-mono">{serverType}</span>}
        {sandbox.version && <span className="font-mono">v{sandbox.version}</span>}
      </div>
    </button>
  );
}

function FallbackInstanceCard({ server, isActive, onClick }: { server: ServerEntry; isActive: boolean; onClick: () => void }) {
  const provider = getProviderConfig(server.provider || 'custom');
  const status = getStatusConfig(server.instanceId ? 'active' : 'available');
  const ProviderIcon = provider.icon;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl border border-border/50 bg-card hover:bg-muted/30 hover:border-border transition-all p-4 cursor-pointer group"
    >
      <div className="flex items-start gap-3">
        <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-muted/50 flex-shrink-0 mt-0.5">
          <ProviderIcon className="h-5 w-5 text-muted-foreground/70" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground truncate">{server.label || server.instanceId || server.id}</span>
            <span className={cn('px-1.5 py-px text-[9px] font-medium rounded-full uppercase tracking-wider leading-none', provider.badgeCls)}>
              {provider.label}
            </span>
            {isActive && (
              <span className="px-1.5 py-px text-[9px] font-medium rounded-full uppercase tracking-wider leading-none text-primary bg-primary/10">
                current
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1.5">
            <span className={cn('flex items-center gap-1.5 text-xs font-medium', status.color)}>
              <span className={cn('h-[7px] w-[7px] rounded-full flex-shrink-0', status.dotColor)} />
              {status.label}
            </span>
            {server.instanceId && <span className="text-[11px] text-muted-foreground/50 font-mono">{server.instanceId}</span>}
          </div>
        </div>
        <ExternalLink className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors flex-shrink-0 mt-1" />
      </div>
    </button>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function InstancesPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { servers, activeServerId } = useServerStore();
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [autoCreating, setAutoCreating] = useState(false);
  const isCloud = isBillingEnabled();

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/auth');
    }
  }, [authLoading, user, router]);

  const { data: sandboxes, isLoading, error, refetch } = useQuery({
    queryKey: ['platform', 'sandbox', 'list'],
    queryFn: listSandboxes,
    enabled: !!user,
    refetchInterval: (query) => {
      // Poll every 5s if any sandbox is provisioning
      const data = query.state.data;
      if (data?.some((s) => s.status === 'provisioning')) return 5000;
      return 30000;
    },
  });

  // After Stripe checkout redirect — just clean the URL and refetch.
  // The webhook already created the subscription + provisioned the sandbox.
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('subscription') !== 'success') return;
    const clean = new URL(window.location.href);
    clean.searchParams.delete('subscription');
    clean.searchParams.delete('session_id');
    window.history.replaceState({}, '', clean.pathname);
    refetch();
  }, [user, refetch]);

  // Local mode: auto-create the single sandbox if none exists, then redirect.
  // Only 1 instance allowed in local mode.
  useEffect(() => {
    if (!user || isLoading || autoCreating || isCloud) return;
    if (sandboxes && sandboxes.length === 0) {
      setAutoCreating(true);
      ensureSandbox()
        .then(() => refetch())
        .catch(() => {})
        .finally(() => setAutoCreating(false));
    }
  }, [user, isLoading, sandboxes, autoCreating, isCloud, refetch]);

  // Auto-redirect: if there's exactly 1 instance (local mode typical), go straight to it.
  useEffect(() => {
    if (isLoading || !sandboxes) return;
    const active = sandboxes.filter((s) => s.status !== 'archived');
    if (active.length === 1 && !isCloud) {
      router.replace(`/instances/${active[0].sandbox_id}`);
    }
  }, [isLoading, sandboxes, isCloud, router]);

  // Filter out archived — user shouldn't see those
  const visible = sandboxes?.filter((s) => s.status !== 'archived') ?? [];
  const fallbackServers = servers.filter((s) => !!s.provider || !!s.url);

  function handleInstanceClick(sandbox: SandboxInfo) {
    // Always go to the instance detail page. It's the gatekeeper:
    // active → dashboard, provisioning → progress, error → error.
    router.push(`/instances/${sandbox.sandbox_id}`);
  }

  function handleFallbackServerClick(server: ServerEntry) {
    if (server.instanceId) {
      router.push(`/instances/${server.instanceId}`);
    } else {
      router.push('/dashboard');
    }
  }

  function handleCreateInstance() {
    if (isCloud) {
      setCheckoutOpen(true);
    } else {
      // Local mode: create directly, no checkout
      setAutoCreating(true);
      ensureSandbox()
        .then(() => refetch())
        .catch(() => {})
        .finally(() => setAutoCreating(false));
    }
  }

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    clearUserLocalStorage();
    router.push('/auth');
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const activeCount = visible.filter((s) => s.status === 'active').length;
  const provisioningCount = visible.filter((s) => s.status === 'provisioning').length;
  const regions = [...new Set(visible.map((s) => {
    const meta = s.metadata as Record<string, unknown> | undefined;
    const loc = (meta?.location as string) || null;
    return getRegionInfo(loc);
  }).filter(Boolean))];

  return (
    <div className="h-screen flex flex-col bg-background relative overflow-hidden">
      {/* World map background — behind header area */}
      <div className="absolute top-0 left-0 right-0 h-[350px] pointer-events-none select-none overflow-hidden">
        <div className="absolute inset-0 [mask-image:linear-gradient(to_bottom,white_10%,transparent_90%)] opacity-40 dark:opacity-25">
          <WorldMap />
        </div>
      </div>

      {/* Top bar */}
      <div className="relative flex items-center justify-between px-8 py-4 shrink-0">
        <KortixLogo size={20} />
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className="gap-2 text-muted-foreground/50 hover:text-foreground"
        >
          <LogOut className="h-3.5 w-3.5" />
          Log Out
        </Button>
      </div>

      {/* Content */}
      <div className="relative flex-1 flex flex-col min-h-0 px-8 sm:px-12 lg:px-20 pt-8 max-w-7xl mx-auto w-full">
        {/* Header */}
        <div className="flex items-end justify-between mb-10">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">Kortix Cloud</span>
            <h1 className="text-3xl font-semibold tracking-tight mt-1">Instances</h1>
          </div>
          {(isCloud || visible.length === 0) && (
            <Button
              onClick={handleCreateInstance}
              disabled={autoCreating}
              className="gap-2 h-10 px-5"
            >
              {autoCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {autoCreating ? 'Creating...' : 'New Instance'}
            </Button>
          )}
        </div>

        {/* Stats bar */}
        {!isLoading && visible.length > 0 && (
          <div className="flex items-center gap-6 mb-8 pb-8 border-b border-border/40">
            <div>
              <p className="text-2xl font-semibold tabular-nums">{visible.length}</p>
              <p className="text-[11px] text-muted-foreground/50 uppercase tracking-wider mt-0.5">Total</p>
            </div>
            <div className="w-px h-8 bg-border/40" />
            <div>
              <p className="text-2xl font-semibold tabular-nums text-emerald-500">{activeCount}</p>
              <p className="text-[11px] text-muted-foreground/50 uppercase tracking-wider mt-0.5">Active</p>
            </div>
            {provisioningCount > 0 && (
              <>
                <div className="w-px h-8 bg-border/40" />
                <div>
                  <p className="text-2xl font-semibold tabular-nums text-amber-500">{provisioningCount}</p>
                  <p className="text-[11px] text-muted-foreground/50 uppercase tracking-wider mt-0.5">Provisioning</p>
                </div>
              </>
            )}
            {regions.length > 0 && (
              <>
                <div className="w-px h-8 bg-border/40" />
                <div>
                  <p className="text-2xl font-semibold tabular-nums">{regions.length}</p>
                  <p className="text-[11px] text-muted-foreground/50 uppercase tracking-wider mt-0.5">{regions.length === 1 ? 'Region' : 'Regions'}</p>
                </div>
              </>
            )}
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Error */}
        {error && !isLoading && fallbackServers.length === 0 && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-destructive font-medium">Failed to load instances</p>
              <p className="text-xs text-destructive/70 mt-0.5">{(error as Error).message}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        )}

        {/* Empty state */}
        {(!isLoading && !error && visible.length === 0 && fallbackServers.length === 0) && (
          <div className="rounded-2xl border border-dashed border-border/50 p-12 flex flex-col items-center gap-5">
            <div className="flex items-center justify-center h-16 w-16 rounded-2xl bg-muted/50">
              <Server className="h-8 w-8 text-muted-foreground/30" />
            </div>
            <div className="text-center">
              <p className="text-base font-medium text-foreground/80">No instances yet</p>
              <p className="text-sm text-muted-foreground/50 mt-1">
                Create your first Kortix instance to get started.
              </p>
            </div>
            <Button onClick={handleCreateInstance} className="gap-2 h-10 px-5 mt-1">
              <Plus className="h-4 w-4" />
              Create Instance
            </Button>
          </div>
        )}

        {/* Scrollable instance area */}
        <div className="flex-1 min-h-0 overflow-y-auto pb-8">
          {/* Instance grid */}
          {!isLoading && visible.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {visible.map((sandbox) => (
                <InstanceCard
                  key={sandbox.sandbox_id}
                  sandbox={sandbox}
                  onClick={() => handleInstanceClick(sandbox)}
                />
              ))}
            </div>
          )}

          {/* Fallback list */}
          {!isLoading && visible.length === 0 && fallbackServers.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {fallbackServers.map((server) => (
                <FallbackInstanceCard
                  key={server.id}
                  server={server}
                  isActive={server.id === activeServerId}
                  onClick={() => handleFallbackServerClick(server)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Checkout modal */}
      <NewInstanceModal open={checkoutOpen} onOpenChange={setCheckoutOpen} />
    </div>
  );
}
