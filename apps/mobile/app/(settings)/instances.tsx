import * as React from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'nativewind';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import {
  Cloud,
  Copy,
  Globe,
  HardDrive,
  Monitor,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Server,
  Square,
  Trash2,
  X,
} from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import { useSandboxContext } from '@/contexts/SandboxContext';
import {
  useInstances,
  useRestartInstance,
  useStopInstance,
  useDeleteInstance,
  useProviders,
  useCreateLocalInstance,
  useCreateCloudInstance,
} from '@/lib/platform/hooks';
import { checkInstanceHealth, type SandboxInfo, type SandboxProviderName } from '@/lib/platform/client';

// ─── Helpers ────────────────────────────────────────────────────────────────

function providerLabel(provider: SandboxProviderName): string {
  switch (provider) {
    case 'local_docker': return 'LOCAL';
    case 'hetzner': return 'CLOUD';
    case 'daytona': return 'CLOUD';
    default: return 'INSTANCE';
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'running': case 'ready': case 'active': return '#34D399';
    case 'stopped': case 'archived': return '#9CA3AF';
    case 'error': case 'failed': return '#EF4444';
    default: return '#FBBF24';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'running': case 'ready': case 'active': return 'Connected';
    case 'stopped': return 'Stopped';
    case 'archived': return 'Archived';
    case 'error': case 'failed': return 'Error';
    default: return status;
  }
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Main Screen ────────────────────────────────────────────────────────────

export default function InstancesScreen() {
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { sandboxId } = useSandboxContext();

  const { data: instances, isLoading, refetch, isRefetching } = useInstances();
  const restartMutation = useRestartInstance();
  const stopMutation = useStopInstance();
  const deleteMutation = useDeleteInstance();

  const addSheetRef = React.useRef<BottomSheetModal>(null);

  const activeInstance = React.useMemo(
    () => instances?.find((i) => i.external_id === sandboxId),
    [instances, sandboxId],
  );

  const handleCopyUrl = React.useCallback((url: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Clipboard.setStringAsync(url);
  }, []);

  const handleRestart = React.useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    restartMutation.mutate(undefined, {
      onSuccess: () => {
        Alert.alert('Restarting', 'Your instance is restarting. This may take a moment.');
        refetch();
      },
      onError: (err: any) => Alert.alert('Error', err?.message || 'Failed to restart'),
    });
  }, [restartMutation, refetch]);

  const handleStop = React.useCallback(() => {
    Alert.alert('Stop Instance', 'Are you sure you want to stop this instance?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Stop',
        style: 'destructive',
        onPress: () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          stopMutation.mutate(undefined, {
            onSuccess: () => refetch(),
            onError: (err: any) => Alert.alert('Error', err?.message || 'Failed to stop'),
          });
        },
      },
    ]);
  }, [stopMutation, refetch]);

  const handleDelete = React.useCallback((instance: SandboxInfo) => {
    Alert.alert(
      'Delete Instance',
      `Are you sure you want to delete "${instance.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            deleteMutation.mutate(instance.sandbox_id, {
              onSuccess: () => refetch(),
              onError: (err: any) => Alert.alert('Error', err?.message || 'Failed to delete'),
            });
          },
        },
      ],
    );
  }, [deleteMutation, refetch]);

  const showActions = React.useCallback((instance: SandboxInfo) => {
    const isActive = instance.external_id === sandboxId;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const options = ['Cancel'];
    if (isActive) { options.push('Restart', 'Stop'); }
    if (!isActive) { options.push('Delete'); }

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: 0, destructiveButtonIndex: !isActive ? options.indexOf('Delete') : -1 },
        (index) => {
          const action = options[index];
          if (action === 'Restart') handleRestart();
          else if (action === 'Stop') handleStop();
          else if (action === 'Delete') handleDelete(instance);
        },
      );
    } else {
      const items = options.slice(1);
      Alert.alert(instance.name, undefined, [
        ...items.map((item) => ({
          text: item,
          style: (item === 'Delete' ? 'destructive' : 'default') as any,
          onPress: () => {
            if (item === 'Restart') handleRestart();
            else if (item === 'Stop') handleStop();
            else if (item === 'Delete') handleDelete(instance);
          },
        })),
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }, [sandboxId, handleRestart, handleStop, handleDelete]);

  const openAddSheet = React.useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    addSheetRef.current?.present();
  }, []);

  const onInstanceAdded = React.useCallback(() => {
    addSheetRef.current?.dismiss();
    refetch();
  }, [refetch]);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="small" />
      </View>
    );
  }

  return (
    <>
      <ScrollView
        className="flex-1 bg-background"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      >
        <View className="px-5 pt-1" style={{ gap: 18 }}>
          {/* Active Instance Detail */}
          {activeInstance && (
            <View className="px-1">
              <Text className="mb-2 text-[11px] font-roobert-medium uppercase tracking-wider text-muted-foreground/80">
                Active Instance
              </Text>
              <View>
                <View className="py-3.5">
                  <View className="flex-row items-center">
                    <View className="h-2.5 w-2.5 rounded-full mr-3" style={{ backgroundColor: statusColor(activeInstance.status) }} />
                    <View className="flex-1">
                      <View className="flex-row items-center">
                        <Text className="font-roobert-medium text-[15px] text-foreground" numberOfLines={1}>
                          {activeInstance.name}
                        </Text>
                        <View className="ml-2 rounded-full bg-emerald-400/15 px-2 py-0.5">
                          <Text className="text-[10px] font-roobert-medium text-emerald-600 dark:text-emerald-400">Active</Text>
                        </View>
                      </View>
                      <Text className="mt-0.5 font-roobert text-xs text-muted-foreground">
                        {statusLabel(activeInstance.status)}{activeInstance.version ? ` · v${activeInstance.version}` : ''}
                      </Text>
                    </View>
                  </View>
                </View>
                <View className="h-px bg-border/35" />

                <Pressable onPress={() => handleCopyUrl(activeInstance.base_url)} className="py-3.5 active:opacity-85">
                  <View className="flex-row items-center">
                    <Icon as={HardDrive} size={18} className="text-foreground/80" strokeWidth={2.2} />
                    <View className="ml-4 flex-1">
                      <Text className="font-roobert-medium text-[15px] text-foreground">Connection URL</Text>
                      <Text className="mt-0.5 font-roobert text-xs text-muted-foreground" numberOfLines={1}>{activeInstance.base_url}</Text>
                    </View>
                    <Icon as={Copy} size={14} className="text-muted-foreground/50" strokeWidth={2.2} />
                  </View>
                </Pressable>
                <View className="h-px bg-border/35" />

                <View className="py-3.5">
                  <View className="flex-row items-center">
                    <Icon as={activeInstance.provider === 'local_docker' ? Monitor : Cloud} size={18} className="text-foreground/80" strokeWidth={2.2} />
                    <View className="ml-4 flex-1">
                      <Text className="font-roobert-medium text-[15px] text-foreground">{providerLabel(activeInstance.provider)} Instance</Text>
                      <Text className="mt-0.5 font-roobert text-xs text-muted-foreground">Created {formatDate(activeInstance.created_at)}</Text>
                    </View>
                  </View>
                </View>
                <View className="h-px bg-border/35" />

                <View className="flex-row py-3.5" style={{ gap: 10 }}>
                  <Pressable onPress={handleRestart} disabled={restartMutation.isPending} className="flex-row items-center rounded-lg bg-muted/60 px-3 py-2 active:opacity-80">
                    <Icon as={RefreshCw} size={12} className="text-foreground mr-1.5" strokeWidth={2.2} />
                    <Text className="font-roobert-medium text-xs text-foreground">{restartMutation.isPending ? 'Restarting...' : 'Restart'}</Text>
                  </Pressable>
                  <Pressable onPress={handleStop} disabled={stopMutation.isPending} className="flex-row items-center rounded-lg bg-destructive/10 px-3 py-2 active:opacity-80">
                    <Icon as={Square} size={12} className="text-destructive mr-1.5" strokeWidth={2.2} />
                    <Text className="font-roobert-medium text-xs text-destructive">{stopMutation.isPending ? 'Stopping...' : 'Stop'}</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          )}

          {/* All Instances */}
          {instances && instances.length > 0 && (
            <View className="px-1">
              <Text className="mb-2 text-[11px] font-roobert-medium uppercase tracking-wider text-muted-foreground/80">
                All Instances
              </Text>
              <View>
                {instances.map((instance, idx) => {
                  const isActive = instance.external_id === sandboxId;
                  const isLast = idx === instances.length - 1;
                  return (
                    <View key={instance.sandbox_id}>
                      <Pressable onPress={() => showActions(instance)} className="py-3.5 active:opacity-85">
                        <View className="flex-row items-center">
                          <View className="h-2.5 w-2.5 rounded-full mr-3" style={{ backgroundColor: statusColor(instance.status) }} />
                          <View className="flex-1">
                            <Text className="font-roobert-medium text-[15px] text-foreground" numberOfLines={1}>{instance.name}</Text>
                            <Text className="mt-0.5 font-roobert text-xs text-muted-foreground">
                              {statusLabel(instance.status)}{instance.version ? ` · v${instance.version}` : ''}
                            </Text>
                          </View>
                          <View className="flex-row items-center" style={{ gap: 6 }}>
                            <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: isDark ? 'rgba(248,248,248,0.06)' : 'rgba(18,18,21,0.05)' }}>
                              <Text className="text-[10px] font-roobert-medium text-muted-foreground">{providerLabel(instance.provider)}</Text>
                            </View>
                            {isActive && (
                              <View className="rounded-full bg-emerald-400/15 px-2 py-0.5">
                                <Text className="text-[10px] font-roobert-medium text-emerald-600 dark:text-emerald-400">Active</Text>
                              </View>
                            )}
                            <Icon as={MoreHorizontal} size={16} className="text-muted-foreground/50" strokeWidth={2.2} />
                          </View>
                        </View>
                      </Pressable>
                      {!isLast && <View className="h-px bg-border/35" />}
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* Empty state */}
          {!isLoading && (!instances || instances.length === 0) && (
            <View className="items-center justify-center py-12">
              <Icon as={Server} size={32} className="text-muted-foreground/40" strokeWidth={1.5} />
              <Text className="mt-3 font-roobert-medium text-[15px] text-foreground">No Instances</Text>
              <Text className="mt-1 text-center font-roobert text-xs text-muted-foreground">
                Tap the button below to add one.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* FAB: New Instance */}
      <View style={{ position: 'absolute', bottom: insets.bottom + 16, left: 20, right: 20 }}>
        <Pressable
          onPress={openAddSheet}
          className="flex-row items-center justify-center rounded-2xl py-3.5 active:opacity-90"
          style={{ backgroundColor: isDark ? '#F8F8F8' : '#121215' }}
        >
          <Icon as={Plus} size={16} className={isDark ? 'text-[#121215]' : 'text-[#F8F8F8]'} strokeWidth={2.5} />
          <Text className={`ml-2 font-roobert-semibold text-[15px] ${isDark ? 'text-[#121215]' : 'text-[#F8F8F8]'}`}>
            New Instance
          </Text>
        </Pressable>
      </View>

      <AddInstanceSheet ref={addSheetRef} isDark={isDark} onCreated={onInstanceAdded} />
    </>
  );
}

// ─── Add Instance Bottom Sheet ──────────────────────────────────────────────

type AddStep = 'select' | 'custom';

const AddInstanceSheet = React.forwardRef<
  BottomSheetModal,
  { isDark: boolean; onCreated: () => void }
>(function AddInstanceSheet({ isDark, onCreated }, ref) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = React.useState<AddStep>('select');
  const [customUrl, setCustomUrl] = React.useState('');
  const [customLabel, setCustomLabel] = React.useState('');
  const [isCreating, setIsCreating] = React.useState(false);

  const { data: providers } = useProviders();
  const createLocalMutation = useCreateLocalInstance();
  const createCloudMutation = useCreateCloudInstance();

  const hasLocalDocker = Array.isArray(providers) && providers.includes('local_docker');
  const fgColor = isDark ? '#f8f8f8' : '#121215';

  const snapPoints = React.useMemo(() => step === 'custom' ? [380] : [320], [step]);

  const renderBackdrop = React.useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.35} />
    ),
    [],
  );

  const resetState = React.useCallback(() => {
    setStep('select');
    setCustomUrl('');
    setCustomLabel('');
    setIsCreating(false);
  }, []);

  const handleLocalDocker = React.useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsCreating(true);
    createLocalMutation.mutate(undefined, {
      onSuccess: () => {
        setIsCreating(false);
        onCreated();
        resetState();
      },
      onError: (err: any) => {
        setIsCreating(false);
        Alert.alert('Error', err?.message || 'Failed to create local instance');
      },
    });
  }, [createLocalMutation, onCreated, resetState]);

  const handleCustomConnect = React.useCallback(async () => {
    const url = customUrl.trim();
    if (!url) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsCreating(true);

    // Check health of the custom URL
    const version = await checkInstanceHealth(url);
    setIsCreating(false);

    if (version) {
      Alert.alert('Connected', `Instance is reachable (v${version}). Custom URL instances will be available in a future update.`);
      onCreated();
      resetState();
    } else {
      Alert.alert('Unreachable', 'Could not connect to the instance. Check the URL and try again.');
    }
  }, [customUrl, onCreated, resetState]);

  return (
    <BottomSheetModal
      ref={ref}
      index={0}
      snapPoints={snapPoints}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      onDismiss={resetState}
      handleIndicatorStyle={{
        backgroundColor: isDark ? '#3F3F46' : '#D4D4D8',
        width: 36,
        height: 5,
        borderRadius: 3,
      }}
      backgroundStyle={{
        backgroundColor: isDark ? '#161618' : '#FFFFFF',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
      }}
    >
      <BottomSheetView
        style={{ paddingHorizontal: 24, paddingTop: 4, paddingBottom: Math.max(insets.bottom, 20) + 16 }}
      >
        {step === 'select' ? (
          <>
            <View className="flex-row items-center mb-1">
              <Icon as={Plus} size={18} className="text-foreground mr-2" strokeWidth={2.2} />
              <Text className="text-lg font-roobert-semibold text-foreground">New Instance</Text>
            </View>
            <Text className="mb-5 font-roobert text-xs text-muted-foreground">
              Choose how to connect.
            </Text>

            <View style={{ gap: 8 }}>
              {/* Local Docker */}
              {hasLocalDocker && (
                <Pressable
                  onPress={handleLocalDocker}
                  disabled={isCreating}
                  className="rounded-2xl border border-border/40 px-4 py-3.5 active:opacity-85"
                >
                  <View className="flex-row items-center">
                    <View className="h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                      <Icon as={Monitor} size={18} className="text-primary" strokeWidth={2.2} />
                    </View>
                    <View className="ml-3 flex-1">
                      <Text className="font-roobert-medium text-[15px] text-foreground">Local Docker</Text>
                      <Text className="mt-0.5 font-roobert text-xs text-muted-foreground">Runs on your machine via Docker</Text>
                    </View>
                    {isCreating && createLocalMutation.isPending && (
                      <ActivityIndicator size="small" />
                    )}
                  </View>
                </Pressable>
              )}

              {/* Custom URL */}
              <Pressable
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setStep('custom'); }}
                className="rounded-2xl border border-border/40 px-4 py-3.5 active:opacity-85"
              >
                <View className="flex-row items-center">
                  <View className="h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                    <Icon as={Globe} size={18} className="text-primary" strokeWidth={2.2} />
                  </View>
                  <View className="ml-3 flex-1">
                    <Text className="font-roobert-medium text-[15px] text-foreground">Custom URL</Text>
                    <Text className="mt-0.5 font-roobert text-xs text-muted-foreground">Connect to any Kortix instance by address</Text>
                  </View>
                </View>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <View className="flex-row items-center mb-1">
              <Icon as={Globe} size={18} className="text-foreground mr-2" strokeWidth={2.2} />
              <Text className="text-lg font-roobert-semibold text-foreground">Custom URL</Text>
            </View>
            <Text className="mb-4 font-roobert text-xs text-muted-foreground">
              Enter the address of your Kortix instance.
            </Text>

            <BottomSheetTextInput
              value={customUrl}
              onChangeText={setCustomUrl}
              placeholder="http://localhost:8008/v1/p/sandbox/8000"
              placeholderTextColor={isDark ? 'rgba(248,248,248,0.25)' : 'rgba(18,18,21,0.3)'}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={{
                backgroundColor: isDark ? 'rgba(248,248,248,0.06)' : 'rgba(18,18,21,0.04)',
                borderWidth: 1,
                borderColor: isDark ? 'rgba(248,248,248,0.1)' : 'rgba(18,18,21,0.08)',
                borderRadius: 14,
                paddingHorizontal: 16,
                paddingVertical: 14,
                fontSize: 14,
                fontFamily: 'Roobert',
                color: fgColor,
                marginBottom: 10,
              }}
            />

            <BottomSheetTextInput
              value={customLabel}
              onChangeText={setCustomLabel}
              placeholder="Display name (optional)"
              placeholderTextColor={isDark ? 'rgba(248,248,248,0.25)' : 'rgba(18,18,21,0.3)'}
              autoCapitalize="words"
              autoCorrect={false}
              style={{
                backgroundColor: isDark ? 'rgba(248,248,248,0.06)' : 'rgba(18,18,21,0.04)',
                borderWidth: 1,
                borderColor: isDark ? 'rgba(248,248,248,0.1)' : 'rgba(18,18,21,0.08)',
                borderRadius: 14,
                paddingHorizontal: 16,
                paddingVertical: 14,
                fontSize: 14,
                fontFamily: 'Roobert',
                color: fgColor,
                marginBottom: 16,
              }}
            />

            <Pressable
              onPress={handleCustomConnect}
              disabled={!customUrl.trim() || isCreating}
              className="items-center rounded-2xl py-3.5 active:opacity-90"
              style={{
                backgroundColor: customUrl.trim()
                  ? isDark ? '#f8f8f8' : '#121215'
                  : isDark ? 'rgba(248,248,248,0.08)' : 'rgba(18,18,21,0.06)',
                opacity: customUrl.trim() ? 1 : 0.5,
              }}
            >
              {isCreating ? (
                <ActivityIndicator size="small" color={isDark ? '#121215' : '#f8f8f8'} />
              ) : (
                <Text
                  className="font-roobert-semibold text-[15px]"
                  style={{ color: customUrl.trim() ? (isDark ? '#121215' : '#f8f8f8') : (isDark ? 'rgba(248,248,248,0.3)' : 'rgba(18,18,21,0.3)') }}
                >
                  Connect
                </Text>
              )}
            </Pressable>

            <Pressable onPress={() => setStep('select')} className="mt-3 items-center py-2 active:opacity-70">
              <Text className="font-roobert-medium text-sm text-muted-foreground">Back</Text>
            </Pressable>
          </>
        )}
      </BottomSheetView>
    </BottomSheetModal>
  );
});
