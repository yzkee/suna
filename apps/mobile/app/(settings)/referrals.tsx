import * as React from 'react';
import { Alert, Pressable, ScrollView, Share, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import { Gift, Share2, Copy } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

const REFERRAL_LINK = 'https://kortix.com';

export default function ReferralsScreen() {
  const insets = useSafeAreaInsets();

  const onShare = React.useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Share.share({
      message: `Join me on Kortix: ${REFERRAL_LINK}`,
    });
  }, []);

  const onCopy = React.useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Clipboard.setStringAsync(REFERRAL_LINK);
    Alert.alert('Copied', 'Referral link copied to clipboard.');
  }, []);

  return (
    <ScrollView
      className="flex-1 bg-background"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
    >
      <View className="px-6 pt-3">
        <View className="rounded-3xl border border-border/40 bg-card/70 p-5">
          <View className="mb-3 h-11 w-11 items-center justify-center rounded-2xl bg-primary/10">
            <Icon as={Gift} size={20} className="text-primary" strokeWidth={2.2} />
          </View>
          <Text className="font-roobert-semibold text-lg text-foreground">Invite your team</Text>
          <Text className="mt-1 font-roobert text-sm text-muted-foreground">
            Share Kortix with teammates and collaborators.
          </Text>

          <View className="mt-4 rounded-2xl bg-muted px-3 py-2">
            <Text className="font-roobert text-xs text-muted-foreground">{REFERRAL_LINK}</Text>
          </View>

          <View className="mt-4 flex-row" style={{ gap: 10 }}>
            <Pressable onPress={onShare} className="flex-1 rounded-2xl bg-primary px-4 py-2.5 active:opacity-80">
              <View className="flex-row items-center justify-center">
                <Icon as={Share2} size={15} className="text-primary-foreground" strokeWidth={2.2} />
                <Text className="ml-2 font-roobert-medium text-sm text-primary-foreground">Share</Text>
              </View>
            </Pressable>
            <Pressable onPress={onCopy} className="rounded-2xl bg-primary/10 px-4 py-2.5 active:opacity-80">
              <View className="flex-row items-center justify-center">
                <Icon as={Copy} size={15} className="text-primary" strokeWidth={2.2} />
                <Text className="ml-2 font-roobert-medium text-sm text-primary">Copy</Text>
              </View>
            </Pressable>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}
