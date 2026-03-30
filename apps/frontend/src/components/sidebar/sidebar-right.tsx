'use client';

import * as React from 'react';
import { useCallback, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  useRightSidebar,
  SIDEBAR_RIGHT_WIDTH,
  SIDEBAR_RIGHT_WIDTH_ICON,
} from '@/components/ui/sidebar-right-provider';
import { useSandboxProxy } from '@/hooks/use-sandbox-proxy';
import { useCreatePty } from '@/hooks/opencode/use-opencode-pty';
import { openTabAndNavigate } from '@/stores/tab-store';
import { SANDBOX_PORTS } from '@/lib/platform-client';
import { SSHKeyDialog } from '@/components/sidebar/ssh-key-dialog';
import {
  getItemsByGroup,
  getNavItemsClustered,
  isItemActive,
  navSubGroupLabels,
  type MenuItemDef,
  type NavSubGroup,
} from '@/lib/menu-registry';
import { normalizeAppPathname } from '@/lib/instance-routes';
import { useProviderModalStore } from '@/stores/provider-modal-store';
import { useOnboardingModeStore } from '@/stores/onboarding-mode-store';
import { getClient } from '@/lib/opencode-sdk';
import { toast } from '@/lib/toast';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

// ============================================================================
// Main Right Sidebar — Quick actions (no file explorer — that's /files now)
// ============================================================================

