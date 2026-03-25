import React, { useCallback, useRef } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'nativewind';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import {
  AlertTriangle,
  ArrowDownToLine,
  Bug,
  Check,
  Download,
  HeartPulse,
  Menu,
  Package,
  Play,
  RefreshCw,
  Shield,
  Sparkles,
  Square,
  X,
  Zap,
} from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import { useGlobalSandboxUpdate } from '@/hooks/useSandboxUpdate';
import { getFullChangelog, type ChangelogChange, type ChangelogEntry, type UpdatePhase } from '@/lib/platform/client';
import { useTabStore, type PageTab } from '@/stores/tab-store';

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

interface UpdatesPageProps {
  page: PageTab;
  onBack: () => void;
  onOpenDrawer: () => void;
  onOpenRightDrawer: () => void;
}

export function UpdatesPage({ page, onBack, onOpenDrawer, onOpenRightDrawer }: UpdatesPageProps) {
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  const {
    updateAvailable,
    currentVersion,
    latestVersion,
    changelog: latestChangelog,
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

  // Persist scroll position across tab switches
  const scrollRef = useRef<ScrollView>(null);
  const savedScrollY = useTabStore((s) => (s.tabStateById[page.id]?.scrollY as number) ?? 0);
  const scrollYRef = useRef(savedScrollY);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollYRef.current = e.nativeEvent.contentOffset.y;
  }, []);

  // Save scroll position when unmounting (tab switch)
  React.useEffect(() => {
    return () => {
      useTabStore.getState().setTabState(page.id, { scrollY: scrollYRef.current });
    };
  }, [page.id]);

  // Restore scroll position on mount
  const handleContentSizeChange = useCallback(() => {
    if (savedScrollY > 0) {
      scrollRef.current?.scrollTo({ y: savedScrollY, animated: false });
    }
  }, [savedScrollY]);

  const { data: fullChangelog, isLoading } = useQuery({
    queryKey: ['sandbox', 'changelog'],
    queryFn: getFullChangelog,
    staleTime: 5 * 60 * 1000,
  });

  const changelog = React.useMemo(() => {
    if (fullChangelog && fullChangelog.length > 0) return fullChangelog;
    if (latestChangelog) return [latestChangelog];
    return [];
  }, [fullChangelog, latestChangelog]);

  const handleUpdate = React.useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    update();
  }, [update]);

  const handleRetry = React.useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    resetStatus();
  }, [resetStatus]);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <View className="flex-row items-center px-4 py-3">
        <Pressable onPress={onOpenDrawer} hitSlop={8} className="mr-3">
          <Icon as={Menu} size={20} className="text-foreground" strokeWidth={2} />
        </Pressable>
        <Text className="flex-1 text-lg font-roobert-medium text-foreground">{page.label}</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        onScroll={handleScroll}
        scrollEventThrottle={64}
        onContentSizeChange={handleContentSizeChange}
      >
        <View className="px-5 pt-2 pb-4">
          {/* Header */}
          <Text className="text-2xl font-roobert-semibold text-foreground">Changelog</Text>
          <View className="mt-1 flex-row items-center">
            <Text className="font-roobert text-sm text-muted-foreground">
              Running <Text className="font-roobert-semibold text-foreground">v{currentVersion || '...'}</Text>
            </Text>
            {latestVersion && updateAvailable && (
              <Text className="font-roobert text-sm text-muted-foreground">
                {' · Latest: '}<Text className="font-roobert-semibold text-foreground">v{latestVersion}</Text>
              </Text>
            )}
          </View>

          {/* Update button */}
          {updateAvailable && !isUpdating && !updateResult && latestVersion && (
            <Pressable
              onPress={handleUpdate}
              className="mt-4 flex-row items-center justify-center self-start rounded-xl px-5 py-2.5 active:opacity-90"
              style={{ backgroundColor: isDark ? '#F8F8F8' : '#121215' }}
            >
              <Icon as={ArrowDownToLine} size={15} className={isDark ? 'text-[#121215]' : 'text-[#F8F8F8]'} strokeWidth={2.5} />
              <Text className={`ml-2 font-roobert-semibold text-sm ${isDark ? 'text-[#121215]' : 'text-[#F8F8F8]'}`}>
                Update to v{latestVersion}
              </Text>
            </Pressable>
          )}

          {/* Update success */}
          {updateResult?.success && (
            <View className="mt-4 flex-row items-center self-start rounded-xl bg-emerald-400/15 px-4 py-2.5">
              <Icon as={Check} size={15} className="text-emerald-500" strokeWidth={2.5} />
              <Text className="ml-2 font-roobert-medium text-sm text-emerald-500">
                Updated to v{updateResult.currentVersion}
              </Text>
            </View>
          )}

          {/* Update progress */}
          {(isUpdating || updateError) && (
            <View
              className="mt-4 rounded-2xl border px-4 py-4"
              style={{
                borderColor: updateError
                  ? isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)'
                  : isDark ? 'rgba(248,248,248,0.08)' : 'rgba(18,18,21,0.08)',
                backgroundColor: updateError
                  ? isDark ? 'rgba(239,68,68,0.05)' : 'rgba(239,68,68,0.03)'
                  : undefined,
              }}
            >
              {/* Header */}
              <View className="flex-row items-center mb-3">
                {updateError ? (
                  <Icon as={X} size={18} className="text-destructive" strokeWidth={2.5} />
                ) : (
                  <ActivityIndicator size="small" />
                )}
                <View className="ml-3 flex-1">
                  <Text className={`font-roobert-medium text-[15px] ${updateError ? 'text-destructive' : 'text-foreground'}`}>
                    {updateError ? 'Update failed' : `Updating to v${latestVersion}`}
                  </Text>
                </View>
                {!updateError && (
                  <Text className="font-roobert text-xs tabular-nums text-muted-foreground">{Math.round(phaseProgress)}%</Text>
                )}
              </View>

              {/* Progress bar */}
              {!updateError && (
                <View className="mb-4 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: isDark ? 'rgba(248,248,248,0.08)' : 'rgba(18,18,21,0.06)' }}>
                  <View className="h-full rounded-full" style={{ width: `${Math.max(phaseProgress, 2)}%`, backgroundColor: isDark ? '#F8F8F8' : '#121215' }} />
                </View>
              )}

              {/* Phase steps */}
              <UpdatePhaseSteps currentPhase={phase} hasError={!!updateError} isDark={isDark} />

              {/* Error details + retry */}
              {updateError && (
                <View className="mt-3 flex-row items-center">
                  <Text className="flex-1 font-roobert text-xs text-muted-foreground">{updateError.message}</Text>
                  <Pressable onPress={handleRetry} className="ml-2 rounded-lg bg-muted/60 px-3 py-1.5 active:opacity-70">
                    <Text className="font-roobert-medium text-xs text-foreground">Try again</Text>
                  </Pressable>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Changelog entries */}
        <View className="px-5" style={{ gap: 16 }}>
          {isLoading && (
            <View className="py-12 items-center">
              <ActivityIndicator size="small" />
            </View>
          )}

          {changelog?.map((entry) => {
            const isCurrent = currentVersion === entry.version;
            const isLatest = latestVersion === entry.version;
            const borderColor = isLatest && !isCurrent
              ? isDark ? 'rgba(219,39,119,0.35)' : 'rgba(219,39,119,0.25)'
              : isDark ? 'rgba(248,248,248,0.08)' : 'rgba(18,18,21,0.08)';
            const bgColor = isLatest && !isCurrent
              ? isDark ? 'rgba(219,39,119,0.04)' : 'rgba(219,39,119,0.02)'
              : undefined;

            return (
              <View key={entry.version} className="rounded-2xl border px-4 pt-4 pb-3" style={{ borderColor, backgroundColor: bgColor }}>
                <View className="flex-row items-center mb-2">
                  <Text className="font-roobert-semibold text-lg text-foreground">v{entry.version}</Text>
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
                    <Text className="ml-auto font-roobert text-[11px] text-muted-foreground/60">{entry.date}</Text>
                  )}
                </View>
                {!!entry.title && <Text className="font-roobert-medium text-[14px] text-foreground mb-1">{entry.title}</Text>}
                {!!entry.description && <Text className="font-roobert text-xs text-muted-foreground mb-3 leading-[18px]">{entry.description}</Text>}
                {entry.changes?.length > 0 && (
                  <View style={{ gap: 6 }}>
                    {entry.changes.map((change, idx) => {
                      const ChangeIcon = CHANGE_ICONS[change.type] || Zap;
                      const color = CHANGE_COLORS[change.type] || '#60A5FA';
                      return (
                        <View key={idx} className="flex-row items-start py-1">
                          <View className="mt-0.5 mr-2.5">
                            <Icon as={ChangeIcon} size={13} style={{ color }} strokeWidth={2.2} />
                          </View>
                          <Text className="flex-1 font-roobert text-[13px] text-foreground/90 leading-[18px]">{change.text}</Text>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}

          {!isLoading && changelog.length === 0 && (
            <Text className="py-8 text-center font-roobert text-xs text-muted-foreground">No changelog entries available.</Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Update Phase Steps ─────────────────────────────────────────────────────

const UPDATE_PHASES: { phase: UpdatePhase; label: string; icon: typeof Download }[] = [
  { phase: 'pulling', label: 'Downloading update', icon: Download },
  { phase: 'stopping', label: 'Stopping sandbox', icon: Square },
  { phase: 'removing', label: 'Preparing update', icon: Package },
  { phase: 'recreating', label: 'Installing update', icon: Package },
  { phase: 'starting', label: 'Starting sandbox', icon: Play },
  { phase: 'health_check', label: 'Health checks', icon: HeartPulse },
  { phase: 'complete', label: 'Complete', icon: Check },
];

const PHASE_ORDER: UpdatePhase[] = ['pulling', 'stopping', 'removing', 'recreating', 'starting', 'health_check', 'complete'];

function UpdatePhaseSteps({ currentPhase, hasError, isDark }: { currentPhase: string; hasError: boolean; isDark: boolean }) {
  const currentIdx = PHASE_ORDER.indexOf(currentPhase as UpdatePhase);

  return (
    <View style={{ gap: 2 }}>
      {UPDATE_PHASES.map((step, idx) => {
        const isComplete = currentIdx > idx;
        const isActive = currentIdx === idx && !hasError;
        const isFailed = currentIdx === idx && hasError;
        const isPending = currentIdx < idx;

        let dotColor = isDark ? 'rgba(248,248,248,0.15)' : 'rgba(18,18,21,0.1)';
        if (isComplete) dotColor = '#10B981';
        else if (isActive) dotColor = isDark ? '#F8F8F8' : '#121215';
        else if (isFailed) dotColor = '#EF4444';

        return (
          <View key={step.phase} className="flex-row items-center py-1.5">
            <View className="w-5 items-center">
              {isComplete ? (
                <Icon as={Check} size={12} style={{ color: '#10B981' }} strokeWidth={2.5} />
              ) : (
                <View className="h-2 w-2 rounded-full" style={{ backgroundColor: dotColor }} />
              )}
            </View>
            <Icon
              as={step.icon}
              size={13}
              className={isComplete ? 'text-emerald-500' : isActive ? 'text-foreground' : isFailed ? 'text-destructive' : 'text-muted-foreground/40'}
              strokeWidth={2.2}
            />
            <Text
              className={`ml-2 font-roobert text-xs ${
                isComplete ? 'text-emerald-500' : isActive ? 'text-foreground font-roobert-medium' : isFailed ? 'text-destructive' : 'text-muted-foreground/40'
              }`}
            >
              {step.label}
            </Text>
            {isActive && !hasError && (
              <ActivityIndicator size={10} style={{ marginLeft: 6 }} color={isDark ? '#F8F8F8' : '#121215'} />
            )}
          </View>
        );
      })}
    </View>
  );
}
