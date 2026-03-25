import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'nativewind';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import {
  AlertTriangle,
  ArrowDownToLine,
  Bug,
  Check,
  RefreshCw,
  Shield,
  Sparkles,
  X,
  Zap,
} from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import { useGlobalSandboxUpdate } from '@/hooks/useSandboxUpdate';
import { getFullChangelog, type ChangelogChange, type ChangelogEntry } from '@/lib/platform/client';

const CHANGE_ICONS: Record<string, typeof Sparkles> = {
  feature: Sparkles,
  fix: Bug,
  improvement: Zap,
  breaking: AlertTriangle,
  upstream: RefreshCw,
  security: Shield,
  deprecation: AlertTriangle,
};

const CHANGE_COLORS: Record<string, string> = {
  feature: '#10B981',
  fix: '#F87171',
  improvement: '#60A5FA',
  breaking: '#F59E0B',
  upstream: '#A78BFA',
  security: '#FB7185',
  deprecation: '#FB923C',
};

export default function ChangelogScreen() {
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  const {
    updateAvailable,
    currentVersion,
    latestVersion,
    update,
    isUpdating,
    phase,
    phaseLabel,
    phaseProgress,
    phaseMessage,
    updateResult,
    updateError,
    resetStatus,
  } = useGlobalSandboxUpdate();

  const { data: changelog, isLoading } = useQuery({
    queryKey: ['sandbox', 'changelog'],
    queryFn: getFullChangelog,
    staleTime: 5 * 60 * 1000,
  });

  const handleUpdate = React.useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    update();
  }, [update]);

  const handleRetry = React.useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    resetStatus();
  }, [resetStatus]);

  return (
    <ScrollView
      className="flex-1 bg-background"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
    >
      <View className="px-5 pt-1" style={{ gap: 18 }}>
        {/* Version info */}
        <View className="px-1">
          <Text className="mb-2 text-[11px] font-roobert-medium uppercase tracking-wider text-muted-foreground/80">
            Version
          </Text>
          <View className="py-3.5">
            <View className="flex-row items-center">
              <View className="flex-1">
                <Text className="font-roobert-medium text-[15px] text-foreground">
                  Running v{currentVersion || '...'}
                </Text>
                {latestVersion && updateAvailable && (
                  <Text className="mt-0.5 font-roobert text-xs text-muted-foreground">
                    Latest: v{latestVersion}
                  </Text>
                )}
                {!updateAvailable && currentVersion && (
                  <Text className="mt-0.5 font-roobert text-xs text-emerald-500">
                    Up to date
                  </Text>
                )}
              </View>
              {updateAvailable && !isUpdating && !updateResult && (
                <Pressable
                  onPress={handleUpdate}
                  className="flex-row items-center rounded-xl px-3.5 py-2 active:opacity-90"
                  style={{ backgroundColor: isDark ? '#F8F8F8' : '#121215' }}
                >
                  <Icon as={ArrowDownToLine} size={13} className={isDark ? 'text-[#121215]' : 'text-[#F8F8F8]'} strokeWidth={2.5} />
                  <Text className={`ml-1.5 font-roobert-semibold text-xs ${isDark ? 'text-[#121215]' : 'text-[#F8F8F8]'}`}>
                    Update
                  </Text>
                </Pressable>
              )}
              {updateResult?.success && (
                <View className="flex-row items-center rounded-xl bg-emerald-400/15 px-3 py-2">
                  <Icon as={Check} size={13} className="text-emerald-500" strokeWidth={2.5} />
                  <Text className="ml-1.5 font-roobert-medium text-xs text-emerald-500">Updated</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Update progress */}
        {isUpdating && (
          <View className="px-1">
            <Text className="mb-2 text-[11px] font-roobert-medium uppercase tracking-wider text-muted-foreground/80">
              Updating
            </Text>
            <View className="py-3.5">
              <View className="flex-row items-center mb-2">
                <ActivityIndicator size="small" />
                <View className="ml-3 flex-1">
                  <Text className="font-roobert-medium text-[15px] text-foreground">{phaseLabel}</Text>
                  {!!phaseMessage && (
                    <Text className="mt-0.5 font-roobert text-xs text-muted-foreground">{phaseMessage}</Text>
                  )}
                </View>
                <Text className="font-roobert text-xs tabular-nums text-muted-foreground">
                  {Math.round(phaseProgress)}%
                </Text>
              </View>
              <View
                className="h-1.5 rounded-full overflow-hidden"
                style={{ backgroundColor: isDark ? 'rgba(248,248,248,0.08)' : 'rgba(18,18,21,0.06)' }}
              >
                <View
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(phaseProgress, 2)}%`,
                    backgroundColor: isDark ? '#F8F8F8' : '#121215',
                  }}
                />
              </View>
            </View>
          </View>
        )}

        {/* Update error */}
        {updateError && (
          <View className="px-1">
            <View className="py-3.5">
              <View className="flex-row items-center">
                <Icon as={X} size={16} className="text-destructive" strokeWidth={2.5} />
                <View className="ml-3 flex-1">
                  <Text className="font-roobert-medium text-[15px] text-destructive">Update failed</Text>
                  <Text className="mt-0.5 font-roobert text-xs text-muted-foreground">{updateError.message}</Text>
                </View>
                <Pressable onPress={handleRetry} className="active:opacity-70">
                  <Text className="font-roobert-medium text-xs text-primary">Try again</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}

        {/* Changelog */}
        <View className="px-1">
          <Text className="mb-2 text-[11px] font-roobert-medium uppercase tracking-wider text-muted-foreground/80">
            Changelog
          </Text>

          {isLoading && (
            <View className="py-8 items-center">
              <ActivityIndicator size="small" />
            </View>
          )}

          {changelog?.map((entry, entryIdx) => {
            const isCurrent = currentVersion === entry.version;
            const isLatest = latestVersion === entry.version;
            return (
              <View key={entry.version} className={entryIdx > 0 ? 'mt-4' : ''}>
                {/* Version header */}
                <View className="flex-row items-center mb-2">
                  <Text className="font-roobert-semibold text-[15px] text-foreground">
                    v{entry.version}
                  </Text>
                  {isCurrent && (
                    <View className="ml-2 rounded-full bg-emerald-400/15 px-2 py-0.5">
                      <Text className="text-[10px] font-roobert-medium text-emerald-600 dark:text-emerald-400">Current</Text>
                    </View>
                  )}
                  {isLatest && !isCurrent && (
                    <View className="ml-2 rounded-full bg-primary/15 px-2 py-0.5">
                      <Text className="text-[10px] font-roobert-medium text-primary">Latest</Text>
                    </View>
                  )}
                  {!!entry.date && (
                    <Text className="ml-auto font-roobert text-[11px] text-muted-foreground/60">
                      {entry.date}
                    </Text>
                  )}
                </View>

                {/* Title & description */}
                {!!entry.title && (
                  <Text className="font-roobert-medium text-[13px] text-foreground/85 mb-1">{entry.title}</Text>
                )}
                {!!entry.description && (
                  <Text className="font-roobert text-xs text-muted-foreground mb-2">{entry.description}</Text>
                )}

                {/* Changes list */}
                {entry.changes?.map((change, changeIdx) => (
                  <ChangeRow key={changeIdx} change={change} isLast={changeIdx === entry.changes.length - 1} />
                ))}

                {/* Divider between entries */}
                {entryIdx < (changelog?.length ?? 0) - 1 && (
                  <View className="mt-4 h-px bg-border/35" />
                )}
              </View>
            );
          })}

          {!isLoading && (!changelog || changelog.length === 0) && (
            <Text className="py-4 text-center font-roobert text-xs text-muted-foreground">
              No changelog entries available.
            </Text>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

function ChangeRow({ change, isLast }: { change: ChangelogChange; isLast: boolean }) {
  const ChangeIcon = CHANGE_ICONS[change.type] || Zap;
  const color = CHANGE_COLORS[change.type] || '#60A5FA';

  return (
    <View className="py-2">
      <View className="flex-row items-start">
        <View className="mt-0.5 mr-2.5">
          <Icon as={ChangeIcon} size={13} style={{ color }} strokeWidth={2.2} />
        </View>
        <Text className="flex-1 font-roobert text-[13px] text-foreground/90">{change.text}</Text>
      </View>
    </View>
  );
}
