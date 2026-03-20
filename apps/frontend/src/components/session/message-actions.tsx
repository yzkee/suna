'use client';

import { useState, useCallback } from 'react';
import { Undo2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// ============================================================================
// Types
// ============================================================================

interface MessageActionsProps {
  /** The user message ID at this turn boundary */
  messageId: string;
  /** Current session ID */
  sessionId: string;
  /** Whether this is the first turn (no revert for first message) */
  isFirstTurn: boolean;
  /** Whether the session is currently busy */
  isBusy: boolean;
  /** Whether the session is in a reverted state */
  isReverted: boolean;
  /** Callback to revert the session to this message */
  onRevert: (messageId: string) => Promise<void>;
}

// ============================================================================
// Confirmation Dialog
// ============================================================================

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  action,
  actionLabel,
  variant = 'default',
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  action: () => void;
  actionLabel: string;
  variant?: 'default' | 'destructive';
  loading?: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={action}
            disabled={loading}
            className={cn(
              variant === 'destructive' &&
                'bg-destructive text-white hover:bg-destructive/90',
            )}
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin mr-1.5" />
            ) : null}
            {actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ============================================================================
// MessageActions — hover-visible action buttons on each turn
// ============================================================================

export function MessageActions({
  messageId,
  sessionId,
  isFirstTurn,
  isBusy,
  isReverted,
  onRevert,
}: MessageActionsProps) {
  const [revertDialogOpen, setRevertDialogOpen] = useState(false);
  const [loading, setLoading] = useState<'revert' | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const handleRevert = useCallback(async () => {
    setLoading('revert');
    try {
      await onRevert(messageId);
    } finally {
      setLoading(null);
      setRevertDialogOpen(false);
    }
  }, [messageId, onRevert]);

  const disabled = isBusy || isReverted;

  // Don't render anything for first turn (no revert available)
  if (isFirstTurn) return null;

  return (
    <>
      {/* Actions container — visible on hover of the parent group */}
      <div
        className={cn(
          'flex items-center gap-0.5',
          !menuOpen && 'opacity-0 group-hover/turn:opacity-100',
          'transition-opacity duration-150',
        )}
      >
        {/* Revert button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setRevertDialogOpen(true)}
              disabled={disabled}
              className={cn(
                'p-1.5 rounded-md transition-colors cursor-pointer',
                'text-muted-foreground/60 hover:text-foreground hover:bg-muted/60',
                'disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted-foreground/60',
              )}
            >
              {loading === 'revert' ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Undo2 className="size-3.5" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Revert to before this
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Revert confirmation dialog */}
      <ConfirmDialog
        open={revertDialogOpen}
        onOpenChange={setRevertDialogOpen}
        title="Revert to this point?"
        description="All messages and file changes after this point will be undone. You can restore them later."
        action={handleRevert}
        actionLabel="Revert"
        variant="destructive"
        loading={loading === 'revert'}
      />
    </>
  );
}


