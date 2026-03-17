/**
 * MentionSuggestions — dropdown list that appears above the input
 * when the user types "@" in SessionChatInput.
 *
 * Categories: Agents (purple), Sessions (green), Files (blue)
 */

import React, { useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { useColorScheme } from 'nativewind';
import { Ionicons } from '@expo/vector-icons';
import type { MentionItem } from './useMentions';

// ─── Constants ───────────────────────────────────────────────────────────────

const COLORS = {
  agent: '#a855f7',   // purple
  session: '#10b981', // emerald
  file: '#3b82f6',    // blue
} as const;

const ICONS: Record<string, string> = {
  agent: 'person-outline',
  session: 'chatbubble-outline',
  file: 'document-text-outline',
};

const CATEGORY_LABELS: Record<MentionItem['kind'], string> = {
  agent: 'Agents',
  session: 'Sessions',
  file: 'Files',
};

// ─── Component ───────────────────────────────────────────────────────────────

interface MentionSuggestionsProps {
  items: MentionItem[];
  selectedIndex: number;
  isLoading?: boolean;
  onSelect: (item: MentionItem) => void;
}

export function MentionSuggestions({
  items,
  selectedIndex,
  isLoading,
  onSelect,
}: MentionSuggestionsProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  const fgColor = isDark ? '#F8F8F8' : '#121215';
  const mutedColor = isDark ? 'rgba(248,248,248,0.45)' : 'rgba(18,18,21,0.45)';
  const headerColor = isDark ? 'rgba(248,248,248,0.35)' : 'rgba(18,18,21,0.35)';
  const bgColor = isDark ? '#1c1c1e' : '#ffffff';
  const hoverBg = isDark ? 'rgba(248,248,248,0.08)' : 'rgba(18,18,21,0.04)';
  const borderColor = isDark ? 'rgba(248,248,248,0.1)' : 'rgba(18,18,21,0.08)';

  if (items.length === 0 && !isLoading) return null;

  // Group items by kind preserving the order: agents -> sessions -> files
  const groups: { kind: MentionItem['kind']; items: { item: MentionItem; globalIdx: number }[] }[] = [];
  const kindOrder: MentionItem['kind'][] = ['agent', 'session', 'file'];
  let globalIdx = 0;

  for (const kind of kindOrder) {
    const groupItems: { item: MentionItem; globalIdx: number }[] = [];
    for (const item of items) {
      if (item.kind === kind) {
        groupItems.push({ item, globalIdx });
      }
      // Count all items to track global index
    }
    if (groupItems.length > 0) groups.push({ kind, items: groupItems });
  }
  // Recompute global indices correctly
  let idx = 0;
  for (const group of groups) {
    for (const entry of group.items) {
      entry.globalIdx = idx++;
    }
  }

  return (
    <View
      style={{
        backgroundColor: bgColor,
        borderWidth: 1,
        borderColor,
        borderRadius: 16,
        marginHorizontal: 16,
        marginBottom: 8,
        maxHeight: 260,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: isDark ? 0.3 : 0.08,
        shadowRadius: 12,
        elevation: 8,
        overflow: 'hidden',
      }}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={{ paddingVertical: 6 }}
      >
        {groups.map((group) => (
          <View key={group.kind}>
            {/* Category header */}
            <Text
              style={{
                color: headerColor,
                fontSize: 11,
                fontFamily: 'Roobert-Medium',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                paddingHorizontal: 14,
                paddingTop: 8,
                paddingBottom: 4,
              }}
            >
              {CATEGORY_LABELS[group.kind]}
            </Text>

            {/* Items */}
            {group.items.map(({ item, globalIdx: gi }) => {
              const isSelected = gi === selectedIndex;
              const color = COLORS[item.kind];

              return (
                <TouchableOpacity
                  key={`${item.kind}-${item.label}-${gi}`}
                  onPress={() => onSelect(item)}
                  activeOpacity={0.6}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    backgroundColor: isSelected ? hoverBg : 'transparent',
                  }}
                >
                  <View
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      backgroundColor: `${color}15`,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: 10,
                    }}
                  >
                    <Ionicons name={ICONS[item.kind] as any} size={15} color={color} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      style={{
                        color: fgColor,
                        fontSize: 14,
                        fontFamily: 'Roobert-Medium',
                      }}
                      numberOfLines={1}
                    >
                      {item.kind === 'file' ? item.label.replace(/^\/workspace\//, '') : item.label}
                    </Text>
                    {item.description ? (
                      <Text
                        style={{
                          color: mutedColor,
                          fontSize: 12,
                          fontFamily: 'Roobert',
                          marginTop: 1,
                        }}
                        numberOfLines={1}
                      >
                        {item.description}
                      </Text>
                    ) : null}
                  </View>
                  <Text
                    style={{
                      color,
                      fontSize: 10,
                      fontFamily: 'Roobert-Medium',
                      textTransform: 'uppercase',
                      letterSpacing: 0.3,
                      marginLeft: 8,
                      opacity: 0.7,
                    }}
                  >
                    {item.kind}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}

        {/* Loading indicator for file search */}
        {isLoading && items.filter((i) => i.kind === 'file').length === 0 && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 14,
              paddingVertical: 10,
            }}
          >
            <ActivityIndicator size="small" color={COLORS.file} style={{ marginRight: 10 }} />
            <Text style={{ color: mutedColor, fontSize: 13, fontFamily: 'Roobert' }}>
              Searching files...
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
