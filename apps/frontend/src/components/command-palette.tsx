'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
} from '@/hooks/opencode/use-opencode-sessions';
// TODO: Re-enable file/text/semantic search once OpenCode server endpoints are fixed.
// Currently broken:
//   - File search (GET /find/file) — returns empty or errors
//   - Text search (GET /find) — endpoint may work but needs verification
//   - Semantic search (GET /lss/search) — requires OPENAI_API_KEY in sandbox
// Imports kept for reference:
// import { useTextSearch, useLssSearch } from '@/features/files';
// import type { FindMatch } from '@/features/files';
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

// Kbd is now shared as CommandKbd from '@/components/ui/command'

// ============================================================================
// Command Palette
// ============================================================================

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [compactOpen, setCompactOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('general');
  const [planModalOpen, setPlanModalOpen] = useState(false);
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

  // Fetch all sessions (for client-side title filter)
  const { data: sessions } = useOpenCodeSessions();

  const close = useCallback(() => setOpen(false), []);

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
    } catch (e) {
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

  // Reset query when dialog closes
  useEffect(() => {
    if (!open) {
      setQuery('');
    }
  }, [open]);

  // Fuzzy match helper
  const fuzzyMatch = useCallback((text: string, q: string): boolean => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const haystack = text.toLowerCase();
    return words.every((w) => haystack.includes(w));
  }, []);

  // Filter sessions by query
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

  // Recent sessions for idle state
  const recentSessions = useMemo(() => {
    if (!sessions) return [];
    return sessions.filter((s) => !s.parentID && !s.time.archived).slice(0, 5);
  }, [sessions]);

  const hasQuery = query.trim().length > 0;
  const queryLongEnough = query.trim().length >= 2;

  const hasSessionResults = filteredSessions.length > 0;

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

  const hasNavResults = filteredNavItems.length > 0;

  const hasAnyResults = hasNavResults || hasSessionResults;

  // TODO: Re-enable when search endpoints are fixed.
  // const showLssSection = hasQuery && queryLongEnough;
  // const showTextSection = hasQuery && textQueryLongEnough;

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
    // Dynamic import to avoid circular deps — lazy is fine for a click handler
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

  // Count how many search results are active (for footer context)
  const totalSearchResults = useMemo(() => {
    if (!hasQuery) return 0;
    return filteredNavItems.length + filteredSessions.length;
  }, [hasQuery, filteredNavItems, filteredSessions]);

  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen} className="sm:max-w-[680px]">
        <CommandInput
          placeholder="Search commands, files, sessions..."
          value={query}
          onValueChange={setQuery}
        />

        {/* ── Unified CommandList — one list for both idle & search so arrow keys always work ── */}
        <CommandList>
          {/* ── IDLE STATE — Spotlight / Raycast style ── */}
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
                        value={`suggestion ${item.label} ${item.keywords || ''}`}
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
              </CommandGroup>

              {/* Recent Sessions */}
              {recentSessions.length > 0 && (
                <CommandGroup heading="Recent" forceMount>
                  {recentSessions.map((session) => (
                    <CommandItem
                      key={session.id}
                      value={`recent ${session.title || ''} ${session.slug || ''} ${session.id}`}
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
              {/* ── Navigation (always first — we filter ourselves) ── */}
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
                        value={item.keywords || `${item.group} ${item.label} ${item.id}`}
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

              {/* No results — only when truly nothing matches (including nav) */}
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

              {/* ── Sessions ── */}
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

              {/*
               * TODO: Re-enable File Search, Text Search, and Semantic Search
               * once the OpenCode server endpoints are verified working.
               *
               * Known issues:
               *   - GET /find/file — file name search returns empty/errors
               *   - GET /find — text content search (ripgrep) needs verification
               *   - GET /lss/search — semantic search requires OPENAI_API_KEY
               *
               * When re-enabling:
               *   1. Import useFileSearch, useTextSearch, useLssSearch from '@/features/files'
               *   2. Import FindMatch type
               *   3. Add back debounce state + effects for each search type
               *   4. Add back the search hook calls
               *   5. Add back filteredTextResults, filteredLssResults memos
               *   6. Add back showFileSection, showTextSection, showLssSection logic
               *   7. Add back the <CommandGroup> blocks for each search type
               *   8. Add shouldFilter={false} on Command (already done in command.tsx)
               *   9. Test that results actually render (cmdk filter was hiding them before)
               */}
            </>
          )}
        </CommandList>

        {/* ── Footer — always visible ── */}
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
          <div className="flex items-center gap-1">
            <CommandKbd>esc</CommandKbd>
            <span>close</span>
          </div>
          {hasQuery && totalSearchResults > 0 && (
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
