/**
 * SessionPage — the full session chat view.
 *
 * Uses the sync store (hydrated by useSessionSync, kept live by SSE)
 * as the single source of truth for messages.
 *
 * Sends messages via fire-and-forget promptAsync with agent/model/variant.
 */

import React, { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  useWindowDimensions,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '@/components/ui/text';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text as RNText } from 'react-native';

import { useSyncStore } from '@/lib/opencode/sync-store';
import { useSessionSync } from '@/lib/opencode/session-sync';
import { groupMessagesIntoTurns } from '@/lib/opencode/turns';
import type { Turn, QuestionRequest } from '@/lib/opencode/types';
import { useSession, replyToQuestion, rejectQuestion, forkSession } from '@/lib/platform/hooks';
import { useTabStore } from '@/stores/tab-store';
import { useSandboxContext } from '@/contexts/SandboxContext';
import {
  useOpenCodeAgents,
  useOpenCodeModels,
  useOpenCodeConfig,
} from '@/lib/opencode/hooks/use-opencode-data';
import { useResolvedConfig } from '@/lib/opencode/hooks/use-local-config';
import { getAuthToken } from '@/api/config';
import { log } from '@/lib/logger';

import { SessionChatInput, type PromptOptions, type TrackedMention } from './SessionChatInput';
import { SessionTurn } from './SessionTurn';
import { QuestionPrompt } from './QuestionPrompt';
import { useSessions } from '@/lib/platform/hooks';
import { FileViewer } from '@/components/files/FileViewer';
import type { SandboxFile } from '@/api/types';

interface SessionPageProps {
  sessionId: string;
  onBack: () => void;
  onOpenDrawer?: () => void;
  onOpenRightDrawer?: () => void;
}

