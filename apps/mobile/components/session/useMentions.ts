/**
 * useMentions — hook for @-mention detection, querying, and tracking.
 *
 * Mirrors the frontend's mention system:
 * - Detects "@" typed in the textarea by walking backwards from cursor
 * - Provides filtered suggestions for agents, sessions, and files
 * - Tracks inserted mentions for sending
 */

import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { getAuthToken } from '@/api/config';
import type { Agent } from '@/lib/opencode/hooks/use-opencode-data';
import type { Session } from '@/lib/platform/types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MentionItem {
  kind: 'file' | 'agent' | 'session';
  label: string;
  value?: string;       // session ID for sessions, file path for files
  description?: string; // e.g. "2h ago" for sessions
}

export interface TrackedMention {
  kind: 'file' | 'agent' | 'session';
  label: string;
  value?: string; // session ID for session mentions
}

interface MentionQuery {
  query: string;
  triggerPos: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

// ─── File search via OpenCode REST API ───────────────────────────────────────

async function searchFiles(
  sandboxUrl: string,
  query: string,
): Promise<string[]> {
  try {
    const token = await getAuthToken();
    const params = new URLSearchParams({ query, type: 'file' });
    const res = await fetch(`${sandboxUrl}/find/file?${params}`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    // Normalize: entries can be strings or {path: string} objects
    return data
      .map((e: any) => (typeof e === 'string' ? e : e?.path ?? ''))
      .filter(Boolean)
      .slice(0, 15);
  } catch {
    return [];
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

interface UseMentionsOptions {
  agents: Agent[];
  sessions: Session[];
  currentSessionId?: string | null;
  sandboxUrl?: string;
}

export function useMentions({
  agents,
  sessions,
  currentSessionId,
  sandboxUrl,
}: UseMentionsOptions) {
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentions, setMentions] = useState<TrackedMention[]>([]);
  const [fileResults, setFileResults] = useState<string[]>([]);
  const [fileSearchLoading, setFileSearchLoading] = useState(false);
  const fileSearchTimer = useRef<ReturnType<typeof setTimeout>>();
  const fileSearchSeq = useRef(0);
  const fileResultsCache = useRef<Set<string>>(new Set());

  const isOpen = mentionQuery !== null;
  const query = mentionQuery?.query ?? '';
  const ql = query.toLowerCase();

  // ── Debounced file search ───────────────────────────────────────────────

  useEffect(() => {
    if (!mentionQuery || !sandboxUrl) {
      setFileResults([]);
      return;
    }

    // Immediately filter from cache
    if (fileResultsCache.current.size > 0) {
      const cached = Array.from(fileResultsCache.current)
        .filter((p) => p.toLowerCase().includes(ql))
        .slice(0, 15);
      setFileResults(cached);
    }

    clearTimeout(fileSearchTimer.current);
    fileSearchTimer.current = setTimeout(async () => {
      const seq = ++fileSearchSeq.current;
      setFileSearchLoading(true);
      const results = await searchFiles(sandboxUrl, query);
      if (fileSearchSeq.current !== seq) return; // stale
      // Merge with cache
      for (const r of results) fileResultsCache.current.add(r);
      const merged = Array.from(fileResultsCache.current)
        .filter((p) => p.toLowerCase().includes(ql))
        .slice(0, 15);
      setFileResults(merged);
      setFileSearchLoading(false);
    }, 150);

    return () => clearTimeout(fileSearchTimer.current);
  }, [mentionQuery?.query, sandboxUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Build suggestion items ──────────────────────────────────────────────

  const items = useMemo<MentionItem[]>(() => {
    if (!mentionQuery) return [];

    const result: MentionItem[] = [];

    // Agents
    const matchedAgents = agents
      .filter((a) => !a.hidden && a.name.toLowerCase().includes(ql))
      .slice(0, 5);
    for (const a of matchedAgents) {
      result.push({
        kind: 'agent',
        label: a.name,
        description: a.description || undefined,
      });
    }

    // Sessions (exclude current, children, archived)
    const matchedSessions = sessions
      .filter((s) => {
        if (s.id === currentSessionId) return false;
        if (s.parentID) return false;
        if (s.time.archived) return false;
        const titleMatch = s.title?.toLowerCase().includes(ql);
        const fileMatch = s.summary?.diffs?.some((d) =>
          d.path.toLowerCase().includes(ql),
        );
        return titleMatch || fileMatch;
      })
      .slice(0, 5);
    for (const s of matchedSessions) {
      const filesChanged = s.summary?.files ?? 0;
      const desc = [
        timeAgo(s.time.updated),
        filesChanged > 0 ? `${filesChanged} file${filesChanged > 1 ? 's' : ''} changed` : '',
      ]
        .filter(Boolean)
        .join(' - ');
      result.push({
        kind: 'session',
        label: s.title || s.id.slice(0, 8),
        value: s.id,
        description: desc || undefined,
      });
    }

    // Files
    for (const path of fileResults) {
      result.push({
        kind: 'file',
        label: path,
      });
    }

    return result;
  }, [mentionQuery, ql, agents, sessions, currentSessionId, fileResults]);

  // ── Text change handler (detect @) ──────────────────────────────────────

  const handleTextChange = useCallback(
    (text: string, cursorPos: number) => {
      let detected = false;
      for (let i = cursorPos - 1; i >= 0; i--) {
        const ch = text[i];
        if (ch === ' ' || ch === '\n') break;
        if (ch === '@') {
          const charBefore = i > 0 ? text[i - 1] : ' ';
          if (charBefore === ' ' || charBefore === '\n' || i === 0) {
            const q = text.slice(i + 1, cursorPos);
            const isAlreadyTracked = mentions.some((m) => m.label === q);
            if (!isAlreadyTracked) {
              setMentionQuery({ query: q, triggerPos: i });
              setMentionIndex(0);
              detected = true;
            }
          }
          break;
        }
      }
      if (!detected) {
        setMentionQuery(null);
      }

      // Prune tracked mentions whose @label text was deleted
      setMentions((prev) => prev.filter((m) => text.includes(`@${m.label}`)));
    },
    [mentions],
  );

  // ── Select a mention from the dropdown ──────────────────────────────────

  const selectMention = useCallback(
    (item: MentionItem, text: string): string => {
      if (!mentionQuery) return text;

      // Find the end of the @query region by scanning forward from triggerPos
      // to the next space/newline or end of text
      let endPos = mentionQuery.triggerPos + 1; // skip the @
      while (endPos < text.length && text[endPos] !== ' ' && text[endPos] !== '\n') {
        endPos++;
      }

      const before = text.slice(0, mentionQuery.triggerPos);
      const after = text.slice(endPos);
      const inserted = `@${item.label} `;
      const newText = before + inserted + after;

      setMentions((prev) => [
        ...prev,
        {
          kind: item.kind,
          label: item.label,
          ...(item.kind === 'session' ? { value: item.value } : {}),
        },
      ]);
      setMentionQuery(null);
      setMentionIndex(0);

      return newText;
    },
    [mentionQuery],
  );

  // ── Navigation ──────────────────────────────────────────────────────────

  const moveUp = useCallback(() => {
    setMentionIndex((i) => Math.max(0, i - 1));
  }, []);

  const moveDown = useCallback(() => {
    setMentionIndex((i) => Math.min(items.length - 1, i + 1));
  }, [items.length]);

  const dismiss = useCallback(() => {
    setMentionQuery(null);
    setMentionIndex(0);
  }, []);

  // ── Reset on send ───────────────────────────────────────────────────────

  const reset = useCallback(() => {
    setMentions([]);
    setMentionQuery(null);
    setMentionIndex(0);
    setFileResults([]);
    fileResultsCache.current.clear();
  }, []);

  return {
    isOpen,
    query,
    items,
    selectedIndex: mentionIndex,
    mentions,
    fileSearchLoading,
    handleTextChange,
    selectMention,
    moveUp,
    moveDown,
    dismiss,
    reset,
  };
}
