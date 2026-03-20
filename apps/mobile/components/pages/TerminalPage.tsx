/**
 * TerminalPage — Full terminal emulator for the mobile app.
 *
 * Uses a WebView running xterm.js to connect to the sandbox terminal
 * via WebSocket (same protocol as the frontend SSHTerminal).
 *
 * WebSocket endpoint: wss://<backendUrl>/sandboxes/<sandboxId>/terminal/ws
 * Protocol: JSON messages { type: 'auth' | 'input' | 'resize' | 'output' | ... }
 */

import React, { useRef, useCallback, useEffect, useState } from 'react';
import {
  View,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Keyboard,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import * as Haptics from 'expo-haptics';

import { useSandboxContext } from '@/contexts/SandboxContext';
import { getAuthToken } from '@/api/config';
import { API_URL } from '@/api/config';
import { log } from '@/lib/logger';
import type { PageTab } from '@/stores/tab-store';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TerminalPageProps {
  page: PageTab;
  onBack: () => void;
  onOpenDrawer?: () => void;
  onOpenRightDrawer?: () => void;
}

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// ─── WebSocket URL helper ────────────────────────────────────────────────────

function getWebSocketBaseUrl(): string {
  return API_URL.replace('https://', 'wss://').replace('http://', 'ws://');
}

// ─── Terminal HTML (xterm.js in WebView) ─────────────────────────────────────

function buildTerminalHtml(isDark: boolean): string {
  const bg = isDark ? '#0f0f14' : '#fafafc';
  const fg = isDark ? '#e4e4e7' : '#18181b';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: ${bg};
      -webkit-user-select: none;
      user-select: none;
    }
    #terminal {
      width: 100%;
      height: 100%;
      padding: 8px 4px;
    }
    .xterm {
      height: 100%;
    }
    .xterm-viewport {
      overflow-y: auto !important;
    }
    .xterm-viewport::-webkit-scrollbar {
      width: 4px;
    }
    .xterm-viewport::-webkit-scrollbar-thumb {
      background: ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'};
      border-radius: 2px;
    }
  </style>
