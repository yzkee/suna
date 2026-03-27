/**
 * ApiKeysPage — full-screen API keys management.
 * Create, list, revoke, delete, regenerate sandbox tokens.
 * Matches frontend /settings/api-keys functionality.
 */

import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  FlatList,
  Pressable,
  Alert,
  ActivityIndicator,
  StyleSheet,
  Keyboard,
  TouchableOpacity,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { Text as RNText } from 'react-native';
import {
  Key,
  Plus,
  Trash2,
  Copy,
  Check,
  Shield,
  RefreshCw,
  Bot,
  AlertCircle,
} from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { BottomSheetModal, BottomSheetView, BottomSheetTextInput, BottomSheetBackdrop } from '@gorhom/bottom-sheet';

import { useThemeColors } from '@/lib/theme-colors';
import { useSandboxContext } from '@/contexts/SandboxContext';
import type { PageTab } from '@/stores/tab-store';
import {
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
  useDeleteApiKey,
  useRegenerateApiKey,
  isKeyExpired,
  formatKeyDate,
  type APIKeyResponse,
  type APIKeyCreateResponse,
  type APIKeyRegenerateResponse,
  type APIKeyStatus,
} from '@/hooks/useApiKeys';

// ─── Tab Page Wrapper ────────────────────────────────────────────────────────

interface ApiKeysTabPageProps {
  page: PageTab;
  onBack: () => void;
  onOpenDrawer?: () => void;
  onOpenRightDrawer?: () => void;
}

