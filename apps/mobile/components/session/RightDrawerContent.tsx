/**
 * RightDrawerContent — settings & services menu for the right-side drawer.
 *
 * Sections: Workspace, Security, Services
 * Items are placeholders — navigation will be wired up later.
 */

import React from 'react';
import { View, TouchableOpacity, ScrollView } from 'react-native';
import { Text as RNText } from 'react-native';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

interface MenuItem {
  icon: string;
  label: string;
  onPress?: () => void;
}

interface MenuSection {
  title: string;
  items: MenuItem[];
}

interface RightDrawerContentProps {
  onClose: () => void;
}

export function RightDrawerContent({ onClose }: RightDrawerContentProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();

  const fgColor = isDark ? '#F8F8F8' : '#121215';
  const mutedColor = isDark ? '#888' : '#777';
  const sectionColor = isDark ? '#666' : '#999';
  const hoverBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)';

  const sections: MenuSection[] = [
    {
      title: 'WORKSPACE',
      items: [
        { icon: 'folder-open-outline', label: 'Files' },
        { icon: 'terminal-outline', label: 'Terminal' },
        { icon: 'hardware-chip-outline', label: 'Memory' },
        { icon: 'grid-outline', label: 'Workspace' },
      ],
    },
    {
      title: 'SECURITY',
      items: [
        { icon: 'key-outline', label: 'Secrets Manager' },
        { icon: 'cube-outline', label: 'LLM Providers' },
        { icon: 'link-outline', label: 'SSH' },
        { icon: 'code-slash-outline', label: 'API' },
      ],
    },
    {
      title: 'SERVICES',
      items: [
        { icon: 'calendar-outline', label: 'Triggers' },
        { icon: 'chatbox-outline', label: 'Channels' },
        { icon: 'swap-horizontal-outline', label: 'Tunnel' },
        { icon: 'git-branch-outline', label: 'Integrations' },
        { icon: 'pulse-outline', label: 'Running Services' },
        { icon: 'compass-outline', label: 'Browser' },
        { icon: 'globe-outline', label: 'Agent Browser' },
      ],
    },
  ];

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: isDark ? '#121215' : '#FFFFFF',
        paddingTop: insets.top,
      }}
    >
      {/* Sections */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
      >
        {sections.map((section) => (
          <View key={section.title} style={{ marginBottom: 8 }}>
            {/* Section title */}
            <RNText
              style={{
                fontSize: 11,
                fontFamily: 'Roobert-Medium',
                color: sectionColor,
                letterSpacing: 1,
                paddingHorizontal: 16,
                paddingTop: 16,
                paddingBottom: 8,
              }}
            >
              {section.title}
            </RNText>

            {/* Items */}
            {section.items.map((item) => (
              <TouchableOpacity
                key={item.label}
                onPress={item.onPress}
                activeOpacity={0.6}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 16,
                  paddingVertical: 11,
                  gap: 12,
                }}
              >
                <Ionicons name={item.icon as any} size={18} color={mutedColor} />
                <RNText
                  style={{
                    fontSize: 15,
                    fontFamily: 'Roobert',
                    color: fgColor,
                  }}
                >
                  {item.label}
                </RNText>
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
