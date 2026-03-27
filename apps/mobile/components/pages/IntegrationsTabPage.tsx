/**
 * IntegrationsTabPage — full-screen Pipedream integrations page
 * rendered as a page tab (from right drawer / command palette).
 * Same header pattern as SSHPage, BrowserPage, etc.
 */

import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Text as RNText } from 'react-native';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { PageTab } from '@/stores/tab-store';
import { IntegrationsPageContent } from '@/components/settings/IntegrationsPage';

interface IntegrationsTabPageProps {
  page: PageTab;
  onBack: () => void;
  onOpenDrawer?: () => void;
  onOpenRightDrawer?: () => void;
}

export function IntegrationsTabPage({
  page,
  onBack,
  onOpenDrawer,
  onOpenRightDrawer,
}: IntegrationsTabPageProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const fgColor = isDark ? '#F8F8F8' : '#121215';

  return (
    <View style={{ flex: 1, backgroundColor: isDark ? '#121215' : '#f5f5f5' }}>
      {/* Header */}
      <View style={{ paddingTop: insets.top }} className="px-4 pb-3 bg-background">
        <View className="flex-row items-center">
          <TouchableOpacity
            onPress={onOpenDrawer}
            className="mr-3 p-1"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="menu" size={24} color={fgColor} />
          </TouchableOpacity>
          <View className="flex-1">
            <RNText
              style={{ fontSize: 18, fontFamily: 'Roobert-SemiBold', color: fgColor }}
              numberOfLines={1}
            >
              {page.label}
            </RNText>
          </View>
          <TouchableOpacity
            onPress={onOpenRightDrawer}
            className="ml-3 p-1"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="apps-outline" size={20} color={fgColor} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Integrations content */}
      <IntegrationsPageContent />
    </View>
  );
}
