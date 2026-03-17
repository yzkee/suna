/**
 * SessionTurn — renders a single user + assistant turn.
 *
 * Mirrors the Computer frontend's SessionTurn component logic.
 */

import React, { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import { View, TouchableOpacity, Animated } from 'react-native';
import { Text } from '@/components/ui/text';
import { useColorScheme } from 'nativewind';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { SelectableMarkdownText } from '@/components/ui/selectable-markdown';
import type {
  Turn,
  MessageWithParts,
  SessionStatus,
  TextPart,
  ToolPart,
  ReasoningPart,
  QuestionRequest,
} from '@/lib/opencode/types';
import {
  collectTurnParts,
  findLastTextPart,
  isTextPart,
  isToolPart,
  isReasoningPart,
  isLastUserMessage,
  getWorkingState,
  getTurnError,
  getTurnStatus,
  getToolInfo,
  shouldShowToolPart,
  formatDuration,
} from '@/lib/opencode/turns';

// ─── Mention highlighting ────────────────────────────────────────────────────

interface ParsedSessionRef {
  id: string;
  title: string;
}

function parseSessionReferences(text: string): {
  cleanText: string;
  sessions: ParsedSessionRef[];
} {
  const sessions: ParsedSessionRef[] = [];
  let cleaned = text.replace(
    /<session_ref\s+id="([^"]*?)"\s+title="([^"]*?)"\s*\/>/g,
    (_, id, title) => {
      sessions.push({ id, title });
      return '';
    },
  );
  cleaned = cleaned
    .replace(
      /\n*Referenced sessions \(use the session_context tool to fetch details when needed\):\n?/g,
      '',
    )
    .trim();
  return { cleanText: cleaned, sessions };
}

type MentionType = 'file' | 'agent' | 'session';

interface TextSegment {
  text: string;
  type?: MentionType;
}

const MENTION_COLORS: Record<MentionType, string> = {
  file: '#3b82f6',    // blue
  agent: '#a855f7',   // purple
  session: '#10b981', // emerald
};

function HighlightMentions({
  text,
  agentNames,
}: {
  text: string;
  agentNames?: string[];
}) {
  const segments = useMemo<TextSegment[]>(() => {
    const { cleanText, sessions } = parseSessionReferences(text);
    if (!cleanText) return [{ text: '' }];

    // Detect session mentions first (titles can contain spaces)
    const detected: { start: number; end: number; type: MentionType }[] = [];
    for (const s of sessions) {
      const needle = `@${s.title}`;
      const idx = cleanText.indexOf(needle);
      if (idx !== -1) {
        detected.push({ start: idx, end: idx + needle.length, type: 'session' });
      }
    }

    // Detect agent/file @mentions
    const agentSet = new Set(agentNames || []);
    const mentionRegex = /@(\S+)/g;
    let match: RegExpExecArray | null;
    while ((match = mentionRegex.exec(cleanText)) !== null) {
      const mStart = match.index;
      // Skip if overlaps with a session mention
      if (detected.some((s) => mStart >= s.start && mStart < s.end)) continue;
      const name = match[1];
      detected.push({
        start: mStart,
        end: match.index + match[0].length,
        type: agentSet.has(name) ? 'agent' : 'file',
      });
    }

    if (detected.length === 0) return [{ text: cleanText }];

    detected.sort((a, b) => a.start - b.start || b.end - a.end);
    const result: TextSegment[] = [];
    let lastIndex = 0;
    for (const ref of detected) {
      if (ref.start < lastIndex) continue;
      if (ref.start > lastIndex) result.push({ text: cleanText.slice(lastIndex, ref.start) });
      result.push({ text: cleanText.slice(ref.start, ref.end), type: ref.type });
      lastIndex = ref.end;
    }
    if (lastIndex < cleanText.length) result.push({ text: cleanText.slice(lastIndex) });
    return result;
  }, [text, agentNames]);

  if (segments.length === 1 && !segments[0].type) {
    return (
      <Text className="text-[15px] leading-[22px] text-foreground">
        {segments[0].text}
      </Text>
    );
  }

  return (
    <Text className="text-[15px] leading-[22px] text-foreground">
      {segments.map((seg, i) =>
        seg.type ? (
          <Text
            key={i}
            style={{ color: MENTION_COLORS[seg.type], fontFamily: 'Roobert-Medium' }}
          >
            {seg.text}
          </Text>
        ) : (
          <Text key={i}>{seg.text}</Text>
        ),
      )}
    </Text>
  );
}

// ─── SessionTurn ─────────────────────────────────────────────────────────────

interface SessionTurnProps {
  turn: Turn;
  allMessages: MessageWithParts[];
  sessionStatus?: SessionStatus;
  isBusy: boolean;
  pendingQuestions?: QuestionRequest[];
  onFork?: (assistantMessageId: string) => void;
  agentNames?: string[];
}

export function SessionTurn({
  turn,
  allMessages,
  sessionStatus,
  isBusy,
  pendingQuestions = [],
  onFork,
  agentNames,
}: SessionTurnProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  const allParts = useMemo(() => collectTurnParts(turn), [turn]);

  const isLast = useMemo(
    () => isLastUserMessage(turn.userMessage.info.id, allMessages),
    [turn.userMessage.info.id, allMessages],
  );

  const working = useMemo(
    () => getWorkingState(sessionStatus, isLast) || (isLast && isBusy),
    [sessionStatus, isLast, isBusy],
  );

  // Get user message text
  const userText = useMemo(() => {
    return turn.userMessage.parts
      .filter(isTextPart)
      .map((p) => (p as TextPart).text)
      .join('\n');
  }, [turn.userMessage.parts]);

  // Get response text
  const response = useMemo(() => {
    if (working) {
      // While working, get streaming text from last assistant message
      const lastMsg = turn.assistantMessages[turn.assistantMessages.length - 1];
      if (lastMsg) {
        return lastMsg.parts
          .filter(isTextPart)
          .map((p) => (p as TextPart).text)
          .join('');
      }
      return '';
    }
    const lastText = findLastTextPart(allParts);
    return lastText?.text ?? '';
  }, [working, turn.assistantMessages, allParts]);

  // Get tool parts — hide question tool when there's a pending question for it
  const toolParts = useMemo(() => {
    const pendingCallIDs = new Set(
      pendingQuestions.filter((q) => q.tool).map((q) => q.tool!.callID),
    );
    return allParts
      .filter(({ part }) => {
        if (!isToolPart(part)) return false;
        const tp = part as ToolPart;
        if (!shouldShowToolPart(tp)) return false;
        // Hide question tool parts that have a pending question
        if (tp.tool === 'question' && pendingCallIDs.has(tp.callID)) return false;
        return true;
      })
      .map(({ part }) => part as ToolPart);
  }, [allParts, pendingQuestions]);

  // Get reasoning
  const reasoningText = useMemo(() => {
    return allParts
      .filter(({ part }) => isReasoningPart(part) && !!(part as ReasoningPart).text?.trim())
      .map(({ part }) => (part as ReasoningPart).text)
      .join('\n');
  }, [allParts]);

  const turnError = useMemo(() => getTurnError(turn), [turn]);
  const statusText = useMemo(
    () => (working ? getTurnStatus(allParts) : undefined),
    [working, allParts],
  );

  // Duration
  const duration = useMemo(() => {
    if (turn.assistantMessages.length === 0) return undefined;
    const firstMsg = turn.assistantMessages[0];
    const lastMsg = turn.assistantMessages[turn.assistantMessages.length - 1];
    const start = firstMsg.info.time.created;
    const end = (lastMsg.info.time as any).completed || Date.now();
    if (!start) return undefined;
    return end - start;
  }, [turn.assistantMessages]);

  // Last assistant message ID (for fork)
  const lastAssistantMessageId = useMemo(() => {
    if (turn.assistantMessages.length === 0) return undefined;
    return turn.assistantMessages[turn.assistantMessages.length - 1].info.id;
  }, [turn.assistantMessages]);

  return (
    <View className="mb-4">
      {/* User message */}
      <View className="flex-row justify-end mb-2 px-4">
        <View className="rounded-2xl rounded-br-md px-4 py-3 max-w-[85%] bg-card border border-border">
          <HighlightMentions text={userText} agentNames={agentNames} />
        </View>
      </View>

      {/* Assistant response */}
      {(turn.assistantMessages.length > 0 || working) && (
        <View className="px-4">
          {/* Tool calls */}
          {toolParts.length > 0 && (
            <View className="mb-2">
              {toolParts.map((tool) => {
                const info = getToolInfo(tool.tool, tool.input);
                const isRunning =
                  tool.state.status === 'pending' || tool.state.status === 'running';
                const isError = tool.state.status === 'error';

                return (
                  <View
                    key={tool.id}
                    className="flex-row items-center rounded-lg px-3 py-2 mb-1 bg-muted/20 border border-border/40"
                  >
                    <Text className="text-xs mr-2">
                      {isRunning ? '⏳' : isError ? '❌' : '✅'}
                    </Text>
                    <Text
                      className="text-sm font-medium text-foreground"
                      numberOfLines={1}
                    >
                      {info.title}
                    </Text>
                    {info.subtitle && (
                      <Text
                        className="text-sm ml-1 flex-1 text-muted-foreground"
                        numberOfLines={1}
                      >
                        {info.subtitle}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {/* Reasoning */}
          {!!reasoningText && (
            <View className="rounded-lg px-3 py-2 mb-2 border-l-2 bg-muted/20 border-border/30">
              <Text
                className="text-xs italic text-muted-foreground/65"
                numberOfLines={3}
              >
                {reasoningText}
              </Text>
            </View>
          )}

          {/* Response text (rendered as markdown) */}
          {!!response && (
            <SelectableMarkdownText isDark={isDark}>
              {response}
            </SelectableMarkdownText>
          )}

          {/* Working indicator */}
          {working && !response && (
            <View className="flex-row items-center py-2">
              <View className="h-2 w-2 rounded-full bg-foreground mr-2 animate-pulse" />
              <Text className="text-sm text-muted-foreground">
                {statusText || 'Thinking...'}
              </Text>
            </View>
          )}

          {/* Working status with response */}
          {working && !!response && (
            <View className="flex-row items-center mt-1">
              <View className="h-1.5 w-1.5 rounded-full bg-foreground mr-1.5" />
              <Text className="text-xs text-muted-foreground">
                {statusText || 'Working...'}
              </Text>
            </View>
          )}

          {/* Error */}
          {!!turnError && !working && (
            <View className="mt-2 rounded-lg bg-destructive/10 px-3 py-2">
              <Text className="text-sm text-destructive">{turnError}</Text>
            </View>
          )}

          {/* Duration + Actions (when done) */}
          {!working && !!response && (
            <TurnActions
              response={response}
              duration={duration}
              isDark={isDark}
              onFork={lastAssistantMessageId ? () => onFork?.(lastAssistantMessageId) : undefined}
            />
          )}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// TurnActions — fade-in action bar below assistant response
// ---------------------------------------------------------------------------

function TurnActions({
  response,
  duration,
  isDark,
  onFork,
}: {
  response: string;
  duration?: number;
  isDark: boolean;
  onFork?: () => void;
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      delay: 150,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  const handleCopy = useCallback(async () => {
    await Clipboard.setStringAsync(response);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [response]);

  const mutedColor = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)';
  const hoverColor = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)';

  return (
    <Animated.View
      style={{
        opacity: fadeAnim,
        transform: [{
          translateY: fadeAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [6, 0],
          }),
        }],
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 6,
        gap: 2,
      }}
    >
      {/* Duration */}
      {duration != null && duration > 0 && (
        <Text className="text-xs text-muted-foreground/50 mr-2">
          {formatDuration(duration)}
        </Text>
      )}

      {/* Copy */}
      <TouchableOpacity
        onPress={handleCopy}
        activeOpacity={0.6}
        hitSlop={6}
        style={{
          padding: 5,
          borderRadius: 6,
        }}
      >
        <Ionicons
          name={copied ? 'checkmark' : 'copy-outline'}
          size={14}
          color={copied ? (isDark ? '#4ade80' : '#16a34a') : mutedColor}
        />
      </TouchableOpacity>

      {/* Fork */}
      {onFork && (
        <TouchableOpacity
          onPress={onFork}
          activeOpacity={0.6}
          hitSlop={6}
          style={{
            padding: 5,
            borderRadius: 6,
          }}
        >
          <Ionicons name="git-branch-outline" size={14} color={mutedColor} />
        </TouchableOpacity>
      )}

      {/* Revert */}
      <TouchableOpacity
        activeOpacity={0.6}
        hitSlop={6}
        style={{
          padding: 5,
          borderRadius: 6,
        }}
      >
        <Ionicons name="arrow-undo-outline" size={14} color={mutedColor} />
      </TouchableOpacity>
    </Animated.View>
  );
}
