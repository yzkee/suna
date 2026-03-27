/**
 * ScheduledTasksPage — full-screen scheduled tasks / triggers management.
 * Shows list of cron triggers with create, edit, toggle, delete, run now.
 * Matches frontend /scheduled-tasks functionality.
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View,
  FlatList,
  TextInput,
  Pressable,
  Alert,
  ActivityIndicator,
  Switch,
  StyleSheet,
  Keyboard,
  TouchableOpacity,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { Text as RNText } from 'react-native';
import {
  Search,
  X,
  Plus,
  Clock,
  Play,
  Pause,
  Trash2,
  ChevronRight,
  Timer,
  Webhook,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  SkipForward,
  Loader2,
  Pencil,
  RotateCw,
  Calendar,
} from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import BottomSheet, { BottomSheetBackdrop, BottomSheetScrollView, BottomSheetModal, BottomSheetView, BottomSheetTextInput } from '@gorhom/bottom-sheet';

import { useThemeColors } from '@/lib/theme-colors';
import type { PageTab } from '@/stores/tab-store';
import {
  useScheduledTasks,
  useCreateScheduledTask,
  useUpdateScheduledTask,
  useDeleteScheduledTask,
  useToggleScheduledTask,
  useRunScheduledTask,
  useTaskExecutions,
  describeCron,
  formatRelativeTime,
  formatDuration,
  type Trigger,
  type Execution,
  type CreateTriggerData,
  type UpdateTriggerData,
  type ExecutionStatus,
} from '@/hooks/useScheduledTasks';

// ─── Tab Page Wrapper ────────────────────────────────────────────────────────

interface ScheduledTasksTabPageProps {
  page: PageTab;
  onBack: () => void;
  onOpenDrawer?: () => void;
  onOpenRightDrawer?: () => void;
}

export function ScheduledTasksTabPage({
  page,
  onBack,
  onOpenDrawer,
  onOpenRightDrawer,
}: ScheduledTasksTabPageProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const fgColor = isDark ? '#F8F8F8' : '#121215';

  return (
    <View style={{ flex: 1, backgroundColor: isDark ? '#121215' : '#F8F8F8' }}>
      {/* Header */}
      <View style={{ paddingTop: insets.top, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: isDark ? '#121215' : '#F8F8F8' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity
            onPress={onOpenDrawer}
            style={{ marginRight: 12, padding: 4 }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="menu" size={24} color={fgColor} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <RNText style={{ fontSize: 18, fontFamily: 'Roobert-SemiBold', color: fgColor }} numberOfLines={1}>
              {page.label}
            </RNText>
          </View>
          <TouchableOpacity
            onPress={onOpenRightDrawer}
            style={{ marginLeft: 12, padding: 4 }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="apps-outline" size={20} color={fgColor} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Content */}
      <ScheduledTasksContent />
    </View>
  );
}

// ─── Main Content ────────────────────────────────────────────────────────────

function ScheduledTasksContent() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const theme = useThemeColors();

  const { data: triggers, isLoading, error, status, fetchStatus } = useScheduledTasks();
  console.log('[ScheduledTasks] Query state:', { status, fetchStatus, isLoading, error: error?.message, triggersCount: triggers?.length });
  const createTask = useCreateScheduledTask();
  const deleteTask = useDeleteScheduledTask();
  const toggleTask = useToggleScheduledTask();
  const runTask = useRunScheduledTask();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTrigger, setSelectedTrigger] = useState<Trigger | null>(null);
  const [showCreateSheet, setShowCreateSheet] = useState(false);

  const detailSheetRef = useRef<BottomSheet>(null);
  const createSheetRef = useRef<BottomSheetModal>(null);

  // Colors
  const fg = isDark ? '#f8f8f8' : '#121215';
  const muted = isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)';
  const inputBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';

  // Filter + sort triggers
  const filteredTriggers = useMemo(() => {
    if (!triggers) return [];
    let list = [...triggers];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          describeCron(t.cronExpr).toLowerCase().includes(q) ||
          (t.prompt || '').toLowerCase().includes(q),
      );
    }

    // Sort: active first, then by updatedAt desc
    list.sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    return list;
  }, [triggers, searchQuery]);

  // Handlers
  const handleSelectTrigger = useCallback((trigger: Trigger) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedTrigger(trigger);
    detailSheetRef.current?.snapToIndex(0);
  }, []);

  const handleToggle = useCallback(
    async (trigger: Trigger) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        await toggleTask.mutateAsync({ id: trigger.id, isActive: !trigger.isActive });
      } catch {
        Alert.alert('Error', 'Failed to toggle task');
      }
    },
    [toggleTask],
  );

  const handleDelete = useCallback(
    (trigger: Trigger) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert('Delete Task', `Delete "${trigger.name}"? This cannot be undone.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteTask.mutateAsync(trigger.id);
              if (selectedTrigger?.id === trigger.id) {
                setSelectedTrigger(null);
                detailSheetRef.current?.close();
              }
            } catch {
              Alert.alert('Error', 'Failed to delete task');
            }
          },
        },
      ]);
    },
    [deleteTask, selectedTrigger],
  );

  const handleRunNow = useCallback(
    async (trigger: Trigger) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      try {
        await runTask.mutateAsync(trigger.id);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        Alert.alert('Error', 'Failed to run task');
      }
    },
    [runTask],
  );

  const handleOpenCreate = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    createSheetRef.current?.present();
  }, []);

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />
    ),
    [],
  );

  // ── Search Bar ──
  const SearchBar = (
    <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: inputBg,
          borderRadius: 12,
          paddingHorizontal: 12,
          height: 42,
        }}
      >
        <Search size={16} color={muted} />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search tasks..."
          placeholderTextColor={muted}
          style={{
            flex: 1,
            marginLeft: 8,
            fontSize: 15,
            fontFamily: 'Roobert',
            color: fg,
          }}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {searchQuery.length > 0 && (
          <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
            <X size={16} color={muted} />
          </Pressable>
        )}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      {SearchBar}

      <FlatList
        data={filteredTriggers}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TaskListItem
            trigger={item}
            isDark={isDark}
            theme={theme}
            onPress={() => handleSelectTrigger(item)}
            onToggle={() => handleToggle(item)}
            onDelete={() => handleDelete(item)}
          />
        )}
        contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          isLoading ? (
            <View style={{ padding: 60, alignItems: 'center' }}>
              <ActivityIndicator color={muted} />
            </View>
          ) : error ? (
            <View style={{ padding: 40, alignItems: 'center' }}>
              <Text style={{ color: '#ef4444', fontSize: 14, fontFamily: 'Roobert', textAlign: 'center' }}>
                Failed to load tasks
              </Text>
            </View>
          ) : (
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
                <Timer size={28} color={muted} />
              </View>
              <Text style={{ fontSize: 17, fontFamily: 'Roobert-Medium', color: fg, marginBottom: 6 }}>
                No scheduled tasks
              </Text>
              <Text style={{ fontSize: 14, fontFamily: 'Roobert', color: muted, textAlign: 'center', lineHeight: 20, paddingHorizontal: 20 }}>
                Create tasks that run on a schedule to automate your workflows.
              </Text>
            </View>
          )
        }
      />

      {/* FAB — Create Task */}
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

      {/* Detail Sheet */}
      <TaskDetailSheet
        sheetRef={detailSheetRef}
        trigger={selectedTrigger}
        isDark={isDark}
        theme={theme}
        onDismiss={() => setSelectedTrigger(null)}
        onToggle={() => selectedTrigger && handleToggle(selectedTrigger)}
        onDelete={() => selectedTrigger && handleDelete(selectedTrigger)}
        onRunNow={() => selectedTrigger && handleRunNow(selectedTrigger)}
      />

      {/* Create Sheet */}
      <CreateTaskSheet
        sheetRef={createSheetRef}
        isDark={isDark}
        theme={theme}
        renderBackdrop={renderBackdrop}
      />
    </View>
  );
}

// ─── Task List Item ──────────────────────────────────────────────────────────

function TaskListItem({
  trigger,
  isDark,
  theme,
  onPress,
  onToggle,
  onDelete,
}: {
  trigger: Trigger;
  isDark: boolean;
  theme: ReturnType<typeof useThemeColors>;
  onPress: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const fg = isDark ? '#f8f8f8' : '#121215';
  const muted = isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)';
  const isWebhook = trigger.type === 'webhook';

  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 20,
        gap: 12,
      }}
    >
      {/* Icon */}
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          backgroundColor: trigger.isActive
            ? (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
            : (isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {isWebhook ? (
          <Webhook size={18} color={trigger.isActive ? fg : muted} />
        ) : (
          <Timer size={18} color={trigger.isActive ? fg : muted} />
        )}
      </View>

      {/* Name + schedule */}
      <View style={{ flex: 1, opacity: trigger.isActive ? 1 : 0.5 }}>
        <Text style={{ fontSize: 15, fontFamily: 'Roobert-Medium', color: fg }} numberOfLines={1}>
          {trigger.name}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 }}>
          <Text style={{ fontSize: 12, fontFamily: 'Roobert', color: muted }} numberOfLines={1}>
            {isWebhook ? `${trigger.webhook?.method} ${trigger.webhook?.path}` : describeCron(trigger.cronExpr)}
          </Text>
          {trigger.sourceType === 'agent' && (
            <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }}>
              <Text style={{ fontSize: 10, fontFamily: 'Roobert-Medium', color: muted }}>Agent</Text>
            </View>
          )}
        </View>
      </View>

      {/* Timing info */}
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        {trigger.nextRunAt && trigger.isActive && (
          <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: muted }}>
            {formatRelativeTime(trigger.nextRunAt)}
          </Text>
        )}
        {!trigger.isActive && (
          <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }}>
            <Text style={{ fontSize: 10, fontFamily: 'Roobert-Medium', color: muted }}>Paused</Text>
          </View>
        )}
      </View>

      <ChevronRight size={16} color={isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)'} />
    </Pressable>
  );
}

// ─── Task Detail Sheet ───────────────────────────────────────────────────────

function TaskDetailSheet({
  sheetRef,
  trigger,
  isDark,
  theme,
  onDismiss,
  onToggle,
  onDelete,
  onRunNow,
}: {
  sheetRef: React.RefObject<BottomSheet>;
  trigger: Trigger | null;
  isDark: boolean;
  theme: ReturnType<typeof useThemeColors>;
  onDismiss: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onRunNow: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'settings' | 'executions'>('settings');

  const fg = isDark ? '#f8f8f8' : '#121215';
  const muted = isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)';
  const subtleBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)';
  const borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';

  const snapPoints = useMemo(() => ['65%', '90%'], []);

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) {
        onDismiss();
        setTab('settings');
      }
    },
    [onDismiss],
  );

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />
    ),
    [],
  );

  // Reset tab when trigger changes
  useEffect(() => {
    if (trigger) setTab('settings');
  }, [trigger?.id]);

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      onChange={handleSheetChange}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: isDark ? '#161618' : '#FFFFFF' }}
      handleIndicatorStyle={{ backgroundColor: isDark ? '#555' : '#ccc' }}
    >
      <BottomSheetScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 20 }}
      >
        {trigger && (
          <>
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 14,
                  backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {trigger.type === 'webhook' ? (
                  <Webhook size={20} color={fg} />
                ) : (
                  <Timer size={20} color={fg} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 18, fontFamily: 'Roobert-Medium', color: fg }}>{trigger.name}</Text>
                <Text style={{ fontSize: 13, fontFamily: 'Roobert', color: muted, marginTop: 2 }}>
                  {trigger.type === 'webhook' ? 'Webhook' : describeCron(trigger.cronExpr)}
                </Text>
              </View>
              <Switch
                value={trigger.isActive}
                onValueChange={onToggle}
                trackColor={{ false: isDark ? '#333' : '#ddd', true: theme.primary }}
                thumbColor="#fff"
              />
            </View>

            {/* Tabs */}
            <View style={{ flexDirection: 'row', marginBottom: 16, gap: 0, borderRadius: 10, overflow: 'hidden', backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }}>
              {(['settings', 'executions'] as const).map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setTab(t)}
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    alignItems: 'center',
                    backgroundColor: tab === t ? (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)') : 'transparent',
                    borderRadius: 10,
                  }}
                >
                  <Text style={{ fontSize: 13, fontFamily: tab === t ? 'Roobert-Medium' : 'Roobert', color: tab === t ? fg : muted, textTransform: 'capitalize' }}>
                    {t}
                  </Text>
                </Pressable>
              ))}
            </View>

            {tab === 'settings' ? (
              <>
                {/* Info grid */}
                <View style={{ gap: 12, marginBottom: 20 }}>
                  <InfoRow label="Next run" value={formatRelativeTime(trigger.nextRunAt)} isDark={isDark} />
                  <InfoRow label="Last run" value={formatRelativeTime(trigger.lastRunAt)} isDark={isDark} />
                  {trigger.agentName && <InfoRow label="Agent" value={trigger.agentName} isDark={isDark} />}
                  <InfoRow label="Session mode" value={trigger.sessionMode === 'reuse' ? 'Reuse session' : 'New session'} isDark={isDark} />
                  <InfoRow label="Max retries" value={String(trigger.maxRetries)} isDark={isDark} />
                  <InfoRow label="Timeout" value={formatDuration(trigger.timeoutMs)} isDark={isDark} />
                  <InfoRow label="Created" value={new Date(trigger.createdAt).toLocaleDateString()} isDark={isDark} />
                </View>

                {/* Prompt */}
                {trigger.prompt && (
                  <View style={{ marginBottom: 20 }}>
                    <Text style={{ fontSize: 12, fontFamily: 'Roobert-Medium', color: muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                      Prompt
                    </Text>
                    <View style={{ padding: 12, borderRadius: 10, backgroundColor: subtleBg, borderWidth: StyleSheet.hairlineWidth, borderColor }}>
                      <Text style={{ fontSize: 13, fontFamily: 'Roobert', color: fg, lineHeight: 20 }}>
                        {trigger.prompt}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Actions */}
                <View style={{ gap: 10 }}>
                  {trigger.type !== 'webhook' && (
                    <Pressable
                      onPress={onRunNow}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        paddingVertical: 13,
                        borderRadius: 12,
                        backgroundColor: theme.primary,
                      }}
                    >
                      <Play size={16} color={theme.primaryForeground} fill={theme.primaryForeground} />
                      <Text style={{ fontSize: 15, fontFamily: 'Roobert-Medium', color: theme.primaryForeground }}>
                        Run Now
                      </Text>
                    </Pressable>
                  )}

                  {trigger.editable && (
                    <Pressable
                      onPress={onDelete}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        paddingVertical: 13,
                        borderRadius: 12,
                        backgroundColor: isDark ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.06)',
                      }}
                    >
                      <Trash2 size={16} color="#ef4444" />
                      <Text style={{ fontSize: 15, fontFamily: 'Roobert-Medium', color: '#ef4444' }}>
                        Delete Task
                      </Text>
                    </Pressable>
                  )}
                </View>
              </>
            ) : (
              <ExecutionsTab triggerId={trigger.id} isDark={isDark} />
            )}
          </>
        )}
      </BottomSheetScrollView>
    </BottomSheet>
  );
}

// ─── Info Row ────────────────────────────────────────────────────────────────

function InfoRow({ label, value, isDark }: { label: string; value: string; isDark: boolean }) {
  const fg = isDark ? '#f8f8f8' : '#121215';
  const muted = isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)';

  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text style={{ fontSize: 13, fontFamily: 'Roobert', color: muted }}>{label}</Text>
      <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: fg }}>{value}</Text>
    </View>
  );
}

// ─── Executions Tab ──────────────────────────────────────────────────────────

function ExecutionsTab({ triggerId, isDark }: { triggerId: string; isDark: boolean }) {
  const { data: executions, isLoading } = useTaskExecutions(triggerId);
  const fg = isDark ? '#f8f8f8' : '#121215';
  const muted = isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)';

  if (isLoading) {
    return (
      <View style={{ padding: 30, alignItems: 'center' }}>
        <ActivityIndicator color={muted} />
      </View>
    );
  }

  if (!executions || executions.length === 0) {
    return (
      <View style={{ padding: 30, alignItems: 'center' }}>
        <Text style={{ fontSize: 14, fontFamily: 'Roobert', color: muted }}>No executions yet</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      {executions.map((exec) => (
        <ExecutionRow key={exec.executionId} execution={exec} isDark={isDark} />
      ))}
    </View>
  );
}

function ExecutionRow({ execution, isDark }: { execution: Execution; isDark: boolean }) {
  const fg = isDark ? '#f8f8f8' : '#121215';
  const muted = isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)';
  const subtleBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)';

  const statusConfig: Record<ExecutionStatus, { color: string; icon: typeof CheckCircle2 }> = {
    completed: { color: '#34d399', icon: CheckCircle2 },
    failed: { color: '#ef4444', icon: XCircle },
    timeout: { color: '#f59e0b', icon: AlertTriangle },
    skipped: { color: muted, icon: SkipForward },
    running: { color: '#3b82f6', icon: Loader2 },
    pending: { color: muted, icon: Clock },
  };

  const config = statusConfig[execution.status] || statusConfig.pending;
  const StatusIcon = config.icon;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderRadius: 10,
        backgroundColor: subtleBg,
        gap: 10,
      }}
    >
      <StatusIcon size={16} color={config.color} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: fg, textTransform: 'capitalize' }}>
          {execution.status}
        </Text>
        {execution.errorMessage && (
          <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: '#ef4444', marginTop: 2 }} numberOfLines={2}>
            {execution.errorMessage}
          </Text>
        )}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: muted }}>
          {formatDuration(execution.durationMs)}
        </Text>
        <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: muted }}>
          {formatRelativeTime(execution.startedAt || execution.createdAt)}
        </Text>
      </View>
    </View>
  );
}

// ─── Create Task Sheet ───────────────────────────────────────────────────────

function CreateTaskSheet({
  sheetRef,
  isDark,
  theme,
  renderBackdrop,
}: {
  sheetRef: React.RefObject<BottomSheetModal>;
  isDark: boolean;
  theme: ReturnType<typeof useThemeColors>;
  renderBackdrop: (props: any) => React.ReactElement;
}) {
  const insets = useSafeAreaInsets();
  const createTask = useCreateScheduledTask();

  const fg = isDark ? '#f8f8f8' : '#121215';
  const muted = isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)';
  const inputBg = isDark ? 'rgba(248,248,248,0.06)' : 'rgba(18,18,21,0.04)';
  const borderColor = isDark ? 'rgba(248,248,248,0.1)' : 'rgba(18,18,21,0.08)';

  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [frequency, setFrequency] = useState<'hourly' | 'daily' | 'weekly'>('daily');
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);

  const reset = () => {
    setName('');
    setPrompt('');
    setFrequency('daily');
    setHour(9);
    setMinute(0);
  };

  const buildCron = (): string => {
    switch (frequency) {
      case 'hourly':
        return `0 ${minute} * * * *`;
      case 'daily':
        return `0 ${minute} ${hour} * * *`;
      case 'weekly':
        return `0 ${minute} ${hour} * * 1`;
      default:
        return `0 ${minute} ${hour} * * *`;
    }
  };

  const handleCreate = async () => {
    if (!name.trim() || !prompt.trim()) {
      Alert.alert('Missing Fields', 'Name and prompt are required.');
      return;
    }
    Keyboard.dismiss();
    try {
      await createTask.mutateAsync({
        name: name.trim(),
        prompt: prompt.trim(),
        cron_expr: buildCron(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      sheetRef.current?.dismiss();
      reset();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to create task');
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
      backgroundStyle={{
        backgroundColor: isDark ? '#161618' : '#FFFFFF',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
      }}
      handleIndicatorStyle={{
        backgroundColor: isDark ? '#3F3F46' : '#D4D4D8',
        width: 36,
        height: 5,
        borderRadius: 3,
      }}
    >
      <BottomSheetView
        style={{
          paddingHorizontal: 24,
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 20) + 16,
        }}
      >
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: 12,
            }}
          >
            <Timer size={20} color={fg} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 18, fontFamily: 'Roobert-Semibold', color: fg }}>
              New Scheduled Task
            </Text>
            <Text style={{ fontSize: 12, fontFamily: 'Roobert', color: muted, marginTop: 2 }}>
              Run a prompt on a recurring schedule
            </Text>
          </View>
        </View>

        {/* Name */}
        <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: muted, marginBottom: 6 }}>Name</Text>
        <BottomSheetTextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Daily report"
          placeholderTextColor={isDark ? 'rgba(248,248,248,0.25)' : 'rgba(18,18,21,0.3)'}
          style={{ ...inputStyle, marginBottom: 16 }}
        />

        {/* Schedule */}
        <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: muted, marginBottom: 6 }}>Schedule</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          {(['hourly', 'daily', 'weekly'] as const).map((f) => (
            <Pressable
              key={f}
              onPress={() => setFrequency(f)}
              style={{
                flex: 1,
                paddingVertical: 8,
                alignItems: 'center',
                borderRadius: 10,
                backgroundColor: frequency === f ? theme.primary : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'),
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontFamily: frequency === f ? 'Roobert-Medium' : 'Roobert',
                  color: frequency === f ? theme.primaryForeground : muted,
                  textTransform: 'capitalize',
                }}
              >
                {f}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Time picker for daily/weekly */}
        {frequency !== 'hourly' && (
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, fontFamily: 'Roobert', color: muted, marginBottom: 4 }}>Hour</Text>
              <BottomSheetTextInput
                value={String(hour)}
                onChangeText={(t) => { const n = parseInt(t, 10); if (!isNaN(n) && n >= 0 && n <= 23) setHour(n); }}
                keyboardType="number-pad"
                style={inputStyle}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, fontFamily: 'Roobert', color: muted, marginBottom: 4 }}>Minute</Text>
              <BottomSheetTextInput
                value={String(minute)}
                onChangeText={(t) => { const n = parseInt(t, 10); if (!isNaN(n) && n >= 0 && n <= 59) setMinute(n); }}
                keyboardType="number-pad"
                style={inputStyle}
              />
            </View>
          </View>
        )}

        {frequency === 'hourly' && (
          <View style={{ marginBottom: 16 }}>
            <Text style={{ fontSize: 12, fontFamily: 'Roobert', color: muted, marginBottom: 4 }}>At minute</Text>
            <BottomSheetTextInput
              value={String(minute)}
              onChangeText={(t) => { const n = parseInt(t, 10); if (!isNaN(n) && n >= 0 && n <= 59) setMinute(n); }}
              keyboardType="number-pad"
              style={inputStyle}
            />
          </View>
        )}

        {/* Prompt */}
        <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: muted, marginBottom: 6 }}>Prompt</Text>
        <BottomSheetTextInput
          value={prompt}
          onChangeText={setPrompt}
          placeholder="What should the agent do?"
          placeholderTextColor={isDark ? 'rgba(248,248,248,0.25)' : 'rgba(18,18,21,0.3)'}
          multiline
          numberOfLines={3}
          style={{ ...inputStyle, height: 80, textAlignVertical: 'top', marginBottom: 20 }}
        />

        {/* Create button */}
        <Pressable
          onPress={handleCreate}
          disabled={!name.trim() || !prompt.trim() || createTask.isPending}
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: 14,
            borderRadius: 14,
            backgroundColor: (!name.trim() || !prompt.trim()) ? (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)') : theme.primary,
            opacity: (!name.trim() || !prompt.trim()) ? 0.5 : 1,
          }}
        >
          {createTask.isPending ? (
            <ActivityIndicator size="small" color={theme.primaryForeground} />
          ) : (
            <Text style={{ fontSize: 16, fontFamily: 'Roobert-Medium', color: theme.primaryForeground }}>
              Create Task
            </Text>
          )}
        </Pressable>
      </BottomSheetView>
    </BottomSheetModal>
  );
}
