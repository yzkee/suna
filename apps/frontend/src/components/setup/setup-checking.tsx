'use client';

import { Loader2, CheckCircle2 } from 'lucide-react';

type Phase = 'checking' | 'subscription';

interface SetupCheckingProps {
  phase: Phase;
}

export function SetupChecking({ phase }: SetupCheckingProps) {
  return (
    <div className="w-full flex flex-col items-center gap-6">
      <div className="relative h-10 w-10 flex items-center justify-center">
        <Loader2 className="size-5 text-primary animate-spin" />
      </div>
      <div className="space-y-3 text-center">
        <StepRow
          active={phase === 'checking'}
          complete={phase === 'subscription'}
          label="Verifying account"
        />
        <StepRow
          active={phase === 'subscription'}
          complete={false}
          pending={phase === 'checking'}
          label="Setting up subscription"
        />
      </div>
    </div>
  );
}

function StepRow({ active, complete, pending, label }: {
  active: boolean;
  complete: boolean;
  pending?: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center justify-center gap-3">
      {active ? (
        <Loader2 className="size-3.5 text-primary animate-spin" />
      ) : complete ? (
        <CheckCircle2 className="size-3.5 text-primary/50" />
      ) : (
        <div className="h-1 w-1 rounded-full bg-foreground/15" />
      )}
      <span className={`text-[13px] ${
        active ? 'text-foreground/90 font-medium' :
        pending ? 'text-foreground/15' :
        'text-foreground/30'
      }`}>
        {label}
      </span>
    </div>
  );
}
