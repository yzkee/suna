/**
 * SetupWizard — Instance setup flow for first-time configuration.
 *
 * Mirrors the frontend's InstanceSetupFlow (setup-flow.tsx):
 *   Step 1: Connect an LLM provider (required for agent to work)
 *   Step 2: Tool API keys (optional — web search, scraping, etc.)
 *   Step 3: Pipedream integrations (optional — 3,000+ app integrations)
 *
 * After completion, writes INSTANCE_SETUP_COMPLETE=true to sandbox env.
 */

import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Linking,
  KeyboardAvoidingView,
  Platform,
  PanResponder,
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
  Link,
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

interface StepProps {
  isDark: boolean;
  themeColors: { primary: string; primaryForeground: string };
}

// ─── Tool secrets definition (matches frontend) ─────────────────────────────

const TOOL_SECRETS = [
  { key: 'TAVILY_API_KEY', label: 'Tavily', description: 'Web search — lets the agent search the internet', icon: Search, signupUrl: 'https://tavily.com' },
  { key: 'FIRECRAWL_API_KEY', label: 'Firecrawl', description: 'Web scraping — read and extract web page content', icon: Flame, signupUrl: 'https://firecrawl.dev' },
  { key: 'SERPER_API_KEY', label: 'Serper', description: 'Google image search for finding visual content', icon: ImageIcon, signupUrl: 'https://serper.dev' },
  { key: 'REPLICATE_API_TOKEN', label: 'Replicate', description: 'AI image & video generation', icon: ImageIcon, signupUrl: 'https://replicate.com' },
  { key: 'CONTEXT7_API_KEY', label: 'Context7', description: 'Documentation search for coding libraries', icon: BookOpen, signupUrl: 'https://context7.com' },
  { key: 'ELEVENLABS_API_KEY', label: 'ElevenLabs', description: 'Text-to-speech and voice generation', icon: Mic, signupUrl: 'https://elevenlabs.io' },
] as const;

const PIPEDREAM_KEYS = [
  { key: 'PIPEDREAM_CLIENT_ID', label: 'Client ID', placeholder: 'e.g. z8PKSGuQdorPj4UErE…', secret: false },
  { key: 'PIPEDREAM_CLIENT_SECRET', label: 'Client Secret', placeholder: 'e.g. UeZCz2PeNdOeHJfw…', secret: true },
  { key: 'PIPEDREAM_PROJECT_ID', label: 'Project ID', placeholder: 'e.g. proj_x9s97z5', secret: false },
] as const;

// LLM provider IDs that count as "connected"
const LLM_PROVIDER_IDS = new Set([
  'anthropic', 'openai', 'openrouter', 'google', 'groq', 'xai',
  'deepseek', 'mistral', 'cerebras', 'togetherai', 'fireworks',
]);

// ─── Helper: authenticated fetch to sandbox ──────────────────────────────────

async function sandboxFetch(sandboxUrl: string, path: string, options?: RequestInit): Promise<Response> {
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

// ─── Shared colors helper ────────────────────────────────────────────────────

function useStepColors(isDark: boolean) {
  return useMemo(() => ({
    fg: isDark ? '#F8F8F8' : '#121215',
    muted: isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)',
    cardBg: isDark ? 'rgba(248,248,248,0.03)' : 'rgba(18,18,21,0.02)',
    cardBorder: isDark ? 'rgba(248,248,248,0.06)' : 'rgba(18,18,21,0.06)',
    inputBg: isDark ? 'rgba(248,248,248,0.04)' : 'rgba(18,18,21,0.03)',
    inputBorder: isDark ? 'rgba(248,248,248,0.08)' : 'rgba(18,18,21,0.08)',
  }), [isDark]);
}

// ─── Step Indicator ──────────────────────────────────────────────────────────

