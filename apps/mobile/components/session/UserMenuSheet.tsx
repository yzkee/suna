import React, { forwardRef, useMemo, useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import type { BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { useColorScheme } from 'nativewind';
import {
  ChevronRight,
  LogOut,
  Monitor,
  Moon,
  Plus,
  Settings,
  Sun,
} from 'lucide-react-native';

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

const THEME_OPTIONS: { value: ThemeOption; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

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
  const { height: screenHeight } = useWindowDimensions();
  const isDark = colorScheme === 'dark';

  const renderBackdrop = useMemo(
    () => (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.35} />
    ),
    [],
  );

  const [contentHeight, setContentHeight] = useState(0);
  const snapPoints = useMemo(() => {
    const minHeight = 360;
    const maxHeight = Math.floor(screenHeight * 0.86);
    const target = contentHeight > 0 ? Math.ceil(contentHeight + 26) : 420;
    return [Math.max(minHeight, Math.min(target, maxHeight))];
  }, [contentHeight, screenHeight]);

  return (
    <BottomSheetModal
      ref={ref}
      index={0}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enableOverDrag={false}
      enablePanDownToClose
      handleIndicatorStyle={{
        backgroundColor: isDark ? '#3F3F46' : '#D4D4D8',
        width: 36,
        height: 5,
        borderRadius: 3,
      }}
      backgroundStyle={{
        backgroundColor: isDark ? '#161618' : '#FFFFFF',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
      }}
      backdropComponent={renderBackdrop}
    >
      <BottomSheetScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={(_: number, h: number) => {
          setContentHeight((prev) => (Math.abs(prev - h) < 1 ? prev : h));
        }}
      >
        {/* Instances */}
        <View className="px-1">
          <View className="flex-row items-center mb-2">
            <Text className="text-[11px] font-roobert-medium uppercase tracking-wider text-muted-foreground/80">
              Instances
            </Text>
            <Pressable
              onPress={onManageInstances}
              className="ml-auto flex-row items-center active:opacity-70"
            >
              <Text className="text-[11px] font-roobert-medium text-muted-foreground">Manage</Text>
              <Icon as={ChevronRight} size={12} className="ml-0.5 text-muted-foreground/50" strokeWidth={2.2} />
            </Pressable>
          </View>

          {/* Active instance */}
          <Pressable className="py-3.5 active:opacity-85">
            <View className="flex-row items-center">
              <View className="h-2 w-2 rounded-full bg-emerald-400 mr-3" />
              <View className="flex-1">
                <Text className="font-roobert-medium text-[15px] text-foreground" numberOfLines={1}>
                  {sandboxLabel || 'sandbox'}
                </Text>
                {!!sandboxHost && (
                  <Text className="mt-0.5 font-roobert text-xs text-muted-foreground" numberOfLines={1}>
                    {sandboxHost}
                  </Text>
                )}
              </View>
            </View>
          </Pressable>
          <View className="h-px bg-border/35" />

          {/* Add instance */}
          <Pressable
            onPress={onAddInstance}
            className="py-3.5 active:opacity-85"
          >
            <View className="flex-row items-center">
              <Icon as={Plus} size={16} className="text-muted-foreground mr-3" strokeWidth={2.2} />
              <Text className="font-roobert text-[14px] text-muted-foreground">Add instance...</Text>
            </View>
          </Pressable>
        </View>

        <View className="my-3 h-px bg-border/40" />

        {/* General */}
        <View className="px-1">
          <Text className="mb-2 text-[11px] font-roobert-medium uppercase tracking-wider text-muted-foreground/80">
            General
          </Text>

          <Pressable
            onPress={onOpenSettings}
            className="active:opacity-85"
          >
            <View className="py-3.5">
              <View className="flex-row items-center">
                <Icon as={Settings} size={18} className="text-foreground/80" strokeWidth={2.2} />
                <View className="ml-4 flex-1">
                  <Text className="font-roobert-medium text-[15px] text-foreground">Settings</Text>
                </View>
                <Icon as={ChevronRight} size={16} className="text-muted-foreground/50" strokeWidth={2.2} />
              </View>
            </View>
          </Pressable>
          <View className="h-px bg-border/35" />

          {/* Theme toggle */}
          <View className="mt-3 flex-row rounded-xl bg-muted/55 p-1">
            {THEME_OPTIONS.map((option) => {
              const active = option.value === activeTheme;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => onSelectTheme(option.value)}
                  className="flex-1 rounded-lg active:opacity-85"
                  style={{
                    backgroundColor: active
                      ? isDark ? '#1E1E22' : '#FFFFFF'
                      : 'transparent',
                  }}
                >
                  <View className="flex-row items-center justify-center px-2 py-2">
                    <Icon
                      as={option.icon}
                      size={14}
                      className={active ? 'text-foreground' : 'text-muted-foreground'}
                      strokeWidth={2.2}
                    />
                    <Text
                      className={`ml-1.5 text-xs font-roobert-medium ${
                        active ? 'text-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      {option.label}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View className="my-3 h-px bg-border/40" />

        {/* Sign Out */}
        <View className="px-1">
          <Pressable
            onPress={onSignOut}
            disabled={isSigningOut}
            className="active:opacity-85"
          >
            <View className="py-3.5">
              <View className="flex-row items-center">
                <Icon as={LogOut} size={18} className="text-destructive" strokeWidth={2.2} />
                <Text
                  className="ml-4 font-roobert-medium text-[15px] text-destructive"
                  style={{ opacity: isSigningOut ? 0.6 : 1 }}
                >
                  {isSigningOut ? 'Signing out...' : 'Log Out'}
                </Text>
              </View>
            </View>
          </Pressable>
        </View>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});
