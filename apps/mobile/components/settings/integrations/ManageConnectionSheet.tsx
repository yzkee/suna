/**
 * ManageConnectionSheet — Bottom sheet for managing a connected Pipedream integration.
 * Rename, view status, disconnect.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, TextInput, Pressable, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { Text } from '@/components/ui/text';
import BottomSheet, { BottomSheetBackdrop, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pencil, Trash2, Check, X, Calendar, Clock } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

import { AppIcon } from './AppIcon';
import {
  useRenameIntegration,
  useDisconnectIntegration,
  type IntegrationConnection,
} from '@/hooks/useIntegrations';
import { log } from '@/lib/logger';

interface ManageConnectionSheetProps {
  connection: IntegrationConnection | null;
  onDismiss: () => void;
}

export function ManageConnectionSheet({ connection, onDismiss }: ManageConnectionSheetProps) {
  const sheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['55%', '80%'], []);
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();

  const rename = useRenameIntegration();
  const disconnect = useDisconnectIntegration();

  const [isEditing, setIsEditing] = useState(false);
  const [labelDraft, setLabelDraft] = useState('');

  // Present/dismiss based on connection
  useEffect(() => {
    if (connection) {
      setIsEditing(false);
      setLabelDraft(connection.label || connection.appName || connection.app);
      sheetRef.current?.snapToIndex(0);
    } else {
      sheetRef.current?.close();
    }
  }, [connection]);

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) onDismiss();
    },
    [onDismiss],
  );

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />
    ),
    [],
  );

  const handleSaveLabel = useCallback(async () => {
    if (!connection || !labelDraft.trim()) return;
    try {
      await rename.mutateAsync({ integrationId: connection.integrationId, label: labelDraft.trim() });
      setIsEditing(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to rename');
    }
  }, [connection, labelDraft, rename]);

  const handleDisconnect = useCallback(() => {
    if (!connection) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(
      'Disconnect Integration',
      `Remove ${connection.appName || connection.app}? This will revoke access.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            try {
              await disconnect.mutateAsync(connection.integrationId);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              onDismiss();
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Failed to disconnect');
            }
          },
        },
      ],
    );
  }, [connection, disconnect, onDismiss]);

  const fg = isDark ? '#f8f8f8' : '#121215';
  const muted = isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)';
  const border = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const cardBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)';

  const displayName = connection?.label || connection?.appName || connection?.app || '';

  const formatDate = (iso: string | null) => {
    if (!iso) return null;
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return null;
    }
  };

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
        {connection && (
          <>
            {/* Header */}
            <View style={{ alignItems: 'center', marginBottom: 24 }}>
              <AppIcon name={connection.appName || connection.app} imgSrc={(connection.metadata as any)?.imgSrc} size={56} />
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 8 }}>
                {isEditing ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <TextInput
                      value={labelDraft}
                      onChangeText={setLabelDraft}
                      onSubmitEditing={handleSaveLabel}
                      autoFocus
                      style={{
                        fontSize: 18,
                        fontFamily: 'Roobert-Medium',
                        color: fg,
                        borderBottomWidth: 1,
                        borderBottomColor: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)',
                        paddingVertical: 2,
                        minWidth: 120,
                        textAlign: 'center',
                      }}
                    />
                    <Pressable onPress={handleSaveLabel} hitSlop={8}>
                      {rename.isPending ? (
                        <ActivityIndicator size="small" color={fg} />
                      ) : (
                        <Check size={18} color="#34d399" />
                      )}
                    </Pressable>
                    <Pressable onPress={() => setIsEditing(false)} hitSlop={8}>
                      <X size={18} color={muted} />
                    </Pressable>
                  </View>
                ) : (
                  <>
                    <Text style={{ fontSize: 18, fontFamily: 'Roobert-Medium', color: fg }}>
                      {displayName}
                    </Text>
                    <Pressable onPress={() => setIsEditing(true)} hitSlop={8}>
                      <Pencil size={14} color={muted} />
                    </Pressable>
                  </>
                )}
              </View>

              {/* Status badge */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  marginTop: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 12,
                  backgroundColor: connection.status === 'active'
                    ? (isDark ? 'rgba(52,211,153,0.1)' : 'rgba(52,211,153,0.08)')
                    : (isDark ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.08)'),
                }}
              >
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: connection.status === 'active' ? '#34d399' : '#ef4444',
                  }}
                />
                <Text
                  style={{
                    fontSize: 12,
                    fontFamily: 'Roobert-Medium',
                    color: connection.status === 'active' ? '#34d399' : '#ef4444',
                    textTransform: 'capitalize',
                  }}
                >
                  {connection.status}
                </Text>
              </View>
            </View>

            {/* Info rows */}
            <View style={{ gap: 12, marginBottom: 24 }}>
              {connection.connectedAt && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Calendar size={16} color={muted} />
                  <Text style={{ fontSize: 14, fontFamily: 'Roobert', color: muted }}>
                    Connected {formatDate(connection.connectedAt)}
                  </Text>
                </View>
              )}
              {connection.lastUsedAt && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Clock size={16} color={muted} />
                  <Text style={{ fontSize: 14, fontFamily: 'Roobert', color: muted }}>
                    Last used {formatDate(connection.lastUsedAt)}
                  </Text>
                </View>
              )}
            </View>

            {/* Disconnect */}
            <Pressable
              onPress={handleDisconnect}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                paddingVertical: 14,
                borderRadius: 14,
                backgroundColor: isDark ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.06)',
              }}
            >
              {disconnect.isPending ? (
                <ActivityIndicator size="small" color="#ef4444" />
              ) : (
                <Trash2 size={16} color="#ef4444" />
              )}
              <Text style={{ fontSize: 15, fontFamily: 'Roobert-Medium', color: '#ef4444' }}>
                Disconnect
              </Text>
            </Pressable>
          </>
        )}
      </BottomSheetScrollView>
    </BottomSheet>
  );
}
