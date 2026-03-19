/**
 * SessionTurn — renders a single user + assistant turn.
 *
 * Mirrors the Computer frontend's SessionTurn component logic.
 */

import React, { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import { View, TouchableOpacity, Animated, StyleSheet, LayoutAnimation, Platform, UIManager } from 'react-native';
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
import {
  Terminal,
  FileCode2,
  Search,
  Globe,
  Glasses,
  CheckSquare,
  Cpu,
  SquareKanban,
  ImageIcon,
  Presentation,
  List,
  Scissors,
  MessageCircle,
  ChevronRight,
  Check,
  CircleAlert,
  Loader2,
  type LucideIcon,
} from 'lucide-react-native';
import type {
  Turn,
  MessageWithParts,
  SessionStatus,
  TextPart,
  ToolPart,
  ReasoningPart,
  QuestionRequest,
  Part,
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
  stripAnsi,
} from '@/lib/opencode/turns';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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

// ─── Tool input resolver ─────────────────────────────────────────────────────
// The SDK sends `input` inside `state.input`, but mobile types define it at `tool.input`.
// At runtime the data may be in either location. This helper checks both.

function getToolInput(tool: ToolPart): Record<string, any> {
  const stateInput = (tool.state as any)?.input;
  if (stateInput && typeof stateInput === 'object' && Object.keys(stateInput).length > 0) {
    return stateInput;
  }
  return tool.input || {};
}

// ─── Tool icon resolver ──────────────────────────────────────────────────────

const TOOL_ICON_MAP: Record<string, LucideIcon> = {
  terminal: Terminal,
  'file-pen': FileCode2,
  search: Search,
  globe: Globe,
  glasses: Glasses,
  'check-square': CheckSquare,
  'square-kanban': SquareKanban,
  image: ImageIcon,
  presentation: Presentation,
  list: List,
  scissors: Scissors,
  'message-circle': MessageCircle,
  cpu: Cpu,
};

function getToolLucideIcon(iconName: string): LucideIcon {
  return TOOL_ICON_MAP[iconName] ?? Cpu;
}

// ─── Shared styles ───────────────────────────────────────────────────────────

const monoFont = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

function cardBorder(isDark: boolean) {
  return isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
}
function cardBg(isDark: boolean) {
  return isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.8)';
}
function mutedBg(isDark: boolean) {
  return isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)';
}
function fg(isDark: boolean) {
  return isDark ? '#F8F8F8' : '#121215';
}
function muted(isDark: boolean) {
  return isDark ? '#71717a' : '#a1a1aa';
}
function mutedStrong(isDark: boolean) {
  return isDark ? '#a1a1aa' : '#71717a';
}

// ─── MonoBlock — reusable monospace code block ───────────────────────────────

function MonoBlock({
  children,
  isDark,
  color,
  maxLines,
}: {
  children: string;
  isDark: boolean;
  color?: string;
  maxLines?: number;
}) {
  return (
    <Text
      numberOfLines={maxLines}
      style={{
        fontSize: 11,
        fontFamily: monoFont,
        lineHeight: 17,
        color: color || mutedStrong(isDark),
      }}
    >
      {children}
    </Text>
  );
}

// ─── OutputSection — "OUTPUT" label + content block ──────────────────────────

