/**
 * SecretsPage — Environment variables / secrets manager for the mobile app.
 *
 * Uses the OpenCode env API (GET/PUT/DELETE {sandboxUrl}/env) to list,
 * create, update, and delete secrets — matching the web frontend.
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  View,
  TouchableOpacity,
  ScrollView,
  Alert,
  RefreshControl,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text } from '@/components/ui/text';
import {
  Plus,
  Trash2,
  Pencil,
  Eye,
  EyeOff,
  Key,
  Check,
  X,
  Search,
} from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { useSandboxContext } from '@/contexts/SandboxContext';
import { getAuthToken } from '@/api/config';
import { log } from '@/lib/logger';
import type { PageTab } from '@/stores/tab-store';

// ─── API hooks ───────────────────────────────────────────────────────────────

function useSecrets(sandboxUrl: string | undefined) {
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSecrets = useCallback(async () => {
    if (!sandboxUrl) return;
    setIsLoading(true);
    setError(null);
    try {
      const token = await getAuthToken();
      const res = await fetch(`${sandboxUrl}/env`, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) throw new Error(`Failed to fetch secrets: ${res.status}`);
      const data = await res.json();
      setSecrets(data.secrets ?? data ?? {});
    } catch (err: any) {
      log.error('Failed to fetch secrets:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [sandboxUrl]);

  useEffect(() => {
    fetchSecrets();
  }, [fetchSecrets]);

  return { secrets, isLoading, error, refetch: fetchSecrets };
}

async function setSecret(sandboxUrl: string, key: string, value: string): Promise<void> {
  const token = await getAuthToken();
  const res = await fetch(`${sandboxUrl}/env/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error(`Failed to set secret: ${res.status}`);
}

async function deleteSecret(sandboxUrl: string, key: string): Promise<void> {
  const token = await getAuthToken();
  const res = await fetch(`${sandboxUrl}/env/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`Failed to delete secret: ${res.status}`);
}

// ─── Secret Row ──────────────────────────────────────────────────────────────

function SecretRow({
  secretKey,
  value,
  isDark,
  editingKey,
  confirmDeleteKey,
  visibleKeys,
  onEdit,
  onDelete,
  onToggleVisibility,
  onSave,
  onCancelEdit,
  onConfirmDelete,
  onCancelDelete,
  isSaving,
  isDeleting,
}: {
  secretKey: string;
  value: string;
  isDark: boolean;
  editingKey: string | null;
  confirmDeleteKey: string | null;
  visibleKeys: Set<string>;
  onEdit: (key: string) => void;
  onDelete: (key: string) => void;
  onToggleVisibility: (key: string) => void;
  onSave: (key: string, value: string) => void;
  onCancelEdit: () => void;
  onConfirmDelete: (key: string) => void;
  onCancelDelete: () => void;
  isSaving: boolean;
  isDeleting: boolean;
}) {
  const [editValue, setEditValue] = useState(value);
  const isEditing = editingKey === secretKey;
  const isConfirmingDelete = confirmDeleteKey === secretKey;
  const isVisible = visibleKeys.has(secretKey);
  const hasValue = !!value;

  useEffect(() => {
    if (isEditing) setEditValue(value);
  }, [isEditing, value]);

  const fg = isDark ? '#F8F8F8' : '#121215';
  const mutedColor = isDark ? '#71717a' : '#a1a1aa';
  const borderColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const monoFont = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

  return (
    <View
      style={{
        borderBottomWidth: 1,
        borderBottomColor: borderColor,
        paddingHorizontal: 16,
        paddingVertical: 12,
      }}
    >
      {/* Key name */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
        <Key size={12} color={mutedColor} style={{ marginRight: 6 }} />
        <Text
          style={{
            fontSize: 13,
            fontFamily: monoFont,
            color: hasValue ? fg : mutedColor,
            flex: 1,
          }}
          numberOfLines={1}
        >
          {secretKey}
        </Text>
      </View>

      {/* Value / Edit / Delete confirm */}
      {isEditing ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TextInput
            value={editValue}
            onChangeText={setEditValue}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => onSave(secretKey, editValue)}
            style={{
              flex: 1,
              fontSize: 13,
              fontFamily: monoFont,
              color: fg,
              backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
              borderRadius: 8,
              paddingHorizontal: 10,
              paddingVertical: 8,
              borderWidth: 1,
              borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
            }}
            placeholderTextColor={mutedColor}
            placeholder="Enter value..."
            secureTextEntry={false}
          />
          <TouchableOpacity
            onPress={() => onSave(secretKey, editValue)}
            disabled={isSaving}
            style={{ padding: 6 }}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color={fg} />
            ) : (
              <Check size={18} color={isDark ? '#4ade80' : '#16a34a'} />
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={onCancelEdit} style={{ padding: 6 }}>
            <X size={18} color={mutedColor} />
          </TouchableOpacity>
        </View>
      ) : isConfirmingDelete ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 12, fontFamily: 'Roobert', color: isDark ? '#f87171' : '#dc2626' }}>
            Remove this key?
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              onPress={() => onConfirmDelete(secretKey)}
              disabled={isDeleting}
              style={{ padding: 6 }}
            >
              {isDeleting ? (
                <ActivityIndicator size="small" color={isDark ? '#f87171' : '#dc2626'} />
              ) : (
                <Check size={18} color={isDark ? '#f87171' : '#dc2626'} />
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={onCancelDelete} style={{ padding: 6 }}>
              <X size={18} color={mutedColor} />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {/* Masked/visible value */}
          <Text
            style={{
              flex: 1,
              fontSize: 12,
              fontFamily: monoFont,
              color: hasValue ? mutedColor : (isDark ? '#52525b' : '#d4d4d8'),
            }}
            numberOfLines={1}
          >
            {!hasValue ? 'empty' : isVisible ? value : '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'}
          </Text>

          {/* Actions */}
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {hasValue && (
              <TouchableOpacity
                onPress={() => onToggleVisibility(secretKey)}
                style={{ padding: 6 }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                {isVisible ? (
                  <EyeOff size={15} color={mutedColor} />
                ) : (
                  <Eye size={15} color={mutedColor} />
                )}
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => onEdit(secretKey)}
              style={{ padding: 6 }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Pencil size={15} color={mutedColor} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onDelete(secretKey)}
              style={{ padding: 6 }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Trash2 size={15} color={mutedColor} />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

// ─── SecretsPage ─────────────────────────────────────────────────────────────

interface SecretsPageProps {
  page: PageTab;
  onBack: () => void;
  onOpenDrawer?: () => void;
  onOpenRightDrawer?: () => void;
}

export function SecretsPage({ page, onBack, onOpenDrawer, onOpenRightDrawer }: SecretsPageProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const { sandboxUrl } = useSandboxContext();

  const fg = isDark ? '#F8F8F8' : '#121215';
  const mutedColor = isDark ? '#71717a' : '#a1a1aa';
  const bgColor = isDark ? '#121215' : '#F8F8F8';
  const cardBg = isDark ? 'rgba(255,255,255,0.03)' : '#FFFFFF';
  const borderColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const monoFont = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

  // Data
  const { secrets, isLoading, error, refetch } = useSecrets(sandboxUrl);

  // UI state
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Derived data
  const rows = useMemo(() => {
    const entries = Object.entries(secrets).map(([key, value]) => ({
      key,
      value: value || '',
      hasValue: !!value,
    }));
    entries.sort((a, b) => a.key.localeCompare(b.key));
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return entries.filter((e) => e.key.toLowerCase().includes(q));
    }
    return entries;
  }, [secrets, searchQuery]);

  // Handlers
  const handleAdd = useCallback(async () => {
    if (!sandboxUrl || !newKey.trim()) return;
    setIsSaving(true);
    try {
      await setSecret(sandboxUrl, newKey.trim(), newValue);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNewKey('');
      setNewValue('');
      setShowAddForm(false);
      refetch();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setIsSaving(false);
    }
  }, [sandboxUrl, newKey, newValue, refetch]);

  const handleSave = useCallback(async (key: string, value: string) => {
    if (!sandboxUrl) return;
    setIsSaving(true);
    try {
      await setSecret(sandboxUrl, key, value);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditingKey(null);
      refetch();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setIsSaving(false);
    }
  }, [sandboxUrl, refetch]);

  const handleConfirmDelete = useCallback(async (key: string) => {
    if (!sandboxUrl) return;
    setIsDeleting(true);
    try {
      await deleteSecret(sandboxUrl, key);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setConfirmDeleteKey(null);
      refetch();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setIsDeleting(false);
    }
  }, [sandboxUrl, refetch]);

  const handleToggleVisibility = useCallback((key: string) => {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleEdit = useCallback((key: string) => {
    setConfirmDeleteKey(null);
    setEditingKey(key);
  }, []);

  const handleDelete = useCallback((key: string) => {
    setEditingKey(null);
    setConfirmDeleteKey(key);
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: bgColor }}>
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingBottom: 12,
          paddingHorizontal: 16,
          borderBottomWidth: 1,
          borderBottomColor: borderColor,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {onOpenDrawer && (
              <TouchableOpacity onPress={onOpenDrawer} style={{ marginRight: 12 }}>
                <Ionicons name="menu-outline" size={22} color={fg} />
              </TouchableOpacity>
            )}
            <Text style={{ fontSize: 17, fontFamily: 'Roobert-SemiBold', color: fg }}>
              Secrets
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity
              onPress={() => {
                setShowAddForm(true);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: fg,
                borderRadius: 8,
                paddingHorizontal: 12,
                paddingVertical: 6,
              }}
            >
              <Plus size={14} color={bgColor} style={{ marginRight: 4 }} />
              <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: bgColor }}>
                Add
              </Text>
            </TouchableOpacity>
            {onOpenRightDrawer && (
              <TouchableOpacity onPress={onOpenRightDrawer}>
                <Ionicons name="apps-outline" size={22} color={fg} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Search bar */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
            borderRadius: 10,
            paddingHorizontal: 10,
            marginTop: 12,
            borderWidth: 1,
            borderColor: borderColor,
          }}
        >
          <Search size={14} color={mutedColor} style={{ marginRight: 6 }} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search secrets..."
            placeholderTextColor={mutedColor}
            style={{
              flex: 1,
              fontSize: 13,
              fontFamily: 'Roobert',
              color: fg,
              paddingVertical: 9,
            }}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 60}
      >
        <ScrollView
          style={{ flex: 1 }}
          refreshControl={
            <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={mutedColor} />
          }
          keyboardShouldPersistTaps="handled"
        >
          {/* Add form */}
          {showAddForm && (
            <View
              style={{
                paddingHorizontal: 16,
                paddingVertical: 14,
                borderBottomWidth: 1,
                borderBottomColor: borderColor,
                backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)',
              }}
            >
              <TextInput
                value={newKey}
                onChangeText={(text) => setNewKey(text.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                placeholder="KEY_NAME"
                placeholderTextColor={mutedColor}
                autoFocus
                autoCapitalize="characters"
                autoCorrect={false}
                style={{
                  fontSize: 13,
                  fontFamily: monoFont,
                  color: fg,
                  backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                  borderRadius: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  borderWidth: 1,
                  borderColor: borderColor,
                  marginBottom: 8,
                }}
              />
              <TextInput
                value={newValue}
                onChangeText={setNewValue}
                placeholder="Value"
                placeholderTextColor={mutedColor}
                returnKeyType="done"
                onSubmitEditing={handleAdd}
                style={{
                  fontSize: 13,
                  fontFamily: monoFont,
                  color: fg,
                  backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                  borderRadius: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  borderWidth: 1,
                  borderColor: borderColor,
                  marginBottom: 10,
                }}
              />
              <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
                <TouchableOpacity
                  onPress={() => { setShowAddForm(false); setNewKey(''); setNewValue(''); }}
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 7,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: borderColor,
                  }}
                >
                  <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: mutedColor }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleAdd}
                  disabled={!newKey.trim() || isSaving}
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 7,
                    borderRadius: 8,
                    backgroundColor: fg,
                    opacity: !newKey.trim() || isSaving ? 0.5 : 1,
                  }}
                >
                  {isSaving ? (
                    <ActivityIndicator size="small" color={bgColor} />
                  ) : (
                    <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: bgColor }}>Add</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Loading */}
          {isLoading && rows.length === 0 && (
            <View style={{ padding: 40, alignItems: 'center' }}>
              <ActivityIndicator size="large" color={mutedColor} />
            </View>
          )}

          {/* Error */}
          {error && (
            <View style={{ padding: 20, alignItems: 'center' }}>
              <Text style={{ fontSize: 13, fontFamily: 'Roobert', color: isDark ? '#f87171' : '#dc2626', textAlign: 'center' }}>
                {error}
              </Text>
            </View>
          )}

          {/* Empty state */}
          {!isLoading && !error && rows.length === 0 && (
            <View style={{ padding: 40, alignItems: 'center' }}>
              <Key size={32} color={mutedColor} style={{ marginBottom: 12, opacity: 0.5 }} />
              <Text style={{ fontSize: 14, fontFamily: 'Roobert-Medium', color: mutedColor, marginBottom: 4 }}>
                {searchQuery ? 'No secrets match your search' : 'No secrets yet'}
              </Text>
              <Text style={{ fontSize: 12, fontFamily: 'Roobert', color: mutedColor, textAlign: 'center', opacity: 0.7 }}>
                {searchQuery ? 'Try a different search term' : 'Add environment variables and API keys'}
              </Text>
            </View>
          )}

          {/* Secrets list */}
          {rows.map((row) => (
            <SecretRow
              key={row.key}
              secretKey={row.key}
              value={row.value}
              isDark={isDark}
              editingKey={editingKey}
              confirmDeleteKey={confirmDeleteKey}
              visibleKeys={visibleKeys}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onToggleVisibility={handleToggleVisibility}
              onSave={handleSave}
              onCancelEdit={() => setEditingKey(null)}
              onConfirmDelete={handleConfirmDelete}
              onCancelDelete={() => setConfirmDeleteKey(null)}
              isSaving={isSaving}
              isDeleting={isDeleting}
            />
          ))}

          {/* Bottom spacing */}
          <View style={{ height: insets.bottom + 80 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
