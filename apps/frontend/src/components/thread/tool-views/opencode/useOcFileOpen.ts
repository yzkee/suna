'use client';

import { useCallback, useEffect, useState } from 'react';
import { useKortixComputerStore } from '@/stores/kortix-computer-store';
import { getClient } from '@/lib/opencode-sdk';

/**
 * Module-level cache of candidate prefixes.
 * We collect multiple possible root paths (from project.current() and path.get())
 * and try each one when converting absolute → relative.
 */
let cachedPrefixes: string[] | null = null;

/** Try stripping each candidate prefix from an absolute path → project-relative */
function toRelative(absPath: string, prefixes: string[]): string {
  for (const wt of prefixes) {
    if (!wt || wt === '/') continue;
    const prefix = wt.endsWith('/') ? wt : wt + '/';
    if (absPath.startsWith(prefix)) {
      return absPath.slice(prefix.length);
    }
  }
  // None matched — return as-is
  return absPath;
}

/**
 * Fetch all candidate worktree/directory prefixes from the SDK.
 * Tries project.current() (same source as Files tab) and path.get().
 * Returns deduplicated, non-empty candidates ordered by specificity (longest first).
 */
async function fetchPrefixesFromSdk(): Promise<string[]> {
  const candidates: string[] = [];

  const client = getClient();

  // 1) project.current() — same source the Files tab uses
  try {
    const projectRes = await client.project.current();
    const project = projectRes.data;
    console.log('[useOcFileOpen] project.current():', JSON.stringify(project));
    if (project?.worktree) candidates.push(project.worktree);
  } catch (err) {
    console.warn('[useOcFileOpen] project.current() failed:', err);
  }

  // 2) path.get() — returns home, state, config, worktree, directory
  try {
    const pathRes = await client.path.get();
    const pathData = pathRes.data;
    console.log('[useOcFileOpen] path.get():', JSON.stringify(pathData));
    if (pathData?.directory) candidates.push(pathData.directory);
    if (pathData?.worktree) candidates.push(pathData.worktree);
  } catch (err) {
    console.warn('[useOcFileOpen] path.get() failed:', err);
  }

  // Deduplicate, filter empty, sort longest first (most specific prefix wins)
  const unique = [...new Set(candidates.filter(Boolean))];
  unique.sort((a, b) => b.length - a.length);

  console.log('[useOcFileOpen] resolved prefixes:', unique);

  if (unique.length > 0) {
    cachedPrefixes = unique;
  }
  return unique;
}

/**
 * Last-resort fallback: discover the project root by probing the file API
 * with progressively shorter suffixes of the absolute path.
 * Starts from just the filename and adds parent segments until a read succeeds.
 * Caches the discovered prefix for future use.
 */
async function discoverPrefixViaFileApi(absPath: string): Promise<string | null> {
  const client = getClient();
  const segments = absPath.split('/').filter(Boolean);
  if (segments.length < 2) return null;

  // Try from just the filename (1 segment) up to 8 levels deep
  const maxDepth = Math.min(segments.length - 1, 8);
  for (let depth = 1; depth <= maxDepth; depth++) {
    const candidate = segments.slice(segments.length - depth).join('/');
    try {
      const result = await client.file.read({ path: candidate });
      if (result.data) {
        // Derive the prefix from the original path minus the working suffix
        const prefix = '/' + segments.slice(0, segments.length - depth).join('/');
        console.log('[useOcFileOpen] discovered prefix via file API:', prefix, '(candidate:', candidate, ')');
        // Merge into cache
        if (cachedPrefixes) {
          if (!cachedPrefixes.includes(prefix)) {
            cachedPrefixes = [prefix, ...cachedPrefixes];
            cachedPrefixes.sort((a, b) => b.length - a.length);
          }
        } else {
          cachedPrefixes = [prefix];
        }
        return candidate;
      }
    } catch {
      // This candidate didn't work, try adding more parent segments
      continue;
    }
  }
  return null;
}

/**
 * Hook: file-open handlers & path display for OC tool views.
 *
 * Collects candidate root prefixes from project.current() and path.get(),
 * then tries each when converting absolute paths → project-relative paths.
 */
export function useOcFileOpen() {
  const openFileInComputer = useKortixComputerStore((s) => s.openFileInComputer);
  const [prefixes, setPrefixes] = useState<string[]>(cachedPrefixes || []);

  // Fetch prefixes on mount
  useEffect(() => {
    if (cachedPrefixes && cachedPrefixes.length > 0) {
      setPrefixes(cachedPrefixes);
      return;
    }
    let cancelled = false;
    fetchPrefixesFromSdk().then((result) => {
      if (!cancelled && result.length > 0) {
        setPrefixes(result);
      }
    });
    return () => { cancelled = true; };
  }, []);

  /** Sync: convert absolute → relative for display */
  const toDisplayPath = useCallback(
    (absPath: string): string => {
      if (!absPath || !absPath.startsWith('/')) return absPath;
      // Try component state first, then module cache (may be updated by file API probe)
      const pfx = prefixes.length > 0 ? prefixes : (cachedPrefixes || []);
      if (pfx.length > 0) return toRelative(absPath, pfx);
      return absPath;
    },
    [prefixes],
  );

  /** Get prefixes, fetching on-demand if needed */
  const getPrefixes = useCallback(async (): Promise<string[]> => {
    const current = prefixes.length > 0 ? prefixes : cachedPrefixes;
    if (current && current.length > 0) return current;
    const fetched = await fetchPrefixesFromSdk();
    if (fetched.length > 0) setPrefixes(fetched);
    return fetched;
  }, [prefixes]);

  /** Resolve an absolute path to relative, with file-API probe fallback */
  const resolveAbsPath = useCallback(
    async (filePath: string): Promise<string> => {
      const pfx = await getPrefixes();
      if (pfx.length > 0) {
        const resolved = toRelative(filePath, pfx);
        if (resolved !== filePath) return resolved; // prefix matched
      }
      // Fallback: discover prefix by probing the file API
      const probed = await discoverPrefixViaFileApi(filePath);
      if (probed) {
        // Update local state with newly discovered prefix
        if (cachedPrefixes && cachedPrefixes.length > 0) {
          setPrefixes([...cachedPrefixes]);
        }
        return probed;
      }
      return filePath;
    },
    [getPrefixes],
  );

  /** Open a single file — resolves to relative path first */
  const openFile = useCallback(
    async (filePath: string) => {
      if (!filePath.startsWith('/')) {
        openFileInComputer(filePath);
        return;
      }
      const resolved = await resolveAbsPath(filePath);
      console.log('[useOcFileOpen] openFile', filePath, '→', resolved);
      openFileInComputer(resolved);
    },
    [openFileInComputer, resolveAbsPath],
  );

  /** Open a file with a navigation list */
  const openFileWithList = useCallback(
    async (filePath: string, allPaths: string[]) => {
      if (!filePath.startsWith('/')) {
        openFileInComputer(filePath, allPaths);
        return;
      }
      // Resolve the clicked file first (this may discover & cache the prefix)
      const resolved = await resolveAbsPath(filePath);
      // Now resolve the rest using (potentially updated) cached prefixes
      const pfx = cachedPrefixes || [];
      const resolvedList = allPaths.map((p) =>
        p.startsWith('/') && pfx.length > 0 ? toRelative(p, pfx) : p,
      );
      console.log('[useOcFileOpen] openFileWithList', filePath, '→', resolved);
      openFileInComputer(resolved, resolvedList);
    },
    [openFileInComputer, resolveAbsPath],
  );

  return { openFile, openFileWithList, toDisplayPath };
}
