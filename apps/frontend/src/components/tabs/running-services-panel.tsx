'use client';

import React, { useCallback, useMemo } from 'react';
import {
  Activity,
  Clock,
  ExternalLink,
  FolderOpen,
  Globe,
  Hash,
  Loader2,
  Server,
  TerminalSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTabStore, openTabAndNavigate, type Tab } from '@/stores/tab-store';
import { useOpenCodePtyList } from '@/hooks/opencode/use-opencode-pty';
import { useSandboxDeployments, type SandboxDeployment } from '@/hooks/use-sandbox-deployments';
import { useOpenCodeSessions, type Session } from '@/hooks/opencode/use-opencode-sessions';
import { useServerStore, getActiveOpenCodeUrl, getSubdomainOpts } from '@/stores/server-store';
import { getProxyBaseUrl } from '@/lib/utils/sandbox-url';
import { getDirectPortUrl } from '@/lib/platform-client';

// ============================================================================
// Types
// ============================================================================

interface RunningService {
  id: string;
  kind: 'preview' | 'deployment' | 'terminal';
  /** Primary display name (deployment ID, tab title, etc.) */
  name: string;
  /** Port number */
  port?: number;
  /** Detected / configured framework */
  framework?: string;
  /** Running status */
  status: 'running' | 'stopped' | 'unknown';
  /** Source session that opened this service */
  sessionId?: string;
  sessionTitle?: string;
  /** Existing tab ID (to focus) */
  tabId?: string;
  /** Deployment ID from Kortix Master */
  deploymentId?: string;
  /** Proxy URL to open */
  proxyUrl?: string;
  /** When the service started */
  startedAt?: string;
  /** Source path on disk */
  sourcePath?: string;
  /** Process ID */
  pid?: number;
  /** Whether there's a preview tab open for this */
  hasTab?: boolean;
}

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
    if (diff < 3_600_000) {
      const m = Math.floor(diff / 60_000);
      return `${m}m ago`;
    }
    if (diff < 86_400_000) {
      const h = Math.floor(diff / 3_600_000);
      return `${h}h ago`;
    }
    const d = Math.floor(diff / 86_400_000);
    return `${d}d ago`;
  } catch {
    return '';
  }
}

function formatUptime(dateStr: string | undefined): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    const now = Date.now();
    const diff = now - date.getTime();
    if (diff < 0) return '';
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ${secs % 60}s`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ${mins % 60}m`;
    const days = Math.floor(hrs / 24);
    return `${days}d ${hrs % 24}h`;
  } catch {
    return '';
  }
}

const FRAMEWORK_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  nextjs: { bg: 'bg-zinc-800 dark:bg-zinc-200', text: 'text-white dark:text-zinc-900', label: 'Next.js' },
  vite: { bg: 'bg-purple-500/15', text: 'text-purple-700 dark:text-purple-300', label: 'Vite' },
  cra: { bg: 'bg-cyan-500/15', text: 'text-cyan-700 dark:text-cyan-300', label: 'CRA' },
  node: { bg: 'bg-green-500/15', text: 'text-green-700 dark:text-green-300', label: 'Node' },
  python: { bg: 'bg-yellow-500/15', text: 'text-yellow-700 dark:text-yellow-300', label: 'Python' },
  static: { bg: 'bg-blue-500/15', text: 'text-blue-700 dark:text-blue-300', label: 'Static' },
};

function getFrameworkStyle(fw: string) {
  return FRAMEWORK_STYLES[fw] || { bg: 'bg-muted', text: 'text-muted-foreground', label: fw };
}

/** Shorten a file path for display */
function shortenPath(path: string): string {
  if (!path) return '';
  // Strip /workspace prefix since it's the common root
  const stripped = path.replace(/^\/workspace\/?/, '');
  return stripped || '/';
}

// ============================================================================
// ServiceRow
// ============================================================================

