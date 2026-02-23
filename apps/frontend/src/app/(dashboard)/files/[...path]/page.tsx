'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useTabStore } from '@/stores/tab-store';

/**
 * Catch-all route for /files/<encoded-file-path>
 *
 * When a file is opened in the app, the URL is updated via pushState to
 * /files/<encodedPath> for shareability. This page handles direct navigation
 * (hard refresh, shared link) by opening the file as a tab so the pre-mounted
 * FileTabContent takes over rendering.
 */
export default function FilePathPage() {
  const params = useParams<{ path: string[] }>();

  useEffect(() => {
    if (!params.path || params.path.length === 0) return;

    // Reconstruct the file path from the URL segments.
    // The original URL is /files/<encodeURIComponent(filePath)>, so a path like
    // "Desktop/tables-and-code-examples.md" becomes /files/Desktop%2Ftables-and-code-examples.md
    // Next.js decodes %2F into a real slash, producing multiple path segments.
    // Re-join them to reconstruct the original file path.
    const filePath = params.path.join('/');
    const fileName = filePath.split('/').pop() || filePath;
    const tabId = `file:${filePath}`;

    // Open the file tab in the store. The pre-mounted SessionTabsContainer
    // in layout-content.tsx will render the FileTabContent for this tab,
    // and the route-based children (this page) will be hidden since
    // showingMountedTab becomes true.
    useTabStore.getState().openTab({
      id: tabId,
      title: fileName,
      type: 'file',
      href: `/files/${encodeURIComponent(filePath)}`,
    });
  }, [params.path]);

  // Brief loading state while the tab store picks up the file tab
  return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
