'use client';

import { useState, useCallback, useRef } from 'react';
import { toast as sonnerToast } from 'sonner';
import { downloadDirectory } from '../api/opencode-files';

/**
 * Hook that manages downloading directories as zips with visible progress.
 *
 * Supports multiple concurrent downloads — each gets its own toast with
 * live progress. Uses raw sonner (not the suppressed wrapper) so toasts appear.
 *
 * Returns:
 *  - `downloadDir(path, name)` — trigger a download (concurrent-safe)
 *  - `isDownloading(path)` — whether a specific path is currently downloading
 *  - `downloadingPaths` — Set of paths currently being downloaded
 */
export function useDirectoryDownload() {
  // Use a ref for the set so mutations don't cause re-renders,
  // and a counter to trigger re-renders only when the set changes size.
  const activeRef = useRef<Set<string>>(new Set());
  const [, setTick] = useState(0);

  const rerender = useCallback(() => setTick((t) => t + 1), []);

  const downloadDir = useCallback(async (dirPath: string, dirName: string) => {
    if (activeRef.current.has(dirPath)) return; // already in progress for this exact path

    activeRef.current.add(dirPath);
    rerender();

    const toastId = sonnerToast.loading(`Zipping ${dirName}…`, { duration: Infinity });

    try {
      let lastPct = 0;

      await downloadDirectory(dirPath, dirName, (progress) => {
        const pct = Math.round(progress * 100);
        if (pct !== lastPct) {
          lastPct = pct;
          sonnerToast.loading(`Zipping ${dirName}… ${pct}%`, { id: toastId, duration: Infinity });
        }
      });

      sonnerToast.success(`Downloaded ${dirName}.zip`, { id: toastId, duration: 3000 });
    } catch (err) {
      sonnerToast.error(
        `Failed to download ${dirName}: ${err instanceof Error ? err.message : 'Unknown error'}`,
        { id: toastId, duration: 5000 },
      );
    } finally {
      activeRef.current.delete(dirPath);
      rerender();
    }
  }, [rerender]);

  const isDownloading = useCallback(
    (path: string) => activeRef.current.has(path),
    [],  // stable — reads the ref directly at call time
  );

  return { downloadDir, isDownloading, downloadingPaths: activeRef.current };
}
