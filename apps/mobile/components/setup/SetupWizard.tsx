/**
 * SetupWizard — Instance setup flow for first-time configuration.
 *
 * Mirrors the frontend's InstanceSetupFlow (setup-flow.tsx):
 *   Step 1: Connect an LLM provider (required for agent to work)
 *   Step 2: Tool API keys (optional — web search, scraping, etc.)
 *
 * After completion, writes INSTANCE_SETUP_COMPLETE=true to sandbox env.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Linking,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Sparkles,
  Check,
  ChevronRight,
  Search,
  Flame,
  ImageIcon,
  BookOpen,
  Mic,
  ExternalLink,
  Settings2,
  Loader2,
} from 'lucide-react-native';

import { KortixLogo } from '@/components/ui/KortixLogo';
import { useSandboxContext } from '@/contexts/SandboxContext';
import { useOpenCodeProviders } from '@/lib/opencode/hooks/use-opencode-data';
import { useThemeColors } from '@/lib/theme-colors';
import { getAuthToken } from '@/api/config';
import { useTabStore } from '@/stores/tab-store';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SetupWizardProps {
  onComplete: () => void;
}

// ─── Tool secrets definition (matches frontend) ─────────────────────────────

const TOOL_SECRETS = [
  {
    key: 'TAVILY_API_KEY',
    label: 'Tavily',
    description: 'Web search — lets the agent search the internet',
    icon: Search,
    signupUrl: 'https://tavily.com',
  },
  {
    key: 'FIRECRAWL_API_KEY',
    label: 'Firecrawl',
    description: 'Web scraping — read and extract web page content',
    icon: Flame,
    signupUrl: 'https://firecrawl.dev',
  },
  {
    key: 'SERPER_API_KEY',
    label: 'Serper',
    description: 'Google image search for finding visual content',
    icon: ImageIcon,
    signupUrl: 'https://serper.dev',
  },
  {
    key: 'REPLICATE_API_TOKEN',
    label: 'Replicate',
    description: 'AI image & video generation',
    icon: ImageIcon,
    signupUrl: 'https://replicate.com',
  },
  {
    key: 'CONTEXT7_API_KEY',
    label: 'Context7',
    description: 'Documentation search for coding libraries',
    icon: BookOpen,
    signupUrl: 'https://context7.com',
  },
  {
    key: 'ELEVENLABS_API_KEY',
    label: 'ElevenLabs',
    description: 'Text-to-speech and voice generation',
    icon: Mic,
    signupUrl: 'https://elevenlabs.io',
  },
] as const;

// LLM provider IDs that count as "connected"
const LLM_PROVIDER_IDS = new Set([
  'anthropic', 'openai', 'openrouter', 'google', 'groq', 'xai',
  'deepseek', 'mistral', 'cerebras', 'togetherai', 'fireworks',
]);

// ─── Helper: authenticated fetch to sandbox ──────────────────────────────────

async function sandboxFetch(
  sandboxUrl: string,
  path: string,
  options?: RequestInit,
): Promise<Response> {
  const token = await getAuthToken();
  return fetch(`${sandboxUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers || {}),
    },
  });
}

// ─── Step Indicator ──────────────────────────────────────────────────────────

function StepIndicator({
  currentStep,
  totalSteps,
  isDark,
}: {
  currentStep: number;
  totalSteps: number;
  isDark: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 24 }}>
      {Array.from({ length: totalSteps }, (_, i) => {
        const step = i + 1;
        const isActive = step === currentStep;
        const isDone = step < currentStep;
        return (
          <View
            key={step}
            style={{
              width: isActive ? 24 : 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: isActive
                ? (isDark ? '#F8F8F8' : '#121215')
                : isDone
                  ? (isDark ? 'rgba(248,248,248,0.4)' : 'rgba(18,18,21,0.4)')
                  : (isDark ? 'rgba(248,248,248,0.15)' : 'rgba(18,18,21,0.15)'),
            }}
          />
        );
      })}
    </View>
  );
}

// ─── Step 1: Provider ────────────────────────────────────────────────────────

function ProviderStep({
  onContinue,
  isDark,
  themeColors,
}: {
  onContinue: () => void;
  isDark: boolean;
  themeColors: { primary: string; primaryForeground: string };
}) {
  const { sandboxUrl } = useSandboxContext();
  const { data: providersData, isLoading, refetch } = useOpenCodeProviders(sandboxUrl);

  const hasLLMProvider = useMemo(() => {
    if (!providersData?.connected) return false;
    return providersData.connected.some((id: string) => LLM_PROVIDER_IDS.has(id));
  }, [providersData]);

  const connectedCount = providersData?.connected?.length ?? 0;

  const handleAddProvider = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    useTabStore.getState().navigateToPage('page:llm-providers');
  }, []);

  // Re-check providers when user comes back from providers page
  const handleContinue = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    refetch();
    onContinue();
  }, [onContinue, refetch]);

  if (isLoading) {
    return (
      <View style={{ alignItems: 'center', paddingVertical: 48, gap: 12 }}>
        <ActivityIndicator size="small" color={isDark ? '#71717a' : '#a1a1aa'} />
        <Text style={{ fontSize: 12, fontFamily: 'Roobert', color: isDark ? 'rgba(248,248,248,0.4)' : 'rgba(18,18,21,0.4)' }}>
          Checking providers…
        </Text>
      </View>
    );
  }

  return (
    <View style={{ width: '100%', gap: 24 }}>
      {/* Header */}
      <View style={{ alignItems: 'center', gap: 8 }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: hasLLMProvider
              ? (isDark ? 'rgba(52,211,153,0.1)' : 'rgba(52,211,153,0.1)')
              : (isDark ? 'rgba(248,248,248,0.06)' : 'rgba(18,18,21,0.04)'),
          }}
        >
          {hasLLMProvider ? (
            <Check size={20} color="#34d399" />
          ) : (
            <Sparkles size={20} color={isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.4)'} />
          )}
        </View>
        <Text style={{ fontSize: 15, fontFamily: 'Roobert-Medium', color: isDark ? '#F8F8F8' : '#121215', textAlign: 'center' }}>
          {hasLLMProvider ? 'Provider connected' : 'Connect an LLM provider'}
        </Text>
        <Text style={{ fontSize: 12, fontFamily: 'Roobert', color: isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)', textAlign: 'center', lineHeight: 18, paddingHorizontal: 16 }}>
          {hasLLMProvider
            ? `${connectedCount} provider${connectedCount > 1 ? 's' : ''} ready. You can add more anytime from settings.`
            : 'Connect your existing OpenAI, Anthropic, or other LLM subscription with an API key.'}
        </Text>
      </View>

      {/* Actions */}
      <View style={{ gap: 8 }}>
        <Pressable
          onPress={handleAddProvider}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            height: 44,
            borderRadius: 12,
            backgroundColor: hasLLMProvider ? 'transparent' : themeColors.primary,
            borderWidth: hasLLMProvider ? 1 : 0,
            borderColor: isDark ? 'rgba(248,248,248,0.1)' : 'rgba(18,18,21,0.1)',
          }}
        >
          <Settings2 size={14} color={hasLLMProvider ? (isDark ? '#F8F8F8' : '#121215') : themeColors.primaryForeground} />
          <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: hasLLMProvider ? (isDark ? '#F8F8F8' : '#121215') : themeColors.primaryForeground }}>
            {hasLLMProvider ? 'Manage Providers' : 'Add LLM Provider'}
          </Text>
        </Pressable>

        <Pressable
          onPress={handleContinue}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            height: 44,
            borderRadius: 12,
            backgroundColor: hasLLMProvider ? themeColors.primary : 'transparent',
          }}
        >
          <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: hasLLMProvider ? themeColors.primaryForeground : (isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)') }}>
            {hasLLMProvider ? 'Continue' : 'Skip for now'}
          </Text>
          {hasLLMProvider && <ChevronRight size={14} color={themeColors.primaryForeground} />}
        </Pressable>
      </View>
    </View>
  );
}

