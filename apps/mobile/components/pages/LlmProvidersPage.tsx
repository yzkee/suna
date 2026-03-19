/**
 * LlmProvidersPage — Manage LLM provider connections and API keys.
 *
 * API endpoints (via OpenCode server):
 *   GET    {sandboxUrl}/provider         — List all providers + connected status
 *   PUT    {sandboxUrl}/auth/{id}        — Connect provider (set API key)
 *   DELETE {sandboxUrl}/auth/{id}        — Disconnect provider (remove key)
 *   POST   {sandboxUrl}/global/dispose   — Force server reload after changes
 */

import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View,
  TouchableOpacity,
  ScrollView,
  Alert,
  RefreshControl,
  ActivityIndicator,
  Platform,
  LayoutAnimation,
} from 'react-native';
import { Text } from '@/components/ui/text';
import {
  Plus,
  Unplug,
  ChevronDown,
  ChevronUp,
  Cpu,
  Check,
} from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetView,
  BottomSheetTextInput,
  BottomSheetScrollView,
  TouchableOpacity as BottomSheetTouchable,
} from '@gorhom/bottom-sheet';
import type { BottomSheetBackdropProps } from '@gorhom/bottom-sheet';

import { useSandboxContext } from '@/contexts/SandboxContext';
import { useOpenCodeProviders } from '@/lib/opencode/hooks/use-opencode-data';
import type { ProviderInfo } from '@/lib/opencode/hooks/use-opencode-data';
import { getAuthToken } from '@/api/config';
import { log } from '@/lib/logger';
import { SearchBar } from '@/components/ui/SearchBar';
import type { PageTab } from '@/stores/tab-store';

// ─── Provider branding ───────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google', xai: 'xAI',
  kortix: 'Kortix', openrouter: 'OpenRouter', 'github-copilot': 'GitHub Copilot',
  vercel: 'Vercel', groq: 'Groq', deepseek: 'DeepSeek', mistral: 'Mistral',
  cohere: 'Cohere', huggingface: 'Hugging Face', cerebras: 'Cerebras',
  togetherai: 'Together AI', fireworks: 'Fireworks', deepinfra: 'DeepInfra',
  nvidia: 'NVIDIA', cloudflare: 'Cloudflare', azure: 'Azure', ollama: 'Ollama',
  perplexity: 'Perplexity', lmstudio: 'LM Studio', bedrock: 'AWS Bedrock',
};

const POPULAR_IDS = new Set(['anthropic', 'openai', 'github-copilot', 'google', 'openrouter', 'vercel']);

function getProviderLabel(id: string, name?: string): string {
  return PROVIDER_LABELS[id] || name || id;
}

// ─── API helpers ─────────────────────────────────────────────────────────────

async function connectProvider(sandboxUrl: string, providerId: string, apiKey: string): Promise<void> {
  const token = await getAuthToken();
  const res = await fetch(`${sandboxUrl}/auth/${encodeURIComponent(providerId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ type: 'api', key: apiKey }),
  });
  if (!res.ok) throw new Error(`Failed to connect: ${res.status}`);
  // Force server reload
  await fetch(`${sandboxUrl}/global/dispose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  }).catch(() => {});
}

