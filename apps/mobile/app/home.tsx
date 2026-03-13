/**
 * Home — Main app screen for Kortix Computer Mobile.
 *
 * Uses a drawer layout:
 * - Drawer: Session list + "New Session" button
 * - Main: Either SessionPage (active session) or DashboardHome (new chat input)
 *
 * Architecture matches the Computer frontend:
 * - Sessions from OpenCode server (via useSessions)
 * - Messages from sync store (via useSessionSync + SSE)
 * - Send via promptAsync (fire-and-forget)
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
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
import { useSessions, useCreateSession } from '@/lib/platform/hooks';
import { useSyncStore } from '@/lib/opencode/sync-store';
import { getAuthToken } from '@/api/config';
import type { Session } from '@/lib/opencode/types';
import { SessionPage } from '@/components/session/SessionPage';
import { SessionChatInput } from '@/components/session/SessionChatInput';
import { log } from '@/lib/logger';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const router = useRouter();
  const { isAuthenticated } = useAuthContext();
  const { sandboxUrl, isLoading: sandboxLoading, error: sandboxError } = useSandboxContext();

  // State
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Data
  const { data: sessions = [], isLoading: sessionsLoading } = useSessions(sandboxUrl);
  const createSession = useCreateSession(sandboxUrl);

  // ── Handlers ──

  const handleNewSession = useCallback(async () => {
    if (!sandboxUrl) return;

    try {
      log.log('➕ [Home] Creating new session...');
      const session = await createSession.mutateAsync({});
      log.log('✅ [Home] Session created:', session.id);
      setActiveSessionId(session.id);
      setDrawerOpen(false);
    } catch (err) {
      log.error('❌ [Home] Failed to create session:', err);
    }
  }, [sandboxUrl, createSession]);

  const handleSessionPress = useCallback((session: Session) => {
    log.log('📖 [Home] Opening session:', session.id);
    setActiveSessionId(session.id);
    setDrawerOpen(false);
  }, []);

  const handleBack = useCallback(() => {
    setActiveSessionId(null);
  }, []);

  const handleOpenDrawer = useCallback(() => {
    setDrawerOpen(true);
  }, []);

  // Dashboard send — create session + send prompt
  const handleDashboardSend = useCallback(
    async (text: string) => {
      if (!sandboxUrl) return;

      try {
        log.log('💬 [Home] Dashboard send — creating session...');
        const session = await createSession.mutateAsync({});
        log.log('✅ [Home] Session created:', session.id);

        // Set active session
        setActiveSessionId(session.id);

        // Add optimistic user message
        const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const partId = `prt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        useSyncStore.getState().addOptimisticMessage(session.id, {
          info: {
            id: messageId,
            role: 'user',
            sessionID: session.id,
            time: { created: Date.now() },
          },
          parts: [{ type: 'text', id: partId, text }],
        });
        useSyncStore.getState().setStatus(session.id, { type: 'busy' });

        // Fire-and-forget prompt
        const token = await getAuthToken();
        fetch(`${sandboxUrl}/session/${session.id}/prompt`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            parts: [{ type: 'text', text }],
          }),
        }).catch((err) => {
          log.error('❌ [Home] Dashboard prompt failed:', err);
          useSyncStore.getState().setStatus(session.id, { type: 'idle' });
        });
      } catch (err) {
        log.error('❌ [Home] Dashboard send failed:', err);
      }
    },
    [sandboxUrl, createSession],
  );

  // ── Drawer content — session list ──

  const renderDrawerContent = useCallback(() => {
    return (
      <View
        className={`flex-1 ${isDark ? 'bg-zinc-950' : 'bg-white'}`}
        style={{ paddingTop: insets.top }}
      >
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-3">
          <Text
            className={`text-lg font-bold ${
              isDark ? 'text-white' : 'text-zinc-900'
            }`}
          >
            Sessions
          </Text>
          <TouchableOpacity
            onPress={handleNewSession}
            className={`flex-row items-center rounded-lg px-3 py-2 ${
              isDark ? 'bg-zinc-800' : 'bg-zinc-100'
            }`}
            activeOpacity={0.7}
          >
            <Ionicons
              name="add"
              size={18}
              color={isDark ? '#fafafa' : '#18181b'}
            />
            <Text
              className={`text-sm font-medium ml-1 ${
                isDark ? 'text-white' : 'text-zinc-900'
              }`}
            >
              New
            </Text>
          </TouchableOpacity>
        </View>

        {/* Session list */}
        {sessionsLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="small" color={isDark ? '#a1a1aa' : '#71717a'} />
          </View>
        ) : (
          <FlatList
            data={sessions}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 20 }}
            renderItem={({ item }) => {
              const isActive = item.id === activeSessionId;
              const status = useSyncStore.getState().sessionStatus[item.id];
              const isSessionBusy = status?.type === 'busy';
              const dateStr = new Date(item.time.updated).toLocaleDateString(
                undefined,
                { month: 'short', day: 'numeric' },
              );

              return (
                <TouchableOpacity
                  onPress={() => handleSessionPress(item)}
                  className={`rounded-lg px-3 py-3 mb-1 ${
                    isActive
                      ? isDark
                        ? 'bg-zinc-800'
                        : 'bg-zinc-100'
                      : ''
                  }`}
                  activeOpacity={0.6}
                >
                  <View className="flex-row items-center">
                    {isSessionBusy && (
                      <View className="h-2 w-2 rounded-full bg-green-500 mr-2" />
                    )}
                    <Text
                      className={`flex-1 text-sm ${
                        isActive
                          ? isDark
                            ? 'text-white font-medium'
                            : 'text-zinc-900 font-medium'
                          : isDark
                            ? 'text-zinc-300'
                            : 'text-zinc-700'
                      }`}
                      numberOfLines={1}
                    >
                      {item.title || 'Untitled session'}
                    </Text>
                    <Text
                      className={`text-xs ml-2 ${
                        isDark ? 'text-zinc-600' : 'text-zinc-400'
                      }`}
                    >
                      {dateStr}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <View className="items-center py-8">
                <Text
                  className={`text-sm ${
                    isDark ? 'text-zinc-500' : 'text-zinc-400'
                  }`}
                >
                  No sessions yet
                </Text>
              </View>
            }
          />
        )}

        {/* Settings */}
        <View
          className={`border-t px-4 py-3 ${
            isDark ? 'border-zinc-800' : 'border-zinc-200'
          }`}
          style={{ paddingBottom: insets.bottom + 8 }}
        >
          <TouchableOpacity
            onPress={() => {
              setDrawerOpen(false);
              router.push('/(settings)');
            }}
            className="flex-row items-center"
            activeOpacity={0.6}
          >
            <Ionicons
              name="settings-outline"
              size={20}
              color={isDark ? '#a1a1aa' : '#71717a'}
            />
            <Text
              className={`text-sm ml-2 ${
                isDark ? 'text-zinc-400' : 'text-zinc-600'
              }`}
            >
              Settings
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [
    isDark,
    insets,
    sessions,
    sessionsLoading,
    activeSessionId,
    handleNewSession,
    handleSessionPress,
    router,
  ]);

  // ── Main content ──

  const renderMainContent = () => {
    // Loading sandbox
    if (sandboxLoading) {
      return (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={isDark ? '#a1a1aa' : '#71717a'} />
          <Text
            className={`text-sm mt-3 ${
              isDark ? 'text-zinc-500' : 'text-zinc-400'
            }`}
          >
            Connecting to sandbox...
          </Text>
        </View>
      );
    }

    // Sandbox error
    if (sandboxError) {
      return (
        <View className="flex-1 items-center justify-center px-8">
          <Text
            className={`text-base font-medium mb-2 ${
              isDark ? 'text-white' : 'text-zinc-900'
            }`}
          >
            Connection Error
          </Text>
          <Text
            className={`text-sm text-center ${
              isDark ? 'text-zinc-400' : 'text-zinc-500'
            }`}
          >
            {sandboxError.message}
          </Text>
        </View>
      );
    }

    // Active session — show full chat
    if (activeSessionId) {
      return (
        <SessionPage
          sessionId={activeSessionId}
          onBack={handleBack}
        />
      );
    }

    // Dashboard — welcome + chat input
    return (
      <View className={`flex-1 ${isDark ? 'bg-black' : 'bg-white'}`}>
        {/* Header */}
        <View
          style={{ paddingTop: insets.top }}
          className={`px-4 pb-3 ${isDark ? 'bg-black' : 'bg-white'}`}
        >
          <View className="flex-row items-center">
            <TouchableOpacity
              onPress={handleOpenDrawer}
              className="mr-3 p-1"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons
                name="menu"
                size={24}
                color={isDark ? '#fafafa' : '#18181b'}
              />
            </TouchableOpacity>
            <Text
              className={`text-lg font-bold ${
                isDark ? 'text-white' : 'text-zinc-900'
              }`}
            >
              Kortix
            </Text>
          </View>
        </View>

        {/* Center content */}
        <View className="flex-1 items-center justify-center px-8">
          <Text
            className={`text-2xl font-bold mb-2 ${
              isDark ? 'text-white' : 'text-zinc-900'
            }`}
          >
            What can I help with?
          </Text>
          <Text
            className={`text-sm text-center ${
              isDark ? 'text-zinc-500' : 'text-zinc-400'
            }`}
          >
            Start a conversation or select a session from the menu.
          </Text>
        </View>

        {/* Chat input at bottom */}
        <View style={{ paddingBottom: insets.bottom }}>
          <SessionChatInput
            onSend={handleDashboardSend}
            placeholder="Ask anything..."
            disabled={!sandboxUrl}
          />
        </View>
      </View>
    );
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <RNStatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      <Drawer
        open={drawerOpen}
        onOpen={() => setDrawerOpen(true)}
        onClose={() => setDrawerOpen(false)}
        drawerType="front"
        drawerStyle={{
          width: '80%',
          backgroundColor: 'transparent',
        }}
        overlayStyle={{
          backgroundColor: isDark
            ? 'rgba(0, 0, 0, 0.4)'
            : 'rgba(0, 0, 0, 0.2)',
        }}
        swipeEnabled={!activeSessionId}
        swipeEdgeWidth={80}
        swipeMinDistance={30}
        renderDrawerContent={renderDrawerContent}
      >
        <View className={`flex-1 ${isDark ? 'bg-black' : 'bg-white'}`}>
          {renderMainContent()}
        </View>
      </Drawer>
    </>
  );
}
