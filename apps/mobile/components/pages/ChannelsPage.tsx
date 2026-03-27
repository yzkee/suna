/**
 * ChannelsPage — full-screen channels management.
 * Create, list, enable/disable, link/unlink, delete channels.
 * Matches frontend /channels functionality.
 */

import React, { useState, useCallback, useMemo, useRef } from 'react';
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
  Plus,
  Search,
  X,
  ChevronRight,
  Trash2,
  Radio,
} from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';

import { useThemeColors } from '@/lib/theme-colors';
import { useSandboxContext } from '@/contexts/SandboxContext';
import type { PageTab } from '@/stores/tab-store';
import {
  useChannels,
  useCreateChannel,
  useUpdateChannel,
  useDeleteChannel,
  useToggleChannel,
  useLinkChannel,
  useUnlinkChannel,
  getChannelTypeLabel,
  type ChannelConfig,
  type ChannelType,
} from '@/hooks/useChannels';

// ─── Channel Type Icons ─────────────────────────────────────────────────────

const CHANNEL_TYPE_ICONS: Record<ChannelType, string> = {
  telegram: 'paper-plane-outline',
  slack: 'logo-slack',
  discord: 'logo-discord',
  whatsapp: 'chatbubble-outline',
  teams: 'people-outline',
  voice: 'mic-outline',
  email: 'mail-outline',
  sms: 'chatbox-outline',
};

function getChannelIcon(type: ChannelType): string {
  return CHANNEL_TYPE_ICONS[type] || 'radio-outline';
}

const SUPPORTED_CHANNEL_TYPES: ChannelType[] = ['telegram', 'slack'];

const ALL_CHANNEL_TYPES: { type: ChannelType; label: string }[] = [
  { type: 'telegram', label: 'Telegram' },
  { type: 'slack', label: 'Slack' },
  { type: 'discord', label: 'Discord' },
  { type: 'whatsapp', label: 'WhatsApp' },
  { type: 'teams', label: 'Teams' },
  { type: 'voice', label: 'Voice' },
  { type: 'email', label: 'Email' },
  { type: 'sms', label: 'SMS' },
];

// ─── Tab Page Wrapper ────────────────────────────────────────────────────────

interface ChannelsTabPageProps {
  page: PageTab;
  onBack: () => void;
  onOpenDrawer?: () => void;
  onOpenRightDrawer?: () => void;
}

export function ChannelsTabPage({
  page,
  onBack,
  onOpenDrawer,
  onOpenRightDrawer,
}: ChannelsTabPageProps) {
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
      <ChannelsContent />
    </View>
  );
}

// ─── Main Content ────────────────────────────────────────────────────────────

