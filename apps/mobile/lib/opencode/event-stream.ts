/**
 * OpenCode SSE Event Stream Hook for React Native
 *
 * Connects to the OpenCode server's SSE endpoint and dispatches events
 * to the sync store. Uses react-native-sse for EventSource support.
 *
 * Mirrors the Computer frontend's use-opencode-events.ts pattern,
 * adapted for React Native.
 */

import { useEffect, useRef, useCallback } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { log } from '@/lib/logger';
import { getAuthToken } from '@/api/config';
import { useSyncStore } from './sync-store';
import { platformKeys } from '@/lib/platform/hooks';
import type { MessageWithParts, Part, SessionStatus } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SSEEvent {
  type: string;
  properties: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Connect to the OpenCode SSE event stream.
 * Should be mounted ONCE at the app level, after sandbox is ready.
 */
export function useOpenCodeEventStream(sandboxUrl: string | undefined) {
  const queryClient = useQueryClient();
  const syncStore = useSyncStore;
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);
  const lastEventTime = useRef(Date.now());

  const connect = useCallback(async () => {
    if (!sandboxUrl) return;

    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    try {
      const token = await getAuthToken();
      const url = `${sandboxUrl}/global/event`;
      const fullUrl = token ? `${url}?token=${encodeURIComponent(token)}` : url;

      log.log('🔌 [SSE] Connecting to:', url);

      const es = new EventSource(fullUrl);
      eventSourceRef.current = es;

      es.onopen = () => {
        log.log('✅ [SSE] Connected');
        reconnectAttempts.current = 0;
      };

      es.onmessage = (event: MessageEvent) => {
        lastEventTime.current = Date.now();

        try {
          const data: SSEEvent = JSON.parse(event.data);
          handleEvent(data);
        } catch (e) {
          // Ignore parse errors for ping/heartbeat events
        }
      };

      es.onerror = () => {
        log.warn('⚠️ [SSE] Connection error, will reconnect...');
        es.close();
        eventSourceRef.current = null;
        scheduleReconnect();
      };
    } catch (error) {
      log.error('❌ [SSE] Failed to connect:', error);
      scheduleReconnect();
    }
  }, [sandboxUrl]);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    const delay = Math.min(
      250 * Math.pow(2, reconnectAttempts.current),
      30000,
    );
    reconnectAttempts.current++;

    log.log(`🔄 [SSE] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current})`);

    reconnectTimeoutRef.current = setTimeout(() => {
      connect();
    }, delay);
  }, [connect]);

  const handleEvent = useCallback((event: SSEEvent) => {
    const { type, properties: props } = event;

    switch (type) {
      // ── Message events ──
      case 'message.updated': {
        const sessionId = props.info?.sessionID;
        if (!sessionId) break;
        const msg: MessageWithParts = {
          info: props.info,
          parts: props.parts || [],
        };
        syncStore.getState().upsertMessage(sessionId, msg);
        break;
      }

      case 'message.removed': {
        const sessionId = props.sessionID;
        const messageId = props.messageID;
        if (sessionId && messageId) {
          syncStore.getState().removeMessage(sessionId, messageId);
        }
        break;
      }

      case 'message.part.updated': {
        const messageId = props.messageID;
        const part = props as Part;
        if (messageId && part) {
          syncStore.getState().upsertPart(messageId, part);
        }
        break;
      }

      // ── Session events ──
      case 'session.status': {
        const sessionId = props.sessionID;
        const status = props.status as SessionStatus;
        if (sessionId && status) {
          syncStore.getState().setStatus(sessionId, status);
        }
        break;
      }

      case 'session.created':
      case 'session.updated':
      case 'session.deleted': {
        // Invalidate React Query session list
        queryClient.invalidateQueries({ queryKey: platformKeys.sessions() });
        break;
      }

      case 'session.compacted': {
        // Re-fetch messages for the compacted session
        const sessionId = props.sessionID;
        if (sessionId) {
          // Will be re-fetched by the session sync hook
          queryClient.invalidateQueries({
            queryKey: platformKeys.sessionMessages(sessionId),
          });
        }
        break;
      }

      // ── Permission events ──
      case 'permission.asked': {
        const sessionId = props.sessionID;
        if (sessionId) {
          syncStore.getState().addPermission(sessionId, props as any);
        }
        break;
      }

      case 'permission.replied': {
        const sessionId = props.sessionID;
        const permId = props.id;
        if (sessionId && permId) {
          syncStore.getState().removePermission(sessionId, permId);
        }
        break;
      }

      // ── Question events ──
      case 'question.asked': {
        const sessionId = props.sessionID;
        if (sessionId) {
          syncStore.getState().addQuestion(sessionId, props as any);
        }
        break;
      }

      case 'question.replied':
      case 'question.rejected': {
        const sessionId = props.sessionID;
        const qId = props.id;
        if (sessionId && qId) {
          syncStore.getState().removeQuestion(sessionId, qId);
        }
        break;
      }

      case 'session.error': {
        const sessionId = props.sessionID;
        if (sessionId) {
          log.error(`❌ [SSE] Session error in ${sessionId}:`, props.error);
        }
        break;
      }

      default:
        // Ignore unknown events (lsp, file, pty, etc.)
        break;
    }
  }, [queryClient]);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    if (sandboxUrl) {
      connect();
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [sandboxUrl, connect]);

  // Reconnect when app comes to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && sandboxUrl) {
        const gap = Date.now() - lastEventTime.current;
        if (gap > 5000) {
          log.log('🔄 [SSE] App foregrounded, reconnecting (gap:', gap, 'ms)');
          connect();
        }
      }
    });

    return () => sub.remove();
  }, [sandboxUrl, connect]);
}