async function disconnectProvider(sandboxUrl: string, providerId: string): Promise<void> {
  const token = await getAuthToken();
  const res = await fetch(`${sandboxUrl}/auth/${encodeURIComponent(providerId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  // Fallback: set empty key if DELETE not supported
  if (res.status === 404 || res.status === 405) {
    await fetch(`${sandboxUrl}/auth/${encodeURIComponent(providerId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ type: 'api', key: '' }),
    });
  } else if (!res.ok) {
    throw new Error(`Failed to disconnect: ${res.status}`);
  }
  // Force server reload
  await fetch(`${sandboxUrl}/global/dispose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  }).catch(() => {});
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const monoFont = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

// ─── ProviderRow ─────────────────────────────────────────────────────────────

function ProviderRow({
  provider,
  isConnected,
  isDark,
  onConnect,
  onDisconnect,
}: {
  provider: ProviderInfo;
  isConnected: boolean;
  isDark: boolean;
  onConnect: (provider: ProviderInfo) => void;
  onDisconnect: (provider: ProviderInfo) => void;
}) {
  const [showModels, setShowModels] = useState(false);
  const fgColor = isDark ? '#F8F8F8' : '#121215';
  const mutedColor = isDark ? '#71717a' : '#a1a1aa';
  const borderColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const modelCount = Object.keys(provider.models).length;
  const label = getProviderLabel(provider.id, provider.name);

  const toggleModels = useCallback(() => {
    LayoutAnimation.configureNext({
      duration: 200,
      create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
      update: { type: LayoutAnimation.Types.easeInEaseOut },
      delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    });
    setShowModels((v) => !v);
  }, []);

  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: borderColor }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 }}>
        {/* Icon */}
        <View style={{
          width: 32, height: 32, borderRadius: 8,
          backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
          alignItems: 'center', justifyContent: 'center', marginRight: 12,
        }}>
          <Text style={{ fontSize: 14, fontFamily: 'Roobert-SemiBold', color: fgColor }}>
            {label.slice(0, 2).toUpperCase()}
          </Text>
        </View>

        {/* Name + info */}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 14, fontFamily: 'Roobert-Medium', color: fgColor }}>{label}</Text>
            {isConnected && (
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: isDark ? 'rgba(16,185,129,0.12)' : 'rgba(16,185,129,0.08)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 }}>
                <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#10b981', marginRight: 4 }} />
                <Text style={{ fontSize: 9, fontFamily: 'Roobert-Medium', color: '#10b981' }}>connected</Text>
              </View>
            )}
          </View>
          <TouchableOpacity onPress={toggleModels} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
            <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: mutedColor }}>{modelCount} models</Text>
            {modelCount > 0 && (
              showModels
                ? <ChevronUp size={12} color={mutedColor} style={{ marginLeft: 4 }} />
                : <ChevronDown size={12} color={mutedColor} style={{ marginLeft: 4 }} />
            )}
          </TouchableOpacity>
        </View>

        {/* Actions */}
        {isConnected ? (
          <TouchableOpacity
            onPress={() => onDisconnect(provider)}
            style={{ padding: 8 }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Unplug size={16} color={isDark ? '#f87171' : '#dc2626'} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={() => onConnect(provider)}
            style={{
              flexDirection: 'row', alignItems: 'center',
              backgroundColor: fgColor, borderRadius: 8,
              paddingHorizontal: 10, paddingVertical: 5,
            }}
          >
            <Plus size={12} color={isDark ? '#121215' : '#F8F8F8'} style={{ marginRight: 3 }} />
            <Text style={{ fontSize: 11, fontFamily: 'Roobert-Medium', color: isDark ? '#121215' : '#F8F8F8' }}>Connect</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Expanded model list */}
      {showModels && modelCount > 0 && (
        <View style={{ paddingHorizontal: 60, paddingBottom: 10 }}>
          {Object.entries(provider.models).map(([modelId, model]) => (
            <Text key={modelId} numberOfLines={1} style={{ fontSize: 11, fontFamily: monoFont, color: mutedColor, lineHeight: 18 }}>
              {model.name || modelId}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── LlmProvidersPage ────────────────────────────────────────────────────────

interface LlmProvidersPageProps {
  page: PageTab;
  onBack: () => void;
  onOpenDrawer?: () => void;
  onOpenRightDrawer?: () => void;
}

export function LlmProvidersPage({ page, onBack, onOpenDrawer, onOpenRightDrawer }: LlmProvidersPageProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const { sandboxUrl } = useSandboxContext();

  const fgColor = isDark ? '#F8F8F8' : '#121215';
  const mutedColor = isDark ? '#71717a' : '#a1a1aa';
  const bgColor = isDark ? '#121215' : '#F8F8F8';
  const borderColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const sheetBg = isDark ? '#161618' : '#FFFFFF';
  const inputBorder = isDark ? 'rgba(248,248,248,0.1)' : 'rgba(18,18,21,0.08)';

  const { data: providers, isLoading, refetch } = useOpenCodeProviders(sandboxUrl);

  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [connectTarget, setConnectTarget] = useState<ProviderInfo | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<ProviderInfo | null>(null);
  const [apiKey, setApiKey] = useState('');

  // Sheets
  const connectSheetRef = useRef<BottomSheetModal>(null);
  const disconnectSheetRef = useRef<BottomSheetModal>(null);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} pressBehavior="close" />
    ),
    [],
  );

  const sheetStyles = useMemo(() => ({
    backgroundStyle: { backgroundColor: sheetBg, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
    handleIndicatorStyle: { backgroundColor: isDark ? '#3F3F46' : '#D4D4D8', width: 36, height: 5, borderRadius: 3 },
  }), [sheetBg, isDark]);

  // Derived data
  const connectedSet = useMemo(() => new Set(providers?.connected || []), [providers]);

  const { connectedProviders, popularProviders, otherProviders } = useMemo(() => {
    if (!providers) return { connectedProviders: [], popularProviders: [], otherProviders: [] };
    const q = searchQuery.toLowerCase();
    const filtered = providers.all.filter((p) => {
      const label = getProviderLabel(p.id, p.name).toLowerCase();
      return !q || label.includes(q) || p.id.includes(q);
    });

    const connected = filtered.filter((p) => connectedSet.has(p.id));
    const popular = filtered.filter((p) => !connectedSet.has(p.id) && POPULAR_IDS.has(p.id));
    const other = filtered.filter((p) => !connectedSet.has(p.id) && !POPULAR_IDS.has(p.id));

    return { connectedProviders: connected, popularProviders: popular, otherProviders: other };
  }, [providers, searchQuery, connectedSet]);

  // Connect
  const openConnect = useCallback((provider: ProviderInfo) => {
    setConnectTarget(provider);
    setApiKey('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    connectSheetRef.current?.present();
  }, []);

  const handleConnect = useCallback(async () => {
    if (!sandboxUrl || !connectTarget || !apiKey.trim()) return;
    setIsSaving(true);
    try {
      await connectProvider(sandboxUrl, connectTarget.id, apiKey.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      connectSheetRef.current?.dismiss();
      refetch();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setIsSaving(false);
    }
  }, [sandboxUrl, connectTarget, apiKey, refetch]);

  // Disconnect
  const openDisconnect = useCallback((provider: ProviderInfo) => {
    setDisconnectTarget(provider);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    disconnectSheetRef.current?.present();
  }, []);

  const handleDisconnect = useCallback(async () => {
    if (!sandboxUrl || !disconnectTarget) return;
    setIsDisconnecting(true);
    try {
      await disconnectProvider(sandboxUrl, disconnectTarget.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      disconnectSheetRef.current?.dismiss();
      refetch();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setIsDisconnecting(false);
    }
  }, [sandboxUrl, disconnectTarget, refetch]);

  // Section header
  const SectionHeader = ({ title }: { title: string }) => (
    <View style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)' }}>
      <Text style={{ fontSize: 11, fontFamily: 'Roobert-Medium', color: mutedColor, textTransform: 'uppercase', letterSpacing: 1 }}>{title}</Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: bgColor }}>
      {/* Header */}
      <View style={{ paddingTop: insets.top + 8, paddingBottom: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: borderColor }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {onOpenDrawer && (
              <TouchableOpacity onPress={onOpenDrawer} style={{ marginRight: 12 }}>
                <Ionicons name="menu-outline" size={22} color={fgColor} />
              </TouchableOpacity>
            )}
            <View>
              <Text style={{ fontSize: 17, fontFamily: 'Roobert-SemiBold', color: fgColor, lineHeight: 18, includeFontPadding: false }}>LLM Providers</Text>
              <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: mutedColor, marginTop: -3, includeFontPadding: false }}>
                {connectedSet.size} connected
              </Text>
            </View>
          </View>
          {onOpenRightDrawer && (
            <TouchableOpacity onPress={onOpenRightDrawer}>
              <Ionicons name="apps-outline" size={22} color={fgColor} />
            </TouchableOpacity>
          )}
        </View>

        <View style={{ marginTop: 12 }}>
          <SearchBar value={searchQuery} onChangeText={setSearchQuery} placeholder="Search providers" onClear={() => setSearchQuery('')} />
        </View>
      </View>

      {/* List */}
      <ScrollView
        style={{ flex: 1 }}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={() => refetch()} tintColor={mutedColor} />}
      >
        {isLoading && !providers && (
          <View style={{ padding: 40, alignItems: 'center' }}>
            <ActivityIndicator size="large" color={mutedColor} />
          </View>
        )}

        {/* Connected */}
        {connectedProviders.length > 0 && (
          <>
            <SectionHeader title={`Connected (${connectedProviders.length})`} />
            {connectedProviders.map((p) => (
              <ProviderRow key={p.id} provider={p} isConnected isDark={isDark} onConnect={openConnect} onDisconnect={openDisconnect} />
            ))}
          </>
        )}

        {/* Popular */}
        {popularProviders.length > 0 && (
          <>
            <SectionHeader title="Popular" />
            {popularProviders.map((p) => (
              <ProviderRow key={p.id} provider={p} isConnected={false} isDark={isDark} onConnect={openConnect} onDisconnect={openDisconnect} />
            ))}
          </>
        )}

        {/* Other */}
        {otherProviders.length > 0 && (
          <>
            <SectionHeader title="Other" />
            {otherProviders.map((p) => (
              <ProviderRow key={p.id} provider={p} isConnected={false} isDark={isDark} onConnect={openConnect} onDisconnect={openDisconnect} />
            ))}
          </>
        )}

        {/* Empty */}
        {!isLoading && providers && connectedProviders.length === 0 && popularProviders.length === 0 && otherProviders.length === 0 && (
          <View style={{ padding: 40, alignItems: 'center' }}>
            <Cpu size={32} color={mutedColor} style={{ marginBottom: 12, opacity: 0.5 }} />
            <Text style={{ fontSize: 14, fontFamily: 'Roobert-Medium', color: mutedColor }}>
              {searchQuery ? 'No providers match your search' : 'No providers available'}
            </Text>
          </View>
        )}

        <View style={{ height: insets.bottom + 80 }} />
      </ScrollView>

      {/* ── Connect Sheet ── */}
      <BottomSheetModal
        ref={connectSheetRef}
        enableDynamicSizing
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
        onDismiss={() => { setConnectTarget(null); setApiKey(''); }}
        {...sheetStyles}
      >
        <BottomSheetView style={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 20) + 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
              <Text style={{ fontSize: 16, fontFamily: 'Roobert-SemiBold', color: fgColor }}>
                {connectTarget ? getProviderLabel(connectTarget.id, connectTarget.name).slice(0, 2).toUpperCase() : ''}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 18, fontFamily: 'Roobert-SemiBold', color: fgColor }}>
                Connect {connectTarget ? getProviderLabel(connectTarget.id, connectTarget.name) : ''}
              </Text>
              <Text style={{ fontSize: 12, fontFamily: 'Roobert', color: mutedColor, marginTop: 2 }}>Enter your API key</Text>
            </View>
          </View>

          <BottomSheetTextInput
            value={apiKey}
            onChangeText={setApiKey}
            placeholder="sk-..."
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            secureTextEntry
            returnKeyType="done"
            onSubmitEditing={handleConnect}
            placeholderTextColor={mutedColor}
            style={{
              borderWidth: 1, borderColor: inputBorder, borderRadius: 14,
              paddingHorizontal: 16, paddingVertical: 14, fontSize: 16,
              fontFamily: monoFont, color: fgColor, marginBottom: 20,
            }}
          />

          <BottomSheetTouchable
            onPress={handleConnect}
            disabled={!apiKey.trim() || isSaving}
            style={{
              backgroundColor: apiKey.trim() ? fgColor : (isDark ? 'rgba(248,248,248,0.08)' : 'rgba(18,18,21,0.06)'),
              borderRadius: 14, paddingVertical: 15, alignItems: 'center',
              opacity: apiKey.trim() && !isSaving ? 1 : 0.5,
            }}
          >
            <Text style={{ fontSize: 16, fontFamily: 'Roobert-SemiBold', color: apiKey.trim() ? bgColor : mutedColor }}>
              {isSaving ? 'Connecting...' : 'Connect'}
            </Text>
          </BottomSheetTouchable>
        </BottomSheetView>
      </BottomSheetModal>

      {/* ── Disconnect Sheet ── */}
      <BottomSheetModal
        ref={disconnectSheetRef}
        enableDynamicSizing
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        onDismiss={() => setDisconnectTarget(null)}
        {...sheetStyles}
      >
        <BottomSheetView style={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 20) + 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: isDark ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.06)', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
              <Unplug size={20} color={isDark ? '#f87171' : '#dc2626'} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 18, fontFamily: 'Roobert-SemiBold', color: fgColor }}>Disconnect Provider</Text>
              <Text style={{ fontSize: 12, fontFamily: 'Roobert', color: mutedColor, marginTop: 2 }}>
                {disconnectTarget ? getProviderLabel(disconnectTarget.id, disconnectTarget.name) : ''}
              </Text>
            </View>
          </View>

          <Text style={{ fontSize: 13, fontFamily: 'Roobert', color: mutedColor, lineHeight: 19, marginBottom: 20 }}>
            You'll need to re-enter your API key to use this provider again.
          </Text>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <BottomSheetTouchable
              onPress={() => disconnectSheetRef.current?.dismiss()}
              style={{ flex: 1, borderRadius: 14, paddingVertical: 15, alignItems: 'center', borderWidth: 1, borderColor }}
            >
              <Text style={{ fontSize: 16, fontFamily: 'Roobert-SemiBold', color: fgColor }}>Cancel</Text>
            </BottomSheetTouchable>
            <BottomSheetTouchable
              onPress={handleDisconnect}
              disabled={isDisconnecting}
              style={{ flex: 1, borderRadius: 14, paddingVertical: 15, alignItems: 'center', backgroundColor: isDark ? '#dc2626' : '#ef4444', opacity: isDisconnecting ? 0.5 : 1 }}
            >
              <Text style={{ fontSize: 16, fontFamily: 'Roobert-SemiBold', color: '#FFFFFF' }}>
                {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
              </Text>
            </BottomSheetTouchable>
          </View>
        </BottomSheetView>
      </BottomSheetModal>
    </View>
  );
}