// ─── Step 2: Tool Secrets ────────────────────────────────────────────────────

function ToolSecretsStep({
  onComplete,
  isDark,
  themeColors,
}: {
  onComplete: () => void;
  isDark: boolean;
  themeColors: { primary: string; primaryForeground: string };
}) {
  const { sandboxUrl } = useSandboxContext();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const filledCount = Object.values(values).filter((v) => v.trim()).length;

  const handleSave = useCallback(async () => {
    if (!sandboxUrl) return;
    const toSave = Object.entries(values).filter(([, v]) => v.trim());

    if (toSave.length === 0) {
      onComplete();
      return;
    }

    setSaving(true);
    try {
      for (const [key, value] of toSave) {
        await sandboxFetch(sandboxUrl, `/env/${encodeURIComponent(key)}`, {
          method: 'PUT',
          body: JSON.stringify({ value: value.trim() }),
        });
      }
    } catch (err) {
      // Continue anyway — user can fix later in Settings > Secrets
    }
    setSaving(false);
    onComplete();
  }, [sandboxUrl, values, onComplete]);

  const handleSkip = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onComplete();
  }, [onComplete]);

  const fg = isDark ? '#F8F8F8' : '#121215';
  const muted = isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)';
  const cardBg = isDark ? 'rgba(248,248,248,0.03)' : 'rgba(18,18,21,0.02)';
  const cardBorder = isDark ? 'rgba(248,248,248,0.06)' : 'rgba(18,18,21,0.06)';
  const inputBg = isDark ? 'rgba(248,248,248,0.04)' : 'rgba(18,18,21,0.03)';
  const inputBorder = isDark ? 'rgba(248,248,248,0.08)' : 'rgba(18,18,21,0.08)';

  return (
    <View style={{ width: '100%', gap: 20 }}>
      {/* Header */}
      <View style={{ alignItems: 'center', gap: 6 }}>
        <Text style={{ fontSize: 15, fontFamily: 'Roobert-Medium', color: fg, textAlign: 'center' }}>
          Add tool keys
        </Text>
        <Text style={{ fontSize: 12, fontFamily: 'Roobert', color: muted, textAlign: 'center' }}>
          Optional API keys for agent capabilities
        </Text>
      </View>

      {/* Secret list */}
      <ScrollView
        style={{ maxHeight: 320 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: 8 }}>
          {TOOL_SECRETS.map((secret) => {
            const Icon = secret.icon;
            return (
              <View
                key={secret.key}
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: 10,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: cardBorder,
                  backgroundColor: cardBg,
                }}
              >
                <View
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: isDark ? 'rgba(248,248,248,0.05)' : 'rgba(18,18,21,0.04)',
                    marginTop: 2,
                  }}
                >
                  <Icon size={14} color={isDark ? 'rgba(248,248,248,0.4)' : 'rgba(18,18,21,0.4)'} />
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: isDark ? 'rgba(248,248,248,0.8)' : 'rgba(18,18,21,0.8)', flex: 1 }}>
                      {secret.label}
                    </Text>
                    <Pressable
                      onPress={() => Linking.openURL(secret.signupUrl)}
                      hitSlop={8}
                    >
                      <ExternalLink size={12} color={isDark ? 'rgba(248,248,248,0.2)' : 'rgba(18,18,21,0.2)'} />
                    </Pressable>
                  </View>
                  <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: isDark ? 'rgba(248,248,248,0.35)' : 'rgba(18,18,21,0.35)', lineHeight: 16 }}>
                    {secret.description}
                  </Text>
                  <TextInput
                    secureTextEntry
                    placeholder={secret.key}
                    placeholderTextColor={isDark ? 'rgba(248,248,248,0.2)' : 'rgba(18,18,21,0.2)'}
                    value={values[secret.key] || ''}
                    onChangeText={(text) => setValues((prev) => ({ ...prev, [secret.key]: text }))}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={{
                      height: 32,
                      borderRadius: 8,
                      paddingHorizontal: 10,
                      fontSize: 12,
                      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
                      color: fg,
                      backgroundColor: inputBg,
                      borderWidth: 1,
                      borderColor: inputBorder,
                    }}
                  />
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* Actions */}
      <View style={{ flexDirection: 'row', gap: 8, paddingTop: 4 }}>
        <Pressable
          onPress={handleSkip}
          disabled={saving}
          style={{
            flex: 1,
            height: 44,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: cardBorder,
          }}
        >
          <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: muted }}>
            Skip for now
          </Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
          disabled={saving}
          style={{
            flex: 1,
            height: 44,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 6,
            backgroundColor: themeColors.primary,
          }}
        >
          {saving ? (
            <>
              <Loader2 size={14} color={themeColors.primaryForeground} />
              <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: themeColors.primaryForeground }}>
                Saving…
              </Text>
            </>
          ) : (
            <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: themeColors.primaryForeground }}>
              {filledCount > 0 ? 'Save & continue' : 'Continue'}
            </Text>
          )}
        </Pressable>
      </View>

      <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: isDark ? 'rgba(248,248,248,0.25)' : 'rgba(18,18,21,0.25)', textAlign: 'center' }}>
        You can add or change keys later in Settings.
      </Text>
    </View>
  );
}

