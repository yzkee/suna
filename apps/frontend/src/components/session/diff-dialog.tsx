'use client';

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { SessionDiffViewer } from '@/components/session/session-diff-viewer';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';

interface DiffDialogProps {
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DiffDialog({ sessionId, open, onOpenChange }: DiffDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col p-0 gap-0">
        <VisuallyHidden><DialogTitle>File Changes</DialogTitle></VisuallyHidden>
        <div className="flex-1 min-h-0 overflow-hidden">
          <SessionDiffViewer sessionId={sessionId} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
