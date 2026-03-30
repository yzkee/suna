'use client';

/**
 * useWorkspaceSearch — Standalone file/folder/content search hook.
 *
 * Reusable across CMD+K palette, @-mention input, file browser, etc.
 * Uses the OpenCode find.files + find.text APIs.
 *
 * Features:
 *   - Debounced async search (configurable delay)
 *   - Parallel file + directory search for maximum coverage
 *   - Smart ranking: exact basename > startsWith > includes > path > fuzzy
 *   - Depth penalty (shallower results rank higher)
 *   - Content search via prefix (e.g. ">" prefix for ripgrep)
 *   - Returns structured results with name, path, isDir
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { findFiles, findText } from '../api/opencode-files';
import type { FindMatch } from '../types';

// ── Types ────────────────────────────────────────────────────────────────

export interface FileSearchResult {
  path: string;
  name: string;
  isDir: boolean;
}

export interface WorkspaceSearchState {
  /** File/directory results (for name search) */
  results: FileSearchResult[];
  /** Content match results (for text/ripgrep search) */
  textResults: FindMatch[];
  /** Whether a search is in progress */
  isLoading: boolean;
  /** The query that produced the current results */
  searchedQuery: string;
  /** Whether the current query is a content search */
  isContentSearch: boolean;
  /** Effective query (without content search prefix) */
  effectiveQuery: string;
  /** Convenience: true if there are any results */
  hasResults: boolean;
}

export interface UseWorkspaceSearchOptions {
  /** Debounce delay in ms (default: 150) */
  debounceMs?: number;
  /** Max file results to return (default: 50) */
  maxResults?: number;
  /** Max content results to return (default: 50) */
  maxTextResults?: number;
  /** Prefix that triggers content search (default: ">") */
  contentSearchPrefix?: string;
  /** Per-API call limit (default: 100) */
  apiLimit?: number;
  /** Minimum query length to trigger search (default: 1) */
  minQueryLength?: number;
}

// ── Ranking ──────────────────────────────────────────────────────────────

/**
 * Smart ranking for file search results.
 * Lower score = better match.
 *
 * Priority tiers:
 *   0xx — exact basename match
 *   1xx — basename startsWith
 *   2xx — basename includes
 *   3xx — full path startsWith
 *   4xx — full path includes
 *   5xx — fuzzy subsequence in basename
 *   6xx — fuzzy subsequence in path
 *  1000 — no match
 *
 * Within each tier, depth is used as tiebreaker (shallower = better).
 */
export function rankFileResult(result: FileSearchResult, query: string): number {
  const ql = query.toLowerCase();
  const pathLower = result.path.toLowerCase();
  const baseLower = result.name.toLowerCase();
  const depth = result.path.split('/').length;

  if (baseLower === ql) return 0 + depth * 0.001;
  if (baseLower.startsWith(ql)) return 100 + depth * 0.001;
  if (baseLower.includes(ql)) return 200 + depth * 0.001;
  if (pathLower.startsWith(ql)) return 300 + depth * 0.001;
  if (pathLower.includes(ql)) return 400 + depth * 0.001;

  // Fuzzy: all query chars in order in basename
  let qi = 0;
  for (let i = 0; i < baseLower.length && qi < ql.length; i++) {
    if (baseLower[i] === ql[qi]) qi++;
  }
  if (qi === ql.length) return 500 + depth * 0.001;

  // Fuzzy in path
  qi = 0;
  for (let i = 0; i < pathLower.length && qi < ql.length; i++) {
    if (pathLower[i] === ql[qi]) qi++;
  }
  if (qi === ql.length) return 600 + depth * 0.001;

  return 1000 + depth;
}

// ── Helpers ──────────────────────────────────────────────────────────────

export function parseFileResults(paths: string[]): FileSearchResult[] {
  return paths.map((p) => {
    const isDir = p.endsWith('/');
    const clean = isDir ? p.slice(0, -1) : p;
    return {
      path: clean,
      name: clean.split('/').pop() || clean,
      isDir,
    };
  });
}

// ── Standalone async search (for @-mentions, callbacks, etc.) ─────────────

/**
 * One-shot async file+folder search with ranking.
 * Returns plain `string[]` paths (dirs have trailing `/`).
 * Drop-in replacement for `findOpenCodeFiles`.
 */
