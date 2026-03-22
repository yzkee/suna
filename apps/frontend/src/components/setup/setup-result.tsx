'use client';

import { CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface SetupSuccessProps {
  message?: string;
}

export function SetupSuccess({ message = 'Redirecting to your workspace...' }: SetupSuccessProps) {
  return (
    <div className="flex flex-col items-center gap-4">
      <CheckCircle2 className="h-10 w-10 text-primary/70" />
      <h1 className="text-[24px] font-normal tracking-tight text-foreground text-center">
        You&apos;re All Set
      </h1>
      <p className="text-[14px] text-foreground/40 text-center">{message}</p>
    </div>
  );
}

interface SetupErrorProps {
  message: string;
  instanceMode?: boolean;
  onRetry: () => void;
  onNavigate: (path: string) => void;
}

export function SetupError({ message, instanceMode = false, onRetry, onNavigate }: SetupErrorProps) {
  return (
    <>
      <h1 className="text-[43px] font-normal tracking-tight text-foreground leading-none text-center">
        {instanceMode ? 'Provisioning Failed' : 'Setup Issue'}
      </h1>

      <Card className="w-full min-h-24 bg-card border border-border">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 bg-red-500 rounded-full" />
                  <span className="text-base font-medium text-red-400">
                    {instanceMode ? 'Instance Error' : 'Setup Error'}
                  </span>
                </div>
                <p className="text-sm text-gray-400">
                  {message || (instanceMode
                    ? 'The instance could not be provisioned.'
                    : 'Please try again or choose a plan manually.')}
                </p>
              </div>
            </div>
            <div className="h-12 w-12 flex items-center justify-center">
              <AlertCircle className="h-6 w-6 text-red-500" />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            {instanceMode ? (
              <>
                <Button onClick={() => onNavigate('/dashboard?open_add_instance=1')} className="flex-1" variant="default">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Try Different Location
                </Button>
                <Button onClick={() => onNavigate('/dashboard')} className="flex-1" variant="outline">
                  Go to Dashboard
                </Button>
              </>
            ) : (
              <>
                <Button onClick={onRetry} className="flex-1" variant="default">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Try Again
                </Button>
                <Button onClick={() => onNavigate('/subscription')} className="flex-1" variant="outline">
                  Choose a Plan
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
