'use client';

import React, { useCallback, useMemo, useState } from 'react';
import {
  Activity,
  Braces,
  CheckCircle2,
  Clock,
  Code2,
  ExternalLink,
  FileCode2,
  FolderOpen,
  Gem,
  Globe,
  Hexagon,
  Loader2,
  Search,
  Server,
  Settings,
  TerminalSquare,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SpotlightCard } from '@/components/ui/spotlight-card';
import { Ripple } from '@/components/ui/ripple';
import { PageHeader } from '@/components/ui/page-header';
import { useTabStore, openTabAndNavigate, type Tab } from '@/stores/tab-store';
import { getCurrentInstanceIdFromWindow, toInstanceAwarePath } from '@/lib/instance-routes';
import { useOpenCodePtyList } from '@/hooks/opencode/use-opencode-pty';
import { useSandboxServices, type SandboxService } from '@/hooks/use-sandbox-services';
import { useOpenCodeSessions, type Session } from '@/hooks/opencode/use-opencode-sessions';
import { useServerStore } from '@/stores/server-store';
import { useSandboxProxy } from '@/hooks/use-sandbox-proxy';

// ============================================================================
// Types
// ============================================================================

interface RunningService {
  id: string;
  kind: 'preview' | 'deployment' | 'terminal';
  name: string;
  port?: number;
  framework?: string;
  status: 'running' | 'stopped' | 'unknown';
  sessionId?: string;
  sessionTitle?: string;
  tabId?: string;
  deploymentId?: string;
  proxyUrl?: string;
  startedAt?: string;
  sourcePath?: string;
  pid?: number;
  hasTab?: boolean;
  managed?: boolean;
}

type FilterKey = 'all' | 'apps' | 'terminals';

// ============================================================================
// Helpers
// ============================================================================

function formatTimeAgo(dateStr: string | undefined): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    const now = Date.now();
    const diff = now - date.getTime();
    if (diff < 0) return '';
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  } catch {
    return '';
  }
}

const FRAMEWORK_LABELS: Record<string, string> = {
  nextjs: 'Next.js',
  vite: 'Vite',
  cra: 'CRA',
  node: 'Node.js',
  python: 'Python',
  static: 'Static',
  go: 'Go',
  ruby: 'Ruby',
  java: 'Java',
  rust: 'Rust',
};

function getFrameworkLabel(fw: string): string | null {
  if (!fw || fw === 'unknown') return null;
  return FRAMEWORK_LABELS[fw] || fw;
}

function shortenPath(path: string): string {
  if (!path) return '';
  return path.replace(/^\/workspace\/?/, '') || '/';
}