</head>
<body>
  <div id="terminal"></div>

  <script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"><\/script>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js"><\/script>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-web-links@0.11.0/lib/addon-web-links.min.js"><\/script>
  <script>
    (function() {
      var ws = null;
      var term = null;
      var fitAddon = null;
      var connectionId = 0;

      var darkTheme = {
        background: '${bg}',
        foreground: '#e4e4e7',
        cursor: '#a78bfa',
        cursorAccent: '#0f0f14',
        selectionBackground: 'rgba(139, 92, 246, 0.3)',
        black: '#27272a',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#fbbf24',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e4e4e7',
        brightBlack: '#52525b',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fde047',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#fafafa'
      };

      var lightTheme = {
        background: '${bg}',
        foreground: '#18181b',
        cursor: '#7c3aed',
        cursorAccent: '#fafafc',
        selectionBackground: 'rgba(124, 58, 237, 0.15)',
        black: '#18181b',
        red: '#dc2626',
        green: '#16a34a',
        yellow: '#ca8a04',
        blue: '#2563eb',
        magenta: '#9333ea',
        cyan: '#0891b2',
        white: '#a1a1aa',
        brightBlack: '#52525b',
        brightRed: '#ef4444',
        brightGreen: '#22c55e',
        brightYellow: '#eab308',
        brightBlue: '#3b82f6',
        brightMagenta: '#a855f7',
        brightCyan: '#06b6d4',
        brightWhite: '#fafafa'
      };

      function postMsg(type, data) {
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, data: data }));
        } catch(e) {}
      }

      function sanitize(chunk) {
        return chunk
          .replace(/\\x1b\\]697;[^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)/g, '')
          .replace(/\\{"cursor":\\d+\\}/g, '');
      }

      function initTerminal() {
        var isDark = ${isDark ? 'true' : 'false'};
        term = new Terminal({
          cursorBlink: true,
          cursorStyle: 'bar',
          fontSize: 13,
          fontFamily: 'Menlo, Monaco, Consolas, monospace',
          theme: isDark ? darkTheme : lightTheme,
          allowProposedApi: true,
          scrollback: 5000,
          convertEol: true
        });

        fitAddon = new FitAddon.FitAddon();
        var webLinksAddon = new WebLinksAddon.WebLinksAddon();

        term.loadAddon(fitAddon);
        term.loadAddon(webLinksAddon);

        term.open(document.getElementById('terminal'));

        setTimeout(function() { fitAddon.fit(); }, 50);

        term.onData(function(data) {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'input', data: data }));
          }
        });

        term.onResize(function(size) {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
          }
        });

        // Handle viewport resize
        window.addEventListener('resize', function() {
          if (fitAddon) {
            setTimeout(function() { fitAddon.fit(); }, 100);
          }
        });

        // Observe container size changes
        var ro = new ResizeObserver(function() {
          if (fitAddon) {
            setTimeout(function() { fitAddon.fit(); }, 50);
          }
        });
        ro.observe(document.getElementById('terminal'));

        postMsg('ready', {});
      }

      function connect(wsUrl, accessToken) {
        if (ws) {
          ws.onopen = null;
          ws.onmessage = null;
          ws.onerror = null;
          ws.onclose = null;
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
          }
          ws = null;
        }

        connectionId++;
        var myId = connectionId;

        postMsg('status', 'connecting');

        ws = new WebSocket(wsUrl);

        ws.onopen = function() {
          if (connectionId !== myId) { ws.close(); return; }
          ws.send(JSON.stringify({ type: 'auth', access_token: accessToken }));
        };

        ws.onmessage = function(event) {
          if (connectionId !== myId) return;
          try {
            var msg = JSON.parse(event.data);
            switch (msg.type) {
              case 'status':
                term.writeln('\\x1b[33m' + msg.message + '\\x1b[0m');
                break;
              case 'connected':
                postMsg('status', 'connected');
                term.writeln('\\x1b[32m' + msg.message + '\\x1b[0m');
                term.writeln('');
                break;
              case 'output':
                if (msg.data) {
                  term.write(sanitize(msg.data));
                }
                break;
              case 'error':
                postMsg('status', 'error');
                term.writeln('\\x1b[31mError: ' + msg.message + '\\x1b[0m');
                break;
              case 'exit':
                term.writeln('\\x1b[33mSession ended (code ' + msg.code + ')\\x1b[0m');
                postMsg('status', 'disconnected');
                ws = null;
                break;
            }
          } catch(e) {}
        };

        ws.onerror = function() {
          if (connectionId !== myId) return;
          postMsg('status', 'error');
        };

        ws.onclose = function() {
          if (connectionId !== myId) return;
          ws = null;
          postMsg('status', 'disconnected');
          if (term) {
            term.writeln('\\x1b[33mConnection closed\\x1b[0m');
          }
        };
      }

      // Listen for messages from React Native
      window.addEventListener('message', function(e) {
        try {
          var msg = JSON.parse(e.data);
          if (msg.type === 'connect') {
            connect(msg.wsUrl, msg.accessToken);
          } else if (msg.type === 'disconnect') {
            if (ws) {
              ws.close();
              ws = null;
            }
          } else if (msg.type === 'refit') {
            if (fitAddon) {
              setTimeout(function() { fitAddon.fit(); }, 50);
            }
          }
        } catch(e) {}
      });

      // Also listen on document for Android
      document.addEventListener('message', function(e) {
        try {
          var msg = JSON.parse(e.data);
          if (msg.type === 'connect') {
            connect(msg.wsUrl, msg.accessToken);
          } else if (msg.type === 'disconnect') {
            if (ws) {
              ws.close();
              ws = null;
            }
          } else if (msg.type === 'refit') {
            if (fitAddon) {
              setTimeout(function() { fitAddon.fit(); }, 50);
            }
          }
        } catch(e) {}
      });

      // Init when DOM is ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTerminal);
      } else {
        initTerminal();
      }
    })();
  <\/script>
