import * as React from 'react';
import { Stack, useRouter } from 'expo-router';
import { Platform, Pressable, View, BackHandler } from 'react-native';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Icon } from '@/components/ui/icon';
import { ArrowLeft } from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { useLanguage } from '@/contexts';
import * as Haptics from 'expo-haptics';

function SettingsIndexHeader({ title }: { title: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPadding = Math.max(insets.top, 10) + 6;

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  return (
    <View className="px-5 pb-3 flex-row items-center gap-2 bg-background" style={{ paddingTop: topPadding }}>
      <Pressable
        onPress={handlePress}
        className="w-8 h-8 items-center justify-center"
        hitSlop={8}
      >
        <Icon
          as={ArrowLeft}
          size={24}
          className="text-foreground"
          strokeWidth={2}
        />
      </Pressable>
      <Text className="text-[28px] font-roobert-medium text-foreground tracking-tight">
        {title}
      </Text>
    </View>
  );
}

function SubpageHeader({ title }: { title: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPadding = Math.max(insets.top, 10) + 6;

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  return (
    <View className="px-5 pb-3 flex-row items-center gap-2 bg-background" style={{ paddingTop: topPadding }}>
      <Pressable
        onPress={handlePress}
        className="w-8 h-8 items-center justify-center"
        hitSlop={8}
      >
        <Icon
          as={ArrowLeft}
          size={24}
          className="text-foreground"
          strokeWidth={2}
        />
      </Pressable>
      <Text className="text-[28px] font-roobert-medium text-foreground tracking-tight">
        {title}
      </Text>
    </View>
  );
}

export default function SettingsLayout() {
  const { t } = useLanguage();
  const { colorScheme } = useColorScheme();
  const router = useRouter();

  useFocusEffect(
    React.useCallback(() => {
      if (Platform.OS !== 'android') return undefined;

      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace('/home');
        }
        return true;
      });

      return () => subscription.remove();
    }, [router]),
  );

  // Match the theme background colors from global.css
  // Light: #F6F6F6, Dark: #121215
  const backgroundColor = colorScheme === 'dark' ? '#121215' : '#F6F6F6';

  return (
    <Stack
      screenOptions={{
        headerShown: false, // We use custom headers
        animation: Platform.OS === 'ios' ? 'default' : 'slide_from_right',
        presentation: 'card',
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
        contentStyle: {
          backgroundColor,
        },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          header: () => <SettingsIndexHeader title={t('settings.title')} />,
          headerShown: true,
        }}
      />
      <Stack.Screen
        name="general"
        options={{
          header: () => <SubpageHeader title="General" />,
          headerShown: true,
        }}
      />
      <Stack.Screen
        name="name"
        options={{
          header: () => <SubpageHeader title={t('nameEdit.title')} />,
          headerShown: true,
        }}
      />
      <Stack.Screen
        name="language"
        options={{
          header: () => <SubpageHeader title={t('language.title')} />,
          headerShown: true,
        }}
      />
      <Stack.Screen
        name="theme"
        options={{
          header: () => <SubpageHeader title={t('theme.title')} />,
          headerShown: true,
        }}
      />
      <Stack.Screen
        name="appearance"
        options={{
          header: () => <SubpageHeader title="Appearance" />,
          headerShown: true,
        }}
      />
      <Stack.Screen
        name="sounds"
        options={{
          header: () => <SubpageHeader title="Sounds" />,
          headerShown: true,
        }}
      />
      <Stack.Screen
        name="notifications"
        options={{
          header: () => <SubpageHeader title={t('notifications.title', 'Notifications')} />,
          headerShown: true,
        }}
      />
      <Stack.Screen
        name="shortcuts"
        options={{
          header: () => <SubpageHeader title="Shortcuts" />,
          headerShown: true,
        }}
      />
      <Stack.Screen
        name="transactions"
        options={{
          header: () => <SubpageHeader title="Transactions" />,
          headerShown: true,
        }}
      />
      <Stack.Screen
        name="referrals"
        options={{
          header: () => <SubpageHeader title="Referrals" />,
          headerShown: true,
        }}
      />
      <Stack.Screen
        name="integrations"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="beta"
        options={{
          header: () => <SubpageHeader title={t('beta.title')} />,
          headerShown: true,
        }}
      />
      <Stack.Screen
        name="account-deletion"
        options={{
          header: () => <SubpageHeader title={t('accountDeletion.title')} />,
          headerShown: true,
        }}
      />
    </Stack>
  );
}