function OutputSection({
  output,
  isDark,
  isError,
}: {
  output: string;
  isDark: boolean;
  isError?: boolean;
}) {
  const displayOutput = output.length > 3000 ? output.slice(0, 3000) + '\n...' : output;
  return (
    <View
      style={{
        marginHorizontal: 10,
        marginBottom: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
        backgroundColor: mutedBg(isDark),
        overflow: 'hidden',
      }}
    >
      {/* Label */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingTop: 8, paddingBottom: 4 }}>
        <View
          style={{
            width: 5,
            height: 5,
            borderRadius: 2.5,
            backgroundColor: isError ? (isDark ? '#ef4444' : '#dc2626') : muted(isDark),
            marginRight: 6,
          }}
        />
        <Text style={{ fontSize: 10, fontFamily: 'Roobert', color: muted(isDark), textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {isError ? 'Error' : 'Output'}
        </Text>
      </View>
      {/* Content */}
      <View style={{ paddingHorizontal: 10, paddingBottom: 10 }}>
        <MonoBlock isDark={isDark} color={isError ? (isDark ? '#f87171' : '#dc2626') : undefined} maxLines={30}>
          {displayOutput}
        </MonoBlock>
      </View>
    </View>
  );
}

// ─── Bash syntax highlighting ────────────────────────────────────────────────

// Common bash commands/builtins to highlight
const BASH_COMMANDS = new Set([
  'ls', 'cd', 'cat', 'echo', 'grep', 'find', 'mkdir', 'rm', 'cp', 'mv',
  'touch', 'chmod', 'chown', 'head', 'tail', 'sort', 'uniq', 'wc', 'diff',
  'sed', 'awk', 'curl', 'wget', 'tar', 'zip', 'unzip', 'git', 'npm', 'npx',
  'node', 'python', 'python3', 'pip', 'pip3', 'yarn', 'pnpm', 'docker',
  'which', 'export', 'source', 'eval', 'exec', 'xargs', 'tee', 'tr',
  'cut', 'paste', 'test', 'read', 'set', 'unset', 'true', 'false',
  'pwd', 'env', 'printenv', 'date', 'sleep', 'kill', 'pkill', 'ps',
  'apt', 'brew', 'make', 'cmake', 'go', 'cargo', 'rustc', 'javac', 'java',
  'ssh', 'scp', 'rsync', 'jq', 'rg', 'fd', 'bat', 'exa',
]);

// Bash operators and redirections
const BASH_OPERATORS = new Set(['&&', '||', '|', ';', '>>', '2>', '2>&1', '>&2']);

interface BashToken {
  text: string;
  type: 'prompt' | 'command' | 'flag' | 'string' | 'operator' | 'redirect' | 'path' | 'plain';
}

function tokenizeBash(command: string): BashToken[] {
  const tokens: BashToken[] = [];
  // Add prompt
  tokens.push({ text: '$ ', type: 'prompt' });

  let i = 0;
  let isFirstWord = true;
  let afterOperator = false;

  while (i < command.length) {
    // Skip whitespace
    if (command[i] === ' ' || command[i] === '\t') {
      let ws = '';
      while (i < command.length && (command[i] === ' ' || command[i] === '\t')) {
        ws += command[i];
        i++;
      }
      tokens.push({ text: ws, type: 'plain' });
      continue;
    }

    // Quoted strings
    if (command[i] === '"' || command[i] === "'") {
      const quote = command[i];
      let str = quote;
      i++;
      while (i < command.length && command[i] !== quote) {
        if (command[i] === '\\' && i + 1 < command.length) {
          str += command[i] + command[i + 1];
          i += 2;
        } else {
          str += command[i];
          i++;
        }
      }
      if (i < command.length) { str += command[i]; i++; }
      tokens.push({ text: str, type: 'string' });
      isFirstWord = false;
      afterOperator = false;
      continue;
    }

    // Multi-char operators: &&, ||, >>, 2>, 2>&1
    const rest = command.slice(i);
    let matchedOp = '';
    for (const op of ['2>&1', '>&2', '2>', '>>', '&&', '||']) {
      if (rest.startsWith(op)) { matchedOp = op; break; }
    }
    if (matchedOp) {
      tokens.push({ text: matchedOp, type: 'operator' });
      i += matchedOp.length;
      isFirstWord = true;
      afterOperator = true;
      continue;
    }

    // Single-char operators: |, ;, >, <
    if ('|;><'.includes(command[i])) {
      tokens.push({ text: command[i], type: 'operator' });
      i++;
      isFirstWord = true;
      afterOperator = true;
      continue;
    }

    // Word
    let word = '';
    while (i < command.length && !' \t|;&><"\''.includes(command[i])) {
      word += command[i];
      i++;
    }

    if (!word) { i++; continue; }

    // Classify word
    if (isFirstWord || afterOperator) {
      // Command position
      if (BASH_COMMANDS.has(word)) {
        tokens.push({ text: word, type: 'command' });
      } else {
        tokens.push({ text: word, type: 'command' });
      }
      isFirstWord = false;
      afterOperator = false;
    } else if (word.startsWith('-')) {
      tokens.push({ text: word, type: 'flag' });
    } else if (word.startsWith('/') || word.includes('/') || word.startsWith('~')) {
      tokens.push({ text: word, type: 'path' });
    } else {
      tokens.push({ text: word, type: 'plain' });
    }
  }

  return tokens;
}

function HighlightedBashCommand({ command, isDark }: { command: string; isDark: boolean }) {
  const tokens = useMemo(() => tokenizeBash(command), [command]);

  const colors: Record<BashToken['type'], string> = {
    prompt: isDark ? '#71717a' : '#a1a1aa',
    command: isDark ? '#c4b5fd' : '#7c3aed', // purple
    flag: isDark ? '#93c5fd' : '#2563eb',     // blue
    string: isDark ? '#86efac' : '#16a34a',   // green
    operator: isDark ? '#fca5a5' : '#dc2626', // red
    redirect: isDark ? '#fca5a5' : '#dc2626', // red
    path: isDark ? '#e2e8f0' : '#334155',     // slate (near-white/dark)
    plain: fg(isDark),
  };

  const fs = 11;
  const lh = 17;

  return (
    <Text style={{ fontSize: fs, fontFamily: monoFont, lineHeight: lh }}>
      {tokens.map((token, i) => (
        <Text key={i} style={{ color: colors[token.type], fontSize: fs, fontFamily: monoFont, lineHeight: lh }}>
          {token.text}
        </Text>
      ))}
    </Text>
  );
}

// ─── Tool-specific expanded content renderers ────────────────────────────────

function ShellExpandedContent({ tool, isDark }: { tool: ToolPart; isDark: boolean }) {
  const input = getToolInput(tool);
  const metadata = (tool.state as any)?.metadata || {};
  const command = input.command || metadata.command || '';
  const output = useMemo(() => {
    if (tool.state.status === 'completed' && 'output' in tool.state && tool.state.output) {
      // Strip bash_metadata XML tags if present
      let raw = tool.state.output;
      raw = raw.replace(/<bash_metadata>[\s\S]*?<\/bash_metadata>/g, '');
      return stripAnsi(raw).trim();
    }
    if (tool.state.status === 'error' && 'error' in tool.state) {
      return tool.state.error;
    }
    return undefined;
  }, [tool.state]);

  return (
    <View>
      {/* Command */}
      {!!command && (
        <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
          <HighlightedBashCommand command={command} isDark={isDark} />
        </View>
      )}
      {/* Output */}
      {!!output && (
        <OutputSection output={output} isDark={isDark} isError={tool.state.status === 'error'} />
      )}
    </View>
  );
}

function WriteEditExpandedContent({ tool, isDark }: { tool: ToolPart; isDark: boolean }) {
  const input = getToolInput(tool);
  const content = input.content || input.newString || '';
  const filePath = input.filePath || '';
  const output = useMemo(() => {
    if (tool.state.status === 'completed' && 'output' in tool.state && tool.state.output) {
      return stripAnsi(tool.state.output).trim();
    }
    return undefined;
  }, [tool.state]);

  // For edit, show old -> new
  const oldString = input.oldString;
  const newString = input.newString;
  const isEdit = tool.tool === 'edit' || tool.tool === 'morph_edit';

  return (
    <View>
      {isEdit && oldString && newString ? (
        <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
          {/* Deletions */}
          <View style={{ marginBottom: 4 }}>
            {oldString.split('\n').slice(0, 15).map((line: string, i: number) => (
              <View
                key={`del-${i}`}
                style={{
                  flexDirection: 'row',
                  backgroundColor: isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.06)',
                  paddingHorizontal: 4,
                  borderRadius: 2,
                }}
              >
                <Text style={{ fontSize: 11, fontFamily: monoFont, lineHeight: 17, color: isDark ? '#f87171' : '#dc2626', marginRight: 6 }}>-</Text>
                <Text style={{ fontSize: 11, fontFamily: monoFont, lineHeight: 17, color: isDark ? '#f87171' : '#dc2626', flex: 1 }} numberOfLines={1}>
                  {line}
                </Text>
              </View>
            ))}
          </View>
          {/* Additions */}
          <View>
            {newString.split('\n').slice(0, 15).map((line: string, i: number) => (
              <View
                key={`add-${i}`}
                style={{
                  flexDirection: 'row',
                  backgroundColor: isDark ? 'rgba(16,185,129,0.08)' : 'rgba(16,185,129,0.06)',
                  paddingHorizontal: 4,
                  borderRadius: 2,
                }}
              >
                <Text style={{ fontSize: 11, fontFamily: monoFont, lineHeight: 17, color: isDark ? '#34d399' : '#059669', marginRight: 6 }}>+</Text>
                <Text style={{ fontSize: 11, fontFamily: monoFont, lineHeight: 17, color: isDark ? '#34d399' : '#059669', flex: 1 }} numberOfLines={1}>
                  {line}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : content ? (
        <View style={{ paddingHorizontal: 12, paddingVertical: 10, maxHeight: 250 }}>
          <MonoBlock isDark={isDark} maxLines={25}>
            {content.length > 2000 ? content.slice(0, 2000) + '\n...' : content}
          </MonoBlock>
        </View>
      ) : null}
      {!!output && <OutputSection output={output} isDark={isDark} />}
    </View>
  );
}

function TodosExpandedContent({ tool, isDark }: { tool: ToolPart; isDark: boolean }) {
  const todos = useMemo(() => {
    // Try parsing input.todos (check both state.input and top-level input)
    const input = getToolInput(tool);
    const raw = input.todos;
    if (Array.isArray(raw)) return raw;
    // Try parsing output
    if (tool.state.status === 'completed' && 'output' in tool.state && tool.state.output) {
      try {
        const parsed = JSON.parse(tool.state.output);
        if (Array.isArray(parsed)) return parsed;
        if (parsed?.todos && Array.isArray(parsed.todos)) return parsed.todos;
      } catch {}
    }
    return [];
  }, [tool.input, tool.state]);

  if (todos.length === 0) return null;

  const statusIcons: Record<string, { icon: string; color: string }> = {
    completed: { icon: 'checkmark-circle', color: isDark ? '#4ade80' : '#16a34a' },
    in_progress: { icon: 'ellipsis-horizontal-circle', color: isDark ? '#60a5fa' : '#2563eb' },
    pending: { icon: 'ellipse-outline', color: muted(isDark) },
    cancelled: { icon: 'close-circle-outline', color: muted(isDark) },
  };

  return (
    <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
      {todos.map((todo: any, i: number) => {
        const st = statusIcons[todo.status] || statusIcons.pending;
        return (
          <View
            key={i}
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              paddingVertical: 5,
              borderBottomWidth: i < todos.length - 1 ? 1 : 0,
              borderBottomColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
            }}
          >
            <Ionicons
              name={st.icon as any}
              size={16}
              color={st.color}
              style={{ marginRight: 8, marginTop: 1 }}
            />
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: 'Roobert',
                  lineHeight: 18,
                  color: todo.status === 'cancelled' ? muted(isDark) : fg(isDark),
                  textDecorationLine: todo.status === 'cancelled' ? 'line-through' : 'none',
                }}
              >
                {todo.content}
              </Text>
              {todo.priority && (
                <Text style={{ fontSize: 10, fontFamily: 'Roobert', color: muted(isDark), marginTop: 1 }}>
                  {todo.priority}
                </Text>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function ReadExpandedContent({ tool, isDark }: { tool: ToolPart; isDark: boolean }) {
  const output = useMemo(() => {
    if (tool.state.status === 'completed' && 'output' in tool.state && tool.state.output) {
      return stripAnsi(tool.state.output).trim();
    }
    return undefined;
  }, [tool.state]);

  if (!output) return null;

  return (
    <View style={{ paddingHorizontal: 12, paddingVertical: 10, maxHeight: 250 }}>
      <MonoBlock isDark={isDark} maxLines={30}>
        {output.length > 3000 ? output.slice(0, 3000) + '\n...' : output}
      </MonoBlock>
    </View>
  );
}

function WebSearchExpandedContent({ tool, isDark }: { tool: ToolPart; isDark: boolean }) {
  const results = useMemo(() => {
    if (tool.state.status !== 'completed' || !('output' in tool.state) || !tool.state.output) return [];
    try {
      const parsed = JSON.parse(tool.state.output);
      // Handle different formats
      if (Array.isArray(parsed)) return parsed;
      if (parsed?.results && Array.isArray(parsed.results)) return parsed.results;
      if (parsed?.queries) {
        // Batch format - flatten
        return parsed.queries.flatMap((q: any) => q.sources || q.results || []);
      }
      return [];
    } catch {
      return [];
    }
  }, [tool.state]);

  if (results.length === 0) {
    // Fallback to raw output
    const rawOutput = tool.state.status === 'completed' && 'output' in tool.state ? tool.state.output?.trim() : undefined;
    if (rawOutput) {
      return (
        <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
          <MonoBlock isDark={isDark} maxLines={20}>{rawOutput}</MonoBlock>
        </View>
      );
    }
    return null;
  }

  return (
    <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
      {results.slice(0, 8).map((result: any, i: number) => (
        <View
          key={i}
          style={{
            paddingVertical: 6,
            borderBottomWidth: i < Math.min(results.length, 8) - 1 ? 1 : 0,
            borderBottomColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
          }}
        >
          <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: 'Roobert-Medium', color: fg(isDark), marginBottom: 2 }}>
            {result.title || result.name || 'Untitled'}
          </Text>
          {(result.url || result.link) && (
            <Text numberOfLines={1} style={{ fontSize: 10, fontFamily: monoFont, color: muted(isDark), marginBottom: 2 }}>
              {(result.url || result.link).replace(/^https?:\/\//, '').split('/')[0]}
            </Text>
          )}
          {(result.snippet || result.description || result.text) && (
            <Text numberOfLines={2} style={{ fontSize: 11, fontFamily: 'Roobert', color: mutedStrong(isDark), lineHeight: 16 }}>
              {(result.snippet || result.description || result.text).slice(0, 200)}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

function GlobGrepExpandedContent({ tool, isDark }: { tool: ToolPart; isDark: boolean }) {
  const output = useMemo(() => {
    if (tool.state.status === 'completed' && 'output' in tool.state && tool.state.output) {
      return stripAnsi(tool.state.output).trim();
    }
    return undefined;
  }, [tool.state]);

  if (!output) return null;

  const lines = output.split('\n').filter(Boolean);
  const isPathList = lines.length > 0 && lines.slice(0, 5).every(l => l.includes('/') || l.includes('.'));

  if (isPathList) {
    return (
      <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
        {lines.slice(0, 30).map((line, i) => {
          const parts = line.split('/');
          const filename = parts[parts.length - 1] || line;
          const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
          return (
            <View
              key={i}
              style={{
                flexDirection: 'row',
                paddingVertical: 4,
                borderBottomWidth: i < Math.min(lines.length, 30) - 1 ? 1 : 0,
                borderBottomColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
              }}
            >
              <Text numberOfLines={1} style={{ fontSize: 11, fontFamily: monoFont, color: fg(isDark) }}>
                {filename}
              </Text>
              {!!dir && (
                <Text numberOfLines={1} style={{ fontSize: 11, fontFamily: monoFont, color: muted(isDark), marginLeft: 6, flex: 1 }}>
                  {dir}
                </Text>
              )}
            </View>
          );
        })}
        {lines.length > 30 && (
          <Text style={{ fontSize: 10, fontFamily: 'Roobert', color: muted(isDark), marginTop: 6 }}>
            +{lines.length - 30} more
          </Text>
        )}
      </View>
    );
  }

  return (
    <View style={{ paddingHorizontal: 12, paddingVertical: 10, maxHeight: 250 }}>
      <MonoBlock isDark={isDark} maxLines={30}>
        {output.length > 3000 ? output.slice(0, 3000) + '\n...' : output}
      </MonoBlock>
    </View>
  );
}

function GenericExpandedContent({ tool, isDark }: { tool: ToolPart; isDark: boolean }) {
  const output = useMemo(() => {
    if (tool.state.status === 'completed' && 'output' in tool.state && tool.state.output) {
      return stripAnsi(tool.state.output).trim();
    }
    if (tool.state.status === 'error' && 'error' in tool.state) {
      return tool.state.error;
    }
    return undefined;
  }, [tool.state]);

  if (!output) return null;

  return (
    <View style={{ paddingHorizontal: 12, paddingVertical: 10, maxHeight: 250 }}>
      <MonoBlock isDark={isDark} color={tool.state.status === 'error' ? (isDark ? '#f87171' : '#dc2626') : undefined} maxLines={30}>
        {output.length > 3000 ? output.slice(0, 3000) + '\n...' : output}
      </MonoBlock>
    </View>
  );
}

// ─── Get expanded content by tool type ───────────────────────────────────────

function getExpandedContent(tool: ToolPart, isDark: boolean): React.ReactNode {
  switch (tool.tool) {
    case 'bash':
      return <ShellExpandedContent tool={tool} isDark={isDark} />;
    case 'write':
    case 'edit':
    case 'morph_edit':
      return <WriteEditExpandedContent tool={tool} isDark={isDark} />;
    case 'todowrite':
      return <TodosExpandedContent tool={tool} isDark={isDark} />;
    case 'read':
      return <ReadExpandedContent tool={tool} isDark={isDark} />;
    case 'websearch':
    case 'web-search':
    case 'web_search':
      return <WebSearchExpandedContent tool={tool} isDark={isDark} />;
    case 'glob':
    case 'grep':
    case 'list':
      return <GlobGrepExpandedContent tool={tool} isDark={isDark} />;
    case 'webfetch':
    case 'scrape-webpage':
      return <GenericExpandedContent tool={tool} isDark={isDark} />;
    default:
      return <GenericExpandedContent tool={tool} isDark={isDark} />;
  }
}

// ─── Check if tool has expandable content ────────────────────────────────────

function toolHasExpandableContent(tool: ToolPart): boolean {
  const { state } = tool;
  const input = getToolInput(tool);
  // Todos always expandable if input has todos
  if (tool.tool === 'todowrite' && Array.isArray(input.todos) && input.todos.length > 0) return true;
  // Shell expandable if has command, description, or output
  if (tool.tool === 'bash' && (input.command || input.description)) return true;
  // Write/Edit expandable if has content
  if ((tool.tool === 'write' || tool.tool === 'edit' || tool.tool === 'morph_edit') &&
      (input.content || input.oldString || input.newString)) return true;
  // Any tool with completed output is expandable
  if (state.status === 'completed' && 'output' in state && state.output?.trim()) return true;
  // Any tool with error is expandable
  if (state.status === 'error' && 'error' in state && state.error) return true;
  return false;
}

// ─── ToolCard — expandable tool call card ────────────────────────────────────

function ToolCard({
  tool,
  isDark,
}: {
  tool: ToolPart;
  isDark: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const input = getToolInput(tool);
  const info = getToolInfo(tool.tool, input);
  const isRunning = tool.state.status === 'pending' || tool.state.status === 'running';
  const isError = tool.state.status === 'error';

  const IconComponent = getToolLucideIcon(info.icon);
  const iconColor = mutedStrong(isDark);

  const hasExpandable = toolHasExpandableContent(tool);

  const handlePress = useCallback(() => {
    if (!hasExpandable && !isRunning) return;
    if (isRunning) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((prev) => !prev);
  }, [hasExpandable, isRunning]);

  const chevronRotation = useSharedValue(0);

  useEffect(() => {
    chevronRotation.value = withTiming(expanded ? 1 : 0, { duration: 200 });
  }, [expanded]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronRotation.value * 90}deg` }],
  }));

  return (
    <View
      style={{
        borderRadius: 12,
        borderWidth: 1,
        borderColor: cardBorder(isDark),
        backgroundColor: cardBg(isDark),
        marginBottom: 6,
        overflow: 'hidden',
      }}
    >
      {/* Header row */}
      <TouchableOpacity
        activeOpacity={hasExpandable ? 0.7 : 1}
        onPress={handlePress}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          paddingVertical: 10,
        }}
      >
        {/* Tool icon */}
        <IconComponent size={15} color={iconColor} style={{ marginRight: 8 }} />

        {/* Title */}
        <Text
          style={{
            fontSize: 13,
            fontFamily: 'Roobert-Medium',
            color: fg(isDark),
          }}
        >
          {info.title}
        </Text>

        {/* Subtitle */}
        {info.subtitle && (
          isRunning ? (
            <View style={{ flex: 1, marginLeft: 6 }}>
              <ShimmerStatusText text={info.subtitle} size="xs" />
            </View>
          ) : (
            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                marginLeft: 6,
                fontSize: 12,
                fontFamily: monoFont,
                color: muted(isDark),
              }}
            >
              {info.subtitle}
            </Text>
          )
        )}

        {/* Right side: status indicator or chevron */}
        <View style={{ marginLeft: 'auto', paddingLeft: 8 }}>
          {isRunning ? (
            <SpinningLoader size={14} color={muted(isDark)} />
          ) : isError ? (
            <CircleAlert size={14} color={isDark ? '#ef4444' : '#dc2626'} />
          ) : hasExpandable ? (
            <ReAnimated.View style={chevronStyle}>
              <ChevronRight size={14} color={isDark ? '#52525b' : '#a1a1aa'} />
            </ReAnimated.View>
          ) : (
            <Check size={14} color={isDark ? '#4ade80' : '#16a34a'} />
          )}
        </View>
      </TouchableOpacity>

      {/* Expanded content — tool-specific */}
      {expanded && (
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
          }}
        >
          {getExpandedContent(tool, isDark)}
        </View>
      )}
    </View>
  );
}

// ─── Spinning Loader ─────────────────────────────────────────────────────────

function SpinningLoader({ size, color }: { size: number; color: string }) {
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 1000, easing: Easing.linear }),
      -1,
      false,
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <ReAnimated.View style={animatedStyle}>
      <Loader2 size={size} color={color} />
    </ReAnimated.View>
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

  // Build interleaved parts list (text, tools, reasoning in natural order)
  // Hide question tool parts with pending questions, hide internal tools
  const visibleParts = useMemo(() => {
    const pendingCallIDs = new Set(
      pendingQuestions.filter((q) => q.tool).map((q) => q.tool!.callID),
    );
    return allParts.filter(({ part }) => {
      if (isToolPart(part)) {
        const tp = part as ToolPart;
        if (!shouldShowToolPart(tp)) return false;
        if (tp.tool === 'question' && pendingCallIDs.has(tp.callID)) return false;
        return true;
      }
      if (isTextPart(part)) return !!(part as TextPart).text?.trim();
      if (isReasoningPart(part)) return !!(part as ReasoningPart).text?.trim();
      return false;
    });
  }, [allParts, pendingQuestions]);

  // Get the final response text (last text part) for copy/actions
  const response = useMemo(() => {
    const lastText = findLastTextPart(allParts);
    return lastText?.text ?? '';
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

      {/* Assistant response — interleaved text + tool calls */}
      {(turn.assistantMessages.length > 0 || working) && (
        <View className="px-4">
          {visibleParts.map(({ part }) => {
            if (isToolPart(part)) {
              const tp = part as ToolPart;
              return <ToolCard key={tp.id} tool={tp} isDark={isDark} />;
            }
            if (isTextPart(part)) {
              const tp = part as TextPart;
              if (!tp.text?.trim()) return null;
              return (
                <View key={tp.id} className="mb-2">
                  <SelectableMarkdownText isDark={isDark}>
                    {tp.text}
                  </SelectableMarkdownText>
                </View>
              );
            }
            if (isReasoningPart(part)) {
              const rp = part as ReasoningPart;
              if (!rp.text?.trim()) return null;
              return (
                <View
                  key={rp.id}
                  className="rounded-lg px-3 py-2 mb-2 border-l-2 bg-muted/20 border-border/30"
                >
                  <Text
                    className="text-xs italic text-muted-foreground/65"
                    numberOfLines={3}
                  >
                    {rp.text}
                  </Text>
                </View>
              );
            }
            return null;
          })}

          {/* Working indicator */}
          {working && visibleParts.length === 0 && (
            <View className="flex-row items-center py-2">
              <View className="h-2 w-2 rounded-full bg-foreground mr-2 animate-pulse" />
              <ShimmerStatusText text={statusText || 'Thinking...'} size="sm" />
            </View>
          )}

          {/* Working status when there are already parts */}
          {working && visibleParts.length > 0 && (
            <View className="flex-row items-center mt-1 mb-1">
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
