/**
 * OpenCode Sync Store — Zustand store for session messages/parts.
 *
 * This is the SINGLE SOURCE OF TRUTH for all message data (not React Query).
 * SSE events update this store incrementally; the UI reads from it.
 *
 * Mirrors the Computer frontend's opencode-sync-store.ts pattern.
 */

import { create } from 'zustand';
import type {
  Message,
  Part,
  MessageWithParts,
  SessionStatus,
  PermissionRequest,
  QuestionRequest,
} from './types';

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface SyncState {
  /** Messages indexed by sessionId -> Message[] */
  messages: Record<string, MessageWithParts[]>;
  /** Session statuses */
  sessionStatus: Record<string, SessionStatus>;
  /** Pending permissions */
  permissions: Record<string, PermissionRequest[]>;
  /** Pending questions */
  questions: Record<string, QuestionRequest[]>;

  // ── Actions ──
  /** Hydrate a session's messages from REST response */
  hydrate: (sessionId: string, messages: MessageWithParts[]) => void;
  /** Upsert a single message (from SSE) */
  upsertMessage: (sessionId: string, msg: MessageWithParts) => void;
  /** Remove a message (from SSE) */
  removeMessage: (sessionId: string, messageId: string) => void;
  /** Upsert a part on a message (from SSE) */
  upsertPart: (messageId: string, part: Part) => void;
  /** Remove a part from a message (from SSE) */
  removePart: (messageId: string, partId: string) => void;
  /** Append a delta to a part's text field (from SSE message.part.delta) */
  appendPartDelta: (messageId: string, partId: string, sessionId: string, field: string, delta: string) => void;
  /** Set session status */
  setStatus: (sessionId: string, status: SessionStatus) => void;
  /** Add optimistic user message */
  addOptimisticMessage: (sessionId: string, msg: MessageWithParts) => void;
  /** Add permission */
  addPermission: (sessionId: string, permission: PermissionRequest) => void;
  /** Remove permission */
  removePermission: (sessionId: string, permissionId: string) => void;
  /** Add question */
  addQuestion: (sessionId: string, question: QuestionRequest) => void;
  /** Remove question */
  removeQuestion: (sessionId: string, questionId: string) => void;
  /** Get messages for a session */
  getMessages: (sessionId: string) => MessageWithParts[];
  /** Get status for a session */
  getStatus: (sessionId: string) => SessionStatus | undefined;
  /** Reset all data */
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Optimistic message tracking (module-level, not in store state to avoid
// unnecessary re-renders when the set changes)
// ---------------------------------------------------------------------------

const optimisticIds = new Set<string>();

export function markOptimistic(id: string) {
  optimisticIds.add(id);
}

export function isOptimistic(id: string): boolean {
  return optimisticIds.has(id);
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

export const useSyncStore = create<SyncState>((set, get) => ({
  messages: {},
  sessionStatus: {},
  permissions: {},
  questions: {},

  hydrate: (sessionId, messages) =>
    set((state) => ({
      messages: { ...state.messages, [sessionId]: messages },
    })),

  upsertMessage: (sessionId, msg) =>
    set((state) => {
      const existing = state.messages[sessionId] || [];
      const idx = existing.findIndex((m) => m.info.id === msg.info.id);
      const updated =
        idx >= 0
          ? existing.map((m, i) => (i === idx ? msg : m))
          : [...existing, msg];
      return { messages: { ...state.messages, [sessionId]: updated } };
    }),

  removeMessage: (sessionId, messageId) =>
    set((state) => {
      const existing = state.messages[sessionId] || [];
      return {
        messages: {
          ...state.messages,
          [sessionId]: existing.filter((m) => m.info.id !== messageId),
        },
      };
    }),

  upsertPart: (messageId, part) =>
    set((state) => {
      const newMessages = { ...state.messages };
      for (const sessionId of Object.keys(newMessages)) {
        const msgs = newMessages[sessionId];
        const msgIdx = msgs.findIndex((m) => m.info.id === messageId);
        if (msgIdx >= 0) {
          const msg = msgs[msgIdx];
          const partIdx = msg.parts.findIndex((p) => p.id === part.id);
          let updatedParts: Part[];
          if (partIdx >= 0) {
            updatedParts = msg.parts.map((p, i) => (i === partIdx ? part : p));
          } else {
            // When a real part arrives, remove any optimistic fallback parts
            // of the same type to prevent duplicates (e.g. double user text)
            const baseParts = msg.parts.filter(
              (p) => !(p.type === part.type && p.id.startsWith('prt_')),
            );
            updatedParts = [...baseParts, part];
          }
          const updatedMsg = { ...msg, parts: updatedParts };
          newMessages[sessionId] = msgs.map((m, i) =>
            i === msgIdx ? updatedMsg : m,
          );
          break;
        }
      }
      return { messages: newMessages };
    }),

  removePart: (messageId, partId) =>
    set((state) => {
      const newMessages = { ...state.messages };
      for (const sessionId of Object.keys(newMessages)) {
        const msgs = newMessages[sessionId];
        const msgIdx = msgs.findIndex((m) => m.info.id === messageId);
        if (msgIdx >= 0) {
          const msg = msgs[msgIdx];
          const updatedMsg = {
            ...msg,
            parts: msg.parts.filter((p) => p.id !== partId),
          };
          newMessages[sessionId] = msgs.map((m, i) =>
            i === msgIdx ? updatedMsg : m,
          );
          break;
        }
      }
      return { messages: newMessages };
    }),

  appendPartDelta: (messageId, partId, sessionId, field, delta) =>
    set((state) => {
      const msgs = state.messages[sessionId];
      if (!msgs) return state;

      const msgIdx = msgs.findIndex((m) => m.info.id === messageId);
      if (msgIdx < 0) return state;

      const msg = msgs[msgIdx];
      let partIdx = msg.parts.findIndex((p) => p.id === partId);

      let updatedParts: Part[];
      if (partIdx < 0) {
        // Part doesn't exist yet — create a stub text part
        const stub: Part = { type: 'text', id: partId, [field]: delta } as any;
        updatedParts = [...msg.parts, stub];
      } else {
        updatedParts = msg.parts.map((p, i) => {
          if (i !== partIdx) return p;
          return { ...p, [field]: ((p as any)[field] || '') + delta };
        });
      }

      const updatedMsg = { ...msg, parts: updatedParts };
      const newMsgs = msgs.map((m, i) => (i === msgIdx ? updatedMsg : m));

      return {
        messages: { ...state.messages, [sessionId]: newMsgs },
      };
    }),

  setStatus: (sessionId, status) =>
    set((state) => ({
      sessionStatus: { ...state.sessionStatus, [sessionId]: status },
    })),

  addOptimisticMessage: (sessionId, msg) => {
    optimisticIds.add(msg.info.id);
    set((state) => {
      const existing = state.messages[sessionId] || [];
      return {
        messages: { ...state.messages, [sessionId]: [...existing, msg] },
      };
    });
  },

  addPermission: (sessionId, permission) =>
    set((state) => ({
      permissions: {
        ...state.permissions,
        [sessionId]: [...(state.permissions[sessionId] || []), permission],
      },
    })),

  removePermission: (sessionId, permissionId) =>
    set((state) => ({
      permissions: {
        ...state.permissions,
        [sessionId]: (state.permissions[sessionId] || []).filter(
          (p) => p.id !== permissionId,
        ),
      },
    })),

  addQuestion: (sessionId, question) =>
    set((state) => ({
      questions: {
        ...state.questions,
        [sessionId]: [...(state.questions[sessionId] || []), question],
      },
    })),

  removeQuestion: (sessionId, questionId) =>
    set((state) => ({
      questions: {
        ...state.questions,
        [sessionId]: (state.questions[sessionId] || []).filter(
          (q) => q.id !== questionId,
        ),
      },
    })),

  getMessages: (sessionId) => get().messages[sessionId] || [],

  getStatus: (sessionId) => get().sessionStatus[sessionId],

  reset: () =>
    set({ messages: {}, sessionStatus: {}, permissions: {}, questions: {} }),
}));
