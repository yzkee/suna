/**
 * SessionChatInput — chat input with agent/model/variant toolbar and @mentions.
 *
 * Matches the Computer frontend's chat input:
 * - Left toolbar: Agent selector, Model selector, Variant (thinking) toggle
 * - Right toolbar: Send / Stop buttons
 * - Multiline text input
 * - @mention autocomplete for files, agents, and sessions
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Modal,
  Platform,
  Animated,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { useColorScheme } from 'nativewind';
import { Ionicons } from '@expo/vector-icons';

import type { Agent, FlatModel } from '@/lib/opencode/hooks/use-opencode-data';
import type { Session } from '@/lib/platform/types';
import { MentionSuggestions } from './MentionSuggestions';
import { useMentions, type TrackedMention, type MentionItem } from './useMentions';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PromptOptions {
  agent?: string;
  model?: { providerID: string; modelID: string };
  variant?: string;
}

export type { TrackedMention } from './useMentions';

interface SessionChatInputProps {
  onSend: (text: string, options: PromptOptions, mentions?: TrackedMention[]) => void;
  onStop?: () => void;
  isBusy?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Agent/model/variant config */
  agent?: Agent | null;
  agents?: Agent[];
  model?: FlatModel | null;
  models?: FlatModel[];
  modelKey?: { providerID: string; modelID: string } | null;
  variant?: string | null;
  variants?: string[];
  onAgentChange?: (name: string) => void;
  onModelChange?: (providerID: string, modelID: string) => void;
  onVariantCycle?: () => void;
  onVariantSet?: (variant: string | null) => void;
  /** Data for @mentions */
  sessions?: Session[];
  currentSessionId?: string | null;
  sandboxUrl?: string;
  /** Called when the user submits while agent is busy — enqueue instead of send */
  onEnqueue?: (text: string) => void;
  /** Slot rendered above the text input inside the card (used for queue UI) */
  inputSlot?: React.ReactNode;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SessionChatInput({
  onSend,
  onStop,
  isBusy = false,
  disabled = false,
  placeholder = 'Ask anything...',
  agent,
  agents = [],
  model,
  models = [],
  modelKey,
  variant,
  variants = [],
  onAgentChange,
  onModelChange,
  onVariantCycle,
  onVariantSet,
  sessions = [],
  currentSessionId,
  sandboxUrl,
  onEnqueue,
  inputSlot,
}: SessionChatInputProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<TextInput>(null);
  const cursorRef = useRef(0);
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  // Config sheet
  const [showConfigSheet, setShowConfigSheet] = useState(false);

  // ── Mentions ────────────────────────────────────────────────────────────

  const mention = useMentions({
    agents,
    sessions,
    currentSessionId,
    sandboxUrl,
  });

  const handleTextChange = useCallback(
    (newText: string) => {
      setText(newText);
      // On React Native, onChangeText doesn't provide cursor position.
      // Use text length (typing appends at end). onSelectionChange
      // will re-detect for mid-text edits.
      cursorRef.current = newText.length;
      mention.handleTextChange(newText, newText.length);
    },
    [mention],
  );

  const handleSelectionChange = useCallback(
    (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      cursorRef.current = e.nativeEvent.selection.end;
    },
    [],
  );

  const handleMentionSelect = useCallback(
    (item: MentionItem) => {
      const newText = mention.selectMention(item, text);
      setText(newText);
      cursorRef.current = newText.length;
      // Refocus after selection (like frontend's requestAnimationFrame)
      setTimeout(() => inputRef.current?.focus(), 50);
    },
    [mention, text],
  );

  // ── Animated placeholder ────────────────────────────────────────────────
  const placeholderVariants = useMemo(
    () => [
      placeholder,
      'Ask about any file in this project',
      'Ask for changed files and diffs',
      'Ask to compact when context is full',
      'Reference files with @',
    ],
    [placeholder],
  );

  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (text.trim().length > 0) return;

    const interval = setInterval(() => {
      // Exit: fade out + slide up
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: -8,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => {
        // Switch text
        setPlaceholderIndex((i) => (i + 1) % placeholderVariants.length);
        // Reset position to below
        slideAnim.setValue(8);
        // Enter: fade in + slide up to center
        Animated.parallel([
          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 350,
            useNativeDriver: true,
          }),
          Animated.timing(slideAnim, {
            toValue: 0,
            duration: 350,
            useNativeDriver: true,
          }),
        ]).start();
      });
    }, 6000);

    return () => clearInterval(interval);
  }, [text, placeholderVariants.length, fadeAnim, slideAnim]);

  // Reset animation when user clears input
  useEffect(() => {
    if (text.trim().length === 0) {
      fadeAnim.setValue(1);
      slideAnim.setValue(0);
    }
  }, [text, fadeAnim, slideAnim]);

  const showAnimatedPlaceholder = text.trim().length === 0 && !inputSlot;
  // ────────────────────────────────────────────────────────────────────────

  const canSend = text.trim().length > 0 && !disabled;
  const hasToolbar = agents.length > 0 || models.length > 0;

  const handleSubmit = useCallback(() => {
    if (mention.isOpen) {
      // If mention popover is open, don't submit — dismiss it
      mention.dismiss();
      return;
    }

    const trimmed = text.trim();
    if (!trimmed || disabled) return;

    // If the agent is busy and we have an enqueue handler, queue instead of sending
    if (isBusy && onEnqueue) {
      onEnqueue(trimmed);
      setText('');
      mention.reset();
      return;
    }

    const options: PromptOptions = {};
    if (agent?.name) options.agent = agent.name;
    if (modelKey) options.model = modelKey;
    if (variant) options.variant = variant;

    const trackedMentions = mention.mentions.length > 0 ? [...mention.mentions] : undefined;
    onSend(trimmed, options, trackedMentions);
    setText('');
    mention.reset();
  }, [text, disabled, onSend, agent, modelKey, variant, mention, isBusy, onEnqueue]);

  // Variant display
  const variantLabel = variant
    ? variant.charAt(0).toUpperCase() + variant.slice(1)
    : 'Default';

  return (
    <>
      <View>
        {/* Mention suggestions — above the input (same condition as frontend) */}
        {mention.isOpen && (mention.items.length > 0 || mention.fileSearchLoading) && (
          <MentionSuggestions
            items={mention.items}
            selectedIndex={mention.selectedIndex}
            isLoading={mention.fileSearchLoading}
            onSelect={handleMentionSelect}
          />
        )}

        {/* Text input area */}
        <View className="px-4 pt-1 pb-3">
          <View className="rounded-2xl px-4 pt-2 pb-1 bg-card border border-border">
            {/* Queue / question slot — rendered above textarea */}
            {inputSlot}

            {/* TextInput + animated placeholder wrapper */}
            <View style={{ position: 'relative' }}>
              {showAnimatedPlaceholder && (
                <Animated.Text
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: Platform.OS === 'ios' ? 6 : 4,
                    fontSize: 16,
                    color: isDark ? '#999999' : '#6e6e6e',
                    opacity: fadeAnim,
                    transform: [{ translateY: slideAnim }],
                    zIndex: 1,
                  }}
                >
                  {placeholderVariants[placeholderIndex]}
                </Animated.Text>
              )}
              <TextInput
                ref={inputRef}
                value={text}
                onChangeText={handleTextChange}
                onSelectionChange={handleSelectionChange}
                placeholder=""
                placeholderTextColor="transparent"
                multiline
                maxLength={10000}
                style={{
                  maxHeight: 120,
                  fontSize: 16,
                  lineHeight: 22,
                  color: isDark ? '#F8F8F8' : '#121215',
                  paddingTop: Platform.OS === 'ios' ? 6 : 4,
                  paddingBottom: Platform.OS === 'ios' ? 6 : 4,
                  minHeight: 36,
                }}
                onSubmitEditing={handleSubmit}
                blurOnSubmit={false}
                returnKeyType="default"
                editable={!disabled}
              />
            </View>

            {/* Toolbar row — inside the input card */}
            <View className="flex-row items-center justify-between py-1.5">
              {/* Left: config button */}
              <TouchableOpacity
                onPress={() => setShowConfigSheet(true)}
                activeOpacity={0.7}
                hitSlop={6}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 20,
                  backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                }}
              >
                <Ionicons
                  name="options-outline"
                  size={14}
                  color={isDark ? '#a1a1aa' : '#71717a'}
                  style={{ marginRight: 6 }}
                />
                <Text
                  numberOfLines={1}
                  style={{
                    fontSize: 12,
                    fontFamily: 'Roobert-Medium',
                    color: isDark ? '#a1a1aa' : '#71717a',
                    maxWidth: 200,
                  }}
                >
                  {agent?.name || 'Agent'}
                  {model?.modelName ? ` · ${model.modelName}` : ''}
                  {variant ? ` · ${variantLabel}` : ''}
                </Text>
                <Ionicons
                  name="chevron-down"
                  size={10}
                  color={isDark ? '#52525b' : '#a1a1aa'}
                  style={{ marginLeft: 4 }}
                />
              </TouchableOpacity>

              {/* Right: send/stop/queue */}
              <View className="flex-row items-center" style={{ gap: 8 }}>
                {isBusy && canSend && onEnqueue && (
                  <TouchableOpacity
                    onPress={handleSubmit}
                    activeOpacity={0.7}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      borderRadius: 20,
                      backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                    }}
                  >
                    <Ionicons
                      name="list-outline"
                      size={13}
                      color={isDark ? '#a1a1aa' : '#71717a'}
                      style={{ marginRight: 4 }}
                    />
                    <Text
                      style={{
                        fontSize: 12,
                        fontFamily: 'Roobert-Medium',
                        color: isDark ? '#a1a1aa' : '#71717a',
                      }}
                    >
                      Queue
                    </Text>
                  </TouchableOpacity>
                )}
                {isBusy ? (
                  <TouchableOpacity
                    onPress={onStop}
                    className="h-7 w-7 items-center justify-center rounded-full bg-primary"
                    activeOpacity={0.7}
                  >
                    <Ionicons name="stop" size={14} color={isDark ? '#121215' : '#F8F8F8'} />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    onPress={handleSubmit}
                    disabled={!canSend}
                    className={`h-7 w-7 items-center justify-center rounded-full ${
                      canSend ? 'bg-primary' : 'bg-muted'
                    }`}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name="arrow-up"
                      size={16}
                      color={canSend ? (isDark ? '#121215' : '#F8F8F8') : (isDark ? '#999999' : '#6e6e6e')}
                    />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        </View>


      </View>

      {/* Config bottom sheet — agent, model, variant */}
      <Modal
        visible={showConfigSheet}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowConfigSheet(false)}
      >
        <ConfigSheet
          isDark={isDark}
          agents={agents}
          selectedAgent={agent || null}
          onAgentChange={(name) => { onAgentChange?.(name); }}
          models={models}
          selectedModel={model || null}
          onModelChange={(pid, mid) => { onModelChange?.(pid, mid); }}
          variants={variants}
          selectedVariant={variant || null}
          onVariantSet={(v) => onVariantSet?.(v)}
          onClose={() => setShowConfigSheet(false)}
        />
      </Modal>
    </>
  );
}

