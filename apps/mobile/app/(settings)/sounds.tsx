import * as React from 'react';
import { Pressable, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'nativewind';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';
import {
  Check,
  CircleOff,
  Music,
  Play,
  Vibrate,
  Volume2,
  Zap,
  AlertCircle,
  Bell,
  Send,
} from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import {
  useSoundStore,
  type SoundEvent,
  type SoundPack,
} from '@/stores/sound-store';
import { previewSound } from '@/lib/sounds';

interface PackOption {
  id: SoundPack;
  label: string;
  description: string;
  icon: typeof Volume2;
}

interface EventOption {
  id: SoundEvent;
  label: string;
  description: string;
  icon: typeof Volume2;
}

const PACKS: PackOption[] = [
  { id: 'off', label: 'Off', description: 'All sounds disabled', icon: CircleOff },
  { id: 'opencode', label: 'Default', description: 'Default sound pack', icon: Volume2 },
  { id: 'kortix', label: 'Seshion Pack', description: 'Whistlin\'', icon: Music },
];

const EVENTS: EventOption[] = [
  { id: 'completion', label: 'Task Completion', description: 'When AI finishes a task', icon: Zap },
  { id: 'error', label: 'Error', description: 'When a session encounters an error', icon: AlertCircle },
  { id: 'notification', label: 'Notification', description: 'Questions and permission requests', icon: Bell },
  { id: 'send', label: 'Message Sent', description: 'When you send a message', icon: Send },
];

export default function SoundsScreen() {
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  const preferences = useSoundStore((s) => s.preferences);
  const setPack = useSoundStore((s) => s.setPack);
  const setVolume = useSoundStore((s) => s.setVolume);
  const setEventEnabled = useSoundStore((s) => s.setEventEnabled);
  const setHapticsEnabled = useSoundStore((s) => s.setHapticsEnabled);

  const trackOff = isDark ? '#3A3A3C' : '#E5E7EB';
  const isOff = preferences.pack === 'off';

  const handlePackSelect = React.useCallback((pack: SoundPack) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPack(pack);
  }, [setPack]);

  const handleVolumeChange = React.useCallback((value: number) => {
    setVolume(value);
  }, [setVolume]);

  const handleVolumeComplete = React.useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleEventToggle = React.useCallback((event: SoundEvent, enabled: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEventEnabled(event, enabled);
  }, [setEventEnabled]);

  const handlePreview = React.useCallback((event: SoundEvent) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    previewSound(event);
  }, []);

  const handleHapticsToggle = React.useCallback((enabled: boolean) => {
    if (enabled) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setHapticsEnabled(enabled);
  }, [setHapticsEnabled]);

  return (
    <ScrollView
      className="flex-1 bg-background"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
    >
      <View className="px-5 pt-1 pb-8">
        <View className="px-1">
          <Text className="text-sm font-roobert text-muted-foreground">
            Choose a sound pack and configure which events play sounds.
          </Text>
        </View>

        {/* Sound Pack Selection */}
        <View className="mt-5 px-1">
          <Text className="text-[13px] font-roobert-medium text-foreground/85">Sound Pack</Text>
          <View className="mt-2" style={{ gap: 8 }}>
            {PACKS.map((pack) => {
              const selected = preferences.pack === pack.id;
              return (
                <Pressable
                  key={pack.id}
                  onPress={() => handlePackSelect(pack.id)}
                  className="overflow-hidden rounded-2xl border active:opacity-85"
                  style={{
                    borderColor: selected
                      ? isDark ? 'rgba(248,248,248,0.2)' : 'rgba(18,18,21,0.2)'
                      : isDark ? 'rgba(248,248,248,0.08)' : 'rgba(18,18,21,0.08)',
                    backgroundColor: selected
                      ? isDark ? 'rgba(248,248,248,0.05)' : 'rgba(18,18,21,0.03)'
                      : 'transparent',
                  }}
                >
                  <View className="flex-row items-center px-4 py-3">
                    <View className="h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
                      <Icon as={pack.icon} size={16} className="text-primary" strokeWidth={2.2} />
                    </View>
                    <View className="ml-3 flex-1">
                      <Text className="font-roobert-medium text-[15px] text-foreground">
                        {pack.label}
                      </Text>
                      <Text className="mt-0.5 font-roobert text-xs text-muted-foreground">
                        {pack.description}
                      </Text>
                    </View>
                    <View className="h-5 w-5 items-center justify-center">
                      {selected && (
                        <Icon as={Check} size={16} className="text-primary" strokeWidth={2.7} />
                      )}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        {!isOff && (
          <>
            {/* Volume */}
            <View className="mt-5 h-px bg-border/40" />
            <View className="mt-4 px-1">
              <Text className="text-[13px] font-roobert-medium text-foreground/85">Volume</Text>
              <View className="mt-2 flex-row items-center" style={{ gap: 10 }}>
                <Icon as={Volume2} size={16} className="text-muted-foreground" strokeWidth={2.2} />
                <View className="flex-1">
                  <Slider
                    value={preferences.volume}
                    onValueChange={handleVolumeChange}
                    onSlidingComplete={handleVolumeComplete}
                    minimumValue={0}
                    maximumValue={1}
                    step={0.01}
                    minimumTrackTintColor={isDark ? '#FFFFFF' : '#121215'}
                    maximumTrackTintColor={isDark ? '#3A3A3C' : '#E5E7EB'}
                    thumbTintColor={isDark ? '#FFFFFF' : '#121215'}
                  />
                </View>
                <Text className="w-9 text-right font-roobert text-xs tabular-nums text-muted-foreground">
                  {Math.round(preferences.volume * 100)}%
                </Text>
              </View>
            </View>

            {/* Sound Events */}
            <View className="mt-5 h-px bg-border/40" />
            <View className="mt-4 px-1">
              <Text className="text-[13px] font-roobert-medium text-foreground/85">Sound Events</Text>
              <View className="mt-2 overflow-hidden rounded-2xl border border-border/40 bg-card/70">
                {EVENTS.map((event, idx) => {
                  const enabled = preferences.events[event.id] !== false;
                  const isLast = idx === EVENTS.length - 1;
                  return (
                    <View key={event.id}>
                      <View className="flex-row items-center px-4 py-3">
                        <View className="h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
                          <Icon as={event.icon} size={15} className="text-primary" strokeWidth={2.2} />
                        </View>
                        <View className="ml-3 flex-1">
                          <Text className="font-roobert-medium text-[14px] text-foreground">
                            {event.label}
                          </Text>
                          <Text className="mt-0.5 font-roobert text-[11px] text-muted-foreground">
                            {event.description}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => handlePreview(event.id)}
                          className="mr-3 h-7 items-center justify-center rounded-lg bg-muted/60 px-2.5 active:opacity-70"
                          hitSlop={4}
                        >
                          <View className="flex-row items-center" style={{ gap: 4 }}>
                            <Icon as={Play} size={10} className="text-muted-foreground" strokeWidth={2.5} />
                            <Text className="font-roobert-medium text-[11px] text-muted-foreground">
                              Preview
                            </Text>
                          </View>
                        </Pressable>
                        <Switch
                          value={enabled}
                          onValueChange={(v) => handleEventToggle(event.id, v)}
                          trackColor={{ false: trackOff, true: '#34C759' }}
                          thumbColor="#FFFFFF"
                          ios_backgroundColor={trackOff}
                        />
                      </View>
                      {!isLast && <View className="ml-16 h-px bg-border/35" />}
                    </View>
                  );
                })}
              </View>
            </View>
          </>
        )}

        {/* Haptic Feedback — always visible */}
        <View className="mt-5 h-px bg-border/40" />
        <View className="mt-4 px-1">
          <Text className="text-[13px] font-roobert-medium text-foreground/85">Feedback</Text>
          <View className="mt-2">
            <View className="rounded-2xl border border-border/40 bg-card/70 px-4 py-3">
              <View className="flex-row items-center">
                <View className="h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
                  <Icon as={Vibrate} size={16} className="text-primary" strokeWidth={2.2} />
                </View>
                <View className="ml-3 flex-1">
                  <Text className="font-roobert-medium text-[15px] text-foreground">
                    Haptic Feedback
                  </Text>
                  <Text className="mt-0.5 font-roobert text-xs text-muted-foreground">
                    Vibration feedback on taps and actions
                  </Text>
                </View>
                <Switch
                  value={preferences.hapticsEnabled}
                  onValueChange={handleHapticsToggle}
                  trackColor={{ false: trackOff, true: '#34C759' }}
                  thumbColor="#FFFFFF"
                  ios_backgroundColor={trackOff}
                />
              </View>
            </View>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}
