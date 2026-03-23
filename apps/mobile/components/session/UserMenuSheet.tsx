import React, { forwardRef, useMemo } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Text } from '@/components/ui/text';
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import type { BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { useColorScheme } from 'nativewind';
import { Ionicons } from '@expo/vector-icons';

type ThemeOption = 'light' | 'dark' | 'system';

interface UserMenuSheetProps {
  sandboxLabel?: string;
  sandboxHost?: string;
  onManageInstances: () => void;
  onAddInstance: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
  onSelectTheme: (value: ThemeOption) => void;
  activeTheme: ThemeOption;
  isSigningOut: boolean;
}

export const UserMenuSheet = forwardRef<BottomSheetModal, UserMenuSheetProps>(function UserMenuSheet(
  {
    sandboxLabel,
    sandboxHost,
    onManageInstances,
    onAddInstance,
    onOpenSettings,
    onSignOut,
    onSelectTheme,
    activeTheme,
    isSigningOut,
  },
  ref,
) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const bgColor = isDark ? '#101014' : '#FFFFFF';
  const borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const muted = isDark ? '#9CA3AF' : '#6B7280';
  const fg = isDark ? '#F8FAFC' : '#111827';

  const themeOptions = useMemo(
    () => [
      { value: 'light' as ThemeOption, icon: 'sunny-outline' },
      { value: 'dark' as ThemeOption, icon: 'moon-outline' },
      { value: 'system' as ThemeOption, icon: 'desktop-outline' },
    ],
    [],
  );

  const renderBackdrop = (props: BottomSheetBackdropProps) => (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.4} />
  );

  return (
    <BottomSheetModal
      ref={ref}
      index={0}
      snapPoints={['85%']}
      enablePanDownToClose
      handleIndicatorStyle={{ backgroundColor: isDark ? '#2F2F35' : '#D1D5DB', width: 36 }}
      backgroundStyle={{ backgroundColor: bgColor, borderRadius: 32 }}
      backdropComponent={renderBackdrop}
    >
      <BottomSheetScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Instances section */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <Text style={{ fontSize: 12, fontFamily: 'Roobert-Medium', color: muted, letterSpacing: 1 }}>
            INSTANCES
          </Text>
          <TouchableOpacity
            onPress={onManageInstances}
            style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center' }}
          >
            <Ionicons name="settings-outline" size={14} color={muted} style={{ marginRight: 4 }} />
            <Text style={{ fontSize: 12, fontFamily: 'Roobert-Medium', color: muted }}>Manage</Text>
          </TouchableOpacity>
        </View>

        <View
          style={{
            borderWidth: 1,
            borderColor,
            borderRadius: 18,
            paddingHorizontal: 16,
            paddingVertical: 14,
            marginBottom: 8,
            backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : '#F9FAFB',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: '#34D399',
                marginRight: 10,
              }}
            />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontFamily: 'Roobert-Medium', color: fg }} numberOfLines={1}>
                {sandboxLabel || 'sandbox'}
              </Text>
              {!!sandboxHost && (
                <Text style={{ fontSize: 11, color: muted }} numberOfLines={1}>
                  {sandboxHost}
                </Text>
              )}
            </View>
          </View>
        </View>

        <TouchableOpacity
          onPress={onAddInstance}
          activeOpacity={0.7}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            borderRadius: 16,
            paddingHorizontal: 16,
            paddingVertical: 12,
            backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#F3F4F6',
            marginBottom: 12,
          }}
        >
          <Ionicons name="add-outline" size={18} color={fg} style={{ marginRight: 10 }} />
          <Text style={{ fontSize: 14, color: fg }}>Add instance...</Text>
        </TouchableOpacity>

        <View style={{ height: 1, backgroundColor: borderColor, marginVertical: 12 }} />

        {/* General section */}
        <Text style={{ fontSize: 12, fontFamily: 'Roobert-Medium', color: muted, letterSpacing: 1, marginBottom: 10 }}>
          GENERAL
        </Text>

        <TouchableOpacity
          onPress={onOpenSettings}
          activeOpacity={0.7}
          style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 14,
              backgroundColor: isDark ? '#1F1F2C' : '#EEF2FF',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: 12,
            }}
          >
            <Ionicons name="settings-outline" size={18} color={isDark ? '#E0E7FF' : '#4C1D95'} />
          </View>
          <Text style={{ fontSize: 15, color: fg, fontFamily: 'Roobert-Medium' }}>General</Text>
        </TouchableOpacity>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            borderRadius: 16,
            backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F4F4F5',
            padding: 4,
            marginBottom: 16,
          }}
        >
          {themeOptions.map((option) => {
            const active = option.value === activeTheme;
            return (
              <TouchableOpacity
                key={option.value}
                onPress={() => onSelectTheme(option.value)}
                style={{
                  flex: 1,
                  borderRadius: 12,
                  paddingVertical: 8,
                  alignItems: 'center',
                  backgroundColor: active
                    ? isDark
                      ? '#27272A'
                      : '#FFFFFF'
                    : 'transparent',
                }}
              >
                <Ionicons
                  name={option.icon as any}
                  size={18}
                  color={active ? (isDark ? '#F8FAFC' : '#111827') : muted}
                />
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={{ height: 1, backgroundColor: borderColor, marginVertical: 12 }} />

        <TouchableOpacity
          onPress={onSignOut}
          activeOpacity={0.7}
          style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}
        >
          <Ionicons name="log-out-outline" size={20} color={isDark ? '#FCA5A5' : '#DC2626'} style={{ marginRight: 12 }} />
          <Text
            style={{
              fontSize: 15,
              color: isDark ? '#FCA5A5' : '#B91C1C',
              flex: 1,
              opacity: isSigningOut ? 0.6 : 1,
            }}
          >
            {isSigningOut ? 'Signing out...' : 'Log Out'}
          </Text>
        </TouchableOpacity>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});