export async function searchWorkspaceFiles(
  query: string,
  limit = 50,
): Promise<string[]> {
  const q = query.trim();
  if (!q) return [];

  const apiLimit = Math.max(limit, 100);
  const [fileOnly, broad, dirsOnly] = await Promise.all([
    findFiles(q, { type: 'file', limit: apiLimit }).catch(() => []),
    findFiles(q, { limit: apiLimit }).catch(() => []),
    findFiles(q, { type: 'directory', limit: apiLimit }).catch(() => []),
  ]);

  const knownDirs = new Set<string>();
  for (const p of dirsOnly) {
    knownDirs.add(p.endsWith('/') ? p.slice(0, -1) : p);
  }

  const seen = new Set<string>();
  const merged: string[] = [];
  for (const p of [...fileOnly, ...broad, ...dirsOnly]) {
    const key = p.endsWith('/') ? p.slice(0, -1) : p;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(knownDirs.has(key) && !p.endsWith('/') ? `${p}/` : p);
    }
  }

  const parsed = parseFileResults(merged);
  parsed.sort((a, b) => {
    const ra = rankFileResult(a, q);
    const rb = rankFileResult(b, q);
    if (ra !== rb) return ra - rb;
    return a.path.localeCompare(b.path);
  });

  return parsed.slice(0, limit).map((r) => (r.isDir ? `${r.path}/` : r.path));
}

// ── Hook ─────────────────────────────────────────────────────────────────

export function useWorkspaceSearch(
  query: string,
  options?: UseWorkspaceSearchOptions,
): WorkspaceSearchState {
  const {
    debounceMs = 150,
    maxResults = 50,
    maxTextResults = 50,
    contentSearchPrefix = '>',
    apiLimit = 100,
    minQueryLength = 1,
  } = options ?? {};

  const [results, setResults] = useState<FileSearchResult[]>([]);
  const [textResults, setTextResults] = useState<FindMatch[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState('');
  const seqRef = useRef(0);

  const trimmed = query.trim();
  const isContentSearch = trimmed.startsWith(contentSearchPrefix);
  const effectiveQuery = isContentSearch
    ? trimmed.slice(contentSearchPrefix.length).trim()
    : trimmed;

  // Debounced search effect
  useEffect(() => {
    if (!effectiveQuery || effectiveQuery.length < minQueryLength) {
      setResults([]);
      setTextResults([]);
      setSearchedQuery('');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const seq = ++seqRef.current;
    const timer = setTimeout(async () => {
      try {
        if (isContentSearch) {
          const matches = await findText(effectiveQuery);
          if (seq === seqRef.current) {
            setTextResults(matches.slice(0, maxTextResults));
            setResults([]);
            setSearchedQuery(effectiveQuery);
            setIsLoading(false);
          }
        } else {
          // Parallel: files-only + broad (files+dirs) + dirs-only
          const [fileOnly, broad, dirsOnly] = await Promise.all([
            findFiles(effectiveQuery, { type: 'file', limit: apiLimit }).catch(() => []),
            findFiles(effectiveQuery, { limit: apiLimit }).catch(() => []),
            findFiles(effectiveQuery, { type: 'directory', limit: apiLimit }).catch(() => []),
          ]);

          if (seq === seqRef.current) {
            // Build a set of known directory paths (from the explicit dir query)
            const knownDirs = new Set<string>();
            for (const p of dirsOnly) {
              knownDirs.add(p.endsWith('/') ? p.slice(0, -1) : p);
            }

            // Merge and dedupe
            const seen = new Set<string>();
            const merged: string[] = [];
            for (const p of [...fileOnly, ...broad, ...dirsOnly]) {
              const key = p.endsWith('/') ? p.slice(0, -1) : p;
              if (!seen.has(key)) {
                seen.add(key);
                // Ensure directory paths have trailing / for parseFileResults
                if (knownDirs.has(key) && !p.endsWith('/')) {
                  merged.push(`${p}/`);
                } else {
                  merged.push(p);
                }
              }
            }

            const parsed = parseFileResults(merged);
            parsed.sort((a, b) => {
              const ra = rankFileResult(a, effectiveQuery);
              const rb = rankFileResult(b, effectiveQuery);
              if (ra !== rb) return ra - rb;
              return a.path.localeCompare(b.path);
            });

            setResults(parsed.slice(0, maxResults));
            setTextResults([]);
            setSearchedQuery(effectiveQuery);
            setIsLoading(false);
          }
        }
      } catch {
        if (seq === seqRef.current) {
          setIsLoading(false);
        }
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [effectiveQuery, isContentSearch, debounceMs, maxResults, maxTextResults, apiLimit, minQueryLength]);

  const hasResults = results.length > 0 || textResults.length > 0;

  return useMemo(() => ({
    results,
    textResults,
    isLoading,
    searchedQuery,
    isContentSearch,
    effectiveQuery,
    hasResults,
  }), [results, textResults, isLoading, searchedQuery, isContentSearch, effectiveQuery, hasResults]);
}
