/**
 * Home — Main app screen for Kortix Computer Mobile.
 *
 * Uses a drawer layout:
 * - Drawer: Session list + "New Session" button
 * - Main: Either SessionPage (active session) or DashboardHome (new chat input)
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View,
  TouchableOpacity,
  FlatList,
  ScrollView,
  ActivityIndicator,
  Alert,
  Animated,
  Platform,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { Stack, useRouter } from 'expo-router';
import { StatusBar as RNStatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'nativewind';
import { Drawer } from 'react-native-drawer-layout';
import { Ionicons } from '@expo/vector-icons';

import { useAuthContext } from '@/contexts';
import { useSandboxContext } from '@/contexts/SandboxContext';
import { useSessions, useCreateSession, useDeleteSession, useArchiveSession, useUnarchiveSession } from '@/lib/platform/hooks';
import { useSyncStore } from '@/lib/opencode/sync-store';
import { getAuthToken } from '@/api/config';
import type { Session } from '@/lib/opencode/types';
import { SessionPage } from '@/components/session/SessionPage';
import { SessionChatInput, type PromptOptions, type TrackedMention } from '@/components/session/SessionChatInput';
import { BottomBar } from '@/components/session/BottomBar';
import type { BottomBarRef } from '@/components/session/BottomBar';
import { TabsOverview } from '@/components/session/TabsOverview';
import { CommandPalette } from '@/components/session/CommandPalette';
import {
  useOpenCodeAgents,
  useOpenCodeModels,
  useOpenCodeConfig,
} from '@/lib/opencode/hooks/use-opencode-data';
import { useResolvedConfig } from '@/lib/opencode/hooks/use-local-config';
import { useTabStore, PAGE_TABS } from '@/stores/tab-store';
import { RightDrawerContent } from '@/components/session/RightDrawerContent';
import { PlaceholderPage } from '@/components/session/PlaceholderPage';
import { FilesPage } from '@/components/pages/FilesPage';
import type { FilesPageRef } from '@/components/pages/FilesPage';
import { SecretsPage } from '@/components/pages/SecretsPage';
import { LlmProvidersPage } from '@/components/pages/LlmProvidersPage';
import { MarketplacePage } from '@/components/pages/MarketplacePage';
import { TerminalPage } from '@/components/pages/TerminalPage';
import {
  Eye, EyeOff, RefreshCw, Upload, Image, FolderPlus, LayoutGrid, List,
  FileText, Copy, Pencil, Trash2,
} from 'lucide-react-native';
import type { BottomBarMenuItem } from '@/components/session/BottomBar';
import { log } from '@/lib/logger';
import { useTabScreenshotStore } from '@/stores/tab-screenshot-store';

// Safe import of react-native-view-shot — requires native rebuild.
// Returns null if the native module isn't available yet.
let captureRef: ((ref: any, opts?: any) => Promise<string>) | null = null;
let ViewShotComponent: React.ComponentType<any> | null = null;
try {
  const viewShot = require('react-native-view-shot');
  captureRef = viewShot.captureRef;
  ViewShotComponent = viewShot.default;
} catch {
  // Native module not available — screenshots disabled until rebuild
}

// ─── Animated collapsible wrapper ────────────────────────────────────────────

function AnimatedCollapsible({
  expanded,
  children,
}: {
  expanded: boolean;
  children: React.ReactNode;
}) {
  const [contentHeight, setContentHeight] = useState(0);
  const anim = useRef(new Animated.Value(expanded ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: expanded ? 1 : 0,
      duration: 250,
      useNativeDriver: false,
    }).start();
  }, [expanded, anim]);

  const animatedHeight = contentHeight > 0
    ? anim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, contentHeight],
      })
    : undefined;

  const opacity = anim.interpolate({
    inputRange: [0, 0.3, 1],
    outputRange: [0, 0, 1],
  });

  return (
    <View>
      {/* Hidden measurer — always present, unconstrained by animated height */}
      <View
        style={{ position: 'absolute', opacity: 0, zIndex: -1, left: 0, right: 0 }}
        pointerEvents="none"
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          if (h > 0 && h !== contentHeight) setContentHeight(h);
        }}
      >
        {children}
      </View>
      {/* Animated container */}
      <Animated.View style={{ height: animatedHeight, opacity, overflow: 'hidden' }}>
        {children}
      </Animated.View>
    </View>
  );
}

