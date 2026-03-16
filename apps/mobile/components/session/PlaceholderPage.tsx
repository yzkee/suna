/**
 * PlaceholderPage — generic placeholder for page tabs (Files, Terminal, etc.)
 *
 * Shows the page icon, title, and a "coming soon" message.
 * Will be replaced with real implementations later.
 */

import React from 'react';
import { View, TouchableOpacity, Text as RNText } from 'react-native';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { PageTab } from '@/stores/tab-store';

interface PlaceholderPageProps {
  page: PageTab;
  onBack: () => void;
  onOpenDrawer?: () => void;
  onOpenRightDrawer?: () => void;
}

export function PlaceholderPage({ page, onBack, onOpenDrawer, onOpenRightDrawer }: PlaceholderPageProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();

  const fgColor = isDark ? '#F8F8F8' : '#121215';
  const mutedColor = isDark ? '#888' : '#777';

  return (
    <View style={{ flex: 1, backgroundColor: isDark ? '#121215' : '#f5f5f5' }}>
      {/* Header */}
      <View
        style={{ paddingTop: insets.top }}
        className="px-4 pb-3 bg-background"
      >
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

      {/* Placeholder content */}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 18,
            backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 20,
          }}
        >
          <Ionicons name={page.icon as any} size={30} color={mutedColor} />
        </View>
        <RNText
          style={{
            fontSize: 18,
            fontFamily: 'Roobert-Medium',
            color: fgColor,
            marginBottom: 8,
            textAlign: 'center',
          }}
        >
          {page.label}
        </RNText>
        <RNText
          style={{
            fontSize: 14,
            fontFamily: 'Roobert',
            color: mutedColor,
            textAlign: 'center',
            lineHeight: 20,
          }}
        >
          Coming soon. This feature is under development.
        </RNText>
      </View>
    </View>
  );
}
