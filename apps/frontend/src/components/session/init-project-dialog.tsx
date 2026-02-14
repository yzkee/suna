'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useInitSession } from '@/hooks/opencode/use-opencode-sessions';
import { toast } from '@/lib/toast';
import { Loader2, Sparkles } from 'lucide-react';

interface InitProjectDialogProps {
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InitProjectDialog({ sessionId, open, onOpenChange }: InitProjectDialogProps) {
  const initSession = useInitSession();

  const handleInit = async () => {
    try {
      await initSession.mutateAsync({ sessionId });
      toast.success('Project initialized — AGENTS.md created');
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to initialize project');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Initialize Project
          </DialogTitle>
          <DialogDescription>
            Analyze your project and generate an <code className="text-xs bg-muted px-1 py-0.5 rounded">AGENTS.md</code> file
            with project-specific agent configurations. This helps the AI understand
            your codebase structure, conventions, and tooling.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border/50 bg-muted/30 p-3 text-xs text-muted-foreground space-y-1.5">
          <p>This will:</p>
          <ul className="list-disc list-inside space-y-0.5 pl-1">
            <li>Scan your project structure and dependencies</li>
            <li>Identify languages, frameworks, and build tools</li>
            <li>Create or update <code className="bg-muted px-1 py-0.5 rounded">AGENTS.md</code> with custom instructions</li>
          </ul>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={initSession.isPending}>
            Cancel
          </Button>
          <Button onClick={handleInit} disabled={initSession.isPending} className="gap-1.5">
            {initSession.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                Initialize
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