function compactUrl(url: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${parsed.host}${path}`;
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }
}

// ============================================================================
// ServiceCard
// ============================================================================

function ServiceCard({ service, index }: { service: RunningService; index: number }) {
  const handleOpen = useCallback(() => {
    if (service.tabId) {
      const store = useTabStore.getState();
      const tab = store.tabs[service.tabId];
      if (tab) {
        store.setActiveTab(service.tabId);
        window.history.pushState(null, '', toInstanceAwarePath(tab.href, getCurrentInstanceIdFromWindow()));
        return;
      }
    }
    if (service.port && service.proxyUrl) {
      openTabAndNavigate({
        id: `preview:${service.port}`,
        title: service.name || `localhost:${service.port}`,
        type: 'preview',
        href: `/preview/${service.port}`,
        metadata: {
          url: service.proxyUrl,
          port: service.port,
          originalUrl: `http://localhost:${service.port}/`,
        },
      });
    }
  }, [service]);

  const isTerminal = service.kind === 'terminal';
  const isDeployment = service.kind === 'deployment' || !!service.deploymentId;
  const isRunning = service.status === 'running' || (service.status === 'unknown' && !!service.hasTab);
  const fwLabel = service.framework ? getFrameworkLabel(service.framework) : null;

  const Icon = isTerminal ? TerminalSquare : isDeployment ? Server : Globe;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, scale: 0.95 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.03, 0.6) }}
    >
      <SpotlightCard className="bg-card border border-border/50">
        <div onClick={handleOpen} className="p-4 sm:p-5 flex flex-col h-full cursor-pointer group">
          <div className="flex items-center gap-3 mb-3">
            <div className="relative">
              <div className="flex items-center justify-center w-9 h-9 rounded-[10px] bg-muted border border-border/50 shrink-0">
                <Icon className="h-4.5 w-4.5 text-foreground" />
              </div>
              {isRunning && (
                <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 border-2 border-background" />
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-semibold text-foreground truncate">{service.name}</h3>
                {isRunning ? (
                  <Badge variant="highlight" className="text-[10px] shrink-0">Running</Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px] shrink-0">{service.status}</Badge>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-xs text-muted-foreground">
                  {isTerminal ? 'Terminal' : isDeployment ? 'Deployment' : 'Preview'}
                </span>
                {service.port != null && service.port > 0 && (
                  <span className="text-xs text-muted-foreground/50 font-mono">:{service.port}</span>
                )}
                {fwLabel && (
                  <span className="text-xs text-muted-foreground/50">{fwLabel}</span>
                )}
              </div>
            </div>
          </div>

          <div className="h-[34px] mb-3">
            <p className="text-xs text-muted-foreground/80 leading-relaxed line-clamp-2">
              {service.proxyUrl ? compactUrl(service.proxyUrl) : service.sourcePath ? shortenPath(service.sourcePath) : service.sessionTitle || '\u00A0'}
            </p>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground/50">
              {service.startedAt ? formatTimeAgo(service.startedAt) : ''}
            </span>
            <div className="flex items-center gap-1">
              {service.hasTab && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Tab open</Badge>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2.5 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </Button>
            </div>
          </div>
        </div>
      </SpotlightCard>
    </motion.div>
  );
}

// ============================================================================
// Loading skeleton
// ============================================================================

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="rounded-2xl border dark:bg-card p-4 sm:p-5">
          <div className="flex items-center gap-3 mb-3">
            <Skeleton className="h-9 w-9 rounded-[10px]" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
          <Skeleton className="h-3 w-full mb-1" />
          <Skeleton className="h-3 w-4/5 mb-3" />
          <div className="flex justify-end">
            <Skeleton className="h-8 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Empty state
// ============================================================================

function EmptyState() {
  return (
    <div className="relative bg-muted/20 rounded-3xl border border-dashed border-border/50 flex flex-col items-center justify-center py-20 px-4 overflow-hidden">
      <Ripple mainCircleSize={160} mainCircleOpacity={0.12} numCircles={6} />
      <div className="relative z-10 flex flex-col items-center">
        <div className="w-16 h-16 bg-muted border rounded-2xl flex items-center justify-center mb-4">
          <Activity className="h-7 w-7 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-2">No running services</h3>
        <p className="text-sm text-muted-foreground text-center leading-relaxed max-w-md">
          Services will appear here when you deploy apps, open previews, or start terminals.
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// RunningServicesPanel
// ============================================================================

export function RunningServicesPanel() {
  const { data: services, isLoading: servicesLoading } = useSandboxServices();
  const { data: ptys, isLoading: ptysLoading } = useOpenCodePtyList();
  const { data: sessions } = useOpenCodeSessions();
  const tabs = useTabStore((s) => s.tabs);
  const tabOrder = useTabStore((s) => s.tabOrder);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');

  const activeServer = useServerStore((s) => {
    return s.servers.find((srv) => srv.id === s.activeServerId) ?? null;
  });
  const { getServiceUrl } = useSandboxProxy();

  const sessionMap = useMemo(() => {
    const map = new Map<string, Session>();
    if (sessions) {
      for (const s of sessions) map.set(s.id, s);
    }
    return map;
  }, [sessions]);

  const previewTabByPort = useMemo(() => {
    const map = new Map<number, Tab>();
    for (const id of tabOrder) {
      const tab = tabs[id];
      if (tab?.type === 'preview') {
        const port = (tab.metadata?.port as number) || 0;
        if (port > 0) map.set(port, tab);
      }
    }
    return map;
  }, [tabs, tabOrder]);

  const { appServices, terminalServices } = useMemo(() => {
    const apps: RunningService[] = [];
    const terminals: RunningService[] = [];
    const seenPorts = new Set<number>();

    if (services) {
      for (const svc of services) {
        seenPorts.add(svc.port);
        const tab = previewTabByPort.get(svc.port);

        let sessionTitle: string | undefined;
        if (tab) {
          const sourceSessionId = tab.metadata?.sourceSessionId as string | undefined;
          const sourceSessionTitle = tab.metadata?.sourceSessionTitle as string | undefined;
          sessionTitle = sourceSessionTitle;
          if (!sessionTitle && sourceSessionId) {
            sessionTitle = sessionMap.get(sourceSessionId)?.title;
          }
        }

        let proxyUrl = tab ? ((tab.metadata?.url as string) || '') : '';
        if (!proxyUrl) {
          proxyUrl = getServiceUrl(svc.port);
        }

        const svcNameIsGeneric = !svc.name || svc.name === `service:${svc.port}` || svc.name === `port-${svc.port}`;
        const name = svcNameIsGeneric
          ? (tab?.title || svc.name || `localhost:${svc.port}`)
          : svc.name;

        apps.push({
          id: `app:${svc.port}`,
          kind: 'deployment',
          name,
          port: svc.port,
          framework: svc.framework,
          status: svc.status,
          sessionId: tab ? (tab.metadata?.sourceSessionId as string | undefined) : undefined,
          sessionTitle,
          tabId: tab?.id,
          deploymentId: svc.id,
          proxyUrl,
          startedAt: svc.startedAt || undefined,
          sourcePath: svc.sourcePath || undefined,
          pid: svc.pid,
          hasTab: !!tab,
          managed: svc.managed,
        });
      }
    }

    for (const [port, tab] of previewTabByPort) {
      if (seenPorts.has(port)) continue;
      const sourceSessionId = tab.metadata?.sourceSessionId as string | undefined;
      const sourceSessionTitle = tab.metadata?.sourceSessionTitle as string | undefined;
      let sessionTitle = sourceSessionTitle;
      if (!sessionTitle && sourceSessionId) {
        sessionTitle = sessionMap.get(sourceSessionId)?.title;
      }
      apps.push({
        id: `app:${port}`,
        kind: 'preview',
        name: tab.title || `localhost:${port}`,
        port,
        status: 'unknown',
        sessionId: sourceSessionId,
        sessionTitle,
        tabId: tab.id,
        proxyUrl: (tab.metadata?.url as string) || '',
        hasTab: true,
      });
    }

    const terminalTabs = tabOrder
      .map((id) => tabs[id])
      .filter((t): t is Tab => !!t && t.type === 'terminal');

    for (const tab of terminalTabs) {
      terminals.push({
        id: `terminal:${tab.id}`,
        kind: 'terminal',
        name: tab.title || 'Terminal',
        status: 'running',
        tabId: tab.id,
        hasTab: true,
      });
    }

    return { appServices: apps, terminalServices: terminals };
  }, [tabs, tabOrder, services, previewTabByPort, getServiceUrl, sessionMap]);

  const isLoading = servicesLoading || ptysLoading;

  const counts = useMemo(() => ({
    all: appServices.length + terminalServices.length,
    apps: appServices.length,
    terminals: terminalServices.length,
  }), [appServices, terminalServices]);

  const filteredServices = useMemo(() => {
    let items: RunningService[] = [];
    if (activeFilter === 'all') items = [...appServices, ...terminalServices];
    else if (activeFilter === 'apps') items = appServices;
    else items = terminalServices;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      items = items.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.framework?.toLowerCase().includes(q) ||
          s.proxyUrl?.toLowerCase().includes(q) ||
          s.sessionTitle?.toLowerCase().includes(q),
      );
    }

    return items;
  }, [appServices, terminalServices, activeFilter, searchQuery]);

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Page header */}
      <div className="container mx-auto max-w-7xl px-3 sm:px-4 py-4 sm:py-8 animate-in fade-in-0 slide-in-from-bottom-4 duration-500 fill-mode-both">
        <PageHeader icon={Activity}>
          <div className="space-y-2 sm:space-y-4">
            <div className="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight">
              <span className="text-primary">Running Services</span>
            </div>
          </div>
        </PageHeader>
      </div>

      <div className="container mx-auto max-w-7xl px-3 sm:px-4">
        {/* Search + filter bar */}
        <div className="flex items-center gap-2 sm:gap-4 pb-3 sm:pb-4 pt-2 sm:pt-3 animate-in fade-in-0 slide-in-from-bottom-4 duration-500 fill-mode-both delay-75">
          <div className="flex-1 max-w-md">
            <div className="relative group">
              <input
                type="text"
                placeholder="Search services..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-11 w-full rounded-2xl border border-input bg-card px-10 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              />
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors">
                <Search className="h-4 w-4" />
              </div>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-md p-0.5 transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* Filter segmented control */}
          <div className="hidden sm:flex items-center gap-1 rounded-2xl border border-border bg-muted/30 p-1">
            {([
              { key: 'all' as FilterKey, label: 'All' },
              { key: 'apps' as FilterKey, label: 'Apps & Previews' },
              { key: 'terminals' as FilterKey, label: 'Terminals' },
            ] as const).map((f) => (
              <button
                key={f.key}
                onClick={() => setActiveFilter(f.key)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-xl transition-all cursor-pointer',
                  activeFilter === f.key
                    ? 'bg-background text-foreground border border-border/50 shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-background/70 border border-transparent',
                )}
              >
                {f.label}
                {counts[f.key] > 0 && (
                  <span className="ml-1 tabular-nums opacity-60">{counts[f.key]}</span>
                )}
              </button>
            ))}
          </div>

          {/* Mobile filter */}
          <div className="sm:hidden">
            <select
              value={activeFilter}
              onChange={(e) => setActiveFilter(e.target.value as FilterKey)}
              className="h-11 rounded-2xl border border-input bg-card px-3 text-sm"
            >
              <option value="all">All ({counts.all})</option>
              <option value="apps">Apps ({counts.apps})</option>
              <option value="terminals">Terminals ({counts.terminals})</option>
            </select>
          </div>
        </div>

        {/* Content */}
        <div className="pb-6 sm:pb-8 animate-in fade-in-0 slide-in-from-bottom-4 duration-500 fill-mode-both delay-150">
          {isLoading ? (
            <LoadingSkeleton />
          ) : counts.all === 0 ? (
            <EmptyState />
          ) : filteredServices.length === 0 && searchQuery ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No services matching &ldquo;{searchQuery}&rdquo;
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {activeFilter === 'all' ? 'All Services' : activeFilter === 'apps' ? 'Apps & Previews' : 'Terminals'}
                </span>
                <Badge variant="secondary" className="text-xs tabular-nums">
                  {filteredServices.length}
                </Badge>
              </div>

              <AnimatePresence mode="popLayout">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {filteredServices.map((s, i) => (
                    <ServiceCard key={s.id} service={s} index={i} />
                  ))}
                </div>
              </AnimatePresence>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
