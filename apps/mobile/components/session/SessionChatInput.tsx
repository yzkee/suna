/**
 * SessionChatInput — chat input for Computer sessions.
 *
 * Simplified mobile version of the frontend's SessionChatInput.
 * Sends messages via promptAsync (fire-and-forget).
 */

import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { useColorScheme } from 'nativewind';
import { Ionicons } from '@expo/vector-icons';

interface SessionChatInputProps {
  onSend: (text: string) => void;
  onStop?: () => void;
  isBusy?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

export function SessionChatInput({
  onSend,
  onStop,
  isBusy = false,
  disabled = false,
  placeholder = 'Ask anything...',
}: SessionChatInputProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<TextInput>(null);
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  const canSend = text.trim().length > 0 && !disabled;

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;

    if (isBusy) {
      // Could queue here in the future
      return;
    }

    onSend(trimmed);
    setText('');
  }, [text, isBusy, disabled, onSend]);

  const handleStop = useCallback(() => {
    onStop?.();
  }, [onStop]);

  return (
    <View
      className={`border-t px-4 py-2 ${
        isDark ? 'border-zinc-800 bg-black' : 'border-zinc-200 bg-white'
      }`}
    >
      <View
        className={`flex-row items-end rounded-2xl px-4 py-2 ${
          isDark ? 'bg-zinc-900' : 'bg-zinc-100'
        }`}
      >
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={isDark ? '#71717a' : '#a1a1aa'}
          multiline
          maxLength={10000}
          style={{
            flex: 1,
            maxHeight: 120,
            fontSize: 16,
            lineHeight: 22,
            color: isDark ? '#fafafa' : '#18181b',
            paddingTop: Platform.OS === 'ios' ? 8 : 4,
            paddingBottom: Platform.OS === 'ios' ? 8 : 4,
          }}
          onSubmitEditing={handleSubmit}
          blurOnSubmit={false}
          returnKeyType="default"
          editable={!disabled}
        />

        <View className="ml-2 justify-end pb-1">
          {isBusy ? (
            <TouchableOpacity
              onPress={handleStop}
              className="h-8 w-8 items-center justify-center rounded-full bg-red-500"
              activeOpacity={0.7}
            >
              <Ionicons name="stop" size={16} color="white" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={handleSubmit}
              disabled={!canSend}
              className={`h-8 w-8 items-center justify-center rounded-full ${
                canSend
                  ? 'bg-zinc-900 dark:bg-white'
                  : 'bg-zinc-300 dark:bg-zinc-700'
              }`}
              activeOpacity={0.7}
            >
              <Ionicons
                name="arrow-up"
                size={18}
                color={canSend ? (isDark ? '#18181b' : 'white') : '#a1a1aa'}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}
