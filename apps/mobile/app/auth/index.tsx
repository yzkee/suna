/**
 * Auth Screen — matches the Computer frontend's self-hosted auth.
 *
 * Simple email + password form. No OAuth, no magic links, no billing checks.
 * For self-hosted local sandbox instances.
 */

import * as React from 'react';
import {
  View,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { useAuthContext } from '@/contexts';
import { log } from '@/lib/logger';
import { supabase } from '@/api/supabase';
import { KortixLogo } from '@/components/ui/KortixLogo';
import { AuthButton } from '@/components/auth/AuthButton';
import { AuthInput } from '@/components/auth/AuthInput';

export default function AuthScreen() {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const { isAuthenticated } = useAuthContext();

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const passwordRef = React.useRef<TextInput>(null);

  // Redirect if already authenticated
  React.useEffect(() => {
    if (isAuthenticated) {
      router.replace('/home');
    }
  }, [isAuthenticated, router]);

  const handleSignIn = React.useCallback(async () => {
    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();

    if (!trimmedEmail || !trimmedPassword) {
      setErrorMessage('Please enter both email and password.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      log.log('Signing in with email/password...');

      const { data, error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password: trimmedPassword,
      });

      if (error) {
        // Use log.warn (not log.error) to avoid red LogBox overlay in dev mode
        log.warn('Sign in failed:', error.message);

        // Show user-friendly error messages
        if (error.message.includes('Invalid login credentials')) {
          setErrorMessage('Invalid email or password. Please try again.');
        } else if (error.message.includes('Email not confirmed')) {
          setErrorMessage('Email not confirmed. Check your Supabase settings.');
        } else {
          setErrorMessage(error.message);
        }
        setLoading(false);
        return;
      }

      if (data.session) {
        log.log('Signed in successfully');
        router.replace('/home');
      }
    } catch (err: any) {
      log.error('Auth exception:', err);
      setErrorMessage(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }, [email, password, router]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />

      <KeyboardAvoidingView
        className="flex-1 bg-background"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View
          className="flex-1 justify-center px-8"
          style={{ paddingTop: insets.top, paddingBottom: insets.bottom + 32 }}
        >
          {/* Logo + headline */}
          <View className="items-start mb-10">
            <KortixLogo
              variant="symbol"
              size={36}
              color={isDark ? 'dark' : 'light'}
            />
            <Text className="text-[28px] font-roobert-semibold text-foreground mt-5 leading-tight">
              Sign in to{'\n'}Kortix
            </Text>
            <Text className="text-[15px] text-muted-foreground mt-2 font-roobert">
              Your AI Computer
            </Text>
          </View>

          {/* Form */}
          <View className="w-full">
            {/* Error message */}
            {errorMessage && (
              <View className="mb-4 rounded-2xl bg-destructive/10 px-4 py-3">
                <Text className="text-sm text-destructive text-center font-roobert">
                  {errorMessage}
                </Text>
              </View>
            )}

            {/* Email input */}
            <View className="mb-3">
              <AuthInput
                value={email}
                onChangeText={setEmail}
                placeholder="Email address"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
            </View>

            {/* Password input */}
            <View className="mb-5">
              <AuthInput
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                secureTextEntry
                autoComplete="password"
                returnKeyType="go"
                onSubmitEditing={handleSignIn}
              />
            </View>

            {/* Sign in button */}
            <AuthButton
              label="Sign in"
              onPress={handleSignIn}
              isLoading={loading}
              variant="primary"
              showArrow={false}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}
