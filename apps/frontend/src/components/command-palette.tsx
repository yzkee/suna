'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  Loader2,
  MessageCircle,
  Search,
  ArrowRightLeft,
  PanelLeftClose,
  PanelLeftIcon,
  ArrowUp,
  ArrowDown,
  CornerDownLeft,
  FolderKanban,
  Bot,
  Cpu,
  ChevronRight,
  ArrowLeft,
  Check,
} from 'lucide-react';

import {
  getItemsForSurface,
  type MenuItemDef,
  type SettingsTabId,
} from '@/lib/menu-registry';

import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandFooter,
  CommandKbd,
} from '@/components/ui/command';
import { useSidebar } from '@/components/ui/sidebar';
import {
  useOpenCodeSessions,
  useOpenCodeProjects,
  useOpenCodeAgents,
  useOpenCodeProviders,
} from '@/hooks/opencode/use-opencode-sessions';
import { toast } from '@/lib/toast';
import { useCreateOpenCodeSession } from '@/hooks/opencode/use-opencode-sessions';
import { openTabAndNavigate } from '@/stores/tab-store';
import { useCreatePty } from '@/hooks/opencode/use-opencode-pty';
import { CompactDialog } from '@/components/session/compact-dialog';
import { DiffDialog } from '@/components/session/diff-dialog';
import { UserSettingsModal } from '@/components/settings/user-settings-modal';
import { PlanSelectionModal } from '@/components/billing/pricing';
import { createClient } from '@/lib/supabase/client';
import { isBillingEnabled } from '@/lib/config';
import { useTheme } from 'next-themes';
import { clearUserLocalStorage } from '@/lib/utils/clear-local-storage';
import { useAdminRole } from '@/hooks/admin';
import { flattenModels } from '@/components/session/session-chat-input';
import { useModelStore } from '@/hooks/opencode/use-model-store';
import {
  PROVIDER_LABELS,
  ProviderLogo,
  MODEL_SELECTOR_PROVIDER_IDS,
} from '@/components/providers/provider-branding';

// ============================================================================
// Types
// ============================================================================

type PalettePage = 'root' | 'agents' | 'models';

// ============================================================================
// Helpers
// ============================================================================

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function deriveProjectName(project: { id: string; name?: string; worktree: string }): string {
  if (project.name) return project.name;
  if (project.worktree === '/' || project.id === 'global') return 'Global';
  return project.worktree.split('/').pop() || project.worktree;
}

/**
 * Sanitize a value string for use as a cmdk CommandItem value.
 * cmdk sets data-value then calls querySelector('[data-value="..."]'),
 * so any characters that break CSS attribute selectors must be removed.
 */