// ─── Config Sheet ────────────────────────────────────────────────────────────

import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type ConfigTab = 'agent' | 'model' | 'thinking';

const TAB_CONFIG: { key: ConfigTab; label: string; icon: string; color: string }[] = [
  { key: 'agent', label: 'Agent', icon: 'person-outline', color: '#a78bfa' },
  { key: 'model', label: 'Model', icon: 'hardware-chip-outline', color: '#60a5fa' },
  { key: 'thinking', label: 'Thinking', icon: 'flash-outline', color: '#fbbf24' },
];

function ConfigSheet({
  isDark,
  agents,
  selectedAgent,
  onAgentChange,
  models,
  selectedModel,
  onModelChange,
  variants,
  selectedVariant,
  onVariantSet,
  onClose,
}: {
  isDark: boolean;
  agents: Agent[];
  selectedAgent: Agent | null;
  onAgentChange: (name: string) => void;
  models: FlatModel[];
  selectedModel: FlatModel | null;
  onModelChange: (providerId: string, modelId: string) => void;
  variants: string[];
  selectedVariant: string | null;
  onVariantSet: (variant: string | null) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<ConfigTab>('agent');
  const fgColor = isDark ? '#F8F8F8' : '#121215';
  const mutedColor = isDark ? '#a1a1aa' : '#71717a';
  const selectedBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
  const tabBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const tabActiveBg = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)';

  // Filter tabs to only show ones with content
  const visibleTabs = TAB_CONFIG.filter((t) => {
    if (t.key === 'agent') return agents.length > 0;
    if (t.key === 'model') return models.length > 0;
    if (t.key === 'thinking') return variants.length > 0;
    return false;
  });

  return (
    <View style={{ flex: 1, backgroundColor: isDark ? '#121215' : '#FFFFFF' }}>
      {/* Handle */}
      <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
        <View
          style={{
            width: 36,
            height: 5,
            borderRadius: 3,
            backgroundColor: isDark ? '#3F3F46' : '#D4D4D8',
          }}
        />
      </View>

      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 20,
          paddingBottom: 12,
        }}
      >
        <Text style={{ fontSize: 20, fontFamily: 'Roobert-SemiBold', color: fgColor }}>
          Configuration
        </Text>
        <TouchableOpacity onPress={onClose} activeOpacity={0.7} hitSlop={10}>
          <Ionicons name="close" size={24} color={mutedColor} />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View
        style={{
          flexDirection: 'row',
          marginHorizontal: 20,
          marginBottom: 16,
          borderRadius: 12,
          backgroundColor: tabBg,
          padding: 3,
        }}
      >
        {visibleTabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              activeOpacity={0.7}
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                paddingVertical: 8,
                borderRadius: 10,
                backgroundColor: isActive ? tabActiveBg : 'transparent',
                gap: 5,
              }}
            >
              <Ionicons
                name={tab.icon as any}
                size={14}
                color={isActive ? tab.color : mutedColor}
              />
              <Text
                style={{
                  fontSize: 13,
                  fontFamily: isActive ? 'Roobert-SemiBold' : 'Roobert-Medium',
                  color: isActive ? fgColor : mutedColor,
                }}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Content */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Agent tab */}
        {activeTab === 'agent' && agents.filter((a) => !a.hidden).map((a) => {
          const isSelected = selectedAgent?.name === a.name;
          return (
            <TouchableOpacity
              key={a.name}
              onPress={() => onAgentChange(a.name)}
              activeOpacity={0.6}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 20,
                paddingVertical: 14,
                backgroundColor: isSelected ? selectedBg : 'transparent',
              }}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontSize: 16,
                    fontFamily: isSelected ? 'Roobert-Medium' : 'Roobert',
                    color: fgColor,
                    textTransform: 'capitalize',
                  }}
                >
                  {a.name}
                </Text>
                {a.description ? (
                  <Text
                    style={{ fontSize: 13, fontFamily: 'Roobert', color: mutedColor, marginTop: 3 }}
                    numberOfLines={2}
                  >
                    {a.description}
                  </Text>
                ) : null}
              </View>
              {isSelected && (
                <Ionicons name="checkmark-circle" size={22} color="#a78bfa" />
              )}
            </TouchableOpacity>
          );
        })}

        {/* Model tab — grouped by provider */}
        {activeTab === 'model' && (() => {
          // Group models by provider
          const groups: { providerID: string; providerName: string; models: typeof models }[] = [];
          const seen = new Map<string, typeof models>();
          for (const m of models) {
            const key = m.providerID;
            if (!seen.has(key)) {
              const group: typeof models = [];
              seen.set(key, group);
              groups.push({ providerID: key, providerName: m.providerName || key, models: group });
            }
            seen.get(key)!.push(m);
          }

          return groups.map((group) => (
            <View key={group.providerID}>
              {/* Provider header */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingHorizontal: 20,
                  paddingTop: 16,
                  paddingBottom: 8,
                }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    fontFamily: 'Roobert-SemiBold',
                    color: mutedColor,
                    textTransform: 'uppercase',
                    letterSpacing: 0.8,
                  }}
                >
                  {group.providerName}
                </Text>
                <Text
                  style={{
                    fontSize: 11,
                    fontFamily: 'Roobert-Medium',
                    color: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)',
                  }}
                >
                  {group.models.length}
                </Text>
              </View>
              {/* Models in this provider */}
              {group.models.map((m) => {
                const isSelected =
                  selectedModel?.providerID === m.providerID &&
                  selectedModel?.modelID === m.modelID;
                return (
                  <TouchableOpacity
                    key={`${m.providerID}/${m.modelID}`}
                    onPress={() => onModelChange(m.providerID, m.modelID)}
                    activeOpacity={0.6}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingHorizontal: 20,
                      paddingVertical: 12,
                      backgroundColor: isSelected ? selectedBg : 'transparent',
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          fontSize: 15,
                          fontFamily: isSelected ? 'Roobert-Medium' : 'Roobert',
                          color: fgColor,
                        }}
                        numberOfLines={1}
                      >
                        {m.modelName || m.modelID}
                      </Text>
                      <Text
                        style={{ fontSize: 12, fontFamily: 'Roobert', color: mutedColor, marginTop: 2 }}
                        numberOfLines={1}
                      >
                        {m.modelID}
                      </Text>
                    </View>
                    {isSelected && (
                      <Ionicons name="checkmark-circle" size={22} color="#60a5fa" />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          ));
        })()}

        {/* Thinking tab */}
        {activeTab === 'thinking' && (
          <>
            <TouchableOpacity
              onPress={() => onVariantSet(null)}
              activeOpacity={0.6}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 20,
                paddingVertical: 14,
                backgroundColor: !selectedVariant ? selectedBg : 'transparent',
              }}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontSize: 16,
                    fontFamily: !selectedVariant ? 'Roobert-Medium' : 'Roobert',
                    color: fgColor,
                  }}
                >
                  Default
                </Text>
                <Text style={{ fontSize: 13, fontFamily: 'Roobert', color: mutedColor, marginTop: 3 }}>
                  Standard response
                </Text>
              </View>
              {!selectedVariant && (
                <Ionicons name="checkmark-circle" size={22} color="#fbbf24" />
              )}
            </TouchableOpacity>
            {variants.map((v) => {
              const isSelected = selectedVariant === v;
              return (
                <TouchableOpacity
                  key={v}
                  onPress={() => onVariantSet(v)}
                  activeOpacity={0.6}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 20,
                    paddingVertical: 14,
                    backgroundColor: isSelected ? selectedBg : 'transparent',
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontSize: 16,
                        fontFamily: isSelected ? 'Roobert-Medium' : 'Roobert',
                        color: isSelected ? (isDark ? '#fbbf24' : '#d97706') : fgColor,
                        textTransform: 'capitalize',
                      }}
                    >
                      {v}
                    </Text>
                    <Text style={{ fontSize: 13, fontFamily: 'Roobert', color: mutedColor, marginTop: 3 }}>
                      Extended thinking mode
                    </Text>
                  </View>
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={22} color="#fbbf24" />
                  )}
                </TouchableOpacity>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}