export function ApiKeysTabPage({
  page,
  onBack,
  onOpenDrawer,
  onOpenRightDrawer,
}: ApiKeysTabPageProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const fgColor = isDark ? '#F8F8F8' : '#121215';

  return (
    <View style={{ flex: 1, backgroundColor: isDark ? '#121215' : '#F8F8F8' }}>
      <View style={{ paddingTop: insets.top, paddingHorizontal: 16, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={onOpenDrawer} style={{ marginRight: 12, padding: 4 }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="menu" size={24} color={fgColor} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <RNText style={{ fontSize: 18, fontFamily: 'Roobert-SemiBold', color: fgColor }} numberOfLines={1}>
              {page.label}
            </RNText>
          </View>
          <TouchableOpacity onPress={onOpenRightDrawer} style={{ marginLeft: 12, padding: 4 }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="apps-outline" size={20} color={fgColor} />
          </TouchableOpacity>
        </View>
      </View>
      <ApiKeysContent />
    </View>
  );
}

// ─── Main Content ────────────────────────────────────────────────────────────

function ApiKeysContent() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const theme = useThemeColors();
  const { sandboxUuid } = useSandboxContext();

  const { data: allKeys, isLoading, error, refetch } = useApiKeys();
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();
  const deleteKey = useDeleteApiKey();
  const regenerateKey = useRegenerateApiKey();

  const [createdKey, setCreatedKey] = useState<APIKeyCreateResponse | APIKeyRegenerateResponse | null>(null);

  const createSheetRef = useRef<BottomSheetModal>(null);
  const secretSheetRef = useRef<BottomSheetModal>(null);

  const fg = isDark ? '#f8f8f8' : '#121215';
  const muted = isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)';
  const subtleBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)';
  const borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';

  // Separate sandbox vs user keys
  const { sandboxKeys, userKeys } = useMemo(() => {
    const sandbox: APIKeyResponse[] = [];
    const user: APIKeyResponse[] = [];
    for (const k of allKeys || []) {
      if (k.type === 'sandbox') sandbox.push(k);
      else user.push(k);
    }
    return { sandboxKeys: sandbox, userKeys: user };
  }, [allKeys]);

  const activeSandboxKey = sandboxKeys.find((k) => k.status === 'active');

  // ── Handlers ──

  const handleRevoke = useCallback((key: APIKeyResponse) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(
      `Revoke "${key.title}"`,
      'This will immediately invalidate the key. Any applications using it will stop working.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: async () => {
            try {
              await revokeKey.mutateAsync(key.key_id);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch { Alert.alert('Error', 'Failed to revoke key'); }
          },
        },
      ],
    );
  }, [revokeKey]);

  const handleDelete = useCallback((key: APIKeyResponse) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(
      `Delete "${key.title}"`,
      'This will permanently remove the key. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteKey.mutateAsync(key.key_id);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch { Alert.alert('Error', 'Failed to delete key'); }
          },
        },
      ],
    );
  }, [deleteKey]);

  const handleRegenerate = useCallback(() => {
    if (!activeSandboxKey) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(
      'Regenerate Sandbox Token',
      'This will revoke the current token and create a new one. It will be applied to the sandbox automatically.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Regenerate',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await regenerateKey.mutateAsync(activeSandboxKey.key_id);
              setCreatedKey(result);
              secretSheetRef.current?.present();
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch { Alert.alert('Error', 'Failed to regenerate token'); }
          },
        },
      ],
    );
  }, [activeSandboxKey, regenerateKey]);

  const handleOpenCreate = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    createSheetRef.current?.present();
  }, []);

  const renderBackdrop = useCallback(
    (props: any) => <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />,
    [],
  );

  // ── List Data ──

  const listData = useMemo(() => {
    const items: { type: 'sandbox' | 'header' | 'key' | 'empty' | 'hint'; data?: any }[] = [];

    // Sandbox token card
    if (activeSandboxKey) {
      items.push({ type: 'sandbox', data: activeSandboxKey });
    }

    // User keys header
    items.push({ type: 'header' });

    if (userKeys.length === 0) {
      items.push({ type: 'empty' });
    } else {
      for (const k of userKeys) {
        items.push({ type: 'key', data: k });
      }
    }

    // Usage hint
    items.push({ type: 'hint' });

    return items;
  }, [activeSandboxKey, userKeys]);

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={listData}
        keyExtractor={(item, i) => item.type === 'key' ? item.data.key_id : `${item.type}-${i}`}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => {
          switch (item.type) {
            case 'sandbox':
              return (
                <SandboxTokenCard
                  apiKey={item.data}
                  isDark={isDark}
                  isRegenerating={regenerateKey.isPending}
                  onRegenerate={handleRegenerate}
                />
              );
            case 'header':
              return (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginBottom: 8 }}>
                  <Text style={{ fontSize: 11, fontFamily: 'Roobert-Medium', color: muted, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                    Your Keys
                  </Text>
                  <Pressable
                    onPress={handleOpenCreate}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 5,
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      borderRadius: 8,
                      backgroundColor: theme.primary,
                    }}
                  >
                    <Plus size={13} color={theme.primaryForeground} />
                    <Text style={{ fontSize: 12, fontFamily: 'Roobert-Medium', color: theme.primaryForeground }}>
                      Create Key
                    </Text>
                  </Pressable>
                </View>
              );
            case 'key':
              return (
                <ApiKeyRow
                  apiKey={item.data}
                  isDark={isDark}
                  onRevoke={() => handleRevoke(item.data)}
                  onDelete={() => handleDelete(item.data)}
                />
              );
            case 'empty':
              return (
                <View style={{ paddingVertical: 32, paddingHorizontal: 20, alignItems: 'center' }}>
                  <Key size={22} color={muted} />
                  <Text style={{ fontSize: 13, fontFamily: 'Roobert', color: muted, textAlign: 'center', marginTop: 10, lineHeight: 18 }}>
                    No API keys yet. Create a key to access{'\n'}your sandbox programmatically.
                  </Text>
                </View>
              );
            case 'hint':
              return (
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 20, padding: 12, borderRadius: 12, backgroundColor: subtleBg, borderWidth: StyleSheet.hairlineWidth, borderColor }}>
                  <Shield size={14} color={muted} style={{ marginTop: 2 }} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: muted, lineHeight: 16 }}>
                      Pass your key as a Bearer token:
                    </Text>
                    <View style={{ backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start' }}>
                      <Text style={{ fontSize: 11, fontFamily: 'Roobert-Medium', color: fg }}>
                        Authorization: Bearer kortix_...
                      </Text>
                    </View>
                    <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: muted, lineHeight: 16, marginTop: 2 }}>
                      Keys are hashed server-side and never stored in plain text.
                    </Text>
                  </View>
                </View>
              );
            default:
              return null;
          }
        }}
        ListEmptyComponent={
          isLoading ? (
            <View style={{ padding: 60, alignItems: 'center' }}>
              <ActivityIndicator color={muted} />
            </View>
          ) : error ? (
            <View style={{ padding: 40, alignItems: 'center' }}>
              <AlertCircle size={28} color={muted} />
              <Text style={{ fontSize: 14, fontFamily: 'Roobert', color: muted, marginTop: 12, textAlign: 'center' }}>
                Failed to load API keys
              </Text>
              <Pressable onPress={() => refetch()} style={{ marginTop: 12, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}>
                <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: fg }}>Try Again</Text>
              </Pressable>
            </View>
          ) : null
        }
      />

      {/* Create Key Sheet */}
      <CreateApiKeySheet
        sheetRef={createSheetRef}
        isDark={isDark}
        theme={theme}
        renderBackdrop={renderBackdrop}
        sandboxUuid={sandboxUuid}
        onCreated={(result) => {
          setCreatedKey(result);
          secretSheetRef.current?.present();
        }}
      />

      {/* Secret Key Display Sheet */}
      <SecretKeySheet
        sheetRef={secretSheetRef}
        isDark={isDark}
        theme={theme}
        renderBackdrop={renderBackdrop}
        createdKey={createdKey}
        onDone={() => {
          secretSheetRef.current?.dismiss();
          setCreatedKey(null);
        }}
      />
    </View>
  );
}

