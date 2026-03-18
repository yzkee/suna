/**
 * SessionTurn — renders a single user + assistant turn.
 *
 * Mirrors the Computer frontend's SessionTurn component logic.
 */

import React, { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import { View, TouchableOpacity, Animated, StyleSheet } from 'react-native';
import { Text } from '@/components/ui/text';
import { useColorScheme } from 'nativewind';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { SelectableMarkdownText } from '@/components/ui/selectable-markdown';
import ReAnimated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import type {
  Turn,
  MessageWithParts,
  SessionStatus,
  TextPart,
  ToolPart,
  ReasoningPart,
  QuestionRequest,
} from '@/lib/opencode/types';
import type { Command } from '@/lib/opencode/hooks/use-opencode-data';
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

// ─── Shimmer text for status indicators ──────────────────────────────────────

function ShimmerStatusText({ text, size = 'sm' }: { text: string; size?: 'sm' | 'xs' }) {
  const shimmerPosition = useSharedValue(0);
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  useEffect(() => {
    shimmerPosition.value = withRepeat(
      withTiming(1, { duration: 2000, easing: Easing.linear }),
      -1,
      false,
    );
  }, []);

  const animatedGradientStyle = useAnimatedStyle(() => {
    const translateX = interpolate(shimmerPosition.value, [0, 1], [-200, 200]);
    return { transform: [{ translateX }] };
  });

  const textColor = isDark ? '#a1a1aa' : '#71717a';
  const shimmerColor = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.35)';
  const fontSize = size === 'xs' ? 12 : 14;
  const lineHeight = size === 'xs' ? 16 : 20;

  return (
    <View style={{ justifyContent: 'center' }}>
      <MaskedView
        maskElement={
          <Text
            style={{
              fontSize,
              lineHeight,
              fontFamily: 'Roobert',
              color: '#000',
            }}
          >
            {text}
          </Text>
        }
      >
        <View style={{ width: Math.max(text.length * (fontSize * 0.6), 80), height: lineHeight }}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: textColor }]} />
          <ReAnimated.View style={[StyleSheet.absoluteFill, { width: 200 }, animatedGradientStyle]}>
            <LinearGradient
              colors={[textColor, shimmerColor, textColor]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={{ flex: 1, width: 200 }}
            />
          </ReAnimated.View>
        </View>
      </MaskedView>
    </View>
  );
}

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
  /** Session ID (for session mentions) */
  sessionId?: string;
}

const MENTION_COLORS: Record<MentionType, string> = {
  file: '#3b82f6',    // blue
  agent: '#a855f7',   // purple
  session: '#10b981', // emerald
};

