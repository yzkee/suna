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
import { getSandboxServices, stopSandboxService, getPtySessions, type SandboxService, type PtySession } from '@/lib/platform/client';
import { useTabStore, type PageTab } from '@/stores/tab-store';

// ─── Types ──────────────────────────────────────────────────────────────────

interface RunningItem {
  id: string;
  kind: 'service' | 'terminal';
  name: string;
  port?: number;
  framework?: string;
  status: 'running' | 'stopped';
  startedAt?: string;
  sourcePath?: string;
  managed?: boolean;
  pid?: number;
}

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

  // Fetch services — silent background polling, no spinner
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const { data: services, isLoading: servicesLoading, refetch: refetchServices } = useQuery({
    queryKey: ['sandbox', 'services'],
    queryFn: () => getSandboxServices(sandboxUrl!),
    enabled: !!sandboxUrl,
    staleTime: 5000,
    refetchInterval: 5000,
  });

  // Fetch terminal/PTY sessions
  const { data: ptySessions, isLoading: ptyLoading, refetch: refetchPty } = useQuery({
    queryKey: ['sandbox', 'pty'],
    queryFn: () => getPtySessions(sandboxUrl!),
    enabled: !!sandboxUrl,
    staleTime: 5000,
    refetchInterval: 5000,
  });

  const isLoading = servicesLoading && ptyLoading;

  const handleManualRefresh = useCallback(async () => {
    setManualRefreshing(true);
    await Promise.all([refetchServices(), refetchPty()]);
    setManualRefreshing(false);
  }, [refetchServices, refetchPty]);

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

  // Merge services + terminals, filter out internal stuff
  const INTERNAL_NAMES = new Set(['opencode', 'kortix-master', 'svc-opencode-channels']);
  const INTERNAL_PORTS = new Set([3111, 8000, 8099]);

  const allItems: RunningItem[] = React.useMemo(() => {
    const items: RunningItem[] = [];

    // Add user-facing services
    if (services) {
      for (const s of services) {
        if (INTERNAL_NAMES.has(s.name) || INTERNAL_PORTS.has(s.port) || s.name.startsWith('svc-') || s.sourcePath?.includes('/servicedirs/')) continue;
        items.push({ id: `svc:${s.port}`, kind: 'service', name: s.name, port: s.port, framework: s.framework, status: s.status, startedAt: s.startedAt, sourcePath: s.sourcePath, managed: s.managed, pid: s.pid });
      }
    }

    // Add terminal sessions
    if (ptySessions) {
      for (const pty of ptySessions) {
        const name = `Terminal ${pty.id.slice(0, 4)}`;
        items.push({ id: `pty:${pty.id}`, kind: 'terminal', name, status: pty.running ? 'running' : 'stopped', startedAt: pty.createdAt });
      }
    }

    return items;
  }, [services, ptySessions]);

  const filteredItems = React.useMemo(() => {
    if (!search.trim()) return allItems;
    const q = search.toLowerCase();
    return allItems.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      (s.framework || '').toLowerCase().includes(q) ||
      (s.port ? String(s.port).includes(q) : false) ||
      s.kind.includes(q)
    );
  }, [allItems, search]);

  const runningCount = filteredItems.filter((s) => s.status === 'running').length;

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
        refreshControl={<RefreshControl refreshing={manualRefreshing} onRefresh={handleManualRefresh} />}
      >
        <View className="px-5 pt-2">

          {/* Loading */}
          {isLoading && (
            <View className="py-12 items-center">
              <ActivityIndicator size="small" />
            </View>
          )}

          {/* Items list */}
          {!isLoading && filteredItems.length > 0 && (
            <View className="mt-2" style={{ gap: 10 }}>
              {filteredItems.map((item) => (
                <ServiceCard
                  key={item.id}
                  item={item}
                  isDark={isDark}
                  onStop={item.kind === 'service' ? () => {
                    const svc = services?.find(s => s.port === item.port);
                    if (svc) handleStop(svc);
                  } : undefined}
                />
              ))}
            </View>
          )}

          {/* Empty state */}
          {!isLoading && filteredItems.length === 0 && (
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
  item,
  isDark,
  onStop,
}: {
  item: RunningItem;
  isDark: boolean;
  onStop?: () => void;
}) {
  const isRunning = item.status === 'running';
  const isTerminal = item.kind === 'terminal';
  const borderColor = isDark ? 'rgba(248,248,248,0.08)' : 'rgba(18,18,21,0.08)';

  return (
    <View
      className="rounded-2xl border px-4 py-3.5"
      style={{ borderColor }}
    >
      {/* Top row: icon + name + status */}
      <View className="flex-row items-center">
        <View className="relative">
          <Icon as={isTerminal ? Terminal : Globe} size={18} className="text-foreground/70" strokeWidth={2} />
          {isRunning && (
            <View className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-400 border border-background" />
          )}
        </View>
        <View className="ml-3 flex-1">
          <View className="flex-row items-center">
            <Text className="font-roobert-medium text-[15px] text-foreground" numberOfLines={1}>
              {item.name}
            </Text>
            {item.port != null && (
              <View className="ml-2 rounded-full bg-muted/60 px-1.5 py-0.5">
                <Text className="text-[10px] font-roobert-medium text-muted-foreground">
                  :{item.port}
                </Text>
              </View>
            )}
            {isTerminal && (
              <View className="ml-2 rounded-full bg-muted/60 px-1.5 py-0.5">
                <Text className="text-[10px] font-roobert-medium text-muted-foreground">Terminal</Text>
              </View>
            )}
          </View>
          <View className="flex-row items-center mt-0.5" style={{ gap: 6 }}>
            {!!item.framework && (
              <Text className="font-roobert text-[11px] text-muted-foreground">
                {getFrameworkLabel(item.framework)}
              </Text>
            )}
            {!!item.startedAt && (
              <>
                {!!item.framework && <Text className="font-roobert text-[11px] text-muted-foreground/50">·</Text>}
                <Text className="font-roobert text-[11px] text-muted-foreground">
                  {formatTimeAgo(item.startedAt)}
                </Text>
              </>
            )}
            {item.managed && (
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
      {(item.sourcePath || (onStop && isRunning)) && (
        <View className="flex-row items-center mt-2.5">
          {!!item.sourcePath && (
            <Text className="flex-1 font-roobert text-[11px] text-muted-foreground/60" numberOfLines={1}>
              {shortenPath(item.sourcePath)}
            </Text>
          )}
          {!item.sourcePath && <View className="flex-1" />}
          {isRunning && onStop && (
            <Pressable
              onPress={onStop}
              className="flex-row items-center rounded-lg bg-destructive/10 px-2.5 py-1 active:opacity-70"
            >
              <Icon as={Square} size={10} className="text-destructive mr-1" strokeWidth={2.5} />
              <Text className="font-roobert-medium text-[11px] text-destructive">Stop</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}
