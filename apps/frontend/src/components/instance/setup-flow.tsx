'use client';

/**
 * InstanceSetupFlow — shown on /instances/[id] after sandbox becomes active.
 * Provider setup + tool keys. Same flow for local and cloud.
 */

import { useMemo } from 'react';
import { Settings2, Check, ChevronRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { KortixLoader } from '@/components/ui/kortix-loader';
import { GlobalProviderModal } from '@/components/providers/provider-modal';
import { useProviderModalStore } from '@/stores/provider-modal-store';
import { useOpenCodeProviders } from '@/hooks/opencode/use-opencode-sessions';
import { isBillingEnabled } from '@/lib/config';
import { cn } from '@/lib/utils';

// ─── Provider step ──────────────────────────────────────────────────────────

function ProviderStep({ onContinue }: { onContinue: () => void }) {
  const { data: providersData, isLoading } = useOpenCodeProviders();
  const openProviderModal = useProviderModalStore((s) => s.openProviderModal);
  const isCloud = isBillingEnabled();

  const connectedProviders = useMemo(() => {
    if (!providersData) return [];
    const connectedIds = new Set(providersData.connected ?? []);
    return (providersData.all ?? []).filter((p) => connectedIds.has(p.id));
  }, [providersData]);

  const hasLLMProvider = connectedProviders.some((p) =>
    ['anthropic', 'openai', 'openrouter', 'google', 'groq', 'xai'].includes(p.id)
  );

  if (isLoading) {
    return (
      <div className="flex flex-col items-center py-12 space-y-4">
        <KortixLoader size="small" />
        <p className="text-[12px] text-muted-foreground/40">Checking providers…</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center">
          <div className={cn(
            'h-11 w-11 rounded-full flex items-center justify-center',
            hasLLMProvider ? 'bg-emerald-500/10' : 'bg-muted/60',
          )}>
            {hasLLMProvider
              ? <Check className="h-5 w-5 text-emerald-500" />
              : <Sparkles className="h-5 w-5 text-muted-foreground/50" />
            }
          </div>
        </div>
        <h2 className="text-[15px] font-medium text-foreground/90">
          {hasLLMProvider ? 'Provider connected' : 'Connect an LLM provider'}
        </h2>
        <p className="text-[12px] text-muted-foreground/50 leading-relaxed">
          {hasLLMProvider
            ? `${connectedProviders.length} provider${connectedProviders.length > 1 ? 's' : ''} ready. You can add more anytime from settings.`
            : 'Connect your existing OpenAI, Anthropic, or other LLM subscription with an API key.'
          }
        </p>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        <Button
          onClick={() => openProviderModal('providers')}
          variant={hasLLMProvider ? 'outline' : 'default'}
          className="w-full h-10 text-[13px] rounded-xl shadow-none gap-2"
        >
          <Settings2 className="h-3.5 w-3.5" />
          {hasLLMProvider ? 'Manage Providers' : 'Add LLM Provider'}
        </Button>

        <Button
          onClick={onContinue}
          variant={hasLLMProvider ? 'default' : 'ghost'}
          className={cn(
            'w-full h-10 text-[13px] rounded-xl shadow-none gap-2',
            !hasLLMProvider && 'text-muted-foreground',
          )}
        >
          {hasLLMProvider ? <>Continue <ChevronRight className="h-3.5 w-3.5" /></> : 'Skip for now'}
        </Button>
      </div>

      <GlobalProviderModal />
    </div>
  );
}

// ─── Main flow ──────────────────────────────────────────────────────────────

export interface InstanceSetupFlowProps {
  onComplete: () => void;
}

export function InstanceSetupFlow({ onComplete }: InstanceSetupFlowProps) {
  const isCloud = isBillingEnabled();

  return (
    <div className="w-full max-w-[400px] flex flex-col items-center">
      {/* Mode label */}
      {!isCloud && (
        <p className="text-[10px] font-medium text-muted-foreground/30 uppercase tracking-[0.2em] mb-6">
          Self-Hosted Local Setup
        </p>
      )}

      <ProviderStep onContinue={onComplete} />
    </div>
  );
}
