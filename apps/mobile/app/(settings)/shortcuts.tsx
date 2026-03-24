import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';

const SHORTCUTS = [
  { action: 'Open command palette', keys: 'Cmd/Ctrl + K' },
  { action: 'Create new session', keys: 'Cmd/Ctrl + J' },
  { action: 'Send message', keys: 'Enter' },
  { action: 'New line in composer', keys: 'Shift + Enter' },
  { action: 'Stop generation', keys: 'Esc' },
];

export default function ShortcutsScreen() {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      className="flex-1 bg-background"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
    >
      <View className="px-6 pt-3">
        <Text className="mb-3 text-xs font-roobert-medium uppercase tracking-wider text-muted-foreground">
          Keyboard shortcuts
        </Text>
        <View className="overflow-hidden rounded-3xl border border-border/40 bg-card/70">
          {SHORTCUTS.map((item, index) => (
            <View key={item.action}>
              <View className="flex-row items-center px-4 py-3">
                <Text className="flex-1 font-roobert text-sm text-foreground">{item.action}</Text>
                <View className="rounded-xl bg-muted px-2.5 py-1">
                  <Text className="font-roobert-medium text-xs text-muted-foreground">{item.keys}</Text>
                </View>
              </View>
              {index < SHORTCUTS.length - 1 && <View className="ml-4 h-px bg-border/30" />}
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