// ─── Sandbox Token Card ──────────────────────────────────────────────────────

function SandboxTokenCard({
  apiKey,
  isDark,
  isRegenerating,
  onRegenerate,
}: {
  apiKey: APIKeyResponse;
  isDark: boolean;
  isRegenerating: boolean;
  onRegenerate: () => void;
}) {
  const fg = isDark ? '#f8f8f8' : '#121215';
  const muted = isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)';
  const subtleBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)';
  const borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';

  return (
    <View style={{ padding: 14, borderRadius: 14, backgroundColor: subtleBg, borderWidth: StyleSheet.hairlineWidth, borderColor, marginTop: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', alignItems: 'center', justifyContent: 'center' }}>
          <Bot size={16} color={muted} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 14, fontFamily: 'Roobert-Medium', color: fg }}>Sandbox Token</Text>
            <StatusDot status={apiKey.status} isDark={isDark} />
          </View>
        </View>
        <Pressable onPress={onRegenerate} disabled={isRegenerating} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }}>
          {isRegenerating ? (
            <ActivityIndicator size="small" color={muted} />
          ) : (
            <RefreshCw size={12} color={muted} />
          )}
          <Text style={{ fontSize: 12, fontFamily: 'Roobert-Medium', color: muted }}>Regenerate</Text>
        </Pressable>
      </View>
      <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: muted, marginTop: 6, marginLeft: 42 }}>
        Used by the agent inside your sandbox to call the platform API
      </Text>
    </View>
  );
}

// ─── API Key Row ─────────────────────────────────────────────────────────────

function ApiKeyRow({
  apiKey,
  isDark,
  onRevoke,
  onDelete,
}: {
  apiKey: APIKeyResponse;
  isDark: boolean;
  onRevoke: () => void;
  onDelete: () => void;
}) {
  const fg = isDark ? '#f8f8f8' : '#121215';
  const muted = isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)';
  const expired = isKeyExpired(apiKey.expires_at);

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
      }}
    >
      <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', alignItems: 'center', justifyContent: 'center' }}>
        <Key size={14} color={muted} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 14, fontFamily: 'Roobert-Medium', color: fg }} numberOfLines={1}>{apiKey.title}</Text>
          <StatusDot status={apiKey.status} isDark={isDark} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: muted }}>
            {formatKeyDate(apiKey.created_at)}
          </Text>
          {apiKey.expires_at && (
            <>
              <Text style={{ fontSize: 11, color: muted }}>·</Text>
              <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: expired ? '#ca8a04' : muted }}>
                {expired ? 'Expired' : 'Expires'} {formatKeyDate(apiKey.expires_at)}
              </Text>
            </>
          )}
        </View>
      </View>
      <Pressable
        onPress={apiKey.status === 'active' ? onRevoke : onDelete}
        hitSlop={10}
        style={{ padding: 6 }}
      >
        <Trash2 size={15} color={muted} />
      </Pressable>
    </View>
  );
}

// ─── Status Dot ──────────────────────────────────────────────────────────────

function StatusDot({ status, isDark }: { status: APIKeyStatus; isDark: boolean }) {
  const config: Record<APIKeyStatus, { color: string; label: string }> = {
    active: { color: '#34d399', label: 'Active' },
    revoked: { color: '#ef4444', label: 'Revoked' },
    expired: { color: '#ca8a04', label: 'Expired' },
  };
  const c = config[status] || config.active;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: c.color }} />
      <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: c.color }}>{c.label}</Text>
    </View>
  );
}