export function SessionPage({ sessionId, onBack, onOpenDrawer, onOpenRightDrawer }: SessionPageProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { sandboxUrl } = useSandboxContext();
  const flatListRef = useRef<FlatList>(null);



  // Session metadata
  const { data: session } = useSession(sandboxUrl, sessionId);
  const { data: allSessions = [] } = useSessions(sandboxUrl);

  // Fork origin — check server parentID and AsyncStorage fallback
  const [forkParentId, setForkParentId] = useState<string | null>(null);
  useEffect(() => {
    const parentFromServer = (session as any)?.parentID;
    if (parentFromServer) {
      setForkParentId(parentFromServer);
      return;
    }
    AsyncStorage.getItem(`fork_origin_${sessionId}`).then((val) => {
      if (val) setForkParentId(val);
    });
  }, [sessionId, session]);
  const { data: parentSession } = useSession(sandboxUrl, forkParentId ?? undefined);

  // Hydrate messages from REST on mount; SSE keeps store updated after
  useSessionSync(sandboxUrl, sessionId);

  // Read messages from sync store
  const messages = useSyncStore((s) => s.messages[sessionId]);
  const sessionStatus = useSyncStore((s) => s.sessionStatus[sessionId]);
  const pendingQuestions = useSyncStore((s) => s.questions[sessionId]) ?? [];
  const safeMessages = useMemo(() => messages ?? [], [messages]);

  const isBusy = sessionStatus?.type === 'busy' || sessionStatus?.type === 'retry';

  // The first pending question for this session (if any)
  const activeQuestion: QuestionRequest | undefined = pendingQuestions[0];
  const hasQuestion = !!activeQuestion;

  // Keep the last question around so we can still render it during exit animation
  const lastQuestionRef = useRef<QuestionRequest | undefined>(undefined);
  const [showQuestionOverlay, setShowQuestionOverlay] = useState(false);
  if (activeQuestion) {
    lastQuestionRef.current = activeQuestion;
  }

  // Animate crossfade between chat input and question prompt
  // inputAnim: 1 = visible, 0 = hidden (faded down)
  // questionAnim: 1 = visible, 0 = hidden (faded down)
  const inputAnim = useRef(new Animated.Value(1)).current;
  const questionAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (hasQuestion) {
      setShowQuestionOverlay(true);
      // Textarea fades out downward, then question fades in from bottom
      Animated.sequence([
        Animated.timing(inputAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(questionAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      // Question fades out downward, then textarea fades in from bottom
      Animated.sequence([
        Animated.timing(questionAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(inputAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => {
        // Only unmount question overlay after animation completes
        setShowQuestionOverlay(false);
      });
    }
  }, [hasQuestion, inputAnim, questionAnim]);

  // Agent/model/variant config
  const { data: agents = [] } = useOpenCodeAgents(sandboxUrl);
  const { data: visibleModels = [], allModels = [], defaults } = useOpenCodeModels(sandboxUrl);
  const { data: config } = useOpenCodeConfig(sandboxUrl);

  // Resolution uses ALL models (fallback chain); selector shows only visible
  const resolved = useResolvedConfig(agents, allModels, config, defaults);

  // Agent names for mention highlighting in user bubbles
  const agentNames = useMemo(() => agents.map((a) => a.name), [agents]);

  // Mention click handlers
  const handleSessionMention = useCallback((mentionedSessionId: string) => {
    useTabStore.getState().navigateToSession(mentionedSessionId);
  }, []);

  // File mention viewer
  const [mentionFileViewerVisible, setMentionFileViewerVisible] = useState(false);
  const [mentionViewerFile, setMentionViewerFile] = useState<SandboxFile | null>(null);

  const handleFileMention = useCallback((path: string) => {
    const name = path.split('/').pop() || path;
    const fullPath = path.startsWith('/') ? path : `/workspace/${path}`;
    setMentionViewerFile({ name, path: fullPath, type: 'file' });
    setMentionFileViewerVisible(true);
  }, []);

  // Group messages into turns
  const turns = useMemo(() => groupMessagesIntoTurns(safeMessages), [safeMessages]);

  // When a new turn appears, scroll so the latest user bubble is at the top
  const prevTurnCount = useRef(turns.length);
  useEffect(() => {
    if (turns.length > prevTurnCount.current) {
      // New turn added — scroll it to the top of the viewport
      const targetIndex = turns.length - 1;
      setTimeout(() => {
        try {
          flatListRef.current?.scrollToIndex({
            index: targetIndex,
            viewPosition: 0,
            viewOffset: 0,
            animated: true,
          });
        } catch {
          flatListRef.current?.scrollToEnd({ animated: true });
        }
      }, 150);
    }
    prevTurnCount.current = turns.length;
  }, [turns.length]);

  // Send handler
  const handleSend = useCallback(
    async (text: string, options: PromptOptions, mentions?: TrackedMention[]) => {
      if (!sandboxUrl) return;

      // Process session mentions — append XML refs (same as frontend)
      let finalText = text;
      const sessionMentions = mentions?.filter((m) => m.kind === 'session' && m.value);
      if (sessionMentions && sessionMentions.length > 0) {
        const refs = sessionMentions
          .map((m) => `<session_ref id="${m.value}" title="${m.label}" />`)
          .join('\n');
        finalText = `${text}\n\nReferenced sessions (use the session_context tool to fetch details when needed):\n${refs}`;
      }

      // Optimistic user message
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const partId = `prt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      useSyncStore.getState().addOptimisticMessage(sessionId, {
        info: {
          id: messageId,
          role: 'user',
          sessionID: sessionId,
          time: { created: Date.now() },
        },
        parts: [{ type: 'text', id: partId, text: finalText }],
      });
      useSyncStore.getState().setStatus(sessionId, { type: 'busy' });
      // Scroll is handled by the useEffect watching turns.length

      // Build prompt payload (matches frontend POST /session/{id}/message)
      const payload: Record<string, any> = {
        parts: [{ type: 'text', text: finalText }],
      };
      if (options.model) payload.model = options.model;
      if (options.agent) payload.agent = options.agent;
      if (options.variant) payload.variant = options.variant;

      // Use prompt_async — returns immediately, SSE handles updates.
      // The blocking /session/{id}/message endpoint hangs until AI finishes,
      // which causes RN fetch to stall/timeout.
      try {
        const token = await getAuthToken();
        const res = await fetch(`${sandboxUrl}/session/${sessionId}/prompt_async`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errorText = await res.text().catch(() => '');
          log.error('❌ [SessionPage] Prompt failed:', res.status, errorText);
          useSyncStore.getState().setStatus(sessionId, { type: 'idle' });
        } else {
          log.log('✅ [SessionPage] Prompt sent (async)');
        }
      } catch (err: any) {
        log.error('❌ [SessionPage] Prompt error:', err?.message || err);
        useSyncStore.getState().setStatus(sessionId, { type: 'idle' });
      }
    },
    [sandboxUrl, sessionId],
  );

  // Stop handler
  const handleStop = useCallback(async () => {
    if (!sandboxUrl) return;
    useSyncStore.getState().setStatus(sessionId, { type: 'idle' });
    try {
      const token = await getAuthToken();
      await fetch(`${sandboxUrl}/session/${sessionId}/abort`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
    } catch (err: any) {
      log.error('❌ [SessionPage] Abort error:', err?.message || err);
    }
  }, [sandboxUrl, sessionId]);

  // Question reply/reject handlers
  const handleQuestionReply = useCallback(
    async (requestId: string, answers: string[][]) => {
      if (!sandboxUrl) return;
      // Optimistically remove from store
      useSyncStore.getState().removeQuestion(sessionId, requestId);
      try {
        await replyToQuestion(sandboxUrl, requestId, answers);
      } catch (err: any) {
        log.error('Failed to reply to question:', err?.message || err);
      }
    },
    [sandboxUrl, sessionId],
  );

  const handleQuestionReject = useCallback(
    async (requestId: string) => {
      if (!sandboxUrl) return;
      // Optimistically remove from store
      useSyncStore.getState().removeQuestion(sessionId, requestId);
      try {
        await rejectQuestion(sandboxUrl, requestId);
      } catch (err: any) {
        log.error('Failed to reject question:', err?.message || err);
      }
      // Also abort the session (matches frontend behavior)
      handleStop();
    },
    [sandboxUrl, sessionId, handleStop],
  );

  // Fork handler — forks session at the given assistant message
  const handleFork = useCallback(
    async (assistantMessageId: string) => {
      if (!sandboxUrl) return;

      // The server copies all messages BEFORE the given messageID (exclusive).
      // To include the assistant message the user clicked on, we pass the ID
      // of the NEXT message after it as the cut-off.
      let forkAtMessageId: string | undefined;
      if (safeMessages.length > 0) {
        const idx = safeMessages.findIndex((m) => m.info.id === assistantMessageId);
        if (idx >= 0 && idx < safeMessages.length - 1) {
          forkAtMessageId = safeMessages[idx + 1].info.id;
        }
        // else: last message — omit messageID to copy all
      }

      try {
        const forkedSession = await forkSession(sandboxUrl, sessionId, forkAtMessageId);
        // Store fork origin so the forked session can show "Forked from" banner
        AsyncStorage.setItem(`fork_origin_${forkedSession.id}`, sessionId);
        useTabStore.getState().navigateToSession(forkedSession.id);
      } catch (err: any) {
        log.error('Failed to fork session:', err?.message || err);
      }
    },
    [sandboxUrl, sessionId, safeMessages],
  );

  // Track last turn height for footer sizing
  const turnHeights = useRef<Record<string, number>>({});
  const [lastTurnHeight, setLastTurnHeight] = useState(80);

  const renderTurn = useCallback(
    ({ item, index }: { item: Turn; index: number }) => (
      <View
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          turnHeights.current[item.userMessage.info.id] = h;
          // Update footer when the last turn's height changes
          if (index === turns.length - 1) {
            setLastTurnHeight(h);
          }
        }}
      >
        <SessionTurn
          turn={item}
          allMessages={safeMessages}
          sessionStatus={sessionStatus}
          isBusy={isBusy}
          pendingQuestions={pendingQuestions}
          onFork={handleFork}
          agentNames={agentNames}
          onFileMention={handleFileMention}
          onSessionMention={handleSessionMention}
        />
      </View>
    ),
    [safeMessages, sessionStatus, isBusy, turns.length, pendingQuestions, handleFork, agentNames, handleFileMention, handleSessionMention],
  );

  const title = session?.title || 'New Session';

  return (
    <View className="flex-1 bg-background">
      {/* Header — matches dashboard layout exactly */}
      <View
        style={{ paddingTop: insets.top }}
        className="px-4 pb-3 bg-background"
      >
        <View className="flex-row items-center">
          <TouchableOpacity
            onPress={onOpenDrawer}
            className="mr-3 p-1"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="menu" size={24} color={isDark ? '#F8F8F8' : '#121215'} />
          </TouchableOpacity>
          <View className="flex-1">
            <Text
              className="text-lg font-bold text-foreground"
              numberOfLines={1}
            >
              {title}
            </Text>
            {isBusy && (
              <View className="flex-row items-center mt-0.5">
                <View className="h-1.5 w-1.5 rounded-full bg-muted-foreground mr-1" />
                <Text className="text-xs text-muted-foreground">Working</Text>
              </View>
            )}
          </View>
          <TouchableOpacity
            onPress={onOpenRightDrawer}
            className="ml-3 p-1"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="apps-outline" size={20} color={isDark ? '#F8F8F8' : '#121215'} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={turns}
        renderItem={renderTurn}
        keyExtractor={(item) => item.userMessage.info.id}
        contentContainerStyle={{ paddingTop: 16 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          forkParentId ? (
            <ForkBanner
              parentTitle={parentSession?.title}
              onPress={() => useTabStore.getState().navigateToSession(forkParentId)}
              isDark={isDark}
            />
          ) : null
        }
        ListFooterComponent={
          <View
            style={{
              // Fill remaining viewport so the last turn's user bubble
              // sits at the top. Subtract: header (~60+insets), input (~120+insets),
              // footer bar (~50), and the actual measured last turn height.
              height: Math.max(0, windowHeight - insets.top - insets.bottom - 210 - lastTurnHeight),
            }}
          />
        }
        onScrollToIndexFailed={(info) => {
          setTimeout(() => {
            flatListRef.current?.scrollToIndex({
              index: info.index,
              viewPosition: 0,
              viewOffset: 0,
              animated: true,
            });
          }, 200);
        }}
      />

      {/* Fade gradient above input — only when textarea is shown */}
      {!hasQuestion && (
        <LinearGradient
          colors={isDark ? ['rgba(18,18,21,0)', 'rgba(18,18,21,1)'] : ['rgba(245,245,245,0)', 'rgba(245,245,245,1)']}
          style={{ height: 40, marginTop: -40, zIndex: 1 }}
          pointerEvents="none"
        />
      )}

      {/* Bottom area — question prompt and chat input share the same slot */}
      <View>
        {/* Chat input — fades out downward when question appears */}
        <Animated.View
          style={{
            opacity: inputAnim,
            transform: [{
              translateY: inputAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [30, 0],
              }),
            }],
          }}
          pointerEvents={hasQuestion ? 'none' : 'auto'}
        >
          <SessionChatInput
            onSend={handleSend}
            onStop={handleStop}
            isBusy={isBusy}
            agent={resolved.agent}
            agents={resolved.agents}
            model={resolved.model}
            models={visibleModels}
            modelKey={resolved.modelKey}
            variant={resolved.variant}
            variants={resolved.variants}
            onAgentChange={resolved.setAgent}
            onModelChange={resolved.setModel}
            onVariantCycle={resolved.cycleVariant}
            sessions={allSessions}
            currentSessionId={sessionId}
            sandboxUrl={sandboxUrl}
          />
        </Animated.View>

        {/* Question prompt — overlays on top of input, fades in from bottom */}
        {showQuestionOverlay && lastQuestionRef.current && (
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: isDark ? '#121215' : '#f5f5f5',
            }}
          >
            <Animated.View
              style={{
                opacity: questionAnim,
                transform: [{
                  translateY: questionAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [30, 0],
                  }),
                }],
              }}
              pointerEvents={hasQuestion ? 'auto' : 'none'}
            >
              <QuestionPrompt
                request={lastQuestionRef.current}
                onReply={handleQuestionReply}
                onReject={handleQuestionReject}
              />
            </Animated.View>
          </View>
        )}
      </View>

      {/* File mention viewer */}
      <FileViewer
        visible={mentionFileViewerVisible}
        onClose={() => {
          setMentionFileViewerVisible(false);
          setMentionViewerFile(null);
        }}
        file={mentionViewerFile}
        sandboxId=""
        sandboxUrl={sandboxUrl}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// ForkBanner — "Forked from {parentTitle}" divider
// ---------------------------------------------------------------------------

function ForkBanner({
  parentTitle,
  onPress,
  isDark,
}: {
  parentTitle?: string;
  onPress: () => void;
  isDark: boolean;
}) {
  const mutedColor = isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.15)';
  const textMuted = isDark ? '#888' : '#999';
  const textColor = isDark ? '#aaa' : '#666';
  const borderColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const pillBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)';

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 12, gap: 8 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: borderColor }} />
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 10,
          paddingVertical: 5,
          borderRadius: 20,
          backgroundColor: pillBg,
          borderWidth: 1,
          borderColor,
          gap: 5,
        }}
      >
        <Ionicons name="git-branch-outline" size={11} color={textMuted} />
        <RNText style={{ fontSize: 10, fontFamily: 'Roobert-Medium', color: textMuted, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          Forked from
        </RNText>
        <RNText
          style={{ fontSize: 10, fontFamily: 'Roobert-Medium', color: textColor, maxWidth: 120 }}
          numberOfLines={1}
        >
          {parentTitle || 'Parent session'}
        </RNText>
      </TouchableOpacity>
      <View style={{ flex: 1, height: 1, backgroundColor: borderColor }} />
    </View>
  );
}