function ServiceRow({ service }: { service: RunningService }) {
  const handleOpen = useCallback(() => {
    // Focus existing tab if available
    if (service.tabId) {
      const store = useTabStore.getState();
      const tab = store.tabs[service.tabId];
      if (tab) {
        store.setActiveTab(service.tabId);
        window.history.pushState(null, '', tab.href);
        return;
      }
    }

    // Open as preview tab
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

  const isDeployment = service.kind === 'deployment' || !!service.deploymentId;
  const isTerminal = service.kind === 'terminal';

  const Icon = isTerminal ? TerminalSquare : isDeployment ? Server : Globe;
  const fwStyle = service.framework ? getFrameworkStyle(service.framework) : null;

  return (
    <button
      onClick={handleOpen}
      className={cn(
        'w-full flex items-start gap-3 px-4 py-3 rounded-xl',
        'text-left transition-all duration-150 cursor-pointer',
        'hover:bg-muted/50 group/row',
        'border border-transparent hover:border-border/30',
      )}
    >
      {/* Icon + status */}
      <div className="relative mt-0.5 flex-shrink-0">
        <div className={cn(
          'w-8 h-8 rounded-lg border flex items-center justify-center',
          service.status === 'running'
            ? 'bg-emerald-500/10 border-emerald-500/20'
            : 'bg-muted border-border/50',
        )}>
          <Icon className={cn(
            'w-4 h-4',
            service.status === 'running'
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-muted-foreground',
          )} />
        </div>
        <span className={cn(
          'absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-background',
          service.status === 'running' ? 'bg-emerald-500' : 'bg-muted-foreground/40',
        )} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-1.5">
        {/* Title line */}
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-foreground truncate">
            {service.name}
          </span>
        </div>

        {/* Info grid */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {/* Port */}
          {service.port != null && service.port > 0 && (
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground/70">
              <Hash className="h-3 w-3 flex-shrink-0" />
              <span className="font-mono tabular-nums">{service.port}</span>
            </div>
          )}

          {/* Framework */}
          {fwStyle && (
            <span className={cn(
              'text-[10px] font-semibold px-2 py-0.5 rounded-md',
              fwStyle.bg, fwStyle.text,
            )}>
              {fwStyle.label}
            </span>
          )}

          {/* Source path */}
          {service.sourcePath && (
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground/50 max-w-[200px]">
              <FolderOpen className="h-3 w-3 flex-shrink-0" />
              <span className="truncate font-mono">{shortenPath(service.sourcePath)}</span>
            </div>
          )}

          {/* Uptime */}
          {service.startedAt && (
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground/50">
              <Clock className="h-3 w-3 flex-shrink-0" />
              <span className="tabular-nums">{formatTimeAgo(service.startedAt)}</span>
            </div>
          )}

          {/* PID */}
          {service.pid != null && service.pid > 0 && (
            <span className="text-[10px] text-muted-foreground/40 font-mono tabular-nums">
              PID {service.pid}
            </span>
          )}
        </div>

        {/* Session association */}
        {service.sessionTitle && (
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full bg-primary/40 flex-shrink-0" />
            <span className="text-[11px] text-primary/70 truncate">
              {service.sessionTitle}
            </span>
          </div>
        )}
      </div>

      {/* Open indicator */}
      <div className="flex flex-col items-center gap-1 flex-shrink-0 mt-0.5">
        {service.hasTab && (
          <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-medium border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5">
            open
          </Badge>
        )}
        <div className="opacity-0 group-hover/row:opacity-100 transition-opacity">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="p-1 rounded hover:bg-muted/80 text-muted-foreground/50 hover:text-muted-foreground">
                <ExternalLink className="h-3.5 w-3.5" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="left" className="text-xs">
              {service.hasTab ? 'Focus tab' : 'Open preview'}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </button>
  );
}

// ============================================================================
// Section header
// ============================================================================

function SectionHeader({
  title,
  icon: SectionIcon,
  count,
}: {
  title: string;
  icon: typeof Activity;
  count: number;
}) {
  return (
    <div className="flex items-center gap-2 px-4 pt-4 pb-2">
      <SectionIcon className="h-3.5 w-3.5 text-muted-foreground/40" />
      <span className="text-[11px] font-semibold text-muted-foreground/50 uppercase tracking-wider">
        {title}
      </span>
      <Badge variant="secondary" className="h-[18px] px-1.5 text-[10px] font-mono bg-muted/50 text-muted-foreground/60">
        {count}
      </Badge>
    </div>
  );
}

// ============================================================================
// RunningServicesPanel
// ============================================================================

export function RunningServicesPanel() {
  // Data sources
  const { data: deployments, isLoading: deploymentsLoading } = useSandboxDeployments();
  const { data: ptys, isLoading: ptysLoading } = useOpenCodePtyList();
  const { data: sessions } = useOpenCodeSessions();
  const tabs = useTabStore((s) => s.tabs);
  const tabOrder = useTabStore((s) => s.tabOrder);

  // Server info for proxy URL construction
  const activeServer = useServerStore((s) => {
    return s.servers.find((srv) => srv.id === s.activeServerId) ?? null;
  });
  const serverUrl = activeServer?.url || getActiveOpenCodeUrl();

  // Build a session lookup by ID
  const sessionMap = useMemo(() => {
    const map = new Map<string, Session>();
    if (sessions) {
      for (const s of sessions) {
        map.set(s.id, s);
      }
    }
    return map;
  }, [sessions]);

  // Build deployment lookup by port (for merging into preview tabs)
  const deploymentByPort = useMemo(() => {
    const map = new Map<number, SandboxDeployment>();
    if (deployments) {
      for (const dep of deployments) {
        map.set(dep.port, dep);
      }
    }
    return map;
  }, [deployments]);

  // Aggregate all running services into a unified list
  const { appServices, terminalServices } = useMemo(() => {
    const apps: RunningService[] = [];
    const terminals: RunningService[] = [];
    const seenPorts = new Set<number>();

    // 1. Preview tabs — merge with deployment data if available
    const previewTabs = tabOrder
      .map((id) => tabs[id])
      .filter((t): t is Tab => !!t && t.type === 'preview');

    for (const tab of previewTabs) {
      const port = (tab.metadata?.port as number) || 0;
      if (!port) continue;
      seenPorts.add(port);

      // Try to find matching deployment
      const dep = deploymentByPort.get(port);

      // Session association from tab metadata
      const sourceSessionId = tab.metadata?.sourceSessionId as string | undefined;
      const sourceSessionTitle = tab.metadata?.sourceSessionTitle as string | undefined;
      let sessionTitle = sourceSessionTitle;
      if (!sessionTitle && sourceSessionId) {
        sessionTitle = sessionMap.get(sourceSessionId)?.title;
      }

      apps.push({
        id: `app:${port}`,
        kind: dep ? 'deployment' : 'preview',
        name: dep?.deploymentId || tab.title || `localhost:${port}`,
        port,
        framework: dep?.framework,
        status: dep?.status || 'running',
        sessionId: sourceSessionId,
        sessionTitle,
        tabId: tab.id,
        deploymentId: dep?.deploymentId,
        proxyUrl: (tab.metadata?.url as string) || '',
        startedAt: dep?.startedAt,
        sourcePath: dep?.sourcePath,
        pid: dep?.pid,
        hasTab: true,
      });
    }

    // 2. Deployments not already covered by preview tabs
    if (deployments) {
      for (const dep of deployments) {
        if (seenPorts.has(dep.port)) continue;

        const subdomainOpts = getSubdomainOpts();
        const proxyUrl = activeServer
          ? (getDirectPortUrl(activeServer, String(dep.port)) || getProxyBaseUrl(dep.port, serverUrl, subdomainOpts))
          : getProxyBaseUrl(dep.port, serverUrl, subdomainOpts);

        apps.push({
          id: `app:${dep.port}`,
          kind: 'deployment',
          name: dep.deploymentId,
          port: dep.port,
          framework: dep.framework,
          status: dep.status,
          deploymentId: dep.deploymentId,
          proxyUrl,
          startedAt: dep.startedAt,
          sourcePath: dep.sourcePath,
          pid: dep.pid,
          hasTab: false,
        });
      }
    }

    // 3. Terminal tabs
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
  }, [tabs, tabOrder, deployments, deploymentByPort, activeServer, serverUrl, sessionMap]);

  const isLoading = deploymentsLoading || ptysLoading;
  const totalCount = appServices.length + terminalServices.length;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between h-12 px-4 border-b shrink-0">
        <div className="flex items-center gap-2.5">
          <Activity className="h-4 w-4 text-foreground/70" />
          <span className="text-sm font-medium text-foreground">Running Services</span>
          {totalCount > 0 && (
            <Badge variant="secondary" className="h-5 px-2 text-[10px] font-mono">
              {totalCount}
            </Badge>
          )}
        </div>
        {isLoading && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/50" />
        )}
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        {totalCount === 0 && !isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <div className="w-14 h-14 rounded-2xl bg-muted/30 flex items-center justify-center mb-4">
              <Activity className="h-7 w-7 opacity-20" />
            </div>
            <p className="text-sm font-medium">No running services</p>
            <p className="text-xs text-muted-foreground/50 mt-1.5 text-center px-8 leading-relaxed">
              Services will appear here when you deploy apps, open previews, or start terminals.
            </p>
          </div>
        ) : (
          <>
            {/* Apps & Previews */}
            {appServices.length > 0 && (
              <>
                <SectionHeader title="Apps & Previews" icon={Globe} count={appServices.length} />
                <div className="px-1">
                  {appServices.map((s) => (
                    <ServiceRow key={s.id} service={s} />
                  ))}
                </div>
              </>
            )}

            {/* Terminals */}
            {terminalServices.length > 0 && (
              <>
                <SectionHeader title="Terminals" icon={TerminalSquare} count={terminalServices.length} />
                <div className="px-1">
                  {terminalServices.map((s) => (
                    <ServiceRow key={s.id} service={s} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </ScrollArea>
    </div>
  );
}