// ─── Create API Key Sheet ────────────────────────────────────────────────────

function CreateApiKeySheet({
  sheetRef,
  isDark,
  theme,
  renderBackdrop,
  sandboxUuid,
  onCreated,
}: {
  sheetRef: React.RefObject<BottomSheetModal>;
  isDark: boolean;
  theme: ReturnType<typeof useThemeColors>;
  renderBackdrop: (props: any) => React.ReactElement;
  sandboxUuid?: string;
  onCreated: (result: APIKeyCreateResponse) => void;
}) {
  const insets = useSafeAreaInsets();
  const createKey = useCreateApiKey();

  const fg = isDark ? '#f8f8f8' : '#121215';
  const muted = isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)';
  const inputBg = isDark ? 'rgba(248,248,248,0.06)' : 'rgba(18,18,21,0.04)';
  const borderColor = isDark ? 'rgba(248,248,248,0.1)' : 'rgba(18,18,21,0.08)';

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [expiration, setExpiration] = useState<'never' | '7' | '30' | '90' | '365'>('never');

  const reset = () => { setTitle(''); setDescription(''); setExpiration('never'); };

  const handleCreate = async () => {
    if (!title.trim() || !sandboxUuid) return;
    Keyboard.dismiss();
    try {
      const result = await createKey.mutateAsync({
        sandbox_id: sandboxUuid,
        title: title.trim(),
        description: description.trim() || undefined,
        expires_in_days: expiration !== 'never' ? parseInt(expiration) : undefined,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      sheetRef.current?.dismiss();
      reset();
      onCreated(result);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to create API key');
    }
  };

  const inputStyle = {
    backgroundColor: inputBg,
    borderWidth: 1,
    borderColor,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: 'Roobert',
    color: fg,
  };

  const expirationOptions = [
    { value: 'never' as const, label: 'No expiration' },
    { value: '7' as const, label: '7 days' },
    { value: '30' as const, label: '30 days' },
    { value: '90' as const, label: '90 days' },
    { value: '365' as const, label: '1 year' },
  ];

  return (
    <BottomSheetModal
      ref={sheetRef}
      enableDynamicSizing
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      onDismiss={reset}
      backgroundStyle={{ backgroundColor: isDark ? '#161618' : '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24 }}
      handleIndicatorStyle={{ backgroundColor: isDark ? '#3F3F46' : '#D4D4D8', width: 36, height: 5, borderRadius: 3 }}
    >
      <BottomSheetView style={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 20) + 16 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
            <Key size={20} color={fg} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 18, fontFamily: 'Roobert-Semibold', color: fg }}>New API Key</Text>
            <Text style={{ fontSize: 12, fontFamily: 'Roobert', color: muted, marginTop: 2 }}>Create a key for programmatic access</Text>
          </View>
        </View>

        {/* Name */}
        <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: muted, marginBottom: 6 }}>Name</Text>
        <BottomSheetTextInput
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. CI/CD Pipeline"
          placeholderTextColor={isDark ? 'rgba(248,248,248,0.25)' : 'rgba(18,18,21,0.3)'}
          autoFocus
          style={{ ...inputStyle, marginBottom: 16 }}
        />

        {/* Description */}
        <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: muted, marginBottom: 6 }}>Description <Text style={{ fontFamily: 'Roobert', color: muted }}>(optional)</Text></Text>
        <BottomSheetTextInput
          value={description}
          onChangeText={setDescription}
          placeholder="What is this key for?"
          placeholderTextColor={isDark ? 'rgba(248,248,248,0.25)' : 'rgba(18,18,21,0.3)'}
          style={{ ...inputStyle, marginBottom: 16 }}
        />

        {/* Expiration */}
        <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: muted, marginBottom: 6 }}>Expiration</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          {expirationOptions.map((opt) => (
            <Pressable
              key={opt.value}
              onPress={() => setExpiration(opt.value)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 10,
                backgroundColor: expiration === opt.value ? theme.primary : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'),
              }}
            >
              <Text style={{
                fontSize: 13,
                fontFamily: expiration === opt.value ? 'Roobert-Medium' : 'Roobert',
                color: expiration === opt.value ? theme.primaryForeground : muted,
              }}>
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Create button */}
        <Pressable
          onPress={handleCreate}
          disabled={!title.trim() || createKey.isPending}
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: 14,
            borderRadius: 14,
            backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
            ...(!title.trim() ? {} : { backgroundColor: theme.primary }),
          }}
        >
          {createKey.isPending ? (
            <ActivityIndicator size="small" color={theme.primaryForeground} />
          ) : (
            <Text style={{ fontSize: 16, fontFamily: 'Roobert-Medium', color: !title.trim() ? muted : theme.primaryForeground }}>
              Create Key
            </Text>
          )}
        </Pressable>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