function HighlightMentions({
  text,
  agentNames,
  onFileMention,
  onSessionMention,
}: {
  text: string;
  agentNames?: string[];
  onFileMention?: (path: string) => void;
  onSessionMention?: (sessionId: string) => void;
}) {
  const segments = useMemo<TextSegment[]>(() => {
    const { cleanText, sessions } = parseSessionReferences(text);
    if (!cleanText) return [{ text: '' }];

    // Detect session mentions first (titles can contain spaces)
    const detected: { start: number; end: number; type: MentionType; sessionId?: string }[] = [];
    for (const s of sessions) {
      const needle = `@${s.title}`;
      const idx = cleanText.indexOf(needle);
      if (idx !== -1) {
        detected.push({ start: idx, end: idx + needle.length, type: 'session', sessionId: s.id });
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
      result.push({ text: cleanText.slice(ref.start, ref.end), type: ref.type, sessionId: ref.sessionId });
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
      {segments.map((seg, i) => {
        if (!seg.type) {
          return <Text key={i}>{seg.text}</Text>;
        }

        const isClickable =
          (seg.type === 'file' && onFileMention) ||
          (seg.type === 'session' && onSessionMention && seg.sessionId);

        return (
          <Text
            key={i}
            style={{
              color: MENTION_COLORS[seg.type],
              fontFamily: 'Roobert-Medium',
              ...(isClickable ? { textDecorationLine: 'underline' as const, textDecorationColor: `${MENTION_COLORS[seg.type]}40` } : {}),
            }}
            onPress={
              isClickable
                ? () => {
                    if (seg.type === 'file' && onFileMention) {
                      onFileMention(seg.text.replace(/^@/, ''));
                    } else if (seg.type === 'session' && onSessionMention && seg.sessionId) {
                      onSessionMention(seg.sessionId);
                    }
                  }
                : undefined
            }
          >
            {seg.text}
          </Text>
        );
      })}
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
  onFileMention?: (path: string) => void;
  onSessionMention?: (sessionId: string) => void;
  commands?: Command[];
}

export function SessionTurn({
  turn,
  allMessages,
  sessionStatus,
  isBusy,
  pendingQuestions = [],
  onFork,
  agentNames,
  onFileMention,
  onSessionMention,
  commands,
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

  // Detect if this user message was generated by a slash command
  const commandInfo = useMemo(
    () => detectCommandFromText(userText, commands),
    [userText, commands],
  );

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
        {commandInfo ? (
          <View
            style={{
              borderRadius: 16,
              borderWidth: 1,
              borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
              backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
              paddingHorizontal: 16,
              paddingVertical: 10,
              maxWidth: '85%',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons
                name="terminal-outline"
                size={14}
                color={isDark ? '#a1a1aa' : '#71717a'}
              />
              <Text
                style={{
                  fontSize: 14,
                  fontFamily: 'Roobert-Medium',
                  color: isDark ? '#F8F8F8' : '#121215',
                }}
              >
                /{commandInfo.name}
              </Text>
            </View>
            {commandInfo.args && (
              <Text
                numberOfLines={3}
                style={{
                  fontSize: 12,
                  fontFamily: 'Roobert',
                  color: isDark ? '#71717a' : '#a1a1aa',
                  marginTop: 4,
                  paddingLeft: 22,
                }}
              >
                {commandInfo.args}
              </Text>
            )}
          </View>
        ) : (
          <View className="rounded-2xl rounded-br-md px-4 py-3 max-w-[85%] bg-card border border-border">
            <HighlightMentions
              text={userText}
              agentNames={agentNames}
              onFileMention={onFileMention}
              onSessionMention={onSessionMention}
            />
          </View>
        )}
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
              <ShimmerStatusText text={statusText || 'Thinking...'} size="sm" />
            </View>
          )}

          {/* Working status with response */}
          {working && !!response && (
            <View className="flex-row items-center mt-1">
              <View className="h-1.5 w-1.5 rounded-full bg-foreground mr-1.5" />
              <ShimmerStatusText text={statusText || 'Working...'} size="xs" />
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

// ---------------------------------------------------------------------------
// detectCommandFromText — detect if a user message matches a command template
// ---------------------------------------------------------------------------

function detectCommandFromText(
  rawText: string,
  commands?: Command[],
): { name: string; args?: string } | undefined {
  if (!commands || !rawText) return undefined;

  const trimmed = rawText.trim();
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  for (const cmd of commands) {
    if (!cmd.template) continue;
    const tpl = cmd.template.trim();

    // Large templates — fast exact/prefix match
    if (tpl.length > 2000) {
      const tplBody = tpl.replace(/\s*\$ARGUMENTS\s*$/, '').trimEnd();
      if (tplBody.length > 0 && trimmed === tplBody) {
        return { name: cmd.name, args: undefined };
      }
      if (tplBody.length > 0 && trimmed.startsWith(tplBody)) {
        const after = trimmed.slice(tplBody.length).trim();
        return { name: cmd.name, args: after.length > 0 && after.length < 200 ? after : undefined };
      }
      continue;
    }

    // Find first placeholder ($1, $ARGUMENTS)
    const phMatch = tpl.match(/\$(\d+|\bARGUMENTS\b)/);
    const prefix = phMatch ? tpl.slice(0, phMatch.index).trimEnd() : tpl.trimEnd();

    if (prefix.length < 20) continue;

    if (trimmed.startsWith(prefix)) {
      let args: string | undefined;
      if (phMatch) {
        const afterPrefix = trimmed.slice(prefix.length).trim();
        const lastBlock = afterPrefix.split('\n\n').pop()?.trim();
        if (lastBlock && lastBlock.length < 200) args = lastBlock;
      }
      return { name: cmd.name, args };
    }

    // Fallback — full regex match with placeholder wildcards
    const phRegex = /\$(\d+|\bARGUMENTS\b)/g;
    const placeholders: string[] = [];
    let src = '^';
    let lastIdx = 0;
    let m: RegExpExecArray | null;

    while ((m = phRegex.exec(tpl)) !== null) {
      src += escapeRe(tpl.slice(lastIdx, m.index));
      src += '([\\s\\S]*?)';
      placeholders.push(m[1]);
      lastIdx = m.index + m[0].length;
    }
    src += escapeRe(tpl.slice(lastIdx)) + '$';

    let fullMatch: RegExpMatchArray | null;
    try {
      fullMatch = trimmed.match(new RegExp(src));
    } catch {
      continue;
    }
    if (!fullMatch) continue;

    const captures = fullMatch.slice(1).map((v) => v?.trim() ?? '');
    const argsIdx = placeholders.findIndex((n) => n.toUpperCase() === 'ARGUMENTS');
    const best =
      (argsIdx >= 0 ? captures[argsIdx] : undefined) ||
      captures.find((v) => v.length > 0);
    return {
      name: cmd.name,
      args: best && best.length < 200 ? best : undefined,
    };
  }
  return undefined;
}
