import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'nativewind';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Key,
  Menu,
  RefreshCw,
  Terminal,
} from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import { setupSSH, type SSHSetupResult } from '@/lib/platform/client';
import { useTabStore, type PageTab } from '@/stores/tab-store';
import { useThemeColors } from '@/lib/theme-colors';

interface SSHPageProps {
  page: PageTab;
  onBack: () => void;
  onOpenDrawer: () => void;
  onOpenRightDrawer: () => void;
}

export function SSHPage({ page, onBack, onOpenDrawer, onOpenRightDrawer }: SSHPageProps) {
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const themeColors = useThemeColors();

  const [sshResult, setSSHResult] = useState<SSHSetupResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showRawKeys, setShowRawKeys] = useState(false);

  // Scroll state persistence
  const scrollRef = useRef<ScrollView>(null);
  const savedScrollY = useTabStore((s) => (s.tabStateById[page.id]?.scrollY as number) ?? 0);
  const scrollYRef = useRef(savedScrollY);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollYRef.current = e.nativeEvent.contentOffset.y;
  }, []);

  React.useEffect(() => {
    return () => {
      useTabStore.getState().setTabState(page.id, { scrollY: scrollYRef.current });
    };
  }, [page.id]);

  const handleContentSizeChange = useCallback(() => {
    if (savedScrollY > 0) {
      scrollRef.current?.scrollTo({ y: savedScrollY, animated: false });
    }
  }, [savedScrollY]);

  const codeBg = isDark ? '#0A0A0A' : '#18181B';
  const codeBorder = isDark ? '#27272A' : '#3F3F46';

  const copyToClipboard = useCallback(async (text: string, field: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Clipboard.setStringAsync(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }, []);

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const result = await setupSSH();
      setSSHResult(result);
    } catch (err: any) {
      setError(err?.message || 'Failed to generate SSH keys');
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const handleRegenerate = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSSHResult(null);
    setShowRawKeys(false);
    await handleGenerate();
  }, [handleGenerate]);

  // Build derived commands
  const oneLiner = sshResult
    ? `mkdir -p ~/.ssh && cat > ~/.ssh/kortix_sandbox << 'KORTIX_KEY'\n${sshResult.private_key}KORTIX_KEY\nchmod 600 ~/.ssh/kortix_sandbox && ssh -i ~/.ssh/kortix_sandbox -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -p ${sshResult.port} ${sshResult.username}@${sshResult.host}`
    : '';

  const reconnectCmd = sshResult
    ? `ssh -i ~/.ssh/kortix_sandbox -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -p ${sshResult.port} ${sshResult.username}@${sshResult.host}`
    : '';

  const sshConfig = sshResult
    ? `Host kortix-sandbox\n  HostName ${sshResult.host}\n  Port ${sshResult.port}\n  User ${sshResult.username}\n  IdentityFile ~/.ssh/kortix_sandbox\n  StrictHostKeyChecking no\n  UserKnownHostsFile /dev/null\n  ServerAliveInterval 15\n  ServerAliveCountMax 4`
    : '';

  const configCmd = sshResult
    ? `mkdir -p ~/.ssh && touch ~/.ssh/config && chmod 600 ~/.ssh/config && cat >> ~/.ssh/config << 'KORTIX_SSH_CONFIG'\n${sshConfig}\nKORTIX_SSH_CONFIG`
    : '';

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <View className="flex-row items-center px-4 py-3">
        <Pressable onPress={onOpenDrawer} hitSlop={8} className="mr-3">
          <Icon as={Menu} size={20} className="text-foreground" strokeWidth={2} />
        </Pressable>
        <Text className="flex-1 text-lg font-roobert-medium text-foreground">{page.label}</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        onScroll={handleScroll}
        scrollEventThrottle={64}
        onContentSizeChange={handleContentSizeChange}
      >
        <View className="px-5 pt-2">
          {/* Title */}
          <Text className="text-2xl font-roobert-semibold text-foreground">SSH Access</Text>
          <Text className="mt-1 font-roobert text-sm text-muted-foreground">
            Generate SSH keys to connect to your sandbox from a terminal.
          </Text>

          {/* Generate / Result */}
          {!sshResult && !isGenerating && (
            <Pressable
              onPress={handleGenerate}
              className="mt-5 flex-row items-center justify-center self-start rounded-xl px-5 py-2.5 active:opacity-90"
              style={{ backgroundColor: themeColors.primary }}
            >
              <Icon as={Key} size={15} style={{ color: themeColors.primaryForeground }} strokeWidth={2.5} />
              <Text className="ml-2 font-roobert-semibold text-sm" style={{ color: themeColors.primaryForeground }}>
                Generate SSH Keys
              </Text>
            </Pressable>
          )}

          {isGenerating && (
            <View className="mt-5 flex-row items-center">
              <ActivityIndicator size="small" />
              <Text className="ml-3 font-roobert text-sm text-muted-foreground">Generating keys...</Text>
            </View>
          )}

          {error && (
            <View className="mt-5 rounded-2xl border px-4 py-3" style={{ borderColor: isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)', backgroundColor: isDark ? 'rgba(239,68,68,0.05)' : 'rgba(239,68,68,0.03)' }}>
              <Text className="font-roobert-medium text-sm text-destructive">{error}</Text>
              <Pressable onPress={handleGenerate} className="mt-2 active:opacity-70">
                <Text className="font-roobert-medium text-xs text-primary">Try again</Text>
              </Pressable>
            </View>
          )}

          {sshResult && (
            <View className="mt-5" style={{ gap: 20 }}>
              {/* Connection Info */}
              <View className="flex-row" style={{ gap: 8 }}>
                <View className="flex-row items-center rounded-lg bg-muted/60 px-3 py-1.5">
                  <Icon as={Terminal} size={12} className="text-muted-foreground mr-1.5" strokeWidth={2.2} />
                  <Text className="font-roobert text-xs text-muted-foreground">{sshResult.host}:{sshResult.port}</Text>
                </View>
                <View className="rounded-lg bg-muted/60 px-3 py-1.5">
                  <Text className="font-roobert text-xs text-muted-foreground">user: {sshResult.username}</Text>
                </View>
              </View>

              {/* Quick Setup */}
              <CodeSection
                title="Quick Setup & Connect"
                description="Run this in your terminal to save the key and connect"
                code={oneLiner}
                copyField="one-liner"
                copiedField={copiedField}
                onCopy={copyToClipboard}
                codeBg={codeBg}
                codeBorder={codeBorder}
              />

              {/* Reconnect */}
              <CodeSection
                title="Reconnect"
                description="Use this after the initial setup"
                code={reconnectCmd}
                copyField="reconnect"
                copiedField={copiedField}
                onCopy={copyToClipboard}
                codeBg={codeBg}
                codeBorder={codeBorder}
              />

              {/* VS Code / Cursor Config */}
              <CodeSection
                title="VS Code / Cursor"
                description="Add this to your SSH config, then connect with: ssh kortix-sandbox"
                code={configCmd}
                copyField="config-cmd"
                copiedField={copiedField}
                onCopy={copyToClipboard}
                codeBg={codeBg}
                codeBorder={codeBorder}
              />

              {/* Raw Keys (collapsible) */}
              <View>
                <Pressable
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowRawKeys(!showRawKeys); }}
                  className="flex-row items-center py-2 active:opacity-70"
                >
                  <Text className="font-roobert-medium text-[13px] text-muted-foreground">Raw Keys</Text>
                  <Icon as={showRawKeys ? ChevronUp : ChevronDown} size={14} className="ml-1 text-muted-foreground" strokeWidth={2.2} />
                </Pressable>

                {showRawKeys && (
                  <View style={{ gap: 16 }}>
                    <CodeSection
                      title="Private Key"
                      code={sshResult.private_key}
                      copyField="pk"
                      copiedField={copiedField}
                      onCopy={copyToClipboard}
                      codeBg={codeBg}
                      codeBorder={codeBorder}
                    />
                    <CodeSection
                      title="Public Key"
                      code={sshResult.public_key}
                      copyField="pub"
                      copiedField={copiedField}
                      onCopy={copyToClipboard}
                      codeBg={codeBg}
                      codeBorder={codeBorder}
                    />
                  </View>
                )}
              </View>

              {/* Regenerate */}
              <Pressable
                onPress={handleRegenerate}
                disabled={isGenerating}
                className="flex-row items-center self-start rounded-lg bg-muted/60 px-3 py-2 active:opacity-80"
              >
                <Icon as={RefreshCw} size={12} className="text-foreground mr-1.5" strokeWidth={2.2} />
                <Text className="font-roobert-medium text-xs text-foreground">Regenerate Keys</Text>
              </Pressable>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Code Section ───────────────────────────────────────────────────────────

function CodeSection({
  title,
  description,
  code,
  copyField,
  copiedField,
  onCopy,
  codeBg,
  codeBorder,
}: {
  title: string;
  description?: string;
  code: string;
  copyField: string;
  copiedField: string | null;
  onCopy: (text: string, field: string) => void;
  codeBg: string;
  codeBorder: string;
}) {
  const isCopied = copiedField === copyField;

  return (
    <View>
      <View className="flex-row items-center mb-1.5">
        <Text className="font-roobert-medium text-[13px] text-foreground flex-1">{title}</Text>
        <Pressable
          onPress={() => onCopy(code, copyField)}
          className="flex-row items-center rounded-lg px-2 py-1 active:opacity-70"
          hitSlop={4}
        >
          <Icon as={isCopied ? Check : Copy} size={12} className={isCopied ? 'text-emerald-500' : 'text-muted-foreground'} strokeWidth={2.2} />
          <Text className={`ml-1 font-roobert-medium text-[11px] ${isCopied ? 'text-emerald-500' : 'text-muted-foreground'}`}>
            {isCopied ? 'Copied' : 'Copy'}
          </Text>
        </Pressable>
      </View>
      {!!description && (
        <Text className="mb-2 font-roobert text-xs text-muted-foreground">{description}</Text>
      )}
      <View
        className="rounded-xl overflow-hidden p-3"
        style={{ backgroundColor: codeBg, borderWidth: 1, borderColor: codeBorder }}
      >
        <Text
          className="font-mono text-[11px] leading-[16px]"
          style={{ color: '#D4D4D8' }}
          selectable
        >
          {code}
        </Text>
      </View>
    </View>
  );
}