</body>
</html>`;
}

// ─── TerminalPage ────────────────────────────────────────────────────────────

export function TerminalPage({ page, onBack, onOpenDrawer, onOpenRightDrawer }: TerminalPageProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const { sandboxId } = useSandboxContext();

  const webViewRef = useRef<WebView>(null);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [webViewReady, setWebViewReady] = useState(false);
  const hasConnected = useRef(false);

  const fgColor = isDark ? '#F8F8F8' : '#121215';
  const mutedColor = isDark ? '#71717a' : '#a1a1aa';
  const bgColor = isDark ? '#0f0f14' : '#fafafc';
  const borderColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  const terminalHtml = React.useMemo(() => buildTerminalHtml(isDark), [isDark]);

  // Connect to the terminal WebSocket once the WebView is ready
  const initiateConnection = useCallback(async () => {
    if (!sandboxId || !webViewReady || hasConnected.current) return;

    try {
      const token = await getAuthToken();
      if (!token) {
        log.error('[TerminalPage] No auth token available');
        setStatus('error');
        return;
      }

      const wsBase = getWebSocketBaseUrl();
      const wsUrl = `${wsBase}/sandboxes/${sandboxId}/terminal/ws`;

      log.log('[TerminalPage] Connecting to terminal:', wsUrl);

      webViewRef.current?.postMessage(
        JSON.stringify({
          type: 'connect',
          wsUrl,
          accessToken: token,
        }),
      );
      hasConnected.current = true;
    } catch (err: any) {
      log.error('[TerminalPage] Connection error:', err?.message || err);
      setStatus('error');
    }
  }, [sandboxId, webViewReady]);

  useEffect(() => {
    initiateConnection();
  }, [initiateConnection]);

  // Handle messages from the WebView
  const handleWebViewMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'ready') {
        setWebViewReady(true);
      } else if (msg.type === 'status') {
        setStatus(msg.data as ConnectionStatus);
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  // Reconnect handler
  const handleReconnect = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    hasConnected.current = false;
    setWebViewReady(false);
    setStatus('disconnected');

    // Force reload the WebView
    webViewRef.current?.reload();
  }, []);

  // Refit terminal on keyboard show/hide
  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => {
        setTimeout(() => {
          webViewRef.current?.postMessage(JSON.stringify({ type: 'refit' }));
        }, 200);
      },
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setTimeout(() => {
          webViewRef.current?.postMessage(JSON.stringify({ type: 'refit' }));
        }, 200);
      },
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Status indicator
  const statusColor =
    status === 'connected'
      ? '#4ade80'
      : status === 'connecting'
        ? '#fbbf24'
        : status === 'error'
          ? '#f87171'
          : mutedColor;

  const statusLabel =
    status === 'connected'
      ? 'Connected'
      : status === 'connecting'
        ? 'Connecting...'
        : status === 'error'
          ? 'Error'
          : 'Disconnected';

  return (
    <View style={{ flex: 1, backgroundColor: bgColor }}>
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingBottom: 10,
          paddingHorizontal: 16,
          borderBottomWidth: 1,
          borderBottomColor: borderColor,
          backgroundColor: isDark ? '#121215' : '#F8F8F8',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            {onOpenDrawer && (
              <TouchableOpacity onPress={onOpenDrawer} style={{ marginRight: 12 }}>
                <Ionicons name="menu-outline" size={22} color={fgColor} />
              </TouchableOpacity>
            )}
            <Ionicons name="terminal-outline" size={18} color={fgColor} style={{ marginRight: 8 }} />
            <Text style={{ fontSize: 17, fontFamily: 'Roobert-SemiBold', color: fgColor }}>
              Terminal
            </Text>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {/* Status indicator */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 4 }}>
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: statusColor,
                  marginRight: 6,
                }}
              />
              <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: mutedColor }}>
                {statusLabel}
              </Text>
            </View>

            {/* Reconnect button */}
            {(status === 'disconnected' || status === 'error') && (
              <TouchableOpacity
                onPress={handleReconnect}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="refresh-outline" size={16} color={fgColor} />
              </TouchableOpacity>
            )}

            {onOpenRightDrawer && (
              <TouchableOpacity onPress={onOpenRightDrawer}>
                <Ionicons name="apps-outline" size={22} color={fgColor} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {/* Terminal WebView */}
      {!sandboxId ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="terminal-outline" size={32} color={mutedColor} style={{ marginBottom: 12, opacity: 0.5 }} />
          <Text style={{ fontSize: 14, fontFamily: 'Roobert-Medium', color: mutedColor }}>
            No sandbox available
          </Text>
          <Text style={{ fontSize: 12, fontFamily: 'Roobert', color: mutedColor, marginTop: 4, opacity: 0.7 }}>
            Waiting for sandbox to be provisioned...
          </Text>
        </View>
      ) : (
        <View style={{ flex: 1, position: 'relative' }}>
          {/* Loading overlay */}
          {!webViewReady && (
            <View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 10,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: bgColor,
              }}
            >
              <ActivityIndicator size="large" color={mutedColor} />
              <Text style={{ fontSize: 13, fontFamily: 'Roobert', color: mutedColor, marginTop: 12 }}>
                Loading terminal...
              </Text>
            </View>
          )}

          <WebView
            ref={webViewRef}
            source={{ html: terminalHtml }}
            style={{ flex: 1, backgroundColor: bgColor }}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            onMessage={handleWebViewMessage}
            scrollEnabled={false}
            bounces={false}
            overScrollMode="never"
            keyboardDisplayRequiresUserAction={false}
            hideKeyboardAccessoryView={false}
            automaticallyAdjustContentInsets={false}
            contentInsetAdjustmentBehavior="never"
            textInteractionEnabled={false}
            allowsInlineMediaPlayback
            mixedContentMode="always"
            onError={(syntheticEvent) => {
              log.error('[TerminalPage] WebView error:', syntheticEvent.nativeEvent.description);
            }}
          />
        </View>
      )}
    </View>
  );
}
