/**
 * TabsOverview — Chrome-like tab switcher with card grid.
 *
 * Shows all open session tabs as stacked cards. User can tap to switch,
 * swipe/tap X to close, or create a new tab.
 */

import React, { useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { Session } from '@/lib/opencode/types';

interface TabsOverviewProps {
  /** All sessions (to look up titles) */
  sessions: Session[];
  /** IDs of open tabs */
  openTabIds: string[];
  /** Currently active session */
  activeSessionId: string | null;
  /** Switch to a tab */
  onSelectTab: (sessionId: string) => void;
  /** Close a tab */
  onCloseTab: (sessionId: string) => void;
  /** Create new session */
  onNewSession: () => void;
  /** Go back to current session / dismiss */
  onDismiss: () => void;
}

export function TabsOverview({
  sessions,
  openTabIds,
  activeSessionId,
  onSelectTab,
  onCloseTab,
  onNewSession,
  onDismiss,
}: TabsOverviewProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const iconColor = isDark ? '#F8F8F8' : '#121215';
  const mutedColor = isDark ? '#999999' : '#6e6e6e';

  // Look up session by ID
  const getSession = useCallback(
    (id: string) => sessions.find((s) => s.id === id),
    [sessions],
  );

  // Card width: 2 columns with gaps
  const cardWidth = (width - 48) / 2;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 py-3">
        <Text className="text-lg font-bold text-foreground">
          {openTabIds.length} {openTabIds.length === 1 ? 'Tab' : 'Tabs'}
        </Text>
        <View className="flex-row items-center">
          <TouchableOpacity
            onPress={onNewSession}
            className="p-2 mr-1"
            activeOpacity={0.6}
            hitSlop={8}
          >
            <Ionicons name="add" size={24} color={iconColor} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onDismiss}
            className="p-2"
            activeOpacity={0.6}
            hitSlop={8}
          >
            <Text className="text-sm font-medium text-foreground">Done</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Tab cards grid */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          paddingHorizontal: 12,
          paddingBottom: insets.bottom + 80,
        }}
      >
        {openTabIds.length === 0 ? (
          <View className="flex-1 items-center justify-center py-20" style={{ width: '100%' }}>
            <Text className="text-sm text-muted-foreground mb-4">No open tabs</Text>
            <TouchableOpacity
              onPress={onNewSession}
              className="flex-row items-center rounded-xl bg-card border border-border px-5 py-3"
              activeOpacity={0.6}
            >
              <Ionicons name="add" size={18} color={iconColor} />
              <Text className="text-sm ml-2 text-foreground">New Session</Text>
            </TouchableOpacity>
          </View>
        ) : (
          openTabIds.map((tabId) => {
            const session = getSession(tabId);
            const isActive = tabId === activeSessionId;
            const title = session?.title || 'New Session';

            return (
              <TouchableOpacity
                key={tabId}
                onPress={() => onSelectTab(tabId)}
                activeOpacity={0.7}
                style={{
                  width: cardWidth,
                  marginHorizontal: 6,
                  marginBottom: 12,
                }}
              >
                <View
                  className={`rounded-2xl overflow-hidden ${
                    isActive ? 'border-2 border-primary' : 'border border-border'
                  }`}
                  style={{
                    backgroundColor: isDark ? '#161618' : '#FFFFFF',
                  }}
                >
                  {/* Card header with title + close */}
                  <View className="flex-row items-center justify-between px-3 pt-3 pb-2">
                    <Text
                      className="flex-1 text-xs font-medium text-foreground"
                      numberOfLines={1}
                    >
                      {title}
                    </Text>
                    <TouchableOpacity
                      onPress={(e) => {
                        e.stopPropagation?.();
                        onCloseTab(tabId);
                      }}
                      className="ml-1 p-0.5"
                      hitSlop={8}
                      activeOpacity={0.6}
                    >
                      <Ionicons name="close" size={14} color={mutedColor} />
                    </TouchableOpacity>
                  </View>

                  {/* Card body — preview area */}
                  <View
                    className="px-3 pb-3"
                    style={{ height: cardWidth * 1.1 }}
                  >
                    <View className="flex-1 rounded-lg bg-muted/30 items-center justify-center">
                      <Ionicons name="chatbubble-outline" size={24} color={mutedColor} />
                    </View>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
