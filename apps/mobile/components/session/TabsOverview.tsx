/**
 * TabsOverview — Chrome-like tab switcher with card grid.
 *
 * Shows all open session tabs as stacked cards. User can tap to switch,
 * swipe/tap X to close, or create a new tab.
 */

import React, { useCallback, useState, useRef } from 'react';
import {
  View,
  TouchableOpacity,
  ScrollView,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetView } from '@gorhom/bottom-sheet';
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
  /** Close all tabs */
  onCloseAll: () => void;
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
  onCloseAll,
  onNewSession,
  onDismiss,
}: TabsOverviewProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const iconColor = isDark ? '#F8F8F8' : '#121215';
  const mutedColor = isDark ? '#999999' : '#6e6e6e';

  const editSheetRef = useRef<BottomSheetModal>(null);

  // Selection mode
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.4}
      />
    ),
    [],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleCloseSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    selectedIds.forEach((id) => onCloseTab(id));
    setSelectedIds(new Set());
    setSelecting(false);
  }, [selectedIds, onCloseTab]);

  const handleCloseAll = useCallback(() => {
    if (openTabIds.length === 0) return;
    Alert.alert(
      'Close All Tabs',
      `Close all ${openTabIds.length} tabs?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close All',
          style: 'destructive',
          onPress: () => {
            onCloseAll();
            setSelecting(false);
            setSelectedIds(new Set());
          },
        },
      ],
    );
  }, [openTabIds.length, onCloseAll]);

  const exitSelecting = useCallback(() => {
    setSelecting(false);
    setSelectedIds(new Set());
  }, []);

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
      <View className="items-center px-4 py-3">
        <Text className="text-sm font-semibold text-foreground">
          {selecting
            ? `${selectedIds.size} Selected`
            : `${openTabIds.length} ${openTabIds.length === 1 ? 'Tab' : 'Tabs'}`}
        </Text>
      </View>

      {/* Tab cards grid */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          paddingHorizontal: 12,
          paddingBottom: 20,
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
            const isActive = !selecting && tabId === activeSessionId;
            const isSelected = selecting && selectedIds.has(tabId);
            const title = session?.title || 'New Session';

            return (
              <TouchableOpacity
                key={tabId}
                onPress={() => {
                  if (selecting) {
                    toggleSelect(tabId);
                  } else {
                    onSelectTab(tabId);
                  }
                }}
                activeOpacity={0.7}
                style={{
                  width: cardWidth,
                  marginHorizontal: 6,
                  marginBottom: 12,
                }}
              >
                <View
                  className={`rounded-2xl overflow-hidden ${
                    isActive
                      ? 'border-2 border-primary'
                      : isSelected
                        ? 'border-2 border-primary'
                        : 'border border-border'
                  }`}
                  style={{
                    backgroundColor: isDark ? '#161618' : '#FFFFFF',
                    opacity: selecting && !isSelected ? 0.5 : 1,
                  }}
                >
                  {/* Card header with title + close/check */}
                  <View className="flex-row items-center justify-between px-3 pt-3 pb-2">
                    <Text
                      className="flex-1 text-xs font-medium text-foreground"
                      numberOfLines={1}
                    >
                      {title}
                    </Text>
                    {selecting ? (
                      <View className={`h-5 w-5 rounded-full items-center justify-center ml-1 ${
                        isSelected ? 'bg-primary' : 'border border-border'
                      }`}>
                        {isSelected && (
                          <Ionicons name="checkmark" size={12} color={isDark ? '#121215' : '#F8F8F8'} />
                        )}
                      </View>
                    ) : (
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
                    )}
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

      {/* Bottom toolbar */}
      <View
        className="flex-row items-center justify-between bg-card border-t border-border px-4 pt-2"
        style={{ paddingBottom: insets.bottom + 4 }}
      >
        {/* Left: Edit / Close Selected / Cancel */}
        {selecting ? (
          <View className="flex-row items-center">
            <TouchableOpacity
              onPress={handleCloseSelected}
              disabled={selectedIds.size === 0}
              activeOpacity={0.6}
              hitSlop={8}
            >
              <Text className={`text-sm ${
                selectedIds.size > 0 ? 'text-destructive' : 'text-muted-foreground/40'
              }`}>
                Close ({selectedIds.size})
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => {
              if (openTabIds.length > 0) {
                editSheetRef.current?.present();
              }
            }}
            disabled={openTabIds.length === 0}
            activeOpacity={0.6}
            hitSlop={8}
          >
            <Text className={`text-sm ${
              openTabIds.length > 0 ? 'text-foreground' : 'text-muted-foreground/40'
            }`}>
              Edit
            </Text>
          </TouchableOpacity>
        )}

        {/* Center: + */}
        <TouchableOpacity
          onPress={onNewSession}
          className="items-center justify-center h-9 w-9 rounded-full bg-muted"
          activeOpacity={0.6}
        >
          <Ionicons name="add" size={24} color={iconColor} />
        </TouchableOpacity>

        {/* Right: Done / Cancel */}
        <TouchableOpacity
          onPress={selecting ? exitSelecting : onDismiss}
          activeOpacity={0.6}
          hitSlop={8}
        >
          <Text className="text-sm font-medium text-foreground">
            {selecting ? 'Cancel' : 'Done'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Edit sheet */}
      <BottomSheetModal
        ref={editSheetRef}
        enableDynamicSizing
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        backgroundStyle={{
          backgroundColor: isDark ? '#161618' : '#FFFFFF',
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
        }}
        handleIndicatorStyle={{
          backgroundColor: isDark ? '#3f3f46' : '#d4d4d8',
          width: 40,
        }}
      >
        <BottomSheetView style={{ paddingBottom: insets.bottom + 12 }}>
          <TouchableOpacity
            onPress={() => {
              editSheetRef.current?.dismiss();
              setSelecting(true);
            }}
            className="flex-row items-center px-6 py-3.5"
            activeOpacity={0.6}
          >
            <Ionicons name="checkmark-circle-outline" size={20} color={iconColor} />
            <Text className="text-[15px] ml-4 text-foreground">Select Tabs</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              editSheetRef.current?.dismiss();
              handleCloseAll();
            }}
            className="flex-row items-center px-6 py-3.5"
            activeOpacity={0.6}
          >
            <Ionicons name="close-circle-outline" size={20} color={isDark ? '#F87171' : '#DC2626'} />
            <Text className="text-[15px] ml-4" style={{ color: isDark ? '#F87171' : '#DC2626' }}>
              Close All Tabs
            </Text>
          </TouchableOpacity>
        </BottomSheetView>
      </BottomSheetModal>
    </View>
  );
}
