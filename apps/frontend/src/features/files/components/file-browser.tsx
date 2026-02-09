'use client';

import { useMemo, useCallback } from 'react';
import { Search, RefreshCw, FolderUp, ServerOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useFilesStore } from '../store/files-store';
import { useFileList, useFileStatusMap, useServerHealth } from '../hooks';
import { useServerStore } from '@/stores/server-store';
import type { FileNode } from '../types';
import { FileBreadcrumbs } from './file-breadcrumbs';
import { FileTreeItem } from './file-tree-item';
import { FileSearch } from './file-search';
import { cn } from '@/lib/utils';

export function FileBrowser() {
  const currentPath = useFilesStore((s) => s.currentPath);
  const navigateToPath = useFilesStore((s) => s.navigateToPath);
  const openFile = useFilesStore((s) => s.openFile);
  const openFileWithList = useFilesStore((s) => s.openFileWithList);
  const isSearchOpen = useFilesStore((s) => s.isSearchOpen);
  const toggleSearch = useFilesStore((s) => s.toggleSearch);
  const serverUrl = useServerStore((s) => s.getActiveServerUrl());

  const { data: health, isLoading: isHealthLoading } = useServerHealth();
  const {
    data: files,
    isLoading,
    error,
    refetch,
  } = useFileList(currentPath, {
    enabled: health?.healthy === true,
  });
  const statusMap = useFileStatusMap();

  // Separate dirs and files, sorted
  const { dirs, fileItems } = useMemo(() => {
    if (!files) return { dirs: [] as FileNode[], fileItems: [] as FileNode[] };
    const dirs = files
      .filter((f) => f.type === 'directory')
      .sort((a, b) => a.name.localeCompare(b.name));
    const fileItems = files
      .filter((f) => f.type === 'file')
      .sort((a, b) => a.name.localeCompare(b.name));
    return { dirs, fileItems };
  }, [files]);

  // Build file list for prev/next navigation in viewer
  const handleFileClick = useCallback(
    (node: FileNode) => {
      if (node.type === 'directory') {
        navigateToPath(node.path);
      } else {
        const allFiles = fileItems.map((f) => f.path);
        const index = allFiles.indexOf(node.path);
        openFileWithList(node.path, allFiles, Math.max(0, index));
      }
    },
    [fileItems, navigateToPath, openFileWithList],
  );

  // Navigate up one level
  const handleNavigateUp = useCallback(() => {
    if (currentPath === '.' || currentPath === '') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    navigateToPath(parts.length > 0 ? parts.join('/') : '.');
  }, [currentPath, navigateToPath]);

  // Server not reachable
  if (!isHealthLoading && !health?.healthy) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <ServerOff className="h-12 w-12 text-muted-foreground" />
        <div>
          <h3 className="text-lg font-medium">Server not reachable</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Could not connect to the OpenCode server at{' '}
            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
              {serverUrl}
            </code>
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Make sure <code className="text-xs bg-muted px-1.5 py-0.5 rounded">opencode serve</code> or{' '}
            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">opencode web</code> is running.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b shrink-0">
        <FileBreadcrumbs />
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={toggleSearch}
            title="Search files (Ctrl+P)"
          >
            <Search className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => refetch()}
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Search overlay */}
      {isSearchOpen && <FileSearch />}

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {/* Loading state */}
        {isLoading && (
          <div className="p-3 space-y-1.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded-md" />
            ))}
          </div>
        )}

        {/* Error state */}
        {error && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Failed to load files
            </p>
            <p className="text-xs text-muted-foreground max-w-sm">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        )}

        {/* File entries */}
        {!isLoading && !error && files && (
          <div className="p-1.5">
            {/* Go up */}
            {currentPath !== '.' && currentPath !== '' && (
              <button
                onClick={handleNavigateUp}
                className={cn(
                  'flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left rounded-md transition-colors',
                  'hover:bg-muted/80 text-muted-foreground',
                )}
              >
                <FolderUp className="h-4 w-4 shrink-0" />
                <span>..</span>
              </button>
            )}

            {/* Directories first */}
            {dirs.map((node) => (
              <FileTreeItem
                key={node.path}
                node={node}
                status={statusMap.get(node.path)}
                onClick={() => handleFileClick(node)}
              />
            ))}

            {/* Then files */}
            {fileItems.map((node) => (
              <FileTreeItem
                key={node.path}
                node={node}
                status={statusMap.get(node.path)}
                onClick={() => handleFileClick(node)}
              />
            ))}

            {/* Empty directory */}
            {files.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-sm text-muted-foreground">
                  Empty directory
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
