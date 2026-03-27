/**
 * TunnelPage — full-screen tunnel connection management.
 * Create, list, manage, and delete tunnel connections.
 * Matches frontend /tunnel functionality.
 */

import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  FlatList,
  Pressable,
  Alert,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { Text as RNText } from 'react-native';
import {
  Plus,
  Trash2,
  Copy,
  Check,
  Shield,
  Cable,
  Wifi,
  WifiOff,
  Monitor,
  Terminal,
  HardDrive,
  ChevronRight,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  RefreshCw,
} from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetTextInput,
  BottomSheetBackdrop,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';

import { useThemeColors } from '@/lib/theme-colors';
import type { PageTab } from '@/stores/tab-store';
import {
  useTunnelConnections,
  useTunnelConnection,
  useCreateTunnelConnection,
  useDeleteTunnelConnection,
  useGrantTunnelPermission,
  useTunnelPermissions,
  useRevokeTunnelPermission,
  useTunnelAuditLogs,
  SCOPE_REGISTRY,
  formatRelativeTime,
  formatTunnelDate,
  type TunnelConnection,
  type TunnelConnectionCreateResponse,
  type ScopeInfo,
} from '@/hooks/useTunnel';
import { API_URL } from '@/api/config';

// ─── Tab Page Wrapper ────────────────────────────────────────────────────────

interface TunnelTabPageProps {
  page: PageTab;
  onBack: () => void;
  onOpenDrawer?: () => void;
  onOpenRightDrawer?: () => void;
}

export function TunnelTabPage({
  page,
  onBack,
  onOpenDrawer,
  onOpenRightDrawer,
}: TunnelTabPageProps) {
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
      <TunnelContent />
    </View>
  );
}

// ─── Scope helpers ──────────────────────────────────────────────────────────

function groupBy<T>(arr: T[], fn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of arr) {
    const key = fn(item);
    (result[key] ||= []).push(item);
  }
  return result;
}

const SCOPE_GROUPS = groupBy(SCOPE_REGISTRY, (s) => s.category);

// ─── Main Content ───────────────────────────────────────────────────────────

