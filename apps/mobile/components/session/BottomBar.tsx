/**
 * BottomBar — Browser-like bottom toolbar.
 *
 * Shows: Back | Forward | + New Session | Tabs (count) | More (...)
 * The "More" menu shows session-specific actions via a bottom sheet.
 */

import React, { useCallback, useRef, useMemo, forwardRef, useImperativeHandle } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Text } from '@/components/ui/text';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetView } from '@gorhom/bottom-sheet';

export type BottomBarMenuItem =
  | {
      type?: 'action';
      icon: React.ComponentType<any>;
      label: string;
      onPress: () => void;
      destructive?: boolean;
    }
  | {
      type: 'divider';
    };

interface BottomBarProps {
  /** Currently active session ID (null = on dashboard) */
  activeSessionId: string | null;
  /** Number of open session tabs */
  tabCount: number;
  /** Navigate to the previous session in history */
  onBack?: () => void;
  /** Navigate to the next session in history */
  onForward?: () => void;
  /** Create a new session */
  onNewSession: () => void;
  /** Open the tabs overview */
  onOpenTabs: () => void;
  /** Whether back navigation is available */
  canGoBack?: boolean;
  /** Whether forward navigation is available */
  canGoForward?: boolean;
  /** Session actions */
  onCompactSession?: () => void;
  onExportTranscript?: () => void;
  onViewChanges?: () => void;
  onDiagnostics?: () => void;
  onArchiveSession?: () => void;
  /**
   * Custom menu items for the three-dot menu.
   * When provided, these replace the default session actions.
   */
  customMenuItems?: BottomBarMenuItem[];
}

export interface BottomBarRef {
  presentMenu: () => void;
}

export const BottomBar = forwardRef<BottomBarRef, BottomBarProps>(function BottomBar({
  activeSessionId,
  tabCount,
  onBack,
  onForward,
  onNewSession,
  onOpenTabs,
  canGoBack = false,
  canGoForward = false,
  onCompactSession,
  onExportTranscript,
  onViewChanges,
  onDiagnostics,
  onArchiveSession,
  customMenuItems,
}, ref) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const sheetRef = useRef<BottomSheetModal>(null);

  useImperativeHandle(ref, () => ({
    presentMenu: () => sheetRef.current?.present(),
  }), []);

  const hasActiveSession = !!activeSessionId;
  const hasCustomMenu = !!customMenuItems && customMenuItems.length > 0;
  const moreEnabled = hasActiveSession || hasCustomMenu;
  const iconColor = isDark ? '#F8F8F8' : '#121215';
  const disabledColor = isDark ? '#3a3a3a' : '#c8c8c8';

  const handleMore = useCallback(() => {
    if (!moreEnabled) return;
    sheetRef.current?.present();
  }, [moreEnabled]);

  const closeSheet = useCallback(() => {
    sheetRef.current?.dismiss();
  }, []);

  const menuItems = useMemo(() => [
    {
      icon: 'alert-circle-outline' as const,
      label: 'Diagnostics',
      onPress: () => { closeSheet(); onDiagnostics?.(); },
    },
    {
      icon: 'git-compare-outline' as const,
      label: 'View changes',
      onPress: () => { closeSheet(); onViewChanges?.(); },
    },
    {
      icon: 'download-outline' as const,
      label: 'Export transcript',
      onPress: () => { closeSheet(); onExportTranscript?.(); },
    },
    {
      icon: 'layers-outline' as const,
      label: 'Compact session',
      onPress: () => { closeSheet(); onCompactSession?.(); },
    },
    {
      icon: 'archive-outline' as const,
      label: 'Archive session',
      onPress: () => { closeSheet(); onArchiveSession?.(); },
    },
  ], [closeSheet, onDiagnostics, onViewChanges, onExportTranscript, onCompactSession, onArchiveSession]);

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

  return (
    <>
      <View
        className="flex-row items-center justify-around bg-card border-t border-border px-2 pt-1.5"
        style={{ paddingBottom: insets.bottom + 2 }}
      >
        {/* Back */}
        <TouchableOpacity
          onPress={onBack}
          disabled={!canGoBack}
          className="items-center justify-center p-2"
          activeOpacity={0.6}
          hitSlop={6}
        >
          <Ionicons
            name="chevron-back"
            size={22}
            color={canGoBack ? iconColor : disabledColor}
          />
        </TouchableOpacity>

        {/* Forward */}
        <TouchableOpacity
          onPress={onForward}
          disabled={!canGoForward}
          className="items-center justify-center p-2"
          activeOpacity={0.6}
          hitSlop={6}
        >
          <Ionicons
            name="chevron-forward"
            size={22}
            color={canGoForward ? iconColor : disabledColor}
          />
        </TouchableOpacity>

        {/* New Session (+) */}
        <TouchableOpacity
          onPress={onNewSession}
          className="items-center justify-center h-9 w-9 rounded-full bg-muted"
          activeOpacity={0.6}
        >
          <Ionicons name="add" size={24} color={iconColor} />
        </TouchableOpacity>

        {/* Tabs */}
        <TouchableOpacity
          onPress={onOpenTabs}
          className="items-center justify-center p-2"
          activeOpacity={0.6}
          hitSlop={6}
        >
          <View
            className="h-6 w-6 rounded border-[1.5px] items-center justify-center"
            style={{ borderColor: iconColor }}
          >
            <Text className="text-xs font-bold text-foreground" style={{ fontSize: 10, lineHeight: 12 }}>
              {tabCount > 99 ? '99' : tabCount}
            </Text>
          </View>
        </TouchableOpacity>

        {/* More (...) */}
        <TouchableOpacity
          onPress={handleMore}
          disabled={!moreEnabled}
          className="items-center justify-center p-2"
          activeOpacity={0.6}
          hitSlop={6}
        >
          <Ionicons
            name="ellipsis-horizontal"
            size={22}
            color={moreEnabled ? iconColor : disabledColor}
          />
        </TouchableOpacity>
      </View>

      {/* More menu — bottom sheet */}
      <BottomSheetModal
        ref={sheetRef}
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
          {hasCustomMenu ? (
            customMenuItems!.map((item, index) => {
              if (item.type === 'divider') {
                return (
                  <View
                    key={`divider-${index}`}
                    className="mx-6 my-1.5"
                    style={{
                      height: 1,
                      backgroundColor: isDark
                        ? 'rgba(248, 248, 248, 0.08)'
                        : 'rgba(18, 18, 21, 0.06)',
                    }}
                  />
                );
              }
              const IconComp = item.icon;
              return (
                <TouchableOpacity
                  key={item.label}
                  onPress={() => { closeSheet(); item.onPress(); }}
                  className="flex-row items-center px-6 py-3.5"
                  activeOpacity={0.6}
                >
                  <IconComp
                    size={20}
                    color={item.destructive ? '#ef4444' : iconColor}
                    strokeWidth={1.8}
                  />
                  <Text
                    className="text-[15px] ml-4"
                    style={{ color: item.destructive ? '#ef4444' : (isDark ? '#F8F8F8' : '#121215') }}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })
          ) : (
            menuItems.map((item) => (
              <TouchableOpacity
                key={item.label}
                onPress={item.onPress}
                className="flex-row items-center px-6 py-3.5"
                activeOpacity={0.6}
              >
                <Ionicons name={item.icon} size={20} color={iconColor} />
                <Text className="text-[15px] ml-4 text-foreground">{item.label}</Text>
              </TouchableOpacity>
            ))
          )}
        </BottomSheetView>
      </BottomSheetModal>
    </>
  );
});
