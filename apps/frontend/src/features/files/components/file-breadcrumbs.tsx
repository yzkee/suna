'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  ChevronRight,
  ChevronLeft,
  FolderRoot,
  Home,
  Edit3,
  Check,
  X,
} from 'lucide-react';
import { useFilesStore } from '../store/files-store';
import { useCurrentProject } from '../hooks';
import { cn } from '@/lib/utils';

export function FileBreadcrumbs() {
  const currentPath = useFilesStore((s) => s.currentPath);
  const navigateToPath = useFilesStore((s) => s.navigateToPath);
  const { data: project } = useCurrentProject();

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const projectName = project?.name || project?.worktree?.split('/').pop() || 'Project';

  // Split the path into segments
  const isRoot = currentPath === '/' || currentPath === '.' || currentPath === '';
  const segments = useMemo(
    () => (isRoot ? [] : currentPath.split('/').filter(Boolean)),
    [isRoot, currentPath],
  );

  // Start editing on double-click
  const handleDoubleClick = useCallback(() => {
    setEditValue(currentPath === '/' ? '' : currentPath);
    setIsEditing(true);
    // Focus and select all after a short delay
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, [currentPath]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && isEditing) {
        // Navigate to entered path
        const newPath = editValue.trim() || '/';
        navigateToPath(newPath);
        setIsEditing(false);
      } else if (e.key === 'Escape' && isEditing) {
        setIsEditing(false);
      } else if (!isEditing) {
        // Navigate up with Backspace (when not editing and input is empty)
        if (e.key === 'Backspace' && !isRoot) {
          const lastSlash = currentPath.lastIndexOf('/');
          const parent = lastSlash <= 0 ? '/' : currentPath.slice(0, lastSlash);
          navigateToPath(parent);
        }
        // Alt + Left Arrow = go up
        if (e.altKey && e.key === 'ArrowLeft' && !isRoot) {
          const lastSlash = currentPath.lastIndexOf('/');
          const parent = lastSlash <= 0 ? '/' : currentPath.slice(0, lastSlash);
          navigateToPath(parent);
        }
        // Alt + Right Arrow = go to first segment after root
        if (e.altKey && e.key === 'ArrowRight' && segments.length > 1) {
          const firstSegment = '/' + segments[0];
          navigateToPath(firstSegment);
        }
      }
    },
    [isEditing, editValue, navigateToPath, isRoot, currentPath, segments],
  );

  // Cancel editing when clicking outside
  useEffect(() => {
    if (!isEditing) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target instanceof HTMLInputElement)) {
        setIsEditing(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isEditing]);

  // Navigate to a specific segment
  const handleSegmentClick = useCallback(
    (index: number) => {
      const pathToHere = '/' + segments.slice(0, index + 1).join('/');
      navigateToPath(pathToHere);
    },
    [segments, navigateToPath],
  );

  // Navigate up one level
  const handleGoUp = useCallback(() => {
    if (isRoot) return;
    const lastSlash = currentPath.lastIndexOf('/');
    const parent = lastSlash <= 0 ? '/' : currentPath.slice(0, lastSlash);
    navigateToPath(parent);
  }, [isRoot, currentPath, navigateToPath]);

  // Handle edit submit
  const handleEditSubmit = useCallback(() => {
    const newPath = editValue.trim() || '/';
    navigateToPath(newPath);
    setIsEditing(false);
  }, [editValue, navigateToPath]);

  // Handle edit cancel
  const handleEditCancel = useCallback(() => {
    setIsEditing(false);
    setEditValue('');
  }, []);

  return (
    <div
      className="flex items-center gap-1 text-sm min-w-0 flex-1"
      onKeyDown={handleKeyDown}
    >
      {/* Home button */}
      <button
        onClick={() => navigateToPath('/')}
        className={cn(
          'flex items-center justify-center h-7 w-7 rounded-md transition-colors cursor-pointer shrink-0',
          'text-muted-foreground hover:text-foreground hover:bg-muted',
        )}
        title="Go to root (Alt+Home)"
      >
        <Home className="h-3.5 w-3.5" />
      </button>

      {/* Up button - only show when not at root */}
      {!isRoot && (
        <button
          onClick={handleGoUp}
          className={cn(
            'flex items-center justify-center h-7 w-7 rounded-md transition-colors cursor-pointer shrink-0',
            'text-muted-foreground hover:text-foreground hover:bg-muted',
          )}
          title="Go up one level (Alt+← or Backspace)"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Divider */}
      <div className="w-px h-4 bg-border mx-1 shrink-0" />

      {/* Path display or edit input */}
      {isEditing ? (
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleEditSubmit();
              if (e.key === 'Escape') handleEditCancel();
            }}
            onBlur={handleEditSubmit}
            className={cn(
              'flex-1 min-w-0 h-7 px-2 text-sm bg-background border rounded-md',
              'outline-none focus:ring-1 focus:ring-primary font-mono',
            )}
            placeholder="/path/to/folder"
          />
        </div>
      ) : (
        <nav
          className="flex items-center gap-0.5 min-w-0 flex-1 overflow-x-auto cursor-text"
          onDoubleClick={handleDoubleClick}
          title="Double-click to edit path"
        >
          {/* Root / button */}
          <button
            onClick={() => navigateToPath('/')}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-md transition-colors cursor-pointer shrink-0',
              'hover:bg-muted',
              segments.length === 0
                ? 'text-foreground font-medium bg-muted/50'
                : 'text-muted-foreground',
            )}
          >
            <FolderRoot className="h-3.5 w-3.5" />
          </button>

          {segments.map((segment, index) => {
            const isLast = index === segments.length - 1;
            const pathToHere = '/' + segments.slice(0, index + 1).join('/');

            return (
              <div key={pathToHere} className="flex items-center gap-0.5 min-w-0">
                <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                <button
                  onClick={() => handleSegmentClick(index)}
                  className={cn(
                    'px-1.5 py-1 rounded-md transition-colors cursor-pointer truncate max-w-[180px] text-xs',
                    'hover:bg-muted',
                    isLast
                      ? 'text-foreground font-medium bg-muted/30'
                      : 'text-muted-foreground',
                  )}
                >
                  {segment}
                </button>
              </div>
            );
          })}

          {/* Edit indicator */}
          <button
            onClick={handleDoubleClick}
            className={cn(
              'flex items-center justify-center h-6 w-6 rounded transition-colors cursor-pointer shrink-0 ml-1',
              'text-muted-foreground/40 hover:text-foreground hover:bg-muted',
            )}
            title="Edit path"
          >
            <Edit3 className="h-3 w-3" />
          </button>
        </nav>
      )}
    </div>
  );
}
