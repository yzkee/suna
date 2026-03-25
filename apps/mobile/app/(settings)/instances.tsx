import * as React from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Platform, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'nativewind';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import {
  Cloud,
  Copy,
  HardDrive,
  Monitor,
  MoreHorizontal,
  RefreshCw,
  Server,
  Square,
  Trash2,
} from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import { useSandboxContext } from '@/contexts/SandboxContext';
import { useInstances, useRestartInstance, useStopInstance, useDeleteInstance } from '@/lib/platform/hooks';
import type { SandboxInfo, SandboxProviderName } from '@/lib/platform/client';

function providerLabel(provider: SandboxProviderName): string {
  switch (provider) {
    case 'local_docker': return 'LOCAL';
    case 'hetzner': return 'CLOUD';
    case 'daytona': return 'CLOUD';
    default: return 'INSTANCE';
  }
}

function providerIcon(provider: SandboxProviderName) {
  switch (provider) {
    case 'local_docker': return Monitor;
    case 'hetzner': return Cloud;
    case 'daytona': return Cloud;
    default: return Server;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'running':
    case 'ready':
    case 'active':
      return '#34D399';
    case 'stopped':
    case 'archived':
      return '#9CA3AF';
    case 'error':
    case 'failed':
      return '#EF4444';
    default:
      return '#FBBF24';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'running':
    case 'ready':
    case 'active':
      return 'Connected';
    case 'stopped': return 'Stopped';
    case 'archived': return 'Archived';
    case 'error':
    case 'failed':
      return 'Error';
    default: return status;
  }
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function InstancesScreen() {
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { sandboxId } = useSandboxContext();

  const { data: instances, isLoading, refetch, isRefetching } = useInstances();
  const restartMutation = useRestartInstance();
  const stopMutation = useStopInstance();
  const deleteMutation = useDeleteInstance();

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
      `Are you sure you want to delete "${instance.name}"? This action cannot be undone.`,
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
    const destructiveIndex = isActive ? -1 : options.length;

    if (isActive) {
      options.push('Restart');
      options.push('Stop');
    }
    if (!isActive) {
      options.push('Delete');
    }

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex: 0,
          destructiveButtonIndex: destructiveIndex,
        },
        (index) => {
          if (index === 0) return;
          const action = options[index];
          if (action === 'Restart') handleRestart();
          else if (action === 'Stop') handleStop();
          else if (action === 'Delete') handleDelete(instance);
        },
      );
    } else {
      // Android fallback
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

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="small" />
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
      }
    >
      <View className="px-5 pt-1" style={{ gap: 18 }}>
        {/* Active Instance Detail */}
        {activeInstance && (
          <View className="px-1">
            <Text className="mb-2 text-[11px] font-roobert-medium uppercase tracking-wider text-muted-foreground/80">
              Active Instance
            </Text>
            <View>
              {/* Instance info */}
              <View className="py-3.5">
                <View className="flex-row items-center">
                  <View
                    className="h-2.5 w-2.5 rounded-full mr-3"
                    style={{ backgroundColor: statusColor(activeInstance.status) }}
                  />
                  <View className="flex-1">
                    <View className="flex-row items-center">
                      <Text className="font-roobert-medium text-[15px] text-foreground" numberOfLines={1}>
                        {activeInstance.name}
                      </Text>
                      <View className="ml-2 rounded-full bg-emerald-400/15 px-2 py-0.5">
                        <Text className="text-[10px] font-roobert-medium text-emerald-600 dark:text-emerald-400">
                          Active
                        </Text>
                      </View>
                    </View>
                    <Text className="mt-0.5 font-roobert text-xs text-muted-foreground">
                      {statusLabel(activeInstance.status)}
                      {activeInstance.version ? ` · v${activeInstance.version}` : ''}
                    </Text>
                  </View>
                </View>
              </View>
              <View className="h-px bg-border/35" />

              {/* URL */}
              <Pressable
                onPress={() => handleCopyUrl(activeInstance.base_url)}
                className="py-3.5 active:opacity-85"
              >
                <View className="flex-row items-center">
                  <Icon as={HardDrive} size={18} className="text-foreground/80" strokeWidth={2.2} />
                  <View className="ml-4 flex-1">
                    <Text className="font-roobert-medium text-[15px] text-foreground">
                      Connection URL
                    </Text>
                    <Text className="mt-0.5 font-roobert text-xs text-muted-foreground" numberOfLines={1}>
                      {activeInstance.base_url}
                    </Text>
                  </View>
                  <Icon as={Copy} size={14} className="text-muted-foreground/50" strokeWidth={2.2} />
                </View>
              </Pressable>
              <View className="h-px bg-border/35" />

              {/* Provider & date */}
              <View className="py-3.5">
                <View className="flex-row items-center">
                  <Icon as={providerIcon(activeInstance.provider)} size={18} className="text-foreground/80" strokeWidth={2.2} />
                  <View className="ml-4 flex-1">
                    <Text className="font-roobert-medium text-[15px] text-foreground">
                      {providerLabel(activeInstance.provider)} Instance
                    </Text>
                    <Text className="mt-0.5 font-roobert text-xs text-muted-foreground">
                      Created {formatDate(activeInstance.created_at)}
                    </Text>
                  </View>
                </View>
              </View>
              <View className="h-px bg-border/35" />

              {/* Actions */}
              <View className="flex-row py-3.5" style={{ gap: 10 }}>
                <Pressable
                  onPress={handleRestart}
                  disabled={restartMutation.isPending}
                  className="flex-row items-center rounded-lg bg-muted/60 px-3 py-2 active:opacity-80"
                >
                  <Icon as={RefreshCw} size={12} className="text-foreground mr-1.5" strokeWidth={2.2} />
                  <Text className="font-roobert-medium text-xs text-foreground">
                    {restartMutation.isPending ? 'Restarting...' : 'Restart'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleStop}
                  disabled={stopMutation.isPending}
                  className="flex-row items-center rounded-lg bg-destructive/10 px-3 py-2 active:opacity-80"
                >
                  <Icon as={Square} size={12} className="text-destructive mr-1.5" strokeWidth={2.2} />
                  <Text className="font-roobert-medium text-xs text-destructive">
                    {stopMutation.isPending ? 'Stopping...' : 'Stop'}
                  </Text>
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
                    <Pressable
                      onPress={() => showActions(instance)}
                      className="py-3.5 active:opacity-85"
                    >
                      <View className="flex-row items-center">
                        <View
                          className="h-2.5 w-2.5 rounded-full mr-3"
                          style={{ backgroundColor: statusColor(instance.status) }}
                        />
                        <View className="flex-1">
                          <View className="flex-row items-center">
                            <Text className="font-roobert-medium text-[15px] text-foreground" numberOfLines={1}>
                              {instance.name}
                            </Text>
                          </View>
                          <Text className="mt-0.5 font-roobert text-xs text-muted-foreground">
                            {statusLabel(instance.status)}
                            {instance.version ? ` · v${instance.version}` : ''}
                          </Text>
                        </View>
                        <View className="flex-row items-center" style={{ gap: 6 }}>
                          <View
                            className="rounded-full px-2 py-0.5"
                            style={{
                              backgroundColor: isDark ? 'rgba(248,248,248,0.06)' : 'rgba(18,18,21,0.05)',
                            }}
                          >
                            <Text className="text-[10px] font-roobert-medium text-muted-foreground">
                              {providerLabel(instance.provider)}
                            </Text>
                          </View>
                          {isActive && (
                            <View className="rounded-full bg-emerald-400/15 px-2 py-0.5">
                              <Text className="text-[10px] font-roobert-medium text-emerald-600 dark:text-emerald-400">
                                Active
                              </Text>
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
            <Text className="mt-3 font-roobert-medium text-[15px] text-foreground">
              No Instances
            </Text>
            <Text className="mt-1 text-center font-roobert text-xs text-muted-foreground">
              Create an instance from the desktop app to get started.
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
