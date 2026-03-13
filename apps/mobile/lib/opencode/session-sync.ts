/**
 * Session Sync Hook — hydrates sync store with messages on mount.
 *
 * After hydration, the SSE event stream keeps the store updated.
 */

import { useEffect, useRef } from 'react';
import { log } from '@/lib/logger';
import { getAuthToken } from '@/api/config';
import { useSyncStore } from './sync-store';
import type { MessageWithParts } from './types';

/**
 * Hydrate a session's messages into the sync store.
 * Call this when navigating to a session page.
 */
export function useSessionSync(
  sandboxUrl: string | undefined,
  sessionId: string | undefined,
) {
  const hydratedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sandboxUrl || !sessionId) return;
    if (hydratedRef.current === sessionId) return;

    let cancelled = false;

    async function fetchMessages() {
      try {
        log.log('📥 [SessionSync] Fetching messages for:', sessionId);
        const token = await getAuthToken();
        const res = await fetch(`${sandboxUrl}/session/${sessionId}/message`, {
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });

        if (!res.ok) {
          throw new Error(`Failed to fetch messages: ${res.status}`);
        }

        const messages: MessageWithParts[] = await res.json();

        if (!cancelled) {
          useSyncStore.getState().hydrate(sessionId!, messages);
          hydratedRef.current = sessionId!;
          log.log('✅ [SessionSync] Hydrated', messages.length, 'messages');
        }
      } catch (error) {
        log.error('❌ [SessionSync] Failed to fetch messages:', error);
      }
    }

    fetchMessages();

    return () => {
      cancelled = true;
    };
  }, [sandboxUrl, sessionId]);
}
