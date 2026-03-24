import * as React from 'react';
import { ScrollView, Switch, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'nativewind';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import { Vibrate, Volume2 } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

const SOUND_ENABLED_KEY = '@settings_sound_enabled';
const HAPTICS_ENABLED_KEY = '@settings_haptics_enabled';

export default function SoundsScreen() {
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const [soundEnabled, setSoundEnabled] = React.useState(true);
  const [hapticsEnabled, setHapticsEnabled] = React.useState(true);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      const [soundValue, hapticsValue] = await Promise.all([
        AsyncStorage.getItem(SOUND_ENABLED_KEY),
        AsyncStorage.getItem(HAPTICS_ENABLED_KEY),
      ]);
      if (!mounted) return;
      setSoundEnabled(soundValue !== 'false');
      setHapticsEnabled(hapticsValue !== 'false');
    })();
    return () => { mounted = false; };
  }, []);

  const persist = React.useCallback(async (key: string, value: boolean) => {
    await AsyncStorage.setItem(key, value ? 'true' : 'false');
  }, []);

  const onToggleSound = React.useCallback(async (value: boolean) => {
    setSoundEnabled(value);
    await persist(SOUND_ENABLED_KEY, value);
    if (value) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [persist]);

  const onToggleHaptics = React.useCallback(async (value: boolean) => {
    setHapticsEnabled(value);
    await persist(HAPTICS_ENABLED_KEY, value);
    if (value) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [persist]);

  const trackOff = colorScheme === 'dark' ? '#3A3A3C' : '#E5E7EB';

  return (
    <ScrollView
      className="flex-1 bg-background"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
    >
      <View className="px-6 pt-3" style={{ gap: 12 }}>
        <SwitchRow
          icon={Volume2}
          title="App sounds"
          description="Play sounds for actions and alerts"
          value={soundEnabled}
          onValueChange={onToggleSound}
          trackOff={trackOff}
        />
        <SwitchRow
          icon={Vibrate}
          title="Haptic feedback"
          description="Vibration feedback on taps and actions"
          value={hapticsEnabled}
          onValueChange={onToggleHaptics}
          trackOff={trackOff}
        />
      </View>
    </ScrollView>
  );
}

function SwitchRow({
  icon,
  title,
  description,
  value,
  onValueChange,
  trackOff,
}: {
  icon: typeof Volume2;
  title: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  trackOff: string;
}) {
  return (
    <View className="rounded-3xl border border-border/40 bg-card/70 px-4 py-3">
      <View className="flex-row items-center">
        <View className="h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
          <Icon as={icon} size={18} className="text-primary" strokeWidth={2.2} />
        </View>
        <View className="ml-3 flex-1">
          <Text className="font-roobert-medium text-[15px] text-foreground">{title}</Text>
          <Text className="mt-0.5 font-roobert text-xs text-muted-foreground">{description}</Text>
        </View>
        <Switch
          value={value}
          onValueChange={onValueChange}
          trackColor={{ false: trackOff, true: '#34C759' }}
          thumbColor="#FFFFFF"
          ios_backgroundColor={trackOff}
        />
      </View>
    </View>
  );
}
