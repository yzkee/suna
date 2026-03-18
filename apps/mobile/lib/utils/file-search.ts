/**
 * File search utilities — searches workspace files via the sandbox API.
 *
 * Extracted from useMentions.ts so it can be shared with the CommandPalette.
 * Mirrors the frontend's findOpenCodeFiles pattern.
 */

import { getAuthToken } from '@/api/config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ocFetch<T>(sandboxUrl: string, path: string): Promise<T | null> {
  try {
    const token = await getAuthToken();
    const res = await fetch(`${sandboxUrl}${path}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function normalizeEntries(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  const result: string[] = [];
  for (const entry of data) {
    if (typeof entry === 'string' && entry.length > 0) {
      result.push(entry);
    } else if (entry && typeof entry === 'object') {
      const p = (entry as any).path ?? (entry as any).absolute ?? '';
      const t = (entry as any).type;
      if (typeof p === 'string' && p.length > 0) {
        result.push(t === 'directory' && !p.endsWith('/') ? `${p}/` : p);
      }
    }
  }
  return result;
}

export function pathMatchesQuery(path: string, ql: string): boolean {
  if (!ql) return true;
  const lower = path.toLowerCase();
  if (lower.includes(ql)) return true;
  const base = lower.split('/').pop() ?? lower;
  return base.includes(ql);
}

export function rankFile(path: string, ql: string): number {
  const lower = path.toLowerCase();
  const base = lower.split('/').pop() ?? lower;
  const depth = path.split('/').length - 1;
  if (!ql) return depth;
  if (base === ql) return 0 + depth * 0.01;
  if (base.startsWith(ql)) return 10 + depth * 0.01;
  if (base.includes(ql)) return 20 + depth * 0.01;
  if (lower.startsWith(ql)) return 30 + depth * 0.01;
  if (lower.includes(ql)) return 40 + depth * 0.01;
  return 1000 + depth;
}

/** List a directory, returning files and subdirectory paths */
async function listDir(
  sandboxUrl: string,
  dirPath: string,
): Promise<{ files: string[]; dirs: string[] }> {
  const data = await ocFetch<unknown>(sandboxUrl, `/file?path=${encodeURIComponent(dirPath)}`);
  const entries = normalizeEntries(data);
  const files: string[] = [];
  const dirs: string[] = [];
  for (const e of entries) {
    if (e.endsWith('/')) dirs.push(e.replace(/\/$/, ''));
    else files.push(e);
  }
  return { files, dirs };
}

// ---------------------------------------------------------------------------
// Module-level cache for the full file index (refreshes every 60s)
// ---------------------------------------------------------------------------

let fileIndexCache: { files: string[]; fetchedAt: number } | undefined;

// ---------------------------------------------------------------------------
// Main search function
// ---------------------------------------------------------------------------

export async function searchFiles(sandboxUrl: string, query: string): Promise<string[]> {
  const ql = query.trim().toLowerCase();
  const fileMatches = new Set<string>();

  // Step 1: /find/file (strict + broad, like frontend)
  const [strictData, broadData] = await Promise.all([
    ocFetch<unknown>(sandboxUrl, `/find/file?query=${encodeURIComponent(query.trim())}&type=file&limit=80`),
    ocFetch<unknown>(sandboxUrl, `/find/file?query=${encodeURIComponent(query.trim())}&limit=80`),
  ]);

  const directoryMatches: string[] = [];
  for (const entry of [...normalizeEntries(strictData), ...normalizeEntries(broadData)]) {
    if (entry.endsWith('/')) {
      directoryMatches.push(entry.replace(/\/$/, ''));
    } else {
      fileMatches.add(entry);
    }
  }

  // Step 2: Expand matching directories
  if (fileMatches.size < 20 && ql.length > 0 && directoryMatches.length > 0) {
    const dirs = directoryMatches.slice(0, 6);
    const results = await Promise.all(dirs.map((d) => listDir(sandboxUrl, d)));
    for (const { files } of results) {
      for (const f of files) {
        if (pathMatchesQuery(f, ql)) fileMatches.add(f);
      }
    }
  }

  // Step 3: Build/use cached file index (root + 2 levels deep)
  if (ql.length > 0 && fileMatches.size < 20) {
    const now = Date.now();
    const cacheFresh = fileIndexCache && now - fileIndexCache.fetchedAt < 60_000;

    if (!cacheFresh) {
      const allFiles: string[] = [];

      // Level 0: /workspace
      const root = await listDir(sandboxUrl, '/workspace');
      allFiles.push(...root.files);

      // Level 1: first-level subdirs
      const level1Dirs = root.dirs.slice(0, 20);
      if (level1Dirs.length > 0) {
        const level1Results = await Promise.all(
          level1Dirs.map((d) => listDir(sandboxUrl, d)),
        );
        const level2Dirs: string[] = [];
        for (const { files, dirs } of level1Results) {
          allFiles.push(...files);
          level2Dirs.push(...dirs);
        }

        // Level 2: second-level subdirs
        const level2Slice = level2Dirs.slice(0, 30);
        if (level2Slice.length > 0) {
          const level2Results = await Promise.all(
            level2Slice.map((d) => listDir(sandboxUrl, d)),
          );
          for (const { files } of level2Results) {
            allFiles.push(...files);
          }
        }
      }

      fileIndexCache = { files: allFiles, fetchedAt: now };
    }

    for (const f of fileIndexCache!.files) {
      if (pathMatchesQuery(f, ql)) fileMatches.add(f);
    }
  }

  return Array.from(fileMatches)
    .sort((a, b) => rankFile(a, ql) - rankFile(b, ql))
    .slice(0, 20);
}