function ChannelsContent() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const theme = useThemeColors();
  const { sandboxUuid, sandboxName } = useSandboxContext();

  const { data: channels, isLoading, error, refetch } = useChannels();
  const createChannel = useCreateChannel();
  const deleteChannelMut = useDeleteChannel();
  const toggleChannel = useToggleChannel();
  const linkChannel = useLinkChannel();
  const unlinkChannel = useUnlinkChannel();
  const updateChannel = useUpdateChannel();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedChannel, setSelectedChannel] = useState<ChannelConfig | null>(null);

  const detailSheetRef = useRef<BottomSheet>(null);
  const addSheetRef = useRef<BottomSheetModal>(null);

  // Colors
  const fg = isDark ? '#f8f8f8' : '#121215';
  const muted = isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)';
  const subtleBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)';
  const borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const inputBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';

  // Filter + sort channels
  const filteredChannels = useMemo(() => {
    if (!channels) return [];
    let list = [...channels];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.channelType.toLowerCase().includes(q) ||
          getChannelTypeLabel(c.channelType).toLowerCase().includes(q),
      );
    }

    // Sort: enabled first, then by updatedAt desc
    list.sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    return list;
  }, [channels, searchQuery]);

  // Handlers
  const handleSelectChannel = useCallback((channel: ChannelConfig) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedChannel(channel);
    detailSheetRef.current?.snapToIndex(0);
  }, []);

  const handleDelete = useCallback(
    (channel: ChannelConfig) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert('Delete Channel', `Delete "${channel.name}"? This cannot be undone.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteChannelMut.mutateAsync(channel.channelConfigId);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              detailSheetRef.current?.close();
              setSelectedChannel(null);
            } catch {
              Alert.alert('Error', 'Failed to delete channel');
            }
          },
        },
      ]);
    },
    [deleteChannelMut],
  );

  const handleOpenAdd = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    addSheetRef.current?.present();
  }, []);

  const renderBackdrop = useCallback(
    (props: any) => <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />,
    [],
  );

  const renderItem = useCallback(
    ({ item }: { item: ChannelConfig }) => (
      <ChannelRow
        channel={item}
        isDark={isDark}
        onPress={() => handleSelectChannel(item)}
      />
    ),
    [isDark, handleSelectChannel],
  );

  return (
    <View style={{ flex: 1 }}>
      {/* Search Bar */}
      <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: inputBg,
            borderRadius: 12,
            paddingHorizontal: 12,
            height: 40,
          }}
        >
          <Search size={16} color={muted} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search channels..."
            placeholderTextColor={muted}
            style={{
              flex: 1,
              marginLeft: 8,
              fontSize: 14,
              fontFamily: 'Roobert',
              color: fg,
              paddingVertical: 0,
            }}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={10}>
              <X size={16} color={muted} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Channel List */}
      {isLoading ? (
        <View style={{ padding: 60, alignItems: 'center' }}>
          <ActivityIndicator color={muted} />
        </View>
      ) : error ? (
        <View style={{ padding: 40, alignItems: 'center' }}>
          <Radio size={28} color={muted} />
          <Text style={{ fontSize: 14, fontFamily: 'Roobert', color: muted, marginTop: 12, textAlign: 'center' }}>
            Failed to load channels
          </Text>
          <Pressable
            onPress={() => refetch()}
            style={{ marginTop: 12, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}
          >
            <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: fg }}>Try Again</Text>
          </Pressable>
        </View>
      ) : filteredChannels.length === 0 ? (
        <View style={{ padding: 60, alignItems: 'center' }}>
          <Radio size={32} color={muted} />
          <Text style={{ fontSize: 16, fontFamily: 'Roobert-Medium', color: fg, marginTop: 16 }}>
            No channels
          </Text>
          <Text style={{ fontSize: 13, fontFamily: 'Roobert', color: muted, marginTop: 6, textAlign: 'center', lineHeight: 18, paddingHorizontal: 20 }}>
            {searchQuery ? 'No channels match your search.' : 'Connect messaging platforms to your sandbox to receive and respond to messages.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredChannels}
          keyExtractor={(item) => item.channelConfigId}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* FAB - Add Channel */}
      <View
        style={{
          position: 'absolute',
          bottom: insets.bottom + 24,
          right: 20,
        }}
      >
        <Pressable
          onPress={handleOpenAdd}
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
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
      </View>

      {/* Detail Sheet */}
      <ChannelDetailSheet
        sheetRef={detailSheetRef}
        channel={selectedChannel}
        isDark={isDark}
        theme={theme}
        sandboxUuid={sandboxUuid}
        sandboxName={sandboxName}
        onToggle={async (channel, enabled) => {
          try {
            await toggleChannel.mutateAsync({ id: channel.channelConfigId, enabled });
            // Update selected channel locally
            setSelectedChannel((prev) => prev ? { ...prev, enabled } : null);
          } catch {
            Alert.alert('Error', 'Failed to toggle channel');
          }
        }}
        onLink={async (channel) => {
          if (!sandboxUuid) return;
          try {
            await linkChannel.mutateAsync({ id: channel.channelConfigId, sandboxId: sandboxUuid });
            setSelectedChannel((prev) => prev ? { ...prev, sandboxId: sandboxUuid, sandbox: { name: sandboxName || '', status: 'running' } } : null);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch {
            Alert.alert('Error', 'Failed to link channel');
          }
        }}
        onUnlink={async (channel) => {
          try {
            await unlinkChannel.mutateAsync(channel.channelConfigId);
            setSelectedChannel((prev) => prev ? { ...prev, sandboxId: null, sandbox: undefined } : null);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch {
            Alert.alert('Error', 'Failed to unlink channel');
          }
        }}
        onSave={async (channel, name) => {
          try {
            await updateChannel.mutateAsync({ id: channel.channelConfigId, data: { name } });
            setSelectedChannel((prev) => prev ? { ...prev, name } : null);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch {
            Alert.alert('Error', 'Failed to update channel');
          }
        }}
        onDelete={handleDelete}
        onClose={() => {
          detailSheetRef.current?.close();
          setSelectedChannel(null);
        }}
      />

      {/* Add Channel Sheet */}
      <AddChannelSheet
        sheetRef={addSheetRef}
        isDark={isDark}
        theme={theme}
        renderBackdrop={renderBackdrop}
        onCreate={async (data) => {
          try {
            await createChannel.mutateAsync(data);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            addSheetRef.current?.dismiss();
          } catch (err: any) {
            Alert.alert('Error', err?.message || 'Failed to create channel');
          }
        }}
        isCreating={createChannel.isPending}
      />
    </View>
  );
}

// ─── Channel Row ─────────────────────────────────────────────────────────────

function ChannelRow({
  channel,
  isDark,
  onPress,
}: {
  channel: ChannelConfig;
  isDark: boolean;
  onPress: () => void;
}) {
  const fg = isDark ? '#f8f8f8' : '#121215';
  const muted = isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)';

  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={getChannelIcon(channel.channelType) as any} size={18} color={muted} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 14, fontFamily: 'Roobert-Medium', color: fg }} numberOfLines={1}>
            {channel.name}
          </Text>
          <ChannelStatusDot enabled={channel.enabled} isDark={isDark} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: muted }}>
            {getChannelTypeLabel(channel.channelType)}
          </Text>
          <Text style={{ fontSize: 11, color: muted }}>·</Text>
          <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: muted }}>
            {channel.sandbox?.name || 'Not linked'}
          </Text>
        </View>
      </View>
      <ChevronRight size={16} color={muted} />
    </Pressable>
  );
}

// ─── Channel Status Dot ──────────────────────────────────────────────────────

function ChannelStatusDot({ enabled, isDark }: { enabled: boolean; isDark: boolean }) {
  const color = enabled ? '#34d399' : (isDark ? 'rgba(248,248,248,0.35)' : 'rgba(18,18,21,0.35)');
  const label = enabled ? 'Active' : 'Disabled';

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ fontSize: 11, fontFamily: 'Roobert', color }}>{label}</Text>
    </View>
  );
}

// ─── Channel Detail Sheet ────────────────────────────────────────────────────

function ChannelDetailSheet({
  sheetRef,
  channel,
  isDark,
  theme,
  sandboxUuid,
  sandboxName,
  onToggle,
  onLink,
  onUnlink,
  onSave,
  onDelete,
  onClose,
}: {
  sheetRef: React.RefObject<BottomSheet>;
  channel: ChannelConfig | null;
  isDark: boolean;
  theme: ReturnType<typeof useThemeColors>;
  sandboxUuid?: string;
  sandboxName?: string;
  onToggle: (channel: ChannelConfig, enabled: boolean) => void;
  onLink: (channel: ChannelConfig) => void;
  onUnlink: (channel: ChannelConfig) => void;
  onSave: (channel: ChannelConfig, name: string) => void;
  onDelete: (channel: ChannelConfig) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [editName, setEditName] = useState('');
  const [nameChanged, setNameChanged] = useState(false);

  const fg = isDark ? '#f8f8f8' : '#121215';
  const muted = isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)';
  const inputBg = isDark ? 'rgba(248,248,248,0.06)' : 'rgba(18,18,21,0.04)';
  const borderColor = isDark ? 'rgba(248,248,248,0.1)' : 'rgba(18,18,21,0.08)';
  const subtleBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)';

  // Sync edit name when channel changes
  React.useEffect(() => {
    if (channel) {
      setEditName(channel.name);
      setNameChanged(false);
    }
  }, [channel?.channelConfigId]);

  const handleNameChange = useCallback((text: string) => {
    setEditName(text);
    setNameChanged(text.trim() !== (channel?.name || ''));
  }, [channel?.name]);

  if (!channel) return null;

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={['65%']}
      enablePanDownToClose
      onClose={onClose}
      backgroundStyle={{ backgroundColor: isDark ? '#161618' : '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24 }}
      handleIndicatorStyle={{ backgroundColor: isDark ? '#3F3F46' : '#D4D4D8', width: 36, height: 5, borderRadius: 3 }}
    >
      <View style={{ flex: 1, paddingHorizontal: 24, paddingBottom: Math.max(insets.bottom, 20) }}>
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
            <Ionicons name={getChannelIcon(channel.channelType) as any} size={20} color={fg} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 18, fontFamily: 'Roobert-Semibold', color: fg }} numberOfLines={1}>
                {channel.name}
              </Text>
              <ChannelStatusDot enabled={channel.enabled} isDark={isDark} />
            </View>
            <Text style={{ fontSize: 12, fontFamily: 'Roobert', color: muted, marginTop: 2 }}>
              {getChannelTypeLabel(channel.channelType)}
            </Text>
          </View>
          <Switch
            value={channel.enabled}
            onValueChange={(val) => onToggle(channel, val)}
            trackColor={{ false: isDark ? '#3F3F46' : '#D4D4D8', true: '#34d399' }}
            thumbColor="#fff"
          />
        </View>

        {/* Name Input */}
        <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: muted, marginBottom: 6 }}>Name</Text>
        <TextInput
          value={editName}
          onChangeText={handleNameChange}
          placeholder="Channel name"
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
            marginBottom: 16,
          }}
        />

        {/* Linked Sandbox */}
        <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: muted, marginBottom: 6 }}>Linked Sandbox</Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            padding: 12,
            borderRadius: 12,
            backgroundColor: subtleBg,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
            marginBottom: 16,
          }}
        >
          <Ionicons name="cube-outline" size={18} color={muted} style={{ marginRight: 10 }} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontFamily: 'Roobert-Medium', color: fg }}>
              {channel.sandbox?.name || 'Not linked'}
            </Text>
            {!channel.sandboxId && (
              <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: muted, marginTop: 2 }}>
                Link to a sandbox to start receiving messages
              </Text>
            )}
          </View>
          {channel.sandboxId ? (
            <Pressable
              onPress={() => onUnlink(channel)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 8,
                backgroundColor: isDark ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.08)',
              }}
            >
              <Text style={{ fontSize: 12, fontFamily: 'Roobert-Medium', color: '#ef4444' }}>Unlink</Text>
            </Pressable>
          ) : sandboxUuid ? (
            <Pressable
              onPress={() => onLink(channel)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 8,
                backgroundColor: theme.primary,
              }}
            >
              <Text style={{ fontSize: 12, fontFamily: 'Roobert-Medium', color: theme.primaryForeground }}>Link</Text>
            </Pressable>
          ) : null}
        </View>

        {/* Save Button (only when name changed) */}
        {nameChanged && (
          <Pressable
            onPress={() => onSave(channel, editName.trim())}
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: 14,
              borderRadius: 14,
              backgroundColor: theme.primary,
              marginBottom: 16,
            }}
          >
            <Text style={{ fontSize: 16, fontFamily: 'Roobert-Medium', color: theme.primaryForeground }}>
              Save Changes
            </Text>
          </Pressable>
        )}

        {/* Danger Zone — Delete */}
        <View
          style={{
            marginTop: 'auto',
            padding: 14,
            borderRadius: 14,
            backgroundColor: isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.04)',
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontFamily: 'Roobert-Medium', color: '#ef4444' }}>Delete Channel</Text>
              <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: isDark ? 'rgba(239,68,68,0.7)' : 'rgba(239,68,68,0.6)', marginTop: 2 }}>
                Permanently remove this channel
              </Text>
            </View>
            <Pressable
              onPress={() => onDelete(channel)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 10,
                backgroundColor: isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.1)',
              }}
            >
              <Trash2 size={14} color="#ef4444" />
              <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: '#ef4444' }}>Delete</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </BottomSheet>
  );
}

// ─── Add Channel Sheet ───────────────────────────────────────────────────────

function AddChannelSheet({
  sheetRef,
  isDark,
  theme,
  renderBackdrop,
  onCreate,
  isCreating,
}: {
  sheetRef: React.RefObject<BottomSheetModal>;
  isDark: boolean;
  theme: ReturnType<typeof useThemeColors>;
  renderBackdrop: (props: any) => React.ReactElement;
  onCreate: (data: { name: string; channel_type: ChannelType }) => void;
  isCreating: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [selectedType, setSelectedType] = useState<ChannelType | null>(null);
  const [channelName, setChannelName] = useState('');

  const fg = isDark ? '#f8f8f8' : '#121215';
  const muted = isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)';
  const inputBg = isDark ? 'rgba(248,248,248,0.06)' : 'rgba(18,18,21,0.04)';
  const borderColor = isDark ? 'rgba(248,248,248,0.1)' : 'rgba(18,18,21,0.08)';

  const reset = () => {
    setSelectedType(null);
    setChannelName('');
  };

  const handleCreate = () => {
    if (!selectedType || !channelName.trim()) return;
    Keyboard.dismiss();
    onCreate({ name: channelName.trim(), channel_type: selectedType });
    reset();
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
      backgroundStyle={{ backgroundColor: isDark ? '#161618' : '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24 }}
      handleIndicatorStyle={{ backgroundColor: isDark ? '#3F3F46' : '#D4D4D8', width: 36, height: 5, borderRadius: 3 }}
    >
      <BottomSheetView style={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 20) + 16 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
            <Radio size={20} color={fg} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 18, fontFamily: 'Roobert-Semibold', color: fg }}>
              {selectedType ? `New ${getChannelTypeLabel(selectedType)} Channel` : 'Add Channel'}
            </Text>
            <Text style={{ fontSize: 12, fontFamily: 'Roobert', color: muted, marginTop: 2 }}>
              {selectedType ? 'Configure your new channel' : 'Choose a messaging platform'}
            </Text>
          </View>
        </View>

        {!selectedType ? (
          /* Channel Type Grid */
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
            {ALL_CHANNEL_TYPES.map((ct) => {
              const isSupported = SUPPORTED_CHANNEL_TYPES.includes(ct.type);
              return (
                <Pressable
                  key={ct.type}
                  onPress={() => {
                    if (isSupported) {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setSelectedType(ct.type);
                    }
                  }}
                  disabled={!isSupported}
                  style={{
                    width: '48%' as any,
                    flexGrow: 1,
                    padding: 14,
                    borderRadius: 14,
                    backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                    alignItems: 'center',
                    gap: 8,
                    opacity: isSupported ? 1 : 0.5,
                  }}
                >
                  <Ionicons name={getChannelIcon(ct.type) as any} size={24} color={isSupported ? fg : muted} />
                  <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: isSupported ? fg : muted }}>
                    {ct.label}
                  </Text>
                  {!isSupported && (
                    <View
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                        borderRadius: 6,
                        backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                      }}
                    >
                      <Text style={{ fontSize: 10, fontFamily: 'Roobert', color: muted }}>Coming Soon</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        ) : (
          /* Channel Setup Form */
          <>
            {/* Back to type selection */}
            <Pressable
              onPress={() => {
                setSelectedType(null);
                setChannelName('');
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 16 }}
            >
              <Ionicons name="chevron-back" size={16} color={muted} />
              <Text style={{ fontSize: 13, fontFamily: 'Roobert', color: muted }}>Back</Text>
            </Pressable>

            {/* Name Input */}
            <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: muted, marginBottom: 6 }}>Channel Name</Text>
            <BottomSheetTextInput
              value={channelName}
              onChangeText={setChannelName}
              placeholder={`e.g. My ${getChannelTypeLabel(selectedType)} Bot`}
              placeholderTextColor={isDark ? 'rgba(248,248,248,0.25)' : 'rgba(18,18,21,0.3)'}
              autoFocus
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

            {/* Create Button */}
            <Pressable
              onPress={handleCreate}
              disabled={!channelName.trim() || isCreating}
              style={{
                alignItems: 'center',
                justifyContent: 'center',
                paddingVertical: 14,
                borderRadius: 14,
                backgroundColor: !channelName.trim()
                  ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)')
                  : theme.primary,
              }}
            >
              {isCreating ? (
                <ActivityIndicator size="small" color={theme.primaryForeground} />
              ) : (
                <Text
                  style={{
                    fontSize: 16,
                    fontFamily: 'Roobert-Medium',
                    color: !channelName.trim() ? muted : theme.primaryForeground,
                  }}
                >
                  Create Channel
                </Text>
              )}
            </Pressable>
          </>
        )}
      </BottomSheetView>
    </BottomSheetModal>
  );
}
