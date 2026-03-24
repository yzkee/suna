import * as React from 'react';
import { Alert, Linking, Pressable, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'nativewind';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import { Bell, Smartphone, Mail, AppWindow, ShieldCheck } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { notificationsApi } from '@/lib/notifications/api';
import { useLanguage } from '@/contexts';

const EMAIL_ENABLED_KEY = '@settings_notifications_email';
const IN_APP_ENABLED_KEY = '@settings_notifications_in_app';

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const { t } = useLanguage();
  const { expoPushToken } = usePushNotifications();
  const [emailEnabled, setEmailEnabled] = React.useState(true);
  const [inAppEnabled, setInAppEnabled] = React.useState(true);
  const [isUnregistering, setIsUnregistering] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      const [emailValue, inAppValue] = await Promise.all([
        AsyncStorage.getItem(EMAIL_ENABLED_KEY),
        AsyncStorage.getItem(IN_APP_ENABLED_KEY),
      ]);
      if (!mounted) return;
      setEmailEnabled(emailValue !== 'false');
      setInAppEnabled(inAppValue !== 'false');
    })();
    return () => { mounted = false; };
  }, []);

  const persistToggle = React.useCallback(async (key: string, value: boolean) => {
    await AsyncStorage.setItem(key, value ? 'true' : 'false');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleUnregister = React.useCallback(async () => {
    if (!expoPushToken || isUnregistering) return;
    setIsUnregistering(true);
    try {
      await notificationsApi.unregisterDeviceToken(expoPushToken);
      Alert.alert('Success', t('notifications.deviceUnregisteredSuccess', 'Device unregistered successfully'));
    } catch (error: any) {
      Alert.alert('Error', error?.message || t('notifications.deviceUnregistrationFailed', 'Failed to unregister device'));
    } finally {
      setIsUnregistering(false);
    }
  }, [expoPushToken, isUnregistering, t]);

  const openSettings = React.useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Linking.openSettings();
  }, []);

  const trackOff = colorScheme === 'dark' ? '#3A3A3C' : '#E5E7EB';

  return (
    <ScrollView
      className="flex-1 bg-background"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
    >
      <View className="px-6 pt-3" style={{ gap: 12 }}>
        <SwitchRow
          icon={Mail}
          title={t('notifications.emailNotifications', 'Email Notifications')}
          description={t('notifications.emailDescription', 'Receive notifications via email')}
          value={emailEnabled}
          onValueChange={async (value) => {
            setEmailEnabled(value);
            await persistToggle(EMAIL_ENABLED_KEY, value);
          }}
          trackOff={trackOff}
        />

        <SwitchRow
          icon={AppWindow}
          title={t('notifications.inAppNotifications', 'In-App Notifications')}
          description={t('notifications.inAppDescription', 'See notifications within the app')}
          value={inAppEnabled}
          onValueChange={async (value) => {
            setInAppEnabled(value);
            await persistToggle(IN_APP_ENABLED_KEY, value);
          }}
          trackOff={trackOff}
        />

        <View className="rounded-3xl border border-border/40 bg-card/70 px-4 py-3">
          <View className="flex-row items-center">
            <View className="h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
              <Icon as={Smartphone} size={18} className="text-primary" strokeWidth={2.2} />
            </View>
            <View className="ml-3 flex-1">
              <Text className="font-roobert-medium text-[15px] text-foreground">
                {t('notifications.pushNotifications', 'Push Notifications')}
              </Text>
              <Text className="mt-0.5 font-roobert text-xs text-muted-foreground">
                {expoPushToken
                  ? t('notifications.deviceRegistered', 'This device is registered for push notifications')
                  : t('notifications.permissionMessage', 'Enable notifications in your device settings')}
              </Text>
            </View>
          </View>

          <View className="mt-3 flex-row" style={{ gap: 10 }}>
            <Pressable
              onPress={openSettings}
              className="rounded-2xl bg-primary/10 px-3 py-2 active:opacity-80"
            >
              <Text className="font-roobert-medium text-xs text-primary">
                {t('notifications.openSettings', 'Open Settings')}
              </Text>
            </Pressable>
            {!!expoPushToken && (
              <Pressable
                onPress={handleUnregister}
                disabled={isUnregistering}
                className="rounded-2xl bg-destructive/10 px-3 py-2 active:opacity-80"
              >
                <Text className="font-roobert-medium text-xs text-destructive">
                  {isUnregistering
                    ? 'Unregistering...'
                    : t('notifications.unregisterDevice', 'Unregister Device')}
                </Text>
              </Pressable>
            )}
          </View>
        </View>

        <View className="rounded-2xl border border-border/40 bg-muted/20 px-4 py-3">
          <View className="flex-row items-start">
            <Icon as={ShieldCheck} size={16} className="mt-0.5 text-muted-foreground" strokeWidth={2} />
            <Text className="ml-2 flex-1 font-roobert text-xs text-muted-foreground">
              {t('notifications.pushDescription', 'Get notified about worker runs, task completions, and important updates')}
            </Text>
          </View>
        </View>
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
  icon: typeof Bell;
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
