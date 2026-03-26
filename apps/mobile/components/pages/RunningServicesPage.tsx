import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'nativewind';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import {
  Activity,
  Globe,
  Menu,
  Server,
  Square,
  Terminal,
} from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import { Ionicons } from '@expo/vector-icons';
import { useSandboxContext } from '@/contexts/SandboxContext';
import { getSandboxServices, stopSandboxService, type SandboxService } from '@/lib/platform/client';
import { useTabStore, type PageTab } from '@/stores/tab-store';

// ─── Helpers ────────────────────────────────────────────────────────────────

const FRAMEWORK_LABELS: Record<string, string> = {
  nextjs: 'Next.js',
  vite: 'Vite',
  python: 'Python',
  node: 'Node.js',
  go: 'Go',
  ruby: 'Ruby',
  java: 'Java',
  rust: 'Rust',
  static: 'Static',
};

function getFrameworkLabel(fw: string): string {
  return FRAMEWORK_LABELS[fw] || fw;
}

function formatTimeAgo(isoDate: string): string {
  if (!isoDate) return '';
  const diff = Date.now() - new Date(isoDate).getTime();
  if (diff < 0) return '';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function shortenPath(path: string): string {
  return path.replace(/^\/workspace\//, '');
}

// ─── Component ──────────────────────────────────────────────────────────────

interface RunningServicesPageProps {
  page: PageTab;
  onBack: () => void;
  onOpenDrawer: () => void;
  onOpenRightDrawer: () => void;
}

export function RunningServicesPage({ page, onBack, onOpenDrawer, onOpenRightDrawer }: RunningServicesPageProps) {
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { sandboxUrl } = useSandboxContext();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');

  // Scroll state persistence
  const scrollRef = useRef<ScrollView>(null);
  const savedScrollY = useTabStore((s) => (s.tabStateById[page.id]?.scrollY as number) ?? 0);
  const scrollYRef = useRef(savedScrollY);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollYRef.current = e.nativeEvent.contentOffset.y;
  }, []);

  React.useEffect(() => {
    return () => {
      useTabStore.getState().setTabState(page.id, { scrollY: scrollYRef.current });
    };
  }, [page.id]);

  const handleContentSizeChange = useCallback(() => {
    if (savedScrollY > 0) {
      scrollRef.current?.scrollTo({ y: savedScrollY, animated: false });
    }
  }, [savedScrollY]);

  // Fetch services
  const { data: services, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['sandbox', 'services'],
    queryFn: () => getSandboxServices(sandboxUrl!),
    enabled: !!sandboxUrl,
    staleTime: 5000,
    refetchInterval: 5000,
  });

  const handleStop = useCallback(async (service: SandboxService) => {
    if (!sandboxUrl) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Stop Service', `Stop "${service.name}" on port ${service.port}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Stop',
        style: 'destructive',
        onPress: async () => {
          const success = await stopSandboxService(sandboxUrl, service.id);
          if (success) {
            queryClient.invalidateQueries({ queryKey: ['sandbox', 'services'] });
          } else {
            Alert.alert('Error', 'Failed to stop service');
          }
        },
      },
    ]);
  }, [sandboxUrl, queryClient]);

  // Filter services
  const filteredServices = React.useMemo(() => {
    if (!services) return [];
    if (!search.trim()) return services;
    const q = search.toLowerCase();
    return services.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      s.framework.toLowerCase().includes(q) ||
      String(s.port).includes(q)
    );
  }, [services, search]);

  const runningCount = filteredServices.filter((s) => s.status === 'running').length;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <View className="flex-row items-center px-4 py-3">
        <Pressable onPress={onOpenDrawer} hitSlop={8} className="mr-3">
          <Icon as={Menu} size={20} className="text-foreground" strokeWidth={2} />
        </Pressable>
        <View className="flex-1">
          <Text className="text-[17px] font-roobert-semibold text-foreground" style={{ lineHeight: 18, includeFontPadding: false }}>{page.label}</Text>
          <Text className="font-roobert text-[11px] text-muted-foreground" style={{ marginTop: -3, includeFontPadding: false }}>
            {isLoading ? 'Loading...' : `${runningCount} service${runningCount !== 1 ? 's' : ''} running`}
          </Text>
        </View>
        <Pressable onPress={onOpenRightDrawer} hitSlop={8} className="ml-3 p-1">
          <Ionicons name="apps-outline" size={20} color={isDark ? '#F8F8F8' : '#121215'} />
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        onScroll={handleScroll}
        scrollEventThrottle={64}
        onContentSizeChange={handleContentSizeChange}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      >
        <View className="px-5 pt-2">

          {/* Loading */}
          {isLoading && (
            <View className="py-12 items-center">
              <ActivityIndicator size="small" />
            </View>
          )}

          {/* Services list */}
          {!isLoading && filteredServices.length > 0 && (
            <View className="mt-5" style={{ gap: 10 }}>
              {filteredServices.map((service) => (
                <ServiceCard
                  key={service.id}
                  service={service}
                  isDark={isDark}
                  onStop={() => handleStop(service)}
                />
              ))}
            </View>
          )}

          {/* Empty state */}
          {!isLoading && filteredServices.length === 0 && (
            <View className="items-center justify-center py-16">
              <Icon as={Server} size={32} className="text-muted-foreground/40" strokeWidth={1.5} />
              <Text className="mt-3 font-roobert-medium text-[15px] text-foreground">No Running Services</Text>
              <Text className="mt-1 text-center font-roobert text-xs text-muted-foreground">
                Start a dev server or application in the terminal to see it here.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Service Card ───────────────────────────────────────────────────────────

function ServiceCard({
  service,
  isDark,
  onStop,
}: {
  service: SandboxService;
  isDark: boolean;
  onStop: () => void;
}) {
  const isRunning = service.status === 'running';
  const borderColor = isDark ? 'rgba(248,248,248,0.08)' : 'rgba(18,18,21,0.08)';

  return (
    <View
      className="rounded-2xl border px-4 py-3.5"
      style={{ borderColor }}
    >
      {/* Top row: icon + name + status */}
      <View className="flex-row items-center">
        <View className="relative">
          <Icon as={Globe} size={18} className="text-foreground/70" strokeWidth={2} />
          {isRunning && (
            <View className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-400 border border-background" />
          )}
        </View>
        <View className="ml-3 flex-1">
          <View className="flex-row items-center">
            <Text className="font-roobert-medium text-[15px] text-foreground" numberOfLines={1}>
              {service.name}
            </Text>
            <View className="ml-2 rounded-full bg-muted/60 px-1.5 py-0.5">
              <Text className="text-[10px] font-roobert-medium text-muted-foreground">
                :{service.port}
              </Text>
            </View>
          </View>
          <View className="flex-row items-center mt-0.5" style={{ gap: 6 }}>
            {!!service.framework && (
              <Text className="font-roobert text-[11px] text-muted-foreground">
                {getFrameworkLabel(service.framework)}
              </Text>
            )}
            {!!service.startedAt && (
              <>
                <Text className="font-roobert text-[11px] text-muted-foreground/50">·</Text>
                <Text className="font-roobert text-[11px] text-muted-foreground">
                  {formatTimeAgo(service.startedAt)}
                </Text>
              </>
            )}
            {service.managed && (
              <>
                <Text className="font-roobert text-[11px] text-muted-foreground/50">·</Text>
                <Text className="font-roobert text-[11px] text-muted-foreground">Managed</Text>
              </>
            )}
          </View>
        </View>

        {/* Status badge */}
        <View
          className="rounded-full px-2 py-0.5"
          style={{
            backgroundColor: isRunning
              ? isDark ? 'rgba(52,211,153,0.12)' : 'rgba(52,211,153,0.1)'
              : isDark ? 'rgba(248,248,248,0.06)' : 'rgba(18,18,21,0.05)',
          }}
        >
          <Text className={`text-[10px] font-roobert-medium ${isRunning ? 'text-emerald-500' : 'text-muted-foreground'}`}>
            {isRunning ? 'Running' : 'Stopped'}
          </Text>
        </View>
      </View>

      {/* Bottom row: path + stop button */}
      <View className="flex-row items-center mt-2.5">
        {!!service.sourcePath && (
          <Text className="flex-1 font-roobert text-[11px] text-muted-foreground/60" numberOfLines={1}>
            {shortenPath(service.sourcePath)}
          </Text>
        )}
        {isRunning && (
          <Pressable
            onPress={onStop}
            className="flex-row items-center rounded-lg bg-destructive/10 px-2.5 py-1 active:opacity-70"
          >
            <Icon as={Square} size={10} className="text-destructive mr-1" strokeWidth={2.5} />
            <Text className="font-roobert-medium text-[11px] text-destructive">Stop</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
