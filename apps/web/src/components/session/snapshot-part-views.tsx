'use client';

import { useState, useMemo } from 'react';
import {
  GitCommitHorizontal,
  FileEdit,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type { SnapshotPart, PatchPart } from '@/ui/types';

// ============================================================================
// OcSnapshotPartView — inline metadata for snapshot parts
// Matches BasicTool trigger style: single-line, muted, minimal.
// ============================================================================

interface OcSnapshotPartViewProps {
  part: SnapshotPart;
}

export function OcSnapshotPartView({ part }: OcSnapshotPartViewProps) {
  const shortHash = part.snapshot.slice(0, 8);

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg',
        'bg-muted/20 border border-border/40',
        'text-xs select-none max-w-full',
      )}
    >
      <GitCommitHorizontal className="size-3.5 text-muted-foreground/50 flex-shrink-0" />
      <span className="font-medium text-xs text-foreground whitespace-nowrap">Snapshot</span>
      <span className="text-muted-foreground text-xs truncate font-mono">
        {shortHash}
      </span>
    </div>
  );
}

// ============================================================================
// OcPatchPartView — "Checkpoint" card in the session chat.
// Shows file count, expandable file list. No revert — feature removed.
// ============================================================================

interface OcPatchPartViewProps {
  part: PatchPart;
}

export function OcPatchPartView({ part }: OcPatchPartViewProps) {
  const [open, setOpen] = useState(false);
  const fileCount = part.files.length;

  const fileEntries = useMemo(() => {
    return part.files.map((file) => {
      const filename = file.split('/').pop() || file;
      return { path: file, filename };
    });
  }, [part.files]);

  if (fileCount === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <div
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg',
            'bg-muted/20 border border-border/40',
            'text-xs transition-colors select-none',
            'cursor-pointer hover:bg-muted/40',
            'max-w-full group',
          )}
        >
          <GitCommitHorizontal className="size-3.5 text-muted-foreground/50 flex-shrink-0" />
          <span className="font-medium text-xs text-foreground whitespace-nowrap">Checkpoint</span>
          <span className="text-muted-foreground text-xs truncate font-mono">
            {fileCount} file{fileCount !== 1 ? 's' : ''} changed
          </span>

          <ChevronRight
            className={cn(
              'size-3 transition-transform flex-shrink-0 text-muted-foreground/50 ml-auto',
              open && 'rotate-90',
            )}
          />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1.5 mb-2 rounded-lg bg-muted/20 border border-border/30 text-xs overflow-hidden">
          <div className="p-2 space-y-0.5">
            {fileEntries.map((entry, i) => (
              <div key={i} className="flex items-center gap-1.5 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                <FileEdit className="size-3 flex-shrink-0 text-muted-foreground/40" />
                <span className="truncate font-mono" title={entry.path}>
                  {entry.path}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