function sanitizeCmdkValue(value: string): string {
  // Remove double quotes, single quotes, backslashes, brackets — all CSS selector breakers
  return value.replace(/["'\\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ============================================================================
// Command Palette
// ============================================================================

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState<PalettePage>('root');
  const [isCreating, setIsCreating] = useState(false);
  const [compactOpen, setCompactOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('general');
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const currentSessionId = useMemo(() => {
    const match = pathname?.match(/^\/sessions\/([^/]+)/);
    return match ? match[1] : null;
  }, [pathname]);
  const { toggleSidebar, open: sidebarOpen } = useSidebar();
  const createSession = useCreateOpenCodeSession();
  const createPty = useCreatePty();
  const { theme, setTheme } = useTheme();
  const billingEnabled = isBillingEnabled();
  const { data: adminRoleData } = useAdminRole();
  const isAdmin = adminRoleData?.isAdmin ?? false;

  // ── Data hooks ──
  const { data: sessions } = useOpenCodeSessions();
  const { data: projects } = useOpenCodeProjects();
  const { data: agents } = useOpenCodeAgents();
  const { data: providers } = useOpenCodeProviders();

  // ── Derived: flat models ──
  const allModels = useMemo(() => flattenModels(providers), [providers]);
  const modelStore = useModelStore(allModels);

  // ── Current agent/model for the active session ──
  const currentAgentName = useMemo(() => {
    if (!currentSessionId) return undefined;
    return modelStore.getSessionAgentName(currentSessionId);
  }, [currentSessionId, modelStore]);

  const currentAgent = useMemo(() => {
    if (!currentAgentName || !agents) return agents?.[0];
    return agents.find((a) => a.name === currentAgentName) ?? agents[0];
  }, [currentAgentName, agents]);

  const currentModelKey = useMemo(() => {
    if (!currentAgent) return undefined;
    return modelStore.getSelectedModel(currentAgent.name);
  }, [currentAgent, modelStore]);

  const close = useCallback(() => setOpen(false), []);

  // ── Page navigation helpers ──
  const goToPage = useCallback((p: PalettePage) => {
    setPage(p);
    setQuery('');
  }, []);

  const goBack = useCallback(() => {
    setPage('root');
    setQuery('');
  }, []);

  const handleOpenTerminal = useCallback(async () => {
    try {
      const pty = await createPty.mutateAsync({
        env: { TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      });
      openTabAndNavigate({
        id: `terminal:${pty.id}`,
        title: pty.title || pty.command || 'Terminal',
        type: 'terminal',
        href: `/terminal/${pty.id}`,
      });
    } catch {
      toast.error('Failed to open terminal');
    }
    close();
  }, [createPty, close]);

  // Global keyboard shortcut
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === '`' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleOpenTerminal();
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [handleOpenTerminal]);

  // Reset when dialog closes
  useEffect(() => {
    if (!open) {
      setQuery('');
      setPage('root');
    }
  }, [open]);

  // Backspace on empty query goes back to root
  useEffect(() => {
    if (page === 'root') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Backspace' && query === '') {
        e.preventDefault();
        goBack();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [page, query, goBack]);

  // Fuzzy match helper
  const fuzzyMatch = useCallback((text: string, q: string): boolean => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const haystack = text.toLowerCase();
    return words.every((w) => haystack.includes(w));
  }, []);

  // ── Filter: sessions ──
  const filteredSessions = useMemo(() => {
    if (!sessions || !query.trim()) return [];
    const q = query.trim();
    return sessions
      .filter((s) => {
        if (s.parentID || s.time.archived) return false;
        const searchable = [s.title, s.slug, s.id].filter(Boolean).join(' ');
        return fuzzyMatch(searchable, q);
      })
      .slice(0, 20);
  }, [sessions, query, fuzzyMatch]);

  // ── Filter: projects ──
  const filteredProjects = useMemo(() => {
    if (!projects) return [];
    const sorted = [...projects].sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0));
    if (!query.trim()) return sorted.slice(0, 5);
    const q = query.trim();
    return sorted
      .filter((p) => {
        const name = deriveProjectName(p);
        const searchable = [name, p.worktree, p.id].join(' ');
        return fuzzyMatch(searchable, q);
      })
      .slice(0, 15);
  }, [projects, query, fuzzyMatch]);

  // Recent sessions for idle state
  const recentSessions = useMemo(() => {
    if (!sessions) return [];
    return sessions.filter((s) => !s.parentID && !s.time.archived).slice(0, 5);
  }, [sessions]);

  const hasQuery = query.trim().length > 0;
  const queryLongEnough = query.trim().length >= 2;

  const hasSessionResults = filteredSessions.length > 0;
  const hasProjectResults = filteredProjects.length > 0;

  // ── Palette items ──
  const allPaletteItems = useMemo(() => {
    return getItemsForSurface('commandPalette').filter((item) => {
      if (item.requiresBilling && !billingEnabled) return false;
      if (item.requiresSession && !currentSessionId) return false;
      if (item.requiresAdmin && !isAdmin) return false;
      return true;
    });
  }, [billingEnabled, currentSessionId, isAdmin]);

  // Filter navigation items client-side
  const filteredNavItems = useMemo(() => {
    if (!hasQuery) return allPaletteItems;
    const q = query.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    return allPaletteItems.filter((item) => {
      const haystack = [
        item.label,
        item.id,
        item.group,
        item.keywords || '',
      ].join(' ').toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
  }, [allPaletteItems, hasQuery, query]);

  // ── Submenu: agents ──
  const visibleAgents = useMemo(() => {
    if (!agents) return [];
    return agents.filter((a) => !a.hidden);
  }, [agents]);

  const filteredAgents = useMemo(() => {
    if (!visibleAgents.length) return [];
    if (!query.trim()) return visibleAgents;
    const q = query.trim().toLowerCase();
    return visibleAgents.filter((a) =>
      a.name.toLowerCase().includes(q) || (a.description || '').toLowerCase().includes(q),
    );
  }, [visibleAgents, query]);

  const primaryAgents = useMemo(() => filteredAgents.filter((a) => a.mode !== 'subagent'), [filteredAgents]);
  const subAgents = useMemo(() => filteredAgents.filter((a) => a.mode === 'subagent'), [filteredAgents]);

  // ── Submenu: models (grouped by provider) ──
  const visibleModels = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allModels
      .filter((m) => {
        if (!q && !modelStore.isVisible({ providerID: m.providerID, modelID: m.modelID })) return false;
        return !q || m.modelName.toLowerCase().includes(q) || m.modelID.toLowerCase().includes(q) || m.providerName.toLowerCase().includes(q);
      })
      .sort((a, b) => a.modelName.localeCompare(b.modelName));
  }, [allModels, query, modelStore]);

  const groupedModels = useMemo(() => {
    const groups = new Map<string, { providerID: string; providerName: string; models: typeof visibleModels }>();
    for (const m of visibleModels) {
      const existing = groups.get(m.providerID);
      if (existing) {
        existing.models.push(m);
      } else {
        groups.set(m.providerID, { providerID: m.providerID, providerName: PROVIDER_LABELS[m.providerID] || m.providerName, models: [m] });
      }
    }
    const entries = Array.from(groups.values());
    entries.sort((a, b) => {
      const ai = MODEL_SELECTOR_PROVIDER_IDS.indexOf(a.providerID);
      const bi = MODEL_SELECTOR_PROVIDER_IDS.indexOf(b.providerID);
      if (ai >= 0 && bi < 0) return -1;
      if (ai < 0 && bi >= 0) return 1;
      if (ai >= 0 && bi >= 0) return ai - bi;
      return a.providerName.localeCompare(b.providerName);
    });
    return entries;
  }, [visibleModels]);

  // ── "Change Agent" and "Change Model" virtual palette items ──
  const sessionActionItems = useMemo(() => {
    if (!hasQuery) return [];
    const q = query.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const items: { id: string; label: string; keywords: string; targetPage: PalettePage }[] = [];
    if (currentSessionId) {
      items.push({
        id: 'change-agent',
        label: 'Change Agent',
        keywords: 'change agent worker switch select bot assistant',
        targetPage: 'agents',
      });
      items.push({
        id: 'change-model',
        label: 'Change Model',
        keywords: 'change model llm switch select provider anthropic openai claude gpt',
        targetPage: 'models',
      });
    }
    return items.filter((item) => {
      const haystack = [item.label, item.keywords].join(' ').toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
  }, [hasQuery, query, currentSessionId]);

  const hasNavResults = filteredNavItems.length > 0;
  const hasSessionActionResults = sessionActionItems.length > 0;
  const hasAnyResults = hasNavResults || hasSessionResults || hasProjectResults || hasSessionActionResults;

  const showNoResults =
    hasQuery &&
    queryLongEnough &&
    !hasAnyResults;

  // ── Handlers ──

  const handleNewSession = useCallback(async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const session = await createSession.mutateAsync();
      openTabAndNavigate({
        id: session.id,
        title: 'New session',
        type: 'session',
        href: `/sessions/${session.id}`,
      });
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent('focus-session-textarea'));
      });
      close();
    } catch {
      toast.error('Failed to create session');
    } finally {
      setIsCreating(false);
    }
  }, [isCreating, createSession, close]);

  const handleNavigate = useCallback(
    (path: string, label?: string) => {
      const type = path.startsWith('/settings')
        ? 'settings' as const
        : 'page' as const;
      openTabAndNavigate({
        id: `page:${path}`,
        title: label || path.split('/').pop() || '',
        type,
        href: path,
      }, router);
      close();
    },
    [router, close],
  );

  const handleSelectSession = useCallback(
    (sessionId: string, title?: string) => {
      openTabAndNavigate({
        id: sessionId,
        title: title || 'Session',
        type: 'session',
        href: `/sessions/${sessionId}`,
      });
      close();
    },
    [close],
  );

  const handleSelectProject = useCallback(
    (projectId: string, name: string) => {
      openTabAndNavigate({
        id: `page:/projects/${projectId}`,
        title: name,
        type: 'page',
        href: `/projects/${projectId}`,
      }, router);
      close();
    },
    [router, close],
  );

  const handleToggleSidebar = useCallback(() => {
    toggleSidebar();
    close();
  }, [toggleSidebar, close]);

  const handleOpenSettings = useCallback((tab: SettingsTabId) => {
    close();
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, [close]);

  const handleOpenPlan = useCallback(() => {
    close();
    setPlanModalOpen(true);
  }, [close]);

  const handleLogout = useCallback(async () => {
    close();
    const supabase = createClient();
    await supabase.auth.signOut();
    clearUserLocalStorage();
    router.push('/auth');
  }, [close, router]);

  const handleSetTheme = useCallback((newTheme: string) => {
    setTheme(newTheme);
    close();
  }, [setTheme, close]);

  const handleCompactSession = useCallback(() => {
    if (!currentSessionId) return;
    close();
    setCompactOpen(true);
  }, [currentSessionId, close]);

  const handleViewChanges = useCallback(() => {
    if (!currentSessionId) return;
    close();
    setDiffOpen(true);
  }, [currentSessionId, close]);

  // ── Registry action dispatcher ──
  const handleOpenProviderModal = useCallback(() => {
    close();
    import('@/stores/provider-modal-store').then(({ useProviderModalStore }) => {
      useProviderModalStore.getState().openProviderModal('connected');
    });
  }, [close]);

  const actionHandlers: Record<string, () => void> = useMemo(() => ({
    newSession: handleNewSession,
    openTerminal: handleOpenTerminal,
    compactSession: handleCompactSession,
    viewChanges: handleViewChanges,
    toggleSidebar: handleToggleSidebar,
    logout: handleLogout,
    openPlan: handleOpenPlan,
    openProviderModal: handleOpenProviderModal,
  }), [handleNewSession, handleOpenTerminal, handleCompactSession, handleViewChanges, handleToggleSidebar, handleLogout, handleOpenPlan, handleOpenProviderModal]);

  const handleRegistryItem = useCallback((item: MenuItemDef) => {
    switch (item.kind) {
      case 'navigate':
        handleNavigate(item.href!, item.label);
        break;
      case 'settings':
        handleOpenSettings(item.settingsTab!);
        break;
      case 'theme':
        handleSetTheme(item.themeValue!);
        break;
      case 'action': {
        const handler = actionHandlers[item.actionId!];
        if (handler) handler();
        break;
      }
    }
  }, [handleNavigate, handleOpenSettings, handleSetTheme, actionHandlers]);

  // ── Agent/Model selection handlers ──
  const handleSelectAgent = useCallback((agentName: string) => {
    if (!currentSessionId) return;
    modelStore.setSessionAgentName(currentSessionId, agentName);
    toast.success(`Agent switched to ${agentName}`);
    close();
  }, [currentSessionId, modelStore, close]);

  const handleSelectModel = useCallback((providerID: string, modelID: string) => {
    if (!currentAgent) return;
    modelStore.setSelectedModel(currentAgent.name, { providerID, modelID });
    modelStore.pushRecent({ providerID, modelID });
    const model = allModels.find((m) => m.providerID === providerID && m.modelID === modelID);
    toast.success(`Model switched to ${model?.modelName || modelID}`);
    close();
  }, [currentAgent, modelStore, allModels, close]);

  // Count results for footer
  const totalSearchResults = useMemo(() => {
    if (page === 'agents') return filteredAgents.length;
    if (page === 'models') return visibleModels.length;
    if (!hasQuery) return 0;
    return filteredNavItems.length + filteredSessions.length + filteredProjects.length + sessionActionItems.length;
  }, [page, hasQuery, filteredNavItems, filteredSessions, filteredProjects, sessionActionItems, filteredAgents, visibleModels]);

  // ── Placeholder text ──
  const placeholder = useMemo(() => {
    if (page === 'agents') return 'Search agents...';
    if (page === 'models') return 'Search models...';
    return 'Search commands, projects, sessions...';
  }, [page]);

  // ── Page title for submenu header ──
  const pageTitle = useMemo(() => {
    if (page === 'agents') return 'Change Agent';
    if (page === 'models') return 'Change Model';
    return null;
  }, [page]);

  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen} className="sm:max-w-[680px]">
        {/* Submenu breadcrumb header */}
        {page !== 'root' && (
          <div className="flex items-center gap-2 px-4 pt-3 pb-1">
            <button
              type="button"
              onClick={goBack}
              className="flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer"
            >
              <ArrowLeft className="h-3 w-3" />
              <span>Back</span>
            </button>
            <span className="text-xs text-muted-foreground/30">/</span>
            <span className="text-xs font-medium text-foreground/80">{pageTitle}</span>
          </div>
        )}

        <CommandInput
          ref={inputRef}
          placeholder={placeholder}
          value={query}
          onValueChange={setQuery}
        />

        <CommandList>
          {/* ============================================================ */}
          {/* PAGE: ROOT                                                    */}
          {/* ============================================================ */}
          {page === 'root' && (
            <>
              {/* ── IDLE STATE ── */}
              {!hasQuery && (
                <>
                  <CommandGroup heading="Suggestions" forceMount>
                    {allPaletteItems
                      .filter(
                        (item) =>
                          item.group === 'actions' ||
                          item.group === 'navigation',
                      )
                      .slice(0, 8)
                      .map((item) => {
                        const Icon = item.icon;
                        const isToggleSidebar = item.id === 'toggle-sidebar';
                        const DisplayIcon = isToggleSidebar
                          ? sidebarOpen
                            ? PanelLeftClose
                            : PanelLeftIcon
                          : Icon;
                        const displayLabel = isToggleSidebar
                          ? sidebarOpen
                            ? 'Collapse Sidebar'
                            : 'Expand Sidebar'
                          : item.label;

                        return (
                          <CommandItem
                            key={item.id}
                            value={sanitizeCmdkValue(`suggestion ${item.label} ${item.keywords || ''}`)}
                            onSelect={() => handleRegistryItem(item)}
                            disabled={item.id === 'new-session' && isCreating}
                          >
                            {item.id === 'new-session' && isCreating ? (
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            ) : (
                              <DisplayIcon className="h-4 w-4" />
                            )}
                            <span className="flex-1">{displayLabel}</span>
                            {item.shortcut && (
                              <CommandShortcut>{item.shortcut}</CommandShortcut>
                            )}
                          </CommandItem>
                        );
                      })}

                    {/* Session actions in idle state */}
                    {currentSessionId && (
                      <>
                        <CommandItem
                          value="suggestion change agent worker switch"
                          onSelect={() => goToPage('agents')}
                        >
                          <Bot className="h-4 w-4" />
                          <span className="flex-1">Change Agent</span>
                          {currentAgent && (
                            <span className="text-[10px] text-muted-foreground/40">{currentAgent.name}</span>
                          )}
                          <ChevronRight className="h-3 w-3 text-muted-foreground/30" />
                        </CommandItem>
                        <CommandItem
                          value="suggestion change model llm switch"
                          onSelect={() => goToPage('models')}
                        >
                          <Cpu className="h-4 w-4" />
                          <span className="flex-1">Change Model</span>
                          {currentModelKey && (
                            <span className="text-[10px] text-muted-foreground/40 truncate max-w-[160px]">
                              {allModels.find(
                                (m) => m.providerID === currentModelKey.providerID && m.modelID === currentModelKey.modelID,
                              )?.modelName || currentModelKey.modelID}
                            </span>
                          )}
                          <ChevronRight className="h-3 w-3 text-muted-foreground/30" />
                        </CommandItem>
                      </>
                    )}
                  </CommandGroup>

                  {/* Projects */}
                  {filteredProjects.length > 0 && (
                    <CommandGroup heading="Projects" forceMount>
                      {filteredProjects.map((project) => {
                        const name = deriveProjectName(project);
                        return (
                          <CommandItem
                            key={project.id}
                            value={sanitizeCmdkValue(`project ${name} ${project.worktree} ${project.id}`)}
                            onSelect={() => handleSelectProject(project.id, name)}
                          >
                            <FolderKanban className="h-4 w-4 flex-shrink-0" />
                            <div className="flex flex-col overflow-hidden flex-1 min-w-0">
                              <span className="truncate text-sm font-medium">{name}</span>
                              {project.worktree && project.worktree !== '/' && (
                                <span className="text-[11px] text-muted-foreground/40 truncate font-mono">
                                  {project.worktree}
                                </span>
                              )}
                            </div>
                            {project.time?.updated && (
                              <span className="text-[10px] text-muted-foreground/30 tabular-nums flex-shrink-0">
                                {formatRelativeTime(project.time.updated)}
                              </span>
                            )}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  )}

                  {/* Recent Sessions */}
                  {recentSessions.length > 0 && (
                    <CommandGroup heading="Recent Sessions" forceMount>
                      {recentSessions.map((session) => (
                        <CommandItem
                          key={session.id}
                          value={sanitizeCmdkValue(`recent ${session.title || ''} ${session.slug || ''} ${session.id}`)}
                          onSelect={() =>
                            handleSelectSession(
                              session.id,
                              session.title || session.slug || 'Untitled',
                            )
                          }
                        >
                          <MessageCircle className="h-4 w-4 flex-shrink-0" />
                          <span className="truncate flex-1">
                            {session.title || session.slug || 'Untitled'}
                          </span>
                          <span className="text-[10px] text-muted-foreground/30 tabular-nums flex-shrink-0">
                            {formatRelativeTime(session.time.updated)}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </>
              )}

              {/* ── SEARCH STATE ── */}
              {hasQuery && (
                <>
                  {/* Session actions (Change Agent / Change Model) */}
                  {hasSessionActionResults && (
                    <CommandGroup heading="Session" forceMount>
                      {sessionActionItems.map((item) => (
                        <CommandItem
                          key={item.id}
                          value={`${item.label} ${item.keywords}`}
                          onSelect={() => goToPage(item.targetPage)}
                        >
                          {item.id === 'change-agent' ? <Bot className="h-4 w-4" /> : <Cpu className="h-4 w-4" />}
                          <span className="flex-1">{item.label}</span>
                          <ChevronRight className="h-3 w-3 text-muted-foreground/30" />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}

                  {/* Navigation */}
                  {hasNavResults && (
                    <CommandGroup heading="Navigation" forceMount>
                      {filteredNavItems.map((item) => {
                        const Icon = item.icon;
                        const isToggleSidebar = item.id === 'toggle-sidebar';
                        const SidebarIcon = isToggleSidebar
                          ? (sidebarOpen ? PanelLeftClose : PanelLeftIcon)
                          : Icon;
                        const displayLabel = isToggleSidebar
                          ? (sidebarOpen ? 'Collapse Sidebar' : 'Expand Sidebar')
                          : item.label;
                        const isActiveTheme = item.kind === 'theme' && theme === item.themeValue;

                        return (
                        <CommandItem
                          key={item.id}
                          value={sanitizeCmdkValue(item.keywords || `${item.group} ${item.label} ${item.id}`)}
                          onSelect={() => handleRegistryItem(item)}
                            disabled={item.id === 'new-session' && isCreating}
                          >
                            {item.id === 'new-session' && isCreating ? (
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            ) : (
                              <SidebarIcon className="h-4 w-4" />
                            )}
                            <span className="flex-1">{displayLabel}</span>
                            {item.shortcut && (
                              <CommandShortcut>
                                {item.shortcut}
                              </CommandShortcut>
                            )}
                            {isActiveTheme && (
                              <span className="text-[10px] text-primary/60 font-medium">Active</span>
                            )}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  )}

                  {/* Projects */}
                  {hasProjectResults && (
                    <CommandGroup heading="Projects" forceMount>
                      {filteredProjects.map((project) => {
                        const name = deriveProjectName(project);
                        return (
                          <CommandItem
                            key={project.id}
                            value={`project-${project.id}`}
                            onSelect={() => handleSelectProject(project.id, name)}
                          >
                            <FolderKanban className="h-4 w-4 flex-shrink-0" />
                            <div className="flex flex-col overflow-hidden flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-sm font-medium">{name}</span>
                                {project.worktree && project.worktree !== '/' && (
                                  <span className="text-[10px] text-muted-foreground/40 font-mono flex-shrink-0 truncate max-w-[200px]">
                                    {project.worktree}
                                  </span>
                                )}
                              </div>
                            </div>
                            {project.time?.updated && (
                              <span className="text-[10px] text-muted-foreground/30 tabular-nums flex-shrink-0">
                                {formatRelativeTime(project.time.updated)}
                              </span>
                            )}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  )}

                  {/* Sessions */}
                  {hasSessionResults && (
                    <CommandGroup heading="Sessions" forceMount>
                      {filteredSessions.map((session) => {
                        const hasTitle = !!(session.title || session.slug);
                        return (
                          <CommandItem
                            key={session.id}
                            value={`session-${session.id}`}
                            onSelect={() =>
                              handleSelectSession(
                                session.id,
                                session.title || session.slug || session.id,
                              )
                            }
                          >
                            <MessageCircle className="h-4 w-4 flex-shrink-0" />
                            <div className="flex flex-col overflow-hidden flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                {hasTitle ? (
                                  <>
                                    <span className="truncate text-sm font-medium">
                                      {session.title || session.slug}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground/40 font-mono flex-shrink-0">
                                      {session.id}
                                    </span>
                                  </>
                                ) : (
                                  <span className="truncate text-sm font-mono text-muted-foreground/70">
                                    {session.id}
                                  </span>
                                )}
                              </div>
                              <span className="text-[11px] text-muted-foreground/50 truncate">
                                {formatRelativeTime(session.time.updated)}
                                {session.summary && session.summary.files > 0 && (
                                  <span className="ml-1">
                                    · {session.summary.files} file
                                    {session.summary.files !== 1 ? 's' : ''}
                                  </span>
                                )}
                              </span>
                            </div>
                            <ArrowRightLeft className="h-3 w-3 text-muted-foreground/30 flex-shrink-0" />
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  )}

                  {/* No results */}
                  {showNoResults && (
                    <div className="flex flex-col items-center gap-2 py-12" cmdk-empty="">
                      <div className="flex items-center justify-center h-10 w-10 rounded-full bg-muted/30">
                        <Search className="h-4 w-4 text-muted-foreground/30" />
                      </div>
                      <div className="text-center">
                        <span className="text-sm text-muted-foreground/60">
                          No results for &ldquo;{query.trim()}&rdquo;
                        </span>
                        <p className="text-[11px] text-muted-foreground/30 mt-1">
                          Try a different search term
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* ============================================================ */}
          {/* PAGE: AGENTS                                                  */}
          {/* ============================================================ */}
          {page === 'agents' && (
            <>
              {primaryAgents.length > 0 && (
                <CommandGroup heading="Agents" forceMount>
                  {primaryAgents.map((agent) => {
                    const isActive = currentAgent?.name === agent.name;
                    return (
                      <CommandItem
                        key={agent.name}
                        value={sanitizeCmdkValue(`agent ${agent.name} ${agent.description || ''}`)}
                        onSelect={() => handleSelectAgent(agent.name)}
                      >
                        <Bot className="h-4 w-4" />
                        <div className="flex flex-col overflow-hidden flex-1 min-w-0">
                          <span className="truncate text-sm font-medium">{agent.name}</span>
                          {agent.description && (
                            <span className="text-[11px] text-muted-foreground/50 truncate">
                              {agent.description}
                            </span>
                          )}
                        </div>
                        {isActive && (
                          <Check className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                        )}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}

              {subAgents.length > 0 && (
                <CommandGroup heading="Sub-agents" forceMount>
                  {subAgents.map((agent) => {
                    const isActive = currentAgent?.name === agent.name;
                    return (
                      <CommandItem
                        key={agent.name}
                        value={sanitizeCmdkValue(`subagent ${agent.name} ${agent.description || ''}`)}
                        onSelect={() => handleSelectAgent(agent.name)}
                      >
                        <Bot className="h-4 w-4 text-muted-foreground/50" />
                        <div className="flex flex-col overflow-hidden flex-1 min-w-0">
                          <span className="truncate text-sm">{agent.name}</span>
                          {agent.description && (
                            <span className="text-[11px] text-muted-foreground/50 truncate">
                              {agent.description}
                            </span>
                          )}
                        </div>
                        {isActive && (
                          <Check className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                        )}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}

              {filteredAgents.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-12" cmdk-empty="">
                  <Bot className="h-5 w-5 text-muted-foreground/30" />
                  <span className="text-sm text-muted-foreground/60">
                    {query ? `No agents matching "${query}"` : 'No agents available'}
                  </span>
                </div>
              )}
            </>
          )}

          {/* ============================================================ */}
          {/* PAGE: MODELS                                                  */}
          {/* ============================================================ */}
          {page === 'models' && (
            <>
              {groupedModels.map((group) => (
                <CommandGroup
                  key={group.providerID}
                  heading={
                    <span className="inline-flex items-center gap-1.5">
                      <ProviderLogo providerID={group.providerID} size="small" />
                      {group.providerName}
                    </span>
                  }
                  forceMount
                >
                  {group.models.map((model) => {
                    const isActive =
                      currentModelKey?.providerID === model.providerID &&
                      currentModelKey?.modelID === model.modelID;
                    return (
                      <CommandItem
                        key={`${model.providerID}:${model.modelID}`}
                        value={sanitizeCmdkValue(`model ${model.providerName} ${model.modelName} ${model.modelID}`)}
                        onSelect={() => handleSelectModel(model.providerID, model.modelID)}
                      >
                        <div className="flex flex-col overflow-hidden flex-1 min-w-0">
                          <span className="truncate text-sm">{model.modelName}</span>
                          <span className="text-[10px] text-muted-foreground/40 font-mono truncate">
                            {model.modelID}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {model.capabilities?.reasoning && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium leading-none bg-blue-500/10 text-blue-600 dark:text-blue-400">
                              reasoning
                            </span>
                          )}
                          {model.capabilities?.vision && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium leading-none bg-purple-500/10 text-purple-600 dark:text-purple-400">
                              vision
                            </span>
                          )}
                          {isActive && (
                            <Check className="h-3.5 w-3.5 text-primary" />
                          )}
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}

              {visibleModels.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-12" cmdk-empty="">
                  <Cpu className="h-5 w-5 text-muted-foreground/30" />
                  <span className="text-sm text-muted-foreground/60">
                    {query ? `No models matching "${query}"` : 'No models available'}
                  </span>
                </div>
              )}
            </>
          )}
        </CommandList>

        {/* ── Footer ── */}
        <CommandFooter>
          <div className="flex items-center gap-1">
            <ArrowUp className="h-3 w-3" />
            <ArrowDown className="h-3 w-3" />
            <span>navigate</span>
          </div>
          <div className="flex items-center gap-1">
            <CornerDownLeft className="h-3 w-3" />
            <span>select</span>
          </div>
          {page !== 'root' && (
            <div className="flex items-center gap-1">
              <CommandKbd>⌫</CommandKbd>
              <span>back</span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <CommandKbd>esc</CommandKbd>
            <span>close</span>
          </div>
          {totalSearchResults > 0 && (
            <span className="ml-auto tabular-nums">
              {totalSearchResults} result{totalSearchResults !== 1 ? 's' : ''}
            </span>
          )}
        </CommandFooter>
      </CommandDialog>

      {currentSessionId && (
        <>
          <CompactDialog
            sessionId={currentSessionId}
            open={compactOpen}
            onOpenChange={setCompactOpen}
          />
          <DiffDialog
            sessionId={currentSessionId}
            open={diffOpen}
            onOpenChange={setDiffOpen}
          />
        </>
      )}

      <UserSettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        defaultTab={settingsTab}
      />
      <PlanSelectionModal
        open={planModalOpen}
        onOpenChange={setPlanModalOpen}
      />
    </>
  );
}
