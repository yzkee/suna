/**
 * QuestionPrompt — mobile-native question UI for OpenCode sessions.
 *
 * Mirrors the frontend's question-prompt.tsx with native mobile UX:
 * - Scrollable tab pills for multi-question flows
 * - Checkbox/radio option rows with haptic feedback
 * - Custom text input with keyboard-aware layout
 * - Confirm tab with review + submit
 * - Single-question immediate submit on pick
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Animated,
  Keyboard,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { useColorScheme } from 'nativewind';
import { Ionicons } from '@expo/vector-icons';
import type {
  QuestionRequest,
  QuestionInfo,
  QuestionAnswer,
} from '@/lib/opencode/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface QuestionPromptProps {
  request: QuestionRequest;
  onReply: (requestId: string, answers: QuestionAnswer[]) => void;
  onReject: (requestId: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function QuestionPrompt({
  request,
  onReply,
  onReject,
}: QuestionPromptProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  const questions = request.questions;
  const isSingle = questions.length === 1 && !questions[0].multiple;

  const [tab, setTab] = useState(0);
  const [answers, setAnswers] = useState<QuestionAnswer[]>(() =>
    questions.map(() => []),
  );
  const [customInputs, setCustomInputs] = useState<string[]>(() =>
    questions.map(() => ''),
  );
  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // Slide-in animation
  const slideAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start();
  }, [slideAnim]);

  const isConfirm = tab === questions.length;
  const currentQuestion = questions[tab] as QuestionInfo | undefined;
  const isMulti = currentQuestion?.multiple ?? false;
  const options = currentQuestion?.options ?? [];
  const currentAnswers = answers[tab] ?? [];
  const showCustom = currentQuestion?.custom !== false;

  // Auto-focus input when editing
  useEffect(() => {
    if (editing) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [editing]);

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  const pick = useCallback(
    (answer: string, isCustom = false) => {
      const next = [...answers];
      next[tab] = [answer];
      setAnswers(next);

      if (isCustom) {
        const nextCustom = [...customInputs];
        nextCustom[tab] = answer;
        setCustomInputs(nextCustom);
      }

      if (isSingle) {
        setReplying(true);
        onReply(request.id, [[answer]]);
        return;
      }

      // Advance to next tab
      setTab(tab + 1);
      setEditing(false);
    },
    [answers, customInputs, tab, isSingle, request.id, onReply],
  );

  const toggle = useCallback(
    (answer: string) => {
      const existing = answers[tab] ?? [];
      const next = [...existing];
      const idx = next.indexOf(answer);
      if (idx === -1) next.push(answer);
      else next.splice(idx, 1);

      const updated = [...answers];
      updated[tab] = next;
      setAnswers(updated);
    },
    [answers, tab],
  );

  const selectOption = useCallback(
    (optIndex: number) => {
      const opts = currentQuestion?.options ?? [];
      if (showCustom && optIndex === opts.length) {
        setEditing(true);
        return;
      }
      const opt = opts[optIndex];
      if (!opt) return;

      if (isMulti) {
        toggle(opt.label);
      } else {
        pick(opt.label);
      }
    },
    [currentQuestion?.options, isMulti, showCustom, toggle, pick],
  );

  const handleCustomSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) {
        setEditing(false);
        return;
      }

      if (isMulti) {
        const existing = answers[tab] ?? [];
        if (!existing.includes(trimmed)) {
          const next = [...existing, trimmed];
          const updated = [...answers];
          updated[tab] = next;
          setAnswers(updated);
        }
        setEditing(false);
        const nextCustom = [...customInputs];
        nextCustom[tab] = '';
        setCustomInputs(nextCustom);
        return;
      }

      pick(trimmed, true);
      setEditing(false);
      Keyboard.dismiss();
    },
    [isMulti, answers, customInputs, tab, pick],
  );

  const submit = useCallback(() => {
    setReplying(true);
    const finalAnswers = questions.map((_, i) => answers[i] ?? []);
    onReply(request.id, finalAnswers);
  }, [answers, questions, request.id, onReply]);

  const reject = useCallback(() => {
    setReplying(true);
    onReject(request.id);
  }, [request.id, onReject]);

  // -----------------------------------------------------------------------
  // Once replied, hide
  // -----------------------------------------------------------------------

  if (replying) return null;

  // -----------------------------------------------------------------------
  // Header summary
  // -----------------------------------------------------------------------

  const headerSummary = (() => {
    if (isSingle) {
      const q = questions[0];
      const trimmedHeader = q.header?.trim();
      if (trimmedHeader && trimmedHeader !== q.question.trim()) {
        return trimmedHeader;
      }
      return 'Question';
    }
    const answered = answers.filter((a) => a.length > 0).length;
    return `${answered} of ${questions.length} answered`;
  })();

  // -----------------------------------------------------------------------
  // Colors
  // -----------------------------------------------------------------------

  const borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const bgColor = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';
  const mutedColor = isDark ? '#888' : '#777';
  const fgColor = isDark ? '#F8F8F8' : '#121215';
  const pillActiveBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
  const pillActiveBorder = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)';
  const selectedBg = isDark ? 'rgba(248,248,248,0.06)' : 'rgba(18,18,21,0.04)';
  const selectedBorder = isDark ? 'rgba(248,248,248,0.15)' : 'rgba(18,18,21,0.15)';
  const checkColor = fgColor;

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <Animated.View
      style={{
        opacity: slideAnim,
        transform: [
          {
            translateY: slideAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [20, 0],
            }),
          },
        ],
      }}
    >
      <View
        style={{
          borderWidth: 1,
          borderColor,
          backgroundColor: bgColor,
          borderRadius: 16,
          overflow: 'hidden',
          marginHorizontal: 16,
          marginBottom: 8,
        }}
      >
        {/* ── Header ── */}
        <View className="flex-row items-center px-3 py-2">
          <Ionicons
            name="chatbubble-ellipses-outline"
            size={14}
            color={mutedColor}
          />
          <Text
            className="flex-1 text-xs ml-2 text-muted-foreground"
            numberOfLines={1}
          >
            {!isSingle && `${questions.length} questions \u00B7 `}
            <Text className="text-foreground/80 font-roobert-medium text-xs">
              {headerSummary}
            </Text>
          </Text>
          <TouchableOpacity
            onPress={reject}
            hitSlop={8}
            className="h-6 w-6 items-center justify-center rounded-md"
            activeOpacity={0.6}
          >
            <Ionicons name="close" size={14} color={mutedColor} />
          </TouchableOpacity>
        </View>

        {/* ── Body ── */}
        <View style={{ borderTopWidth: 1, borderTopColor: borderColor }}>
          {/* Tab pills (multi-question only) */}
          {!isSingle && (
            <View
              style={{
                borderBottomWidth: 1,
                borderBottomColor: borderColor,
              }}
            >
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{
                  paddingHorizontal: 8,
                  paddingVertical: 6,
                  gap: 4,
                }}
              >
                {questions.map((q, i) => {
                  const isAnswered = (answers[i]?.length ?? 0) > 0;
                  const isActive = tab === i;
                  return (
                    <TouchableOpacity
                      key={i}
                      onPress={() => {
                        setTab(i);
                        setEditing(false);
                      }}
                      activeOpacity={0.7}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: isActive ? pillActiveBorder : 'transparent',
                        backgroundColor: isActive ? pillActiveBg : 'transparent',
                        gap: 5,
                      }}
                    >
                      {/* Checkbox indicator */}
                      <View
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 3,
                          borderWidth: 1.5,
                          borderColor: isAnswered
                            ? checkColor
                            : isActive
                              ? mutedColor
                              : isDark
                                ? 'rgba(255,255,255,0.15)'
                                : 'rgba(0,0,0,0.15)',
                          backgroundColor: isAnswered
                            ? (isDark ? 'rgba(248,248,248,0.1)' : 'rgba(18,18,21,0.06)')
                            : 'transparent',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {isAnswered && (
                          <Ionicons name="checkmark" size={10} color={checkColor} />
                        )}
                        {!isAnswered && isActive && (
                          <View
                            style={{
                              width: 3,
                              height: 3,
                              borderRadius: 1.5,
                              backgroundColor: fgColor,
                            }}
                          />
                        )}
                      </View>
                      <Text
                        className={`text-sm ${
                          isActive
                            ? 'font-roobert-medium text-foreground'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {q.header || `Q${i + 1}`}
                      </Text>
                    </TouchableOpacity>
                  );
                })}

                {/* Confirm tab */}
                <TouchableOpacity
                  onPress={() => {
                    setTab(questions.length);
                    setEditing(false);
                  }}
                  activeOpacity={0.7}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: isConfirm ? pillActiveBorder : 'transparent',
                    backgroundColor: isConfirm ? pillActiveBg : 'transparent',
                  }}
                >
                  <Text
                    className={`text-sm ${
                      isConfirm
                        ? 'font-roobert-medium text-foreground'
                        : 'text-muted-foreground'
                    }`}
                  >
                    Confirm
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          )}

          {/* Content area */}
          <View className="px-3 py-2.5">
            {isConfirm ? (
              /* ── Confirm / review tab ── */
              <View>
                {questions.map((q, i) => {
                  const ans = answers[i] ?? [];
                  const done = ans.length > 0;
                  return (
                    <TouchableOpacity
                      key={i}
                      onPress={() => setTab(i)}
                      activeOpacity={0.6}
                      className="flex-row items-center py-1.5"
                      style={{ opacity: done ? 1 : 0.4 }}
                    >
                      {/* Checkbox */}
                      <View
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 3,
                          borderWidth: 1.5,
                          borderColor: done ? checkColor : (isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'),
                          backgroundColor: done ? (isDark ? 'rgba(248,248,248,0.1)' : 'rgba(18,18,21,0.06)') : 'transparent',
                          alignItems: 'center',
                          justifyContent: 'center',
                          marginRight: 8,
                        }}
                      >
                        {done && (
                          <Ionicons name="checkmark" size={10} color={checkColor} />
                        )}
                      </View>
                      <Text
                        className="flex-1 text-sm text-foreground"
                        numberOfLines={1}
                      >
                        {q.header || q.question}
                      </Text>
                      <Text
                        className="text-sm text-muted-foreground ml-2"
                        numberOfLines={1}
                        style={{ maxWidth: '40%' }}
                      >
                        {ans.length > 0 ? ans.join(', ') : '\u2014'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}

                {/* Submit button */}
                <View className="flex-row justify-end mt-3">
                  <TouchableOpacity
                    onPress={submit}
                    activeOpacity={0.8}
                    style={{
                      backgroundColor: fgColor,
                      paddingHorizontal: 20,
                      paddingVertical: 10,
                      borderRadius: 10,
                    }}
                  >
                    <Text
                      style={{
                        color: isDark ? '#121215' : '#F8F8F8',
                        fontSize: 14,
                        fontFamily: 'Roobert-Medium',
                      }}
                    >
                      Submit
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : currentQuestion ? (
              /* ── Question content ── */
              <View>
                {/* Question text */}
                <Text className="text-sm font-roobert-medium text-foreground leading-relaxed mb-2">
                  {currentQuestion.question}
                  {isMulti && (
                    <Text className="text-sm text-muted-foreground italic">
                      {' '}(select multiple)
                    </Text>
                  )}
                </Text>

                {/* Options */}
                {options.map((opt, i) => {
                  const isPicked = currentAnswers.includes(opt.label);
                  return (
                    <TouchableOpacity
                      key={i}
                      onPress={() => selectOption(i)}
                      activeOpacity={0.7}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingHorizontal: 10,
                        paddingVertical: 10,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: isPicked ? selectedBorder : 'transparent',
                        backgroundColor: isPicked ? selectedBg : 'transparent',
                        marginBottom: 2,
                        gap: 10,
                      }}
                    >
                      {/* Checkbox / radio indicator */}
                      <View
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: isMulti ? 4 : 9,
                          borderWidth: 1.5,
                          borderColor: isPicked
                            ? fgColor
                            : isDark
                              ? 'rgba(255,255,255,0.2)'
                              : 'rgba(0,0,0,0.15)',
                          backgroundColor: isPicked
                            ? (isDark ? 'rgba(248,248,248,0.1)' : 'rgba(18,18,21,0.06)')
                            : 'transparent',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {isPicked && (
                          <Ionicons
                            name="checkmark"
                            size={12}
                            color={fgColor}
                          />
                        )}
                      </View>

                      {/* Label + description */}
                      <View className="flex-1">
                        <Text className="text-sm">
                          <Text
                            className={`font-roobert-semibold ${
                              isPicked ? 'text-foreground' : 'text-foreground/80'
                            }`}
                          >
                            {opt.label}
                          </Text>
                          {opt.description && (
                            <Text className="text-muted-foreground">
                              {' '}{opt.description}
                            </Text>
                          )}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}

                {/* Type your own answer */}
                {showCustom && !editing && (
                  <TouchableOpacity
                    onPress={() => selectOption(options.length)}
                    activeOpacity={0.7}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingHorizontal: 10,
                      paddingVertical: 10,
                      borderRadius: 10,
                      gap: 10,
                    }}
                  >
                    <Ionicons
                      name="pencil-outline"
                      size={16}
                      color={isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)'}
                    />
                    <Text className="text-sm text-muted-foreground">
                      Type your own answer
                    </Text>
                  </TouchableOpacity>
                )}

                {/* Custom input */}
                {editing && (
                  <View className="flex-row items-center mt-1 gap-2">
                    <TextInput
                      ref={inputRef}
                      placeholder="Type your answer..."
                      placeholderTextColor={mutedColor}
                      defaultValue={customInputs[tab]}
                      onSubmitEditing={(e) =>
                        handleCustomSubmit(e.nativeEvent.text)
                      }
                      returnKeyType={isMulti ? 'done' : 'go'}
                      style={{
                        flex: 1,
                        height: 36,
                        paddingHorizontal: 12,
                        fontSize: 14,
                        color: fgColor,
                        backgroundColor: isDark
                          ? 'rgba(255,255,255,0.05)'
                          : 'rgba(0,0,0,0.03)',
                        borderWidth: 1,
                        borderColor: isDark
                          ? 'rgba(255,255,255,0.1)'
                          : 'rgba(0,0,0,0.08)',
                        borderRadius: 8,
                      }}
                    />
                    <TouchableOpacity
                      onPress={() => {
                        const val = inputRef.current
                          ? (inputRef.current as any)._lastNativeText ||
                            customInputs[tab]
                          : customInputs[tab];
                        handleCustomSubmit(val || '');
                      }}
                      activeOpacity={0.8}
                      style={{
                        height: 36,
                        paddingHorizontal: 12,
                        backgroundColor: fgColor,
                        borderRadius: 8,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text
                        style={{
                          color: isDark ? '#121215' : '#F8F8F8',
                          fontSize: 13,
                          fontFamily: 'Roobert-Medium',
                        }}
                      >
                        {isMulti ? 'Add' : 'Go'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        setEditing(false);
                        Keyboard.dismiss();
                      }}
                      hitSlop={8}
                      className="h-9 w-9 items-center justify-center rounded-lg"
                      activeOpacity={0.6}
                    >
                      <Ionicons name="close" size={16} color={mutedColor} />
                    </TouchableOpacity>
                  </View>
                )}

                {/* Next button for multi-select */}
                {!isSingle && isMulti && !editing && (
                  <View className="flex-row justify-end mt-2">
                    <TouchableOpacity
                      onPress={() => {
                        setTab(tab + 1);
                        setEditing(false);
                      }}
                      disabled={currentAnswers.length === 0}
                      activeOpacity={0.8}
                      style={{
                        paddingHorizontal: 16,
                        paddingVertical: 8,
                        borderRadius: 8,
                        backgroundColor:
                          currentAnswers.length > 0
                            ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)')
                            : (isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'),
                        opacity: currentAnswers.length > 0 ? 1 : 0.4,
                      }}
                    >
                      <Text
                        className={`text-sm font-roobert-medium ${
                          currentAnswers.length > 0
                            ? 'text-foreground'
                            : 'text-muted-foreground'
                        }`}
                      >
                        Next
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </Animated.View>
  );
}
