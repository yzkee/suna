'use client';

import { useState, useMemo, useCallback } from 'react';
import {
  GitCommitHorizontal,
  FileEdit,
  ChevronRight,
  Undo2,
  Loader2,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ConfirmDialog } from '@/components/session/message-actions';
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
// Mirrors the BasicTool pattern exactly:
//   - Same container: px-2.5 py-1.5 rounded-lg bg-muted/20 border border-border/40
//   - Icon left, title + subtitle inline, chevron right
//   - Expandable file list below in mt-1.5 mb-2 rounded-lg bg-muted/20 border
//   - Revert button on hover with confirmation dialog
// ============================================================================

interface OcPatchPartViewProps {
  part: PatchPart;
  onRevert?: (messageId: string, partId: string) => Promise<void>;
  disabled?: boolean;
}

export function OcPatchPartView({ part, onRevert, disabled }: OcPatchPartViewProps) {
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reverting, setReverting] = useState(false);
  const fileCount = part.files.length;

  const fileEntries = useMemo(() => {
    return part.files.map((file) => {
      const filename = file.split('/').pop() || file;
      return { path: file, filename };
    });
  }, [part.files]);

  const handleRevertClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onRevert || disabled || reverting) return;
    setConfirmOpen(true);
  }, [onRevert, disabled, reverting]);

  const handleRevertConfirm = useCallback(async () => {
    if (!onRevert || disabled || reverting) return;
    try {
      setReverting(true);
      await onRevert(part.messageID, part.id);
    } finally {
      setReverting(false);
      setConfirmOpen(false);
    }
  }, [onRevert, disabled, reverting, part.messageID, part.id]);

  if (fileCount === 0) return null;

  return (
    <>
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

            {/* Revert button — visible on hover, same pattern as MessageActions */}
            {onRevert && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleRevertClick}
                    disabled={disabled || reverting}
                    className={cn(
                      'p-1 rounded-md transition-all cursor-pointer flex-shrink-0 ml-auto',
                      'text-muted-foreground/60 hover:text-foreground hover:bg-muted/60',
                      'opacity-0 group-hover:opacity-100',
                      'disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted-foreground/60',
                    )}
                  >
                    {reverting ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Undo2 className="size-3" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  Revert to this checkpoint
                </TooltipContent>
              </Tooltip>
            )}

            <ChevronRight
              className={cn(
                'size-3 transition-transform flex-shrink-0 text-muted-foreground/50',
                !onRevert && 'ml-auto',
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

      {/* Revert confirmation dialog */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Revert to this checkpoint?"
        description={`This will undo all file changes and messages after this checkpoint (${fileCount} file${fileCount !== 1 ? 's' : ''}). You can restore everything later.`}
        action={handleRevertConfirm}
        actionLabel="Revert"
        variant="destructive"
        loading={reverting}
      />
    </>
  );
}

// ============================================================================
// SnapshotTimelineEntry — used in the Snapshots dialog timeline
// ============================================================================

export interface SnapshotTimelineItem {
  id: string;
  type: 'snapshot' | 'patch';
  messageId: string;
  /** For snapshot parts */
  snapshotHash?: string;
  /** For patch parts */
  patchHash?: string;
  files?: string[];
  /** Timestamp derived from parent message */
  timestamp?: number;
  /** Turn index (1-based) for display */
  turnIndex?: number;
}

interface SnapshotTimelineEntryProps {
  item: SnapshotTimelineItem;
  isLast: boolean;
  onViewDiff?: (hash: string) => void;
}

export function SnapshotTimelineEntry({ item, isLast, onViewDiff }: SnapshotTimelineEntryProps) {
  const [expanded, setExpanded] = useState(false);
  const hash = item.snapshotHash || item.patchHash || '';
  const shortHash = hash.slice(0, 8);
  const fileCount = item.files?.length ?? 0;

  const formattedTime = useMemo(() => {
    if (!item.timestamp) return '';
    const d = new Date(item.timestamp);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }, [item.timestamp]);

  return (
    <div className="relative flex gap-3">
      {/* Timeline line */}
      {!isLast && (
        <div className="absolute left-[9px] top-[22px] bottom-0 w-px bg-border/50" />
      )}

      {/* Dot */}
      <div className="relative z-10 flex-shrink-0 mt-1.5">
        <div
          className={cn(
            'size-[18px] rounded-full flex items-center justify-center border-2',
            'border-muted-foreground/30 bg-muted/30',
          )}
        >
          <GitCommitHorizontal className="size-2.5 text-muted-foreground/60" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-foreground">
            {item.type === 'snapshot' ? 'Snapshot' : 'Checkpoint'}
          </span>
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground">
            {shortHash}
          </span>
          {item.turnIndex != null && (
            <span className="text-[10px] text-muted-foreground/60">
              Turn {item.turnIndex}
            </span>
          )}
          {formattedTime && (
            <span className="text-[10px] text-muted-foreground/50">
              {formattedTime}
            </span>
          )}
        </div>

        {item.type === 'patch' && fileCount > 0 && (
          <Collapsible open={expanded} onOpenChange={setExpanded}>
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-1 mt-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                <ChevronRight className={cn('size-2.5 transition-transform', expanded && 'rotate-90')} />
                {fileCount} file{fileCount !== 1 ? 's' : ''} changed
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-1.5 rounded-lg bg-muted/20 border border-border/30 p-2 space-y-0.5">
                {item.files!.map((file, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-[10px] text-muted-foreground/80 font-mono px-1 py-0.5">
                    <FileEdit className="size-2.5 text-muted-foreground/40 flex-shrink-0" />
                    <span className="truncate">{file}</span>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {onViewDiff && hash && (
          <button
            onClick={() => onViewDiff(hash)}
            className="mt-1.5 px-2.5 py-1 rounded text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 border border-border/40 transition-colors cursor-pointer"
          >
            View diff
          </button>
        )}
      </div>
    </div>
  );
}