export function SidebarRight() {
  const {
    state,
    open,
    setOpen,
    toggleSidebar,
    isMobile,
  } = useRightSidebar();

  const router = useRouter();
  const pathname = normalizeAppPathname(usePathname());
  const [sshDialogOpen, setSSHDialogOpen] = useState(false);

  const { getServiceUrl } = useSandboxProxy();

  // Create new PTY terminal → opens as a tab
  const createPty = useCreatePty();
  const handleNewTerminal = useCallback(async () => {
    try {
      const pty = await createPty.mutateAsync({
        env: { TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      });
      openTabAndNavigate({
        id: `terminal:${pty.id}`,
        title: pty.title || pty.command || `Terminal`,
        type: 'terminal',
        href: `/terminal/${pty.id}`,
      });
    } catch (e) {
      console.error('[SidebarRight] Failed to create PTY:', e);
    }
  }, [createPty]);

  // Reload / dispose instance → rescans skills, agents, plugins, config
  const [isReloading, setIsReloading] = useState(false);
  const [reloadDialogOpen, setReloadDialogOpen] = useState(false);

  const handleReloadInstance = useCallback(() => {
    setReloadDialogOpen(true);
  }, []);

  const confirmReloadInstance = useCallback(async () => {
    if (isReloading) return;
    setReloadDialogOpen(false);
    setIsReloading(true);
    try {
      const client = getClient();
      await client.instance.dispose();
      toast.success('Instance reloaded — skills, agents & config rescanned');
    } catch (e) {
      console.error('[SidebarRight] Instance reload failed:', e);
      toast.error('Failed to reload instance');
    } finally {
      setIsReloading(false);
    }
  }, [isReloading]);

  /**
   * Open a well-known sandbox service as a preview tab.
   * All modes route through the backend proxy — no direct localhost access.
   *
   * For local mode: prefer subdomain URLs (p{port}-{sandboxId}.localhost:8008)
   * because they use the in-memory authenticatedSubdomains map and avoid
   * cookie/auth timing issues with path-based proxy URLs.
   */
  const openSandboxServiceTab = useCallback(
    (containerPort: string, title: string) => {
      const url = getServiceUrl(parseInt(containerPort, 10));

      const tabId = `preview:${containerPort}`;
      const tabHref = `/p/${containerPort}`;

      openTabAndNavigate({
        id: tabId,
        title,
        type: 'preview',
        href: tabHref,
        metadata: {
          url,
          port: parseInt(containerPort, 10),
          originalUrl: `http://localhost:${containerPort}/`,
        },
      });
    },
    [getServiceUrl],
  );

  /** Generic handler for any registry item in the right sidebar */
  const handleItemAction = useCallback((item: MenuItemDef) => {
    switch (item.kind) {
      case 'navigate': {
        const tabType = (item.tabType || 'page') as any;
        const tabId = item.tabId || `page:${item.href}`;
        openTabAndNavigate(
          {
            id: tabId,
            title: item.label,
            type: tabType,
            href: item.href!,
            ...(item.tabType === 'preview' ? { metadata: { url: '', port: 0, originalUrl: '', path: '/' } } : {}),
          },
          router,
        );
        break;
      }
      case 'sandboxService':
        if (item.actionId === 'openAgentBrowser') {
          openSandboxServiceTab(SANDBOX_PORTS.BROWSER_VIEWER, item.label);
        }
        break;
      case 'action':
        if (item.actionId === 'newTerminal') {
          handleNewTerminal();
        } else if (item.actionId === 'generateSSHKey') {
          setSSHDialogOpen(true);
        } else if (item.actionId === 'openProviderModal') {
          useProviderModalStore.getState().openProviderModal('connected');
        } else if (item.actionId === 'reloadInstance') {
          handleReloadInstance();
        }
        break;
    }
  }, [router, openSandboxServiceTab, handleNewTerminal, handleReloadInstance]);

  // Get registry items for the right sidebar
  const quickActionClusters = getNavItemsClustered('rightSidebar', 'quickActions');
  const navClusters = getNavItemsClustered('rightSidebar', 'navigation');

  const obHide = useOnboardingModeStore((s) => s.active && !s.morphing);

  if (isMobile) return null;

  const effectiveGap = obHide ? '0px' : (open ? SIDEBAR_RIGHT_WIDTH : SIDEBAR_RIGHT_WIDTH_ICON);
  const effectivePanel = obHide ? '0px' : (open ? SIDEBAR_RIGHT_WIDTH : SIDEBAR_RIGHT_WIDTH_ICON);

  return (
    <>
      {/* Gap element — takes space in flex layout so content area shrinks */}
      <div
        className="relative shrink-0 bg-transparent transition-[width,opacity] duration-500 ease-out will-change-[width] transform-gpu"
        style={{
          width: effectiveGap,
          opacity: obHide ? 0 : 1,
        }}
      >
        {/* Rail — thin hoverable strip on the left edge to toggle */}
        <button
          aria-label="Toggle Sidebar"
          tabIndex={-1}
          onClick={toggleSidebar}
          title="Toggle Sidebar"
          className={cn(
            'hover:after:bg-sidebar-border absolute inset-y-0 left-0 z-20 hidden w-4 -translate-x-1/2 transition-all duration-300 ease-out after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] sm:flex',
            state === 'expanded' ? 'cursor-w-resize' : 'cursor-e-resize',
          )}
        />
      </div>

      {/* Fixed sidebar panel */}
      <div
        className="fixed inset-y-0 right-0 z-10 h-svh transition-[right,width,opacity] duration-500 ease-out will-change-[width,transform] transform-gpu backface-visibility-hidden flex overflow-visible"
        style={{
          width: effectivePanel,
          opacity: obHide ? 0 : 1,
        }}
      >
        <div className="bg-sidebar text-sidebar-foreground flex h-full w-full flex-col">

          {/* ====== HEADER ====== */}
          <div className="flex flex-col pt-3 pb-0 overflow-visible">
            <div className="relative flex h-[32px] items-center px-3 justify-between">
              {state === 'collapsed' && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <button
                    className="flex items-center justify-center h-7 w-7 rounded-lg cursor-pointer text-sidebar-foreground hover:bg-sidebar-accent transition-colors duration-150"
                    onClick={() => setOpen(true)}
                    aria-label="Expand sidebar"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              <div className={cn(
                'flex items-center justify-between w-full',
                state === 'collapsed' ? 'opacity-0 pointer-events-none' : 'opacity-100',
              )}>
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider select-none px-1">
                  Quick Actions
                </span>
                <button
                  className="flex items-center justify-center h-7 w-7 rounded-lg transition-colors duration-150 cursor-pointer text-sidebar-foreground hover:bg-sidebar-accent"
                  onClick={() => setOpen(false)}
                  aria-label="Collapse sidebar"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* ====== CONTENT ====== */}
          <div className={cn(
            'flex min-h-0 flex-1 flex-col relative',
            state === 'collapsed' ? 'overflow-visible' : 'overflow-hidden',
          )}>
            {/* --- Collapsed: icon buttons (registry-driven, clustered) --- */}
            <div className={cn(
              'absolute inset-0 px-2 pt-2 flex flex-col items-center overflow-visible',
              state === 'collapsed' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
            )}>
              {/* Quick action clusters */}
              {quickActionClusters.map((cluster, clusterIdx) => (
                <div key={cluster[0]?.subGroup ?? clusterIdx} className="w-full">
                  {clusterIdx > 0 && <div className="mx-auto my-2 h-px w-6 bg-sidebar-border/60" />}
                  <div className="space-y-0.5">
                    {cluster.map((item) => {
                      const Icon = item.icon;
                      const isTerminal = item.actionId === 'newTerminal';
                      const isReload = item.actionId === 'reloadInstance';
                      const isDisabled = (isTerminal && createPty.isPending) || (isReload && isReloading);
                      return (
                        <Tooltip key={item.id}>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => handleItemAction(item)}
                              disabled={isDisabled}
                              className={cn(
                                'flex items-center justify-center w-full py-2 rounded-lg cursor-pointer',
                                'text-sidebar-foreground hover:bg-sidebar-accent transition-colors duration-150',
                                'disabled:opacity-50 disabled:cursor-not-allowed',
                                isReload && isReloading && 'animate-spin',
                              )}
                            >
                              <Icon className="h-4 w-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="left" sideOffset={12} className="text-xs">
                            {isReload && isReloading ? 'Reloading...' : item.label}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Navigation clusters with separators */}
              {navClusters.map((cluster, clusterIdx) => (
                <div key={cluster[0]?.subGroup ?? clusterIdx} className="w-full">
                  {/* Separator between clusters */}
                  <div className="mx-auto my-2 h-px w-6 bg-sidebar-border/60" />
                  <div className="space-y-0.5">
                    {cluster.map((item) => {
                      const Icon = item.icon;
                      const active = isItemActive(item, pathname);
                      return (
                        <Tooltip key={item.id}>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => handleItemAction(item)}
                              className={cn(
                                'flex items-center justify-center w-full py-2 rounded-lg cursor-pointer transition-colors duration-150',
                                active
                                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                                  : 'text-sidebar-foreground hover:bg-sidebar-accent',
                              )}
                            >
                              <Icon className="h-4 w-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="left" sideOffset={12} className="text-xs">
                            {item.label}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>
              ))}

            </div>

            {/* --- Expanded: action list (registry-driven, clustered) --- */}
            <div className={cn(
              'flex flex-col h-full',
              state === 'collapsed' ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto',
            )}>
              <nav className="flex-1 px-3 pt-2 overflow-y-auto">
                {/* Quick action clusters with section labels */}
                {quickActionClusters.map((cluster, clusterIdx) => {
                  const subGroup = cluster[0]?.subGroup as NavSubGroup | undefined;
                  const label = subGroup ? navSubGroupLabels[subGroup] : undefined;
                  return (
                    <div key={subGroup ?? clusterIdx} className={clusterIdx === 0 ? 'mt-0' : 'mt-2'}>
                      {label && (
                        <div className="px-3 pb-1.5 pt-1">
                          <span className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider select-none">
                            {label}
                          </span>
                        </div>
                      )}
                      <div className="space-y-0.5">
                        {cluster.map((item) => {
                          const Icon = item.icon;
                          const isTerminal = item.actionId === 'newTerminal';
                          const isReload = item.actionId === 'reloadInstance';
                          const isDisabled = (isTerminal && createPty.isPending) || (isReload && isReloading);
                          const label = isTerminal && createPty.isPending
                            ? 'Creating...'
                            : isReload && isReloading
                              ? 'Reloading...'
                              : item.label;
                          return (
                            <button
                              key={item.id}
                              onClick={() => handleItemAction(item)}
                              disabled={isDisabled}
                              className={cn(
                                'flex items-center gap-3 w-full px-3 py-2 rounded-lg text-[13px] cursor-pointer',
                                'text-sidebar-foreground hover:bg-sidebar-accent transition-colors duration-150',
                                'disabled:opacity-50 disabled:cursor-not-allowed',
                              )}
                            >
                              <Icon className={cn("h-4 w-4 flex-shrink-0", isReload && isReloading && 'animate-spin')} />
                              <span>{label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {/* Navigation clusters with section labels */}
                {navClusters.map((cluster, clusterIdx) => {
                  const subGroup = cluster[0]?.subGroup as NavSubGroup | undefined;
                  const label = subGroup ? navSubGroupLabels[subGroup] : undefined;
                  return (
                    <div key={subGroup ?? clusterIdx} className="mt-3">
                      {label && (
                        <div className="px-3 pb-1.5 pt-1">
                          <span className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider select-none">
                            {label}
                          </span>
                        </div>
                      )}
                      <div className="space-y-0.5">
                        {cluster.map((item) => {
                          const Icon = item.icon;
                          const active = isItemActive(item, pathname);
                          return (
                            <button
                              key={item.id}
                              onClick={() => handleItemAction(item)}
                              className={cn(
                                'flex items-center gap-3 w-full px-3 py-2 rounded-lg text-[13px] transition-colors duration-150 cursor-pointer',
                                active
                                  ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                                  : 'text-sidebar-foreground hover:bg-sidebar-accent',
                              )}
                            >
                              <Icon className="h-4 w-4 flex-shrink-0" />
                              <span>{item.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </nav>

            </div>
          </div>
        </div>
      </div>

      <SSHKeyDialog open={sshDialogOpen} onOpenChange={setSSHDialogOpen} />

      <AlertDialog open={reloadDialogOpen} onOpenChange={setReloadDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reload Instance</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>This will tear down and rebuild the agent runtime. All active sessions will be interrupted.</p>
                <ul className="list-disc pl-4 text-xs text-muted-foreground space-y-1">
                  <li>All MCP connections will be dropped and reconnected</li>
                  <li>In-flight LLM calls and tool executions will abort</li>
                  <li>Skills, agents, plugins, tools, and config will be rescanned from disk</li>
                  <li>You&apos;ll need to send a new message to resume in each session</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={confirmReloadInstance}
              disabled={isReloading}
            >
              {isReloading ? 'Reloading...' : 'Reload Instance'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
