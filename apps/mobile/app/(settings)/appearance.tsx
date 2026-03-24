import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import { ChevronRight, Globe, Moon } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

export default function AppearanceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const go = React.useCallback((path: '/(settings)/theme' | '/(settings)/language') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(path);
  }, [router]);

  return (
    <ScrollView
      className="flex-1 bg-background"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
    >
      <View className="px-6 pt-3" style={{ gap: 12 }}>
        <AppearanceRow
          icon={Moon}
          title="Theme"
          description="Light, dark, or system"
          onPress={() => go('/(settings)/theme')}
        />
        <AppearanceRow
          icon={Globe}
          title="Language"
          description="App display language"
          onPress={() => go('/(settings)/language')}
        />
      </View>
    </ScrollView>
  );
}

function AppearanceRow({
  icon,
  title,
  description,
  onPress,
}: {
  icon: typeof Moon;
  title: string;
  description: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} className="rounded-3xl border border-border/40 bg-card/70 px-4 py-3 active:opacity-85">
      <View className="flex-row items-center">
        <View className="h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
          <Icon as={icon} size={18} className="text-primary" strokeWidth={2.2} />
        </View>
        <View className="ml-3 flex-1">
          <Text className="font-roobert-medium text-[15px] text-foreground">{title}</Text>
          <Text className="mt-0.5 font-roobert text-xs text-muted-foreground">{description}</Text>
        </View>
        <Icon as={ChevronRight} size={16} className="text-muted-foreground/50" strokeWidth={2.2} />
      </View>
    </Pressable>
  );
}