// ─── Secret Key Display Sheet ────────────────────────────────────────────────

function SecretKeySheet({
  sheetRef,
  isDark,
  theme,
  renderBackdrop,
  createdKey,
  onDone,
}: {
  sheetRef: React.RefObject<BottomSheetModal>;
  isDark: boolean;
  theme: ReturnType<typeof useThemeColors>;
  renderBackdrop: (props: any) => React.ReactElement;
  createdKey: APIKeyCreateResponse | APIKeyRegenerateResponse | null;
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [copied, setCopied] = useState(false);

  const fg = isDark ? '#f8f8f8' : '#121215';
  const muted = isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)';
  const inputBg = isDark ? 'rgba(248,248,248,0.06)' : 'rgba(18,18,21,0.04)';
  const borderColor = isDark ? 'rgba(248,248,248,0.1)' : 'rgba(18,18,21,0.08)';

  const secretKey = createdKey && 'secret_key' in createdKey ? createdKey.secret_key : '';

  const handleCopy = useCallback(async () => {
    if (!secretKey) return;
    await Clipboard.setStringAsync(secretKey);
    setCopied(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setCopied(false), 2000);
  }, [secretKey]);

  return (
    <BottomSheetModal
      ref={sheetRef}
      enableDynamicSizing
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: isDark ? '#161618' : '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24 }}
      handleIndicatorStyle={{ backgroundColor: isDark ? '#3F3F46' : '#D4D4D8', width: 36, height: 5, borderRadius: 3 }}
    >
      <BottomSheetView style={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 20) + 16 }}>
        <Text style={{ fontSize: 18, fontFamily: 'Roobert-Semibold', color: fg, marginBottom: 4 }}>
          {createdKey?.type === 'sandbox' ? 'Token Regenerated' : 'Key Created'}
        </Text>
        <Text style={{ fontSize: 13, fontFamily: 'Roobert', color: muted, marginBottom: 20 }}>
          {createdKey?.type === 'sandbox'
            ? 'The new token has been applied to your sandbox.'
            : "Copy your secret key now. It won't be shown again."}
        </Text>

        {/* Secret key display */}
        <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: muted, marginBottom: 6 }}>
          {createdKey?.type === 'sandbox' ? 'Sandbox Token' : 'Secret Key'}
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
          <View style={{ flex: 1, backgroundColor: inputBg, borderWidth: 1, borderColor, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 }}>
            <Text style={{ fontSize: 13, fontFamily: 'Roobert', color: fg }} numberOfLines={1} ellipsizeMode="middle">
              {secretKey}
            </Text>
          </View>
          <Pressable
            onPress={handleCopy}
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              backgroundColor: theme.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {copied ? (
              <Check size={18} color={theme.primaryForeground} />
            ) : (
              <Copy size={18} color={theme.primaryForeground} />
            )}
          </Pressable>
        </View>

        {/* Warning */}
        <View style={{ padding: 12, borderRadius: 12, backgroundColor: isDark ? 'rgba(245,158,11,0.08)' : 'rgba(245,158,11,0.06)', borderWidth: 1, borderColor: isDark ? 'rgba(245,158,11,0.15)' : 'rgba(245,158,11,0.12)', marginBottom: 20 }}>
          <Text style={{ fontSize: 12, fontFamily: 'Roobert', color: isDark ? '#fbbf24' : '#b45309', lineHeight: 18 }}>
            Store this key securely. It cannot be retrieved after closing this dialog.
          </Text>
        </View>

        {/* Done button */}
        <Pressable
          onPress={onDone}
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: 14,
            borderRadius: 14,
            backgroundColor: theme.primary,
          }}
        >
          <Text style={{ fontSize: 16, fontFamily: 'Roobert-Medium', color: theme.primaryForeground }}>Done</Text>
        </Pressable>
      </BottomSheetView>
    </BottomSheetModal>
  );
}