function StepIndicator({ currentStep, totalSteps, isDark, onStepPress }: {
  currentStep: number;
  totalSteps: number;
  isDark: boolean;
  onStepPress?: (step: number) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 24 }}>
      {Array.from({ length: totalSteps }, (_, i) => {
        const step = i + 1;
        const isActive = step === currentStep;
        const isDone = step < currentStep;
        return (
          <Pressable
            key={step}
            disabled={!isDone || !onStepPress}
            onPress={() => isDone && onStepPress?.(step)}
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

function ProviderStep({ onContinue, isDark, themeColors }: StepProps & { onContinue: () => void }) {
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
      <View style={{ alignItems: 'center', gap: 8 }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: hasLLMProvider ? 'rgba(52,211,153,0.1)' : (isDark ? 'rgba(248,248,248,0.06)' : 'rgba(18,18,21,0.04)') }}>
          {hasLLMProvider ? <Check size={20} color="#34d399" /> : <Sparkles size={20} color={isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.4)'} />}
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

      <View style={{ gap: 8 }}>
        <Pressable onPress={handleAddProvider} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44, borderRadius: 12, backgroundColor: hasLLMProvider ? 'transparent' : themeColors.primary, borderWidth: hasLLMProvider ? 1 : 0, borderColor: isDark ? 'rgba(248,248,248,0.1)' : 'rgba(18,18,21,0.1)' }}>
          <Settings2 size={14} color={hasLLMProvider ? (isDark ? '#F8F8F8' : '#121215') : themeColors.primaryForeground} />
          <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: hasLLMProvider ? (isDark ? '#F8F8F8' : '#121215') : themeColors.primaryForeground }}>
            {hasLLMProvider ? 'Manage Providers' : 'Add LLM Provider'}
          </Text>
        </Pressable>

        <Pressable onPress={handleContinue} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, borderRadius: 12, backgroundColor: hasLLMProvider ? themeColors.primary : 'transparent' }}>
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

function ToolSecretsStep({ onContinue, isDark, themeColors }: StepProps & { onContinue: () => void }) {
  const { sandboxUrl } = useSandboxContext();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const colors = useStepColors(isDark);
  const filledCount = Object.values(values).filter((v) => v.trim()).length;

  const handleSave = useCallback(async () => {
    if (!sandboxUrl) return;
    const toSave = Object.entries(values).filter(([, v]) => v.trim());
    if (toSave.length === 0) { onContinue(); return; }

    setSaving(true);
    try {
      for (const [key, value] of toSave) {
        await sandboxFetch(sandboxUrl, `/env/${encodeURIComponent(key)}`, {
          method: 'PUT', body: JSON.stringify({ value: value.trim() }),
        });
      }
    } catch { /* Continue anyway */ }
    setSaving(false);
    onContinue();
  }, [sandboxUrl, values, onContinue]);

  return (
    <View style={{ width: '100%', gap: 20 }}>


      <View style={{ alignItems: 'center', gap: 6 }}>
        <Text style={{ fontSize: 15, fontFamily: 'Roobert-Medium', color: colors.fg, textAlign: 'center' }}>Add tool keys</Text>
        <Text style={{ fontSize: 12, fontFamily: 'Roobert', color: colors.muted, textAlign: 'center' }}>Optional API keys for agent capabilities</Text>
      </View>

      <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 8 }}>
          {TOOL_SECRETS.map((secret) => {
            const Icon = secret.icon;
            return (
              <View key={secret.key} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.cardBg }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: isDark ? 'rgba(248,248,248,0.05)' : 'rgba(18,18,21,0.04)', marginTop: 2 }}>
                  <Icon size={14} color={isDark ? 'rgba(248,248,248,0.4)' : 'rgba(18,18,21,0.4)'} />
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: isDark ? 'rgba(248,248,248,0.8)' : 'rgba(18,18,21,0.8)', flex: 1 }}>{secret.label}</Text>
                    <Pressable onPress={() => Linking.openURL(secret.signupUrl)} hitSlop={8}>
                      <ExternalLink size={12} color={isDark ? 'rgba(248,248,248,0.2)' : 'rgba(18,18,21,0.2)'} />
                    </Pressable>
                  </View>
                  <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: isDark ? 'rgba(248,248,248,0.35)' : 'rgba(18,18,21,0.35)', lineHeight: 16 }}>{secret.description}</Text>
                  <TextInput
                    secureTextEntry placeholder={secret.key}
                    placeholderTextColor={isDark ? 'rgba(248,248,248,0.2)' : 'rgba(18,18,21,0.2)'}
                    value={values[secret.key] || ''} onChangeText={(text) => setValues((prev) => ({ ...prev, [secret.key]: text }))}
                    autoCapitalize="none" autoCorrect={false}
                    style={{ height: 32, borderRadius: 8, paddingHorizontal: 10, fontSize: 12, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }), color: colors.fg, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder }}
                  />
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View style={{ flexDirection: 'row', gap: 8, paddingTop: 4 }}>
        <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onContinue(); }} disabled={saving} style={{ flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.cardBorder }}>
          <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: colors.muted }}>Skip for now</Text>
        </Pressable>
        <Pressable onPress={handleSave} disabled={saving} style={{ flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, backgroundColor: themeColors.primary }}>
          {saving ? (
            <><Loader2 size={14} color={themeColors.primaryForeground} /><Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: themeColors.primaryForeground }}>Saving…</Text></>
          ) : (
            <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: themeColors.primaryForeground }}>{filledCount > 0 ? 'Save & continue' : 'Continue'}</Text>
          )}
        </Pressable>
      </View>

      <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: isDark ? 'rgba(248,248,248,0.25)' : 'rgba(18,18,21,0.25)', textAlign: 'center' }}>
        You can add or change keys later in Settings.
      </Text>
    </View>
  );
}