// ─── Main SetupWizard ────────────────────────────────────────────────────────

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const themeColors = useThemeColors();
  const { sandboxUrl } = useSandboxContext();

  const [step, setStep] = useState<1 | 2>(1);
  const [completing, setCompleting] = useState(false);

  const totalSteps = 2;

  const markSetupComplete = useCallback(async () => {
    if (!sandboxUrl) return;
    setCompleting(true);
    try {
      await sandboxFetch(sandboxUrl, '/env/INSTANCE_SETUP_COMPLETE', {
        method: 'PUT',
        body: JSON.stringify({ value: 'true' }),
      });
    } catch {
      // Best effort — continue to main app
    }
    onComplete();
  }, [sandboxUrl, onComplete]);

  const handleProviderContinue = useCallback(() => {
    setStep(2);
  }, []);

  const handleToolKeysDone = useCallback(() => {
    markSetupComplete();
  }, [markSetupComplete]);

  const bg = isDark ? '#09090b' : '#FFFFFF';

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: bg }}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingTop: insets.top + 40,
          paddingBottom: insets.bottom + 40,
          paddingHorizontal: 32,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Logo */}
        <KortixLogo size={28} variant="symbol" color={isDark ? 'dark' : 'light'} />

        {/* Title */}
        <Text
          style={{
            fontSize: 10,
            fontFamily: 'Roobert-Medium',
            color: isDark ? 'rgba(248,248,248,0.3)' : 'rgba(18,18,21,0.3)',
            letterSpacing: 2,
            textTransform: 'uppercase',
            marginTop: 16,
            marginBottom: 8,
          }}
        >
          Instance Setup
        </Text>

        <Text
          style={{
            fontSize: 10,
            fontFamily: 'Roobert',
            color: isDark ? 'rgba(248,248,248,0.2)' : 'rgba(18,18,21,0.2)',
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            marginBottom: 24,
          }}
        >
          Self-Hosted Setup
        </Text>

        {/* Step indicator */}
        <StepIndicator currentStep={step} totalSteps={totalSteps} isDark={isDark} />

        {/* Step content */}
        <View style={{ width: '100%', maxWidth: 340 }}>
          {step === 1 && (
            <ProviderStep
              onContinue={handleProviderContinue}
              isDark={isDark}
              themeColors={themeColors}
            />
          )}
          {step === 2 && (
            <ToolSecretsStep
              onComplete={handleToolKeysDone}
              isDark={isDark}
              themeColors={themeColors}
            />
          )}
        </View>

        {completing && (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: isDark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.6)' }}>
            <ActivityIndicator size="small" color={themeColors.primary} />
            <Text style={{ marginTop: 12, fontSize: 13, fontFamily: 'Roobert-Medium', color: isDark ? '#F8F8F8' : '#121215' }}>
              Finishing setup…
            </Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