function TunnelContent() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const theme = useThemeColors();

  const { data: connections = [], isLoading, refetch } = useTunnelConnections();
  const deleteMutation = useDeleteTunnelConnection();

  const [selectedTunnel, setSelectedTunnel] = useState<TunnelConnection | null>(null);

  const createSheetRef = useRef<BottomSheetModal>(null);
  const detailSheetRef = useRef<BottomSheetModal>(null);

  const fg = isDark ? '#f8f8f8' : '#121215';
  const muted = isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)';
  const subtleBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)';
  const borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const cardBg = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.01)';
  const onlineBg = isDark ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.08)';
  const onlineColor = isDark ? '#34d399' : '#059669';

  const renderBackdrop = useCallback(
    (props: any) => <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />,
    [],
  );

  const handleOpenCreate = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    createSheetRef.current?.present();
  }, []);

  const handleOpenDetail = useCallback((tunnel: TunnelConnection) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedTunnel(tunnel);
    requestAnimationFrame(() => {
      detailSheetRef.current?.present();
    });
  }, []);

  const handleDelete = useCallback((tunnel: TunnelConnection) => {
    Alert.alert(
      'Delete Connection',
      `Delete "${tunnel.name}"? This will remove all permissions and audit logs.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteMutation.mutateAsync(tunnel.tunnelId);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              detailSheetRef.current?.dismiss();
            } catch (err) {
              Alert.alert('Error', err instanceof Error ? err.message : 'Failed to delete');
            }
          },
        },
      ],
    );
  }, [deleteMutation]);

  const sorted = useMemo(() => {
    return [...connections].sort((a, b) => {
      if (a.status === 'online' && b.status !== 'online') return -1;
      if (b.status === 'online' && a.status !== 'online') return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [connections]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="small" color={fg} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={sorted}
        keyExtractor={(item) => item.tunnelId}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 80 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={fg} />}
        ListEmptyComponent={
          <View style={{ padding: 60, alignItems: 'center' }}>
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 20,
                backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}
            >
              <Cable size={28} color={muted} />
            </View>
            <RNText style={{ fontSize: 17, fontFamily: 'Roobert-Medium', color: fg, marginBottom: 6 }}>
              No connections yet
            </RNText>
            <RNText style={{ fontSize: 14, fontFamily: 'Roobert', color: muted, textAlign: 'center', lineHeight: 20, paddingHorizontal: 20 }}>
              Connect your local machine to let your AI agent access files and run commands.
            </RNText>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => handleOpenDetail(item)}
            style={{
              backgroundColor: cardBg,
              borderWidth: 1,
              borderColor,
              borderRadius: 16,
              padding: 16,
              marginBottom: 12,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  backgroundColor: item.status === 'online' ? onlineBg : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'),
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: 12,
                }}
              >
                <Monitor size={18} color={item.status === 'online' ? onlineColor : muted} />
              </View>
              <View style={{ flex: 1 }}>
                <RNText style={{ fontSize: 15, fontFamily: 'Roobert-SemiBold', color: fg }} numberOfLines={1}>
                  {item.name}
                </RNText>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                  <View
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: item.status === 'online' ? onlineColor : muted,
                      marginRight: 6,
                    }}
                  />
                  <RNText style={{ fontSize: 12, fontFamily: 'Roobert', color: item.status === 'online' ? onlineColor : muted }}>
                    {item.status === 'online' ? 'Online' : 'Offline'}
                  </RNText>
                </View>
              </View>
              <ChevronRight size={16} color={muted} />
            </View>

            {/* Machine info */}
            {item.machineInfo && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {item.machineInfo.hostname && (
                  <View style={{ backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <RNText style={{ fontSize: 11, fontFamily: 'Roobert', color: muted }}>
                      {String(item.machineInfo.hostname)}
                    </RNText>
                  </View>
                )}
                {item.machineInfo.platform && (
                  <View style={{ backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <RNText style={{ fontSize: 11, fontFamily: 'Roobert', color: muted }}>
                      {String(item.machineInfo.platform)}
                    </RNText>
                  </View>
                )}
                {item.lastHeartbeatAt && (
                  <View style={{ backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <RNText style={{ fontSize: 11, fontFamily: 'Roobert', color: muted }}>
                      {formatRelativeTime(item.lastHeartbeatAt)}
                    </RNText>
                  </View>
                )}
              </View>
            )}
          </Pressable>
        )}
      />

      {/* FAB */}
      <Pressable
        onPress={handleOpenCreate}
        style={{
          position: 'absolute',
          right: 20,
          bottom: insets.bottom + 20,
          width: 52,
          height: 52,
          borderRadius: 16,
          backgroundColor: theme.primary,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.2,
          shadowRadius: 8,
          elevation: 6,
        }}
      >
        <Plus size={24} color={theme.primaryForeground} />
      </Pressable>

      {/* Create Sheet */}
      <CreateTunnelSheet ref={createSheetRef} renderBackdrop={renderBackdrop} />

      {/* Detail Sheet */}
      <TunnelDetailSheet
        ref={detailSheetRef}
        tunnel={selectedTunnel}
        renderBackdrop={renderBackdrop}
        onDelete={handleDelete}
        onDismiss={() => setSelectedTunnel(null)}
      />
    </View>
  );
}

// ─── Create Tunnel Sheet ────────────────────────────────────────────────────

type CreateStep = 'name' | 'permissions' | 'connect';

const CreateTunnelSheet = React.forwardRef<
  BottomSheetModal,
  { renderBackdrop: (props: any) => JSX.Element }
>(function CreateTunnelSheet({ renderBackdrop }, ref) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const theme = useThemeColors();

  const fg = isDark ? '#f8f8f8' : '#121215';
  const muted = isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)';
  const borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const inputBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)';
  const sheetBg = isDark ? '#161618' : '#FFFFFF';

  const [step, setStep] = useState<CreateStep>('name');
  const [name, setName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(
    new Set(['files:read', 'files:write', 'shell:exec']),
  );
  const [result, setResult] = useState<TunnelConnectionCreateResponse | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  const createMutation = useCreateTunnelConnection();
  const grantMutation = useGrantTunnelPermission();

  const reset = useCallback(() => {
    setStep('name');
    setName('');
    setSelectedScopes(new Set(['files:read', 'files:write', 'shell:exec']));
    setResult(null);
    setIsCreating(false);
    setCopied(false);
  }, []);

  const handleToggleScope = useCallback((key: string) => {
    setSelectedScopes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleCreate = async () => {
    const tunnelName = name.trim() || 'My Machine';
    setIsCreating(true);
    try {
      const capabilities = [
        ...new Set(
          Array.from(selectedScopes)
            .map((key) => SCOPE_REGISTRY.find((s) => s.key === key)?.capability)
            .filter(Boolean) as string[],
        ),
      ];
      const res = await createMutation.mutateAsync({ name: tunnelName, capabilities });

      const scopeEntries = Array.from(selectedScopes)
        .map((key) => SCOPE_REGISTRY.find((s) => s.key === key))
        .filter(Boolean) as ScopeInfo[];

      await Promise.all(
        scopeEntries.map((s) =>
          grantMutation.mutateAsync({
            tunnelId: res.tunnelId,
            capability: s.capability,
            scope: { scope: s.key },
          }),
        ),
      );

      setResult(res);
      setStep('connect');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert('Error', 'Failed to create connection');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopy = useCallback(async () => {
    if (!result) return;
    const apiUrl = `${API_URL}/tunnel`;
    const cmd = `npx @kortix/agent-tunnel connect --tunnel-id ${result.tunnelId} --token ${result.setupToken} --api-url ${apiUrl}`;
    await Clipboard.setStringAsync(cmd);
    setCopied(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setCopied(false), 2500);
  }, [result]);

  return (
    <BottomSheetModal
      ref={ref}
      enableDynamicSizing
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      onDismiss={reset}
      backgroundStyle={{ backgroundColor: sheetBg, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}
      handleIndicatorStyle={{ backgroundColor: isDark ? '#3F3F46' : '#D4D4D8', width: 36, height: 5, borderRadius: 3 }}
    >
      <BottomSheetScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 20) + 16 }}>
        {/* Step indicator */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', marginBottom: 24 }}>
          {([
            { key: 'name' as const, label: 'Name' },
            { key: 'permissions' as const, label: 'Permissions' },
            { key: 'connect' as const, label: 'Connect' },
          ]).map(({ key: s, label }, i) => {
            const stepIndex = ['name', 'permissions', 'connect'].indexOf(step);
            const isCompleted = i < stepIndex;
            const isCurrent = i === stepIndex;

            return (
              <React.Fragment key={s}>
                {i > 0 && (
                  <View style={{ width: 40, height: 1, backgroundColor: isCompleted ? theme.primary : borderColor, marginTop: 13 }} />
                )}
                <View style={{ alignItems: 'center', width: 72 }}>
                  <View
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 13,
                      backgroundColor: isCompleted || isCurrent ? theme.primary : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {isCompleted ? (
                      <Check size={13} color={theme.primaryForeground} />
                    ) : (
                      <RNText style={{ fontSize: 12, fontFamily: 'Roobert-Medium', color: isCurrent ? theme.primaryForeground : muted }}>
                        {i + 1}
                      </RNText>
                    )}
                  </View>
                  <RNText style={{ fontSize: 11, fontFamily: 'Roobert-Medium', color: isCurrent ? fg : muted, marginTop: 5 }}>
                    {label}
                  </RNText>
                </View>
              </React.Fragment>
            );
          })}
        </View>

        {isCreating ? (
          <View style={{ alignItems: 'center', paddingVertical: 40 }}>
            <ActivityIndicator size="small" color={theme.primary} />
            <RNText style={{ fontSize: 14, fontFamily: 'Roobert-Medium', color: fg, marginTop: 12 }}>Creating connection...</RNText>
          </View>
        ) : step === 'name' ? (
          <>
            {/* Icon */}
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', alignItems: 'center', justifyContent: 'center' }}>
                <Monitor size={22} color={muted} />
              </View>
            </View>
            <RNText style={{ fontSize: 16, fontFamily: 'Roobert-SemiBold', color: fg, textAlign: 'center', marginBottom: 4 }}>
              Name your machine
            </RNText>
            <RNText style={{ fontSize: 13, fontFamily: 'Roobert', color: muted, textAlign: 'center', marginBottom: 20 }}>
              A friendly label for this connection.
            </RNText>
            <BottomSheetTextInput
              value={name}
              onChangeText={setName}
              placeholder="My Machine"
              placeholderTextColor={isDark ? 'rgba(248,248,248,0.25)' : 'rgba(18,18,21,0.3)'}
              style={{
                backgroundColor: inputBg,
                borderWidth: 1,
                borderColor,
                borderRadius: 14,
                paddingHorizontal: 16,
                paddingVertical: 14,
                fontSize: 16,
                fontFamily: 'Roobert',
                color: fg,
                marginBottom: 20,
              }}
            />
            <Pressable
              onPress={() => setStep('permissions')}
              style={{
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                paddingVertical: 14,
                borderRadius: 14,
                backgroundColor: theme.primary,
              }}
            >
              <RNText style={{ fontSize: 16, fontFamily: 'Roobert-Medium', color: theme.primaryForeground }}>Continue</RNText>
              <ArrowRight size={16} color={theme.primaryForeground} style={{ marginLeft: 6 }} />
            </Pressable>
          </>
        ) : step === 'permissions' ? (
          <>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: isDark ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.08)', alignItems: 'center', justifyContent: 'center' }}>
                <Shield size={22} color={isDark ? '#818cf8' : '#6366f1'} />
              </View>
            </View>
            <RNText style={{ fontSize: 16, fontFamily: 'Roobert-SemiBold', color: fg, textAlign: 'center', marginBottom: 4 }}>
              Permissions
            </RNText>
            <RNText style={{ fontSize: 13, fontFamily: 'Roobert', color: muted, textAlign: 'center', marginBottom: 20 }}>
              Choose what your AI agent can access.
            </RNText>

            {Object.entries(SCOPE_GROUPS).map(([category, scopes]) => (
              <View key={category} style={{ marginBottom: 16 }}>
                <RNText style={{ fontSize: 11, fontFamily: 'Roobert-SemiBold', color: muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                  {category}
                </RNText>
                {scopes.map((scope) => {
                  const enabled = selectedScopes.has(scope.key);
                  return (
                    <Pressable
                      key={scope.key}
                      onPress={() => handleToggleScope(scope.key)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingVertical: 10,
                        paddingHorizontal: 12,
                        borderRadius: 10,
                        marginBottom: 4,
                        backgroundColor: enabled ? (isDark ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.06)') : 'transparent',
                        borderWidth: 1,
                        borderColor: enabled ? (isDark ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.15)') : 'transparent',
                      }}
                    >
                      <View
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 4,
                          borderWidth: 2,
                          borderColor: enabled ? theme.primary : (isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)'),
                          backgroundColor: enabled ? theme.primary : 'transparent',
                          alignItems: 'center',
                          justifyContent: 'center',
                          marginRight: 12,
                        }}
                      >
                        {enabled && <Check size={12} color={theme.primaryForeground} />}
                      </View>
                      <View style={{ flex: 1 }}>
                        <RNText style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: fg }}>{scope.label}</RNText>
                        <RNText style={{ fontSize: 11, fontFamily: 'Roobert', color: muted, marginTop: 1 }}>{scope.description}</RNText>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ))}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <Pressable
                onPress={() => setStep('name')}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  paddingVertical: 14,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor,
                }}
              >
                <ArrowLeft size={16} color={fg} style={{ marginRight: 6 }} />
                <RNText style={{ fontSize: 16, fontFamily: 'Roobert-Medium', color: fg }}>Back</RNText>
              </Pressable>
              <Pressable
                onPress={handleCreate}
                disabled={selectedScopes.size === 0}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  paddingVertical: 14,
                  borderRadius: 14,
                  backgroundColor: selectedScopes.size > 0 ? theme.primary : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
                }}
              >
                <RNText style={{ fontSize: 16, fontFamily: 'Roobert-Medium', color: selectedScopes.size > 0 ? theme.primaryForeground : muted }}>
                  Create
                </RNText>
                {selectedScopes.size > 0 && <ArrowRight size={16} color={theme.primaryForeground} style={{ marginLeft: 6 }} />}
              </Pressable>
            </View>
          </>
        ) : result ? (
          <>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: isDark ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.08)', alignItems: 'center', justifyContent: 'center' }}>
                <Terminal size={22} color={isDark ? '#34d399' : '#059669'} />
              </View>
            </View>
            <RNText style={{ fontSize: 16, fontFamily: 'Roobert-SemiBold', color: fg, textAlign: 'center', marginBottom: 4 }}>
              Run this command
            </RNText>
            <RNText style={{ fontSize: 13, fontFamily: 'Roobert', color: muted, textAlign: 'center', marginBottom: 16 }}>
              Connect <RNText style={{ fontFamily: 'Roobert-SemiBold', color: fg }}>{result.name}</RNText> by running this in your terminal.
            </RNText>

            {/* Command box */}
            <Pressable
              onPress={handleCopy}
              style={{
                backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                borderWidth: 1,
                borderColor,
                borderRadius: 12,
                padding: 14,
                paddingRight: 32,
                marginBottom: 12,
              }}
            >
              <RNText style={{ fontSize: 11, fontFamily: 'monospace', lineHeight: 18 }} selectable>
                <RNText style={{ color: isDark ? '#34d399' : '#059669', fontFamily: 'monospace', fontWeight: '600' }}>npx</RNText>
                <RNText style={{ color: isDark ? '#7dd3fc' : '#0369a1', fontFamily: 'monospace' }}> @kortix/agent-tunnel</RNText>
                <RNText style={{ color: isDark ? '#7dd3fc' : '#0369a1', fontFamily: 'monospace' }}> connect</RNText>
                {'\n'}
                <RNText style={{ color: isDark ? '#fcd34d' : '#92400e', fontFamily: 'monospace' }}>  --tunnel-id</RNText>
                <RNText style={{ color: isDark ? 'rgba(248,248,248,0.8)' : 'rgba(18,18,21,0.8)', fontFamily: 'monospace' }}> {result.tunnelId}</RNText>
                {'\n'}
                <RNText style={{ color: isDark ? '#fcd34d' : '#92400e', fontFamily: 'monospace' }}>  --token</RNText>
                <RNText style={{ color: isDark ? '#fda4af' : '#9f1239', fontFamily: 'monospace' }}> {result.setupToken}</RNText>
                {'\n'}
                <RNText style={{ color: isDark ? '#fcd34d' : '#92400e', fontFamily: 'monospace' }}>  --api-url</RNText>
                <RNText style={{ color: isDark ? '#67e8f9' : '#0e7490', fontFamily: 'monospace' }}> {API_URL}/tunnel</RNText>
              </RNText>
              <View style={{ position: 'absolute', top: 10, right: 10 }}>
                {copied ? (
                  <Check size={14} color={isDark ? '#34d399' : '#059669'} />
                ) : (
                  <Copy size={14} color={muted} />
                )}
              </View>
            </Pressable>

            {/* Warning */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                backgroundColor: isDark ? 'rgba(251,191,36,0.08)' : 'rgba(251,191,36,0.1)',
                borderWidth: 1,
                borderColor: isDark ? 'rgba(251,191,36,0.2)' : 'rgba(251,191,36,0.3)',
                borderRadius: 10,
                padding: 12,
                marginBottom: 16,
                gap: 8,
              }}
            >
              <AlertTriangle size={14} color={isDark ? '#fbbf24' : '#d97706'} style={{ marginTop: 1 }} />
              <View style={{ flex: 1 }}>
                <RNText style={{ fontSize: 12, fontFamily: 'Roobert-SemiBold', color: isDark ? '#fde68a' : '#92400e' }}>Important</RNText>
                <RNText style={{ fontSize: 12, fontFamily: 'Roobert', color: isDark ? 'rgba(253,230,138,0.8)' : '#92400e', marginTop: 2 }}>
                  Save this command now — the setup token is shown only once.
                </RNText>
              </View>
            </View>

            <Pressable
              onPress={handleCopy}
              style={{
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                paddingVertical: 14,
                borderRadius: 14,
                backgroundColor: theme.primary,
              }}
            >
              {copied ? (
                <Check size={18} color={theme.primaryForeground} />
              ) : (
                <>
                  <Copy size={16} color={theme.primaryForeground} style={{ marginRight: 8 }} />
                  <RNText style={{ fontSize: 16, fontFamily: 'Roobert-Medium', color: theme.primaryForeground }}>Copy Command</RNText>
                </>
              )}
            </Pressable>
          </>
        ) : null}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

// ─── Tunnel Detail Sheet ────────────────────────────────────────────────────

interface TunnelDetailSheetProps {
  tunnel: TunnelConnection | null;
  renderBackdrop: (props: any) => JSX.Element;
  onDelete: (tunnel: TunnelConnection) => void;
  onDismiss: () => void;
}

const TunnelDetailSheet = React.forwardRef<BottomSheetModal, TunnelDetailSheetProps>(
  function TunnelDetailSheet({ tunnel, renderBackdrop, onDelete, onDismiss }, ref) {
    const { colorScheme } = useColorScheme();
    const isDark = colorScheme === 'dark';
    const insets = useSafeAreaInsets();
    const theme = useThemeColors();

    const fg = isDark ? '#f8f8f8' : '#121215';
    const muted = isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)';
    const borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
    const sheetBg = isDark ? '#161618' : '#FFFFFF';
    const onlineColor = isDark ? '#34d399' : '#059669';
    const dangerBg = isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.05)';
    const dangerBorder = isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)';

    const { data: permissions = [] } = useTunnelPermissions(tunnel?.tunnelId ?? '');
    const { data: auditPage } = useTunnelAuditLogs(tunnel?.tunnelId ?? '', 1, 20);
    const auditLogs = auditPage?.data ?? [];

    if (!tunnel) return null;

    const isOnline = tunnel.status === 'online';

    return (
      <BottomSheetModal
        ref={ref}
        enableDynamicSizing
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        onDismiss={onDismiss}
        backgroundStyle={{ backgroundColor: sheetBg, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}
        handleIndicatorStyle={{ backgroundColor: isDark ? '#3F3F46' : '#D4D4D8', width: 36, height: 5, borderRadius: 3 }}
      >
        <BottomSheetScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 20) + 16 }}>
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                backgroundColor: isOnline ? (isDark ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.08)') : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'),
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 14,
              }}
            >
              <Monitor size={22} color={isOnline ? onlineColor : muted} />
            </View>
            <View style={{ flex: 1 }}>
              <RNText style={{ fontSize: 17, fontFamily: 'Roobert-SemiBold', color: fg }}>{tunnel.name}</RNText>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: isOnline ? onlineColor : muted, marginRight: 6 }} />
                <RNText style={{ fontSize: 13, fontFamily: 'Roobert', color: isOnline ? onlineColor : muted }}>
                  {isOnline ? 'Online' : 'Offline'}
                </RNText>
                {tunnel.lastHeartbeatAt && (
                  <RNText style={{ fontSize: 12, fontFamily: 'Roobert', color: muted, marginLeft: 8 }}>
                    {formatRelativeTime(tunnel.lastHeartbeatAt)}
                  </RNText>
                )}
              </View>
            </View>
          </View>

          {/* Connection Info */}
          <View style={{ borderWidth: 1, borderColor, borderRadius: 14, padding: 14, marginBottom: 16 }}>
            <RNText style={{ fontSize: 12, fontFamily: 'Roobert-SemiBold', color: muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
              Connection Info
            </RNText>
            {[
              ['ID', tunnel.tunnelId.slice(0, 12) + '...'],
              ['Hostname', tunnel.machineInfo?.hostname ? String(tunnel.machineInfo.hostname) : '—'],
              ['Platform', tunnel.machineInfo?.platform ? String(tunnel.machineInfo.platform) : '—'],
              ['Capabilities', tunnel.capabilities.length > 0 ? tunnel.capabilities.join(', ') : 'None'],
              ['Created', formatTunnelDate(tunnel.createdAt)],
            ].map(([label, value]) => (
              <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
                <RNText style={{ fontSize: 13, fontFamily: 'Roobert', color: muted }}>{label}</RNText>
                <RNText style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: fg }} numberOfLines={1}>{value}</RNText>
              </View>
            ))}
          </View>

          {/* Permissions */}
          <View style={{ borderWidth: 1, borderColor, borderRadius: 14, padding: 14, marginBottom: 16 }}>
            <RNText style={{ fontSize: 12, fontFamily: 'Roobert-SemiBold', color: muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
              Permissions ({permissions.filter((p) => p.status === 'active').length})
            </RNText>
            {permissions.filter((p) => p.status === 'active').length === 0 ? (
              <RNText style={{ fontSize: 13, fontFamily: 'Roobert', color: muted, textAlign: 'center', paddingVertical: 8 }}>
                No active permissions
              </RNText>
            ) : (
              permissions
                .filter((p) => p.status === 'active')
                .map((p) => (
                  <View key={p.permissionId} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: onlineColor, marginRight: 8 }} />
                    <RNText style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: fg, flex: 1 }}>{p.capability}</RNText>
                    {p.expiresAt && (
                      <RNText style={{ fontSize: 11, fontFamily: 'Roobert', color: muted }}>
                        Expires {formatTunnelDate(p.expiresAt)}
                      </RNText>
                    )}
                  </View>
                ))
            )}
          </View>

          {/* Recent Activity */}
          {auditLogs.length > 0 && (
            <View style={{ borderWidth: 1, borderColor, borderRadius: 14, padding: 14, marginBottom: 16 }}>
              <RNText style={{ fontSize: 12, fontFamily: 'Roobert-SemiBold', color: muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                Recent Activity
              </RNText>
              {auditLogs.slice(0, 5).map((log) => (
                <View key={log.logId} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: log.success ? onlineColor : '#ef4444', marginRight: 8 }} />
                  <RNText style={{ fontSize: 13, fontFamily: 'Roobert', color: fg, flex: 1 }} numberOfLines={1}>{log.operation}</RNText>
                  {log.durationMs != null && (
                    <RNText style={{ fontSize: 11, fontFamily: 'Roobert', color: muted }}>{log.durationMs}ms</RNText>
                  )}
                </View>
              ))}
            </View>
          )}

          {/* Danger Zone */}
          <View style={{ backgroundColor: dangerBg, borderWidth: 1, borderColor: dangerBorder, borderRadius: 14, padding: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
              <AlertTriangle size={14} color="#ef4444" style={{ marginRight: 8 }} />
              <RNText style={{ fontSize: 13, fontFamily: 'Roobert-SemiBold', color: '#ef4444' }}>Danger Zone</RNText>
            </View>
            <Pressable
              onPress={() => onDelete(tunnel)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                paddingVertical: 10,
                borderRadius: 10,
                backgroundColor: isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.1)',
              }}
            >
              <Trash2 size={14} color="#ef4444" style={{ marginRight: 6 }} />
              <RNText style={{ fontSize: 14, fontFamily: 'Roobert-Medium', color: '#ef4444' }}>Delete Connection</RNText>
            </Pressable>
          </View>
        </BottomSheetScrollView>
      </BottomSheetModal>
    );
  },
);