// ─── Animated chevron ───────────────────────────────────────────────────────

function AnimatedChevron({ expanded, color, size = 16 }: { expanded: boolean; color: string; size?: number }) {
  const rotation = useRef(new Animated.Value(expanded ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(rotation, {
      toValue: expanded ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [expanded, rotation]);

  const rotate = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['-90deg', '0deg'],
  });

  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Ionicons name="chevron-down" size={size} color={color} />
    </Animated.View>
  );
}

// ─── Session list item (extracted to avoid re-renders) ──────────────────────

function SessionListItem({
  item,
  isActive,
  onPress,
  onArchive,
  onDelete,
}: {
  item: Session;
  isActive: boolean;
  onPress: (s: Session) => void;
  onArchive?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const mutedColor = isDark ? '#999999' : '#6e6e6e';
  const status = useSyncStore((s) => s.sessionStatus[item.id]);
  const isSessionBusy = status?.type === 'busy';

  return (
    <TouchableOpacity
      onPress={() => onPress(item)}
      onLongPress={() => {
        Alert.alert(item.title || 'Session', undefined, [
          { text: 'Archive', onPress: () => onArchive?.(item.id) },
          { text: 'Delete', style: 'destructive', onPress: () => onDelete?.(item.id) },
          { text: 'Cancel', style: 'cancel' },
        ]);
      }}
      className={`rounded-lg px-3 py-2.5 mb-0.5 ${isActive ? 'bg-accent' : ''}`}
      activeOpacity={0.6}
    >
      <View className="flex-row items-center">
        {isSessionBusy && (
          <View className="h-2 w-2 rounded-full bg-primary mr-2" />
        )}
        <Text
          className={`flex-1 text-sm ${
            isActive ? 'text-foreground font-semibold' : 'text-foreground'
          }`}
          numberOfLines={1}
        >
          {item.title || 'New Session'}
        </Text>
        {isActive && (
          <View className="flex-row items-center ml-2">
            <TouchableOpacity
              onPress={() => onArchive?.(item.id)}
              className="p-1.5 mr-0.5"
              hitSlop={6}
              activeOpacity={0.6}
            >
              <Ionicons name="archive-outline" size={16} color={mutedColor} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onDelete?.(item.id)}
              className="p-1.5"
              hitSlop={6}
              activeOpacity={0.6}
            >
              <Ionicons name="trash-outline" size={16} color={mutedColor} />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─── Main screen ────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const router = useRouter();
  const { sandboxUrl, isLoading: sandboxLoading, error: sandboxError } =
    useSandboxContext();

  // State
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [pendingFilePath, setPendingFilePath] = useState<string | null>(null);

  // Files page ref (for BottomBar menu integration)
  const filesPageRef = useRef<FilesPageRef>(null);
  const bottomBarRef = useRef<BottomBarRef>(null);
  const viewShotRef = useRef<any>(null);
  const [filesShowHidden, setFilesShowHidden] = useState(false);
  const [filesViewMode, setFilesViewMode] = useState<'list' | 'grid'>('list');
  const [filesSelectedName, setFilesSelectedName] = useState<string | null>(null);

  // Persisted tab state (survives app restarts)
  const activeSessionId = useTabStore((s) => s.activeSessionId);
  const activePageId = useTabStore((s) => s.activePageId);
  const showTabsOverview = useTabStore((s) => s.showTabsOverview);
  const openTabIds = useTabStore((s) => s.openTabIds);
  const openPageIds = useTabStore((s) => s.openPageIds);
  const sessionHistory = useTabStore((s) => s.sessionHistory);
  const historyIndex = useTabStore((s) => s.historyIndex);
  const navigateToSession = useTabStore((s) => s.navigateToSession);
  const closeTab = useTabStore((s) => s.closeTab);
  const closeAllTabs = useTabStore((s) => s.closeAllTabs);
  const setShowTabsOverview = useTabStore((s) => s.setShowTabsOverview);

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < sessionHistory.length - 1;

  const handleHistoryBack = useCallback(() => {
    useTabStore.getState().goBack();
  }, []);

  const handleHistoryForward = useCallback(() => {
    useTabStore.getState().goForward();
  }, []);

  // Data
  const { data: sessions = [], isLoading: sessionsLoading } =
    useSessions(sandboxUrl);
  const createSession = useCreateSession(sandboxUrl);
  const deleteSession = useDeleteSession(sandboxUrl);
  const archiveSession = useArchiveSession(sandboxUrl);
  const unarchiveSession = useUnarchiveSession(sandboxUrl);

  // Split sessions into active and archived
  const activeSessions = useMemo(
    () => sessions.filter((s) => !(s.time as any).archived),
    [sessions],
  );
  const archivedSessions = useMemo(
    () => sessions.filter((s) => !!(s.time as any).archived),
    [sessions],
  );

  // Collapsible state
  const [sessionsExpanded, setSessionsExpanded] = useState(true);
  const [archivedExpanded, setArchivedExpanded] = useState(false);

  // Agent/model/variant for dashboard input
  const { data: agents = [] } = useOpenCodeAgents(sandboxUrl);
  const { data: dashVisibleModels = [], allModels: dashAllModels = [], defaults: dashDefaults } = useOpenCodeModels(sandboxUrl);
  const { data: dashConfig } = useOpenCodeConfig(sandboxUrl);
  const resolved = useResolvedConfig(agents, dashAllModels, dashConfig, dashDefaults);

  // Stable error message (prevents re-render loops from error object identity)
  const sandboxErrorMsg = sandboxError?.message || null;

  // Open file selected from command palette once Files page is active.
  useEffect(() => {
    if (!pendingFilePath) return;
    if (activePageId !== 'page:files') return;

    const timer = setTimeout(() => {
      filesPageRef.current?.openPath(pendingFilePath);
      setPendingFilePath(null);
    }, 120);

    return () => clearTimeout(timer);
  }, [pendingFilePath, activePageId]);

  // ── Handlers (all useCallback for stable refs) ──

  const handleDrawerOpen = useCallback(() => setDrawerOpen(true), []);
  const handleDrawerClose = useCallback(() => setDrawerOpen(false), []);
  const handleRightDrawerOpen = useCallback(() => setRightDrawerOpen(true), []);
  const handleRightDrawerClose = useCallback(() => setRightDrawerOpen(false), []);

  const handleNewSession = useCallback(async () => {
    if (!sandboxUrl) return;
    try {
      log.log('➕ [Home] Creating new session...');
      const session = await createSession.mutateAsync({});
      log.log('✅ [Home] Session created:', session.id);
      navigateToSession(session.id);
      setDrawerOpen(false);
    } catch (err: any) {
      log.error('❌ [Home] Failed to create session:', err?.message || err);
    }
  }, [sandboxUrl, createSession, navigateToSession]);

  const handleSessionPress = useCallback((session: Session) => {
    navigateToSession(session.id);
    setDrawerOpen(false);
  }, [navigateToSession]);

  const handleBack = useCallback(() => navigateToSession(null), [navigateToSession]);

  const handleArchive = useCallback((sessionId: string) => {
    Alert.alert('Archive Session', 'Move this session to archived?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Archive',
        onPress: () => {
          if (useTabStore.getState().activeSessionId === sessionId) {
            navigateToSession(null);
          }
          archiveSession.mutate(sessionId);
        },
      },
    ]);
  }, [archiveSession, navigateToSession]);

  const handleUnarchive = useCallback((sessionId: string) => {
    unarchiveSession.mutate(sessionId);
  }, [unarchiveSession]);

  const handleDelete = useCallback((sessionId: string) => {
    Alert.alert('Delete Session', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          if (useTabStore.getState().activeSessionId === sessionId) {
            navigateToSession(null);
          }
          deleteSession.mutate(sessionId);
        },
      },
    ]);
  }, [deleteSession, navigateToSession]);

  const handleDashboardSend = useCallback(
    async (text: string, options: PromptOptions, mentions?: TrackedMention[]) => {
      if (!sandboxUrl) return;

      // Process session mentions — append XML refs (same as frontend)
      let finalText = text;
      const sessionMentions = mentions?.filter((m) => m.kind === 'session' && m.value);
      if (sessionMentions && sessionMentions.length > 0) {
        const refs = sessionMentions
          .map((m) => `<session_ref id="${m.value}" title="${m.label}" />`)
          .join('\n');
        finalText = `${text}\n\nReferenced sessions (use the session_context tool to fetch details when needed):\n${refs}`;
      }

      try {
        const session = await createSession.mutateAsync({});
        navigateToSession(session.id);

        const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const partId = `prt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        useSyncStore.getState().addOptimisticMessage(session.id, {
          info: {
            id: messageId,
            role: 'user',
            sessionID: session.id,
            time: { created: Date.now() },
          },
          parts: [{ type: 'text', id: partId, text: finalText }],
        });
        useSyncStore.getState().setStatus(session.id, { type: 'busy' });

        const payload: Record<string, any> = {
          parts: [{ type: 'text', text: finalText }],
        };
        if (options.model) payload.model = options.model;
        if (options.agent) payload.agent = options.agent;
        if (options.variant) payload.variant = options.variant;

        const token = await getAuthToken();
        fetch(`${sandboxUrl}/session/${session.id}/prompt_async`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(payload),
        }).catch((err) => {
          log.error('❌ [Home] Dashboard prompt failed:', err);
          useSyncStore.getState().setStatus(session.id, { type: 'idle' });
        });
      } catch (err: any) {
        log.error('❌ [Home] Dashboard send failed:', err?.message || err);
      }
    },
    [sandboxUrl, createSession, navigateToSession],
  );

  // Capture a screenshot of the current tab before showing tabs overview.
  // Screenshots are stored as temp files in the app's private directory —
  // they never appear in the user's photo gallery.
  const handleOpenTabsOverview = useCallback(async () => {
    const currentTabId = activePageId || activeSessionId;
    if (currentTabId && viewShotRef.current && captureRef) {
      try {
        const uri = await captureRef(viewShotRef, {
          format: 'jpg',
          quality: 0.6,
          result: 'tmpfile',
        });
        if (uri) {
          useTabScreenshotStore.getState().setScreenshot(currentTabId, uri);
        }
      } catch (err) {
        // Native module not available or capture failed — text preview fallback
      }
    }
    setShowTabsOverview(true);
  }, [activePageId, activeSessionId, setShowTabsOverview]);

  const handleGoToSettings = useCallback(() => {
    setDrawerOpen(false);
    router.push('/(settings)');
  }, [router]);

  // ── Drawer content ──

  const { user } = useAuthContext();
  const userEmail = user?.email || '';
  const userDisplayName = userEmail.split('@')[0] || 'User';

  const renderDrawerContent = useCallback(() => {
    const iconColor = isDark ? '#F8F8F8' : '#121215';
    const mutedColor = isDark ? '#999999' : '#6e6e6e';

    return (
      <View
        className="flex-1 bg-background"
        style={{ paddingTop: insets.top }}
      >
        {/* Search + New session */}
        <View className="flex-row items-center px-3 pt-2 pb-2">
          <TouchableOpacity
            onPress={() => { setDrawerOpen(false); setCommandPaletteOpen(true); }}
            className="flex-1 flex-row items-center rounded-xl bg-card border border-border px-3 py-2 mr-2"
            activeOpacity={0.6}
          >
            <Ionicons name="search-outline" size={18} color={mutedColor} />
            <Text className="text-sm ml-2 text-muted-foreground">Search</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleNewSession}
            className="h-9 w-9 items-center justify-center rounded-xl bg-card border border-border"
            activeOpacity={0.6}
          >
            <Ionicons name="create-outline" size={18} color={iconColor} />
          </TouchableOpacity>
        </View>

        {/* Sessions header (collapsible) */}
        <TouchableOpacity
          onPress={() => setSessionsExpanded((v) => !v)}
          className="flex-row items-center justify-between px-5 py-2.5"
          activeOpacity={0.6}
        >
          <View className="flex-row items-center">
            <Ionicons name="list-outline" size={18} color={iconColor} />
            <Text className="text-sm font-medium ml-3 text-foreground">Sessions</Text>
          </View>
          <AnimatedChevron expanded={sessionsExpanded} color={mutedColor} size={16} />
        </TouchableOpacity>

        {/* Session list + Archived */}
        {sessionsLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="small" color={mutedColor} />
          </View>
        ) : (
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 20 }}
          >
            <AnimatedCollapsible expanded={sessionsExpanded}>
              {/* Archived section (collapsible) */}
              {archivedSessions.length > 0 && (
                <>
                  <TouchableOpacity
                    onPress={() => setArchivedExpanded((v) => !v)}
                    className="flex-row items-center justify-between px-3 py-2.5"
                    activeOpacity={0.6}
                  >
                    <View className="flex-row items-center">
                      <Ionicons name="archive-outline" size={16} color={mutedColor} />
                      <Text className="text-sm ml-2 text-muted-foreground">Archived</Text>
                    </View>
                    <View className="flex-row items-center">
                      <View className="bg-muted rounded-full px-2 py-0.5 mr-1">
                        <Text className="text-xs text-muted-foreground">{archivedSessions.length}</Text>
                      </View>
                      <AnimatedChevron expanded={archivedExpanded} color={mutedColor} size={14} />
                    </View>
                  </TouchableOpacity>

                  <AnimatedCollapsible expanded={archivedExpanded}>
                    {archivedSessions.map((item) => (
                      <View key={item.id} className="flex-row items-center rounded-lg px-3 py-2.5 mb-0.5">
                        <Text
                          className="flex-1 text-sm text-muted-foreground"
                          numberOfLines={1}
                        >
                          {item.title || 'New Session'}
                        </Text>
                        <TouchableOpacity
                          onPress={() => handleUnarchive(item.id)}
                          className="p-1.5 mr-1"
                          hitSlop={6}
                          activeOpacity={0.6}
                        >
                          <Ionicons name="archive-outline" size={16} color={mutedColor} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleDelete(item.id)}
                          className="p-1.5"
                          hitSlop={6}
                          activeOpacity={0.6}
                        >
                          <Ionicons name="trash-outline" size={16} color={mutedColor} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </AnimatedCollapsible>
                </>
              )}

              {/* Active sessions */}
              {activeSessions.length === 0 ? (
                <View className="items-center py-8">
                  <Text className="text-sm text-muted-foreground">No sessions yet</Text>
                </View>
              ) : (
                activeSessions.map((item) => (
                  <SessionListItem
                    key={item.id}
                    item={item}
                    isActive={item.id === activeSessionId}
                    onPress={handleSessionPress}
                    onArchive={handleArchive}
                    onDelete={handleDelete}
                  />
                ))
              )}
            </AnimatedCollapsible>
          </ScrollView>
        )}

        {/* Bottom: user info */}
        <View
          className="border-t border-border px-4 py-3"
          style={{ paddingBottom: insets.bottom + 8 }}
        >
          <View className="flex-row items-center">
            <View className="h-8 w-8 rounded-full bg-muted items-center justify-center mr-3">
              <Text className="text-xs font-semibold text-muted-foreground uppercase">
                {userDisplayName.charAt(0)}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-sm text-foreground" numberOfLines={1}>
                {userDisplayName}
              </Text>
              <Text className="text-xs text-muted-foreground">Self-Hosted</Text>
            </View>
          </View>
        </View>
      </View>
    );
  }, [
    isDark,
    insets,
    activeSessions,
    archivedSessions,
    sessionsLoading,
    sessionsExpanded,
    archivedExpanded,
    activeSessionId,
    userDisplayName,
    handleNewSession,
    handleSessionPress,
    handleArchive,
    handleUnarchive,
    handleDelete,
  ]);

  const renderRightDrawerContent = useCallback(
    () => <RightDrawerContent onClose={handleRightDrawerClose} />,
    [handleRightDrawerClose],
  );

  // ── Render ──

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <RNStatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      <Drawer
        open={drawerOpen}
        onOpen={handleDrawerOpen}
        onClose={handleDrawerClose}
        drawerType="slide"
        drawerStyle={{ width: '80%', backgroundColor: 'transparent' }}
        overlayStyle={{
          backgroundColor: isDark ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.2)',
        }}
        swipeEnabled
        swipeEdgeWidth={80}
        swipeMinDistance={30}
        renderDrawerContent={renderDrawerContent}
      >
        <Drawer
          open={rightDrawerOpen}
          onOpen={handleRightDrawerOpen}
          onClose={handleRightDrawerClose}
          drawerPosition="right"
          drawerType="slide"
          drawerStyle={{ width: '80%', backgroundColor: 'transparent' }}
          overlayStyle={{
            backgroundColor: isDark ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.2)',
          }}
          swipeEnabled={false}
          renderDrawerContent={renderRightDrawerContent}
        >
        {React.createElement(
          ViewShotComponent || View,
          ViewShotComponent
            ? { ref: viewShotRef, style: { flex: 1, backgroundColor: isDark ? '#09090B' : '#FFFFFF' } }
            : { className: 'flex-1 bg-background' },
          <>
          {/* Loading sandbox */}
          {sandboxLoading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color={isDark ? '#999999' : '#6e6e6e'} />
              <Text className="text-sm mt-3 text-muted-foreground">
                Connecting to sandbox...
              </Text>
            </View>

          /* Sandbox error */
          ) : sandboxErrorMsg ? (
            <View className="flex-1 items-center justify-center px-8">
              <Text className="text-base font-medium mb-2 text-foreground">
                Connection Error
              </Text>
              <Text className="text-sm text-center text-muted-foreground">
                {sandboxErrorMsg}
              </Text>
            </View>

          /* Active page tab — Files */
          ) : activePageId === 'page:files' && PAGE_TABS[activePageId] && !showTabsOverview ? (
            <FilesPage
              ref={filesPageRef}
              page={PAGE_TABS[activePageId]}
              onBack={handleBack}
              onOpenDrawer={handleDrawerOpen}
              onOpenRightDrawer={handleRightDrawerOpen}
              onFileSelectionChange={(file) => setFilesSelectedName(file?.name ?? null)}
              onRequestMenu={() => bottomBarRef.current?.presentMenu()}
            />

          /* Active page tab — LLM Providers */
          ) : activePageId === 'page:llm-providers' && PAGE_TABS[activePageId] && !showTabsOverview ? (
            <LlmProvidersPage
              page={PAGE_TABS[activePageId]}
              onBack={handleBack}
              onOpenDrawer={handleDrawerOpen}
              onOpenRightDrawer={handleRightDrawerOpen}
            />

          /* Active page tab — Secrets */
          ) : activePageId === 'page:secrets' && PAGE_TABS[activePageId] && !showTabsOverview ? (
            <SecretsPage
              page={PAGE_TABS[activePageId]}
              onBack={handleBack}
              onOpenDrawer={handleDrawerOpen}
              onOpenRightDrawer={handleRightDrawerOpen}
            />

          /* Active page tab — Terminal */
          ) : activePageId === 'page:terminal' && PAGE_TABS[activePageId] && !showTabsOverview ? (
            <TerminalPage
              page={PAGE_TABS[activePageId]}
              onBack={handleBack}
              onOpenDrawer={handleDrawerOpen}
              onOpenRightDrawer={handleRightDrawerOpen}
            />

          /* Active page tab — Marketplace */
          ) : activePageId === 'page:marketplace' && PAGE_TABS[activePageId] && !showTabsOverview ? (
            <MarketplacePage
              page={PAGE_TABS[activePageId]}
              onBack={handleBack}
              onOpenDrawer={handleDrawerOpen}
              onOpenRightDrawer={handleRightDrawerOpen}
            />

          /* Active page tab — other pages (placeholder) */
          ) : activePageId && PAGE_TABS[activePageId] && !showTabsOverview ? (
            <PlaceholderPage
              page={PAGE_TABS[activePageId]}
              onBack={handleBack}
              onOpenDrawer={handleDrawerOpen}
              onOpenRightDrawer={handleRightDrawerOpen}
            />

          /* Active session */
          ) : activeSessionId && !showTabsOverview ? (
            <SessionPage sessionId={activeSessionId} onBack={handleBack} onOpenDrawer={handleDrawerOpen} onOpenRightDrawer={handleRightDrawerOpen} />

          /* Tabs overview */
          ) : showTabsOverview ? (
            <TabsOverview
              sessions={activeSessions}
              openTabIds={openTabIds}
              activeSessionId={activeSessionId}
              onSelectTab={(id) => navigateToSession(id)}
              onCloseTab={(id) => {
                closeTab(id);
                useTabScreenshotStore.getState().removeScreenshot(id);
              }}
              onCloseAll={() => {
                closeAllTabs();
                useTabScreenshotStore.getState().clear();
              }}
              onNewSession={handleNewSession}
              onDismiss={() => setShowTabsOverview(false)}
            />

          /* Dashboard */
          ) : (
            <View className="flex-1 bg-background">
              <View
                style={{ paddingTop: insets.top }}
                className="px-4 pb-3 bg-background"
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center">
                    <TouchableOpacity
                      onPress={handleDrawerOpen}
                      className="mr-3 p-1"
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons name="menu" size={24} color={isDark ? '#F8F8F8' : '#121215'} />
                    </TouchableOpacity>
                    <Text className="text-lg font-bold text-foreground">
                      Kortix
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={handleRightDrawerOpen}
                    className="p-1"
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="apps-outline" size={20} color={isDark ? '#F8F8F8' : '#121215'} />
                  </TouchableOpacity>
                </View>
              </View>

              <View className="flex-1 items-center justify-center px-8">
                <Text className="text-2xl font-bold mb-2 text-foreground">
                  What can I help with?
                </Text>
                <Text className="text-sm text-center text-muted-foreground">
                  Start a conversation or select a session from the menu.
                </Text>
              </View>

              <View>
                <SessionChatInput
                  onSend={handleDashboardSend}
                  placeholder="Ask anything..."
                  disabled={!sandboxUrl}
                  agent={resolved.agent}
                  agents={resolved.agents}
                  model={resolved.model}
                  models={dashVisibleModels}
                  modelKey={resolved.modelKey}
                  variant={resolved.variant}
                  variants={resolved.variants}
                  onAgentChange={resolved.setAgent}
                  onModelChange={resolved.setModel}
                  onVariantCycle={resolved.cycleVariant}
                  onVariantSet={resolved.setVariant}
                  sessions={sessions}
                  sandboxUrl={sandboxUrl}
                />
              </View>
            </View>
          )}

        </>
        )}

          {/* Bottom bar — hidden when tabs overview is showing */}
          {!showTabsOverview && (
            <View>
              <BottomBar
                ref={bottomBarRef}
                activeSessionId={activeSessionId}
                onMenuDismiss={() => {
                  if (activePageId === 'page:files') {
                    filesPageRef.current?.deselectFile();
                    setFilesSelectedName(null);
                  }
                }}
                tabCount={openTabIds.length + openPageIds.length}
                canGoBack={canGoBack}
                canGoForward={canGoForward}
                onBack={handleHistoryBack}
                onForward={handleHistoryForward}
                onNewSession={handleNewSession}
                onOpenTabs={handleOpenTabsOverview}
                onCompactSession={() => {
                  if (activeSessionId) {
                    Alert.alert('Compact Session', 'Compact this session to reduce context size?', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Compact', onPress: () => log.log('TODO: compact session') },
                    ]);
                  }
                }}
                onExportTranscript={() => log.log('TODO: export transcript')}
                onViewChanges={() => log.log('TODO: view changes')}
                onDiagnostics={() => log.log('TODO: diagnostics')}
                onArchiveSession={() => { if (activeSessionId) handleArchive(activeSessionId); }}
                customMenuItems={
                  activePageId === 'page:files'
                    ? (filesSelectedName
                        ? ([
                            // Contextual file actions only (long-press)
                            {
                              icon: FileText,
                              label: `Open ${filesSelectedName}`,
                              onPress: () => {
                                filesPageRef.current?.openFile();
                                setFilesSelectedName(null);
                              },
                            },
                            {
                              icon: Copy,
                              label: 'Copy path',
                              onPress: () => {
                                filesPageRef.current?.copyPath();
                                setFilesSelectedName(null);
                              },
                            },
                            {
                              icon: Pencil,
                              label: 'Rename',
                              onPress: () => filesPageRef.current?.renameFile(),
                            },
                            {
                              icon: Trash2,
                              label: 'Delete',
                              destructive: true,
                              onPress: () => filesPageRef.current?.deleteFile(),
                            },
                          ] as BottomBarMenuItem[])
                        : ([
                            // General file actions (three-dot tap)
                            {
                              icon: filesViewMode === 'list' ? LayoutGrid : List,
                              label: filesViewMode === 'list' ? 'Grid view' : 'List view',
                              onPress: () => {
                                filesPageRef.current?.toggleViewMode();
                                setFilesViewMode((v) => (v === 'list' ? 'grid' : 'list'));
                              },
                            },
                            {
                              icon: filesShowHidden ? Eye : EyeOff,
                              label: filesShowHidden ? 'Hide dotfiles' : 'Show dotfiles',
                              onPress: () => {
                                filesPageRef.current?.toggleHidden();
                                setFilesShowHidden((v) => !v);
                              },
                            },
                            {
                              icon: Upload,
                              label: 'Upload file',
                              onPress: () => filesPageRef.current?.uploadDocument(),
                            },
                            {
                              icon: Image,
                              label: 'Upload image',
                              onPress: () => filesPageRef.current?.uploadImage(),
                            },
                            {
                              icon: FolderPlus,
                              label: 'New folder',
                              onPress: () => filesPageRef.current?.createFolder(),
                            },
                            {
                              icon: RefreshCw,
                              label: 'Refresh',
                              onPress: () => filesPageRef.current?.refetch(),
                            },
                          ] as BottomBarMenuItem[]))
                    : undefined
                }
              />
            </View>
          )}
        </Drawer>
      </Drawer>

      {/* Command Palette */}
      <CommandPalette
        visible={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        sessions={sessions}
        onNewSession={handleNewSession}
        onSessionSelect={(id) => {
          if (id) {
            navigateToSession(id);
          } else {
            navigateToSession(null);
          }
        }}
        onPageSelect={(pageId) => {
          useTabStore.getState().navigateToPage(pageId);
        }}
        onSettings={handleGoToSettings}
        sandboxUrl={sandboxUrl}
        onFileSelect={(path) => {
          useTabStore.getState().navigateToPage('page:files');
          setPendingFilePath(path);
        }}
      />
    </>
  );
}