// ─── Step 3: Pipedream ───────────────────────────────────────────────────────

function PipedreamStep({ onComplete, completing, isDark, themeColors }: StepProps & { onComplete: () => void; completing: boolean }) {
  const { sandboxUrl } = useSandboxContext();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const colors = useStepColors(isDark);
  const allFilled = PIPEDREAM_KEYS.every((k) => (values[k.key] || '').trim());

  const handleSave = useCallback(async () => {
    if (!sandboxUrl || !allFilled) { onComplete(); return; }

    setSaving(true);
    try {
      const entries = [
        ...PIPEDREAM_KEYS.map((k) => [k.key, (values[k.key] || '').trim()] as const),
        ['PIPEDREAM_ENVIRONMENT', 'production'] as const,
      ];
      for (const [key, value] of entries) {
        if (!value) continue;
        await sandboxFetch(sandboxUrl, `/env/${encodeURIComponent(key)}`, {
          method: 'PUT', body: JSON.stringify({ value }),
        });
      }
    } catch { /* Continue anyway */ }
    setSaving(false);
    onComplete();
  }, [sandboxUrl, values, allFilled, onComplete]);

  const busy = saving || completing;

  return (
    <View style={{ width: '100%', gap: 20 }}>


      <View style={{ alignItems: 'center', gap: 8 }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: isDark ? 'rgba(248,248,248,0.06)' : 'rgba(18,18,21,0.04)' }}>
          <Link size={20} color={isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.4)'} />
        </View>
        <Text style={{ fontSize: 15, fontFamily: 'Roobert-Medium', color: colors.fg, textAlign: 'center' }}>
          Third-party integrations
        </Text>
        <Text style={{ fontSize: 12, fontFamily: 'Roobert', color: colors.muted, textAlign: 'center', lineHeight: 18, paddingHorizontal: 8 }}>
          Connect to 3,000+ apps via Pipedream Connect. Optional — you can add this later in Settings.
        </Text>
      </View>

      <View style={{ gap: 12 }}>
        {PIPEDREAM_KEYS.map((field) => (
          <View key={field.key} style={{ gap: 4 }}>
            <Text style={{ fontSize: 12, fontFamily: 'Roobert-Medium', color: isDark ? 'rgba(248,248,248,0.6)' : 'rgba(18,18,21,0.6)' }}>
              {field.label}
            </Text>
            <TextInput
              secureTextEntry={field.secret}
              placeholder={field.placeholder}
              placeholderTextColor={isDark ? 'rgba(248,248,248,0.2)' : 'rgba(18,18,21,0.2)'}
              value={values[field.key] || ''}
              onChangeText={(text) => setValues((prev) => ({ ...prev, [field.key]: text }))}
              autoCapitalize="none" autoCorrect={false}
              style={{ height: 36, borderRadius: 8, paddingHorizontal: 10, fontSize: 12, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }), color: colors.fg, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder }}
            />
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', gap: 8, paddingTop: 4 }}>
        <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onComplete(); }} disabled={busy} style={{ flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, borderWidth: 1, borderColor: colors.cardBorder }}>
          {completing ? (
            <><Loader2 size={14} color={colors.muted} /><Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: colors.muted }}>Finishing…</Text></>
          ) : (
            <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: colors.muted }}>Skip for now</Text>
          )}
        </Pressable>
        <Pressable onPress={handleSave} disabled={busy || !allFilled} style={{ flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, backgroundColor: themeColors.primary, opacity: allFilled ? 1 : 0.5 }}>
          {busy ? (
            <><Loader2 size={14} color={themeColors.primaryForeground} /><Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: themeColors.primaryForeground }}>{saving ? 'Saving…' : 'Finishing…'}</Text></>
          ) : (
            <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: themeColors.primaryForeground }}>Save & finish</Text>
          )}
        </Pressable>
      </View>

      <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: isDark ? 'rgba(248,248,248,0.25)' : 'rgba(18,18,21,0.25)', textAlign: 'center' }}>
        Get your credentials at{' '}
        <Text style={{ textDecorationLine: 'underline' }} onPress={() => Linking.openURL('https://pipedream.com/connect')}>
          pipedream.com/connect
        </Text>
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

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [completing, setCompleting] = useState(false);
  const stepRef = useRef(step);
  stepRef.current = step;

  const totalSteps = 3;

  // Swipe right to go back to previous step
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Only activate for horizontal swipes (right) with enough velocity
        return gestureState.dx > 30 && Math.abs(gestureState.dy) < 50;
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx > 80 && stepRef.current > 1) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setStep((prev) => (prev > 1 ? (prev - 1) as 1 | 2 | 3 : prev));
        }
      },
    }),
  ).current;

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

  const handleStepPress = useCallback((s: number) => {
    if (s < step) setStep(s as 1 | 2 | 3);
  }, [step]);

  const bg = isDark ? '#09090b' : '#FFFFFF';

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: bg }}
      {...panResponder.panHandlers}
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
        <Text style={{ fontSize: 10, fontFamily: 'Roobert-Medium', color: isDark ? 'rgba(248,248,248,0.3)' : 'rgba(18,18,21,0.3)', letterSpacing: 2, textTransform: 'uppercase', marginTop: 16, marginBottom: 8 }}>
          Instance Setup
        </Text>
        <Text style={{ fontSize: 10, fontFamily: 'Roobert', color: isDark ? 'rgba(248,248,248,0.2)' : 'rgba(18,18,21,0.2)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 24 }}>
          Self-Hosted Setup
        </Text>

        {/* Step indicator */}
        <StepIndicator currentStep={step} totalSteps={totalSteps} isDark={isDark} onStepPress={handleStepPress} />

        {/* Step content */}
        <View style={{ width: '100%', maxWidth: 340 }}>
          {step === 1 && (
            <ProviderStep
              onContinue={() => setStep(2)}
              isDark={isDark}
              themeColors={themeColors}
            />
          )}
          {step === 2 && (
            <ToolSecretsStep
              onContinue={() => setStep(3)}
              isDark={isDark}
              themeColors={themeColors}
            />
          )}
          {step === 3 && (
            <PipedreamStep
              onComplete={markSetupComplete}
              completing={completing}
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
