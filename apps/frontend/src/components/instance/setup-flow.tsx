'use client';

/**
 * InstanceSetupFlow — the canonical setup wizard for /instances/[id].
 *
 * Two-step flow shown after sandbox becomes active:
 *   Step 1: Connect an LLM provider (required for agent to work)
 *   Step 2: Tool API keys (optional — web search, scraping, etc.)
 *
 * Used by both self-hosted and cloud instances. This is the SINGLE
 * source of truth for instance setup — /auth no longer owns any of this.
 */

import { useState, useMemo, useCallback } from 'react';
import {
  Settings2,
  Check,
  ChevronRight,
  Sparkles,
  Search,
  Flame,
  Image,
  Mic,
  BookOpen,
  ExternalLink,
  Loader2,
  Link,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { KortixLoader } from '@/components/ui/kortix-loader';
import { GlobalProviderModal } from '@/components/providers/provider-modal';
import { useProviderModalStore } from '@/stores/provider-modal-store';
import { useOpenCodeProviders } from '@/hooks/opencode/use-opencode-sessions';
import { isBillingEnabled } from '@/lib/config';
import { getActiveOpenCodeUrl } from '@/stores/server-store';
import { authenticatedFetch } from '@/lib/auth-token';
import { cn } from '@/lib/utils';
import { backendApi } from '@/lib/api-client';

// ─── Step indicator ─────────────────────────────────────────────────────────

function StepIndicator({
  currentStep,
  totalSteps,
  onStepClick,
}: {
  currentStep: number;
  totalSteps: number;
  onStepClick?: (step: number) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-1.5 mb-6">
      {Array.from({ length: totalSteps }, (_, i) => {
        const step = i + 1;
        const isDone = step < currentStep;
        const isActive = step === currentStep;
        const isClickable = isDone && !!onStepClick;
        return (
          <div key={step} className="contents">
            <button
              type="button"
              disabled={!isClickable}
              onClick={() => isClickable && onStepClick(step)}
              className={cn(
                'rounded-full transition-all duration-300',
                isDone && 'w-1.5 h-1.5 bg-foreground/40',
                isActive && 'w-6 h-1.5 bg-foreground',
                !isDone && !isActive && 'w-1.5 h-1.5 bg-foreground/15',
                isClickable ? 'cursor-pointer hover:bg-foreground/70 scale-125' : 'cursor-default',
              )}
              aria-label={isClickable ? `Go to step ${step}` : undefined}
            />
            {i < totalSteps - 1 && <div className="w-1" />}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 1: Provider ───────────────────────────────────────────────────────

function ProviderStep({ onContinue }: { onContinue: () => void }) {
  const { data: providersData, isLoading } = useOpenCodeProviders();
  const openProviderModal = useProviderModalStore((s) => s.openProviderModal);

  const connectedProviders = useMemo(() => {
    if (!providersData) return [];
    const connectedIds = new Set(providersData.connected ?? []);
    return (providersData.all ?? []).filter((p) => connectedIds.has(p.id));
  }, [providersData]);

  const hasLLMProvider = connectedProviders.some((p) =>
    ['anthropic', 'openai', 'openrouter', 'google', 'groq', 'xai'].includes(p.id),
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
          <div
            className={cn(
              'h-11 w-11 rounded-full flex items-center justify-center',
              hasLLMProvider ? 'bg-emerald-500/10' : 'bg-muted/60',
            )}
          >
            {hasLLMProvider ? (
              <Check className="h-5 w-5 text-emerald-500" />
            ) : (
              <Sparkles className="h-5 w-5 text-muted-foreground/50" />
            )}
          </div>
        </div>
        <h2 className="text-[15px] font-medium text-foreground/90">
          {hasLLMProvider ? 'Provider connected' : 'Connect an LLM provider'}
        </h2>
        <p className="text-[12px] text-muted-foreground/50 leading-relaxed">
          {hasLLMProvider
            ? `${connectedProviders.length} provider${connectedProviders.length > 1 ? 's' : ''} ready. You can add more anytime from settings.`
            : 'Connect your existing OpenAI, Anthropic, or other LLM subscription with an API key.'}
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
          {hasLLMProvider ? (
            <>
              Continue <ChevronRight className="h-3.5 w-3.5" />
            </>
          ) : (
            'Skip for now'
          )}
        </Button>
      </div>

      <GlobalProviderModal />
    </div>
  );
}

// ─── Step 2: Tool Secrets ───────────────────────────────────────────────────

/** Tool API keys the agent uses — shown in wizard step 2. All optional. */
const TOOL_SECRETS = [
  {
    key: 'TAVILY_API_KEY',
    label: 'Tavily',
    description: 'Web search — lets the agent search the internet',
    icon: Search,
    signupUrl: 'https://tavily.com',
  },
  {
    key: 'FIRECRAWL_API_KEY',
    label: 'Firecrawl',
    description: 'Web scraping — read and extract web page content',
    icon: Flame,
    signupUrl: 'https://firecrawl.dev',
  },
  {
    key: 'SERPER_API_KEY',
    label: 'Serper',
    description: 'Google image search for finding visual content',
    icon: Image,
    signupUrl: 'https://serper.dev',
  },
  {
    key: 'REPLICATE_API_TOKEN',
    label: 'Replicate',
    description: 'AI image & video generation',
    icon: Image,
    signupUrl: 'https://replicate.com',
  },
  {
    key: 'CONTEXT7_API_KEY',
    label: 'Context7',
    description: 'Documentation search for coding libraries',
    icon: BookOpen,
    signupUrl: 'https://context7.com',
  },
  {
    key: 'ELEVENLABS_API_KEY',
    label: 'ElevenLabs',
    description: 'Text-to-speech and voice generation',
    icon: Mic,
    signupUrl: 'https://elevenlabs.io',
  },
] as const;

function ToolSecretsStep({
  onContinue,
  onSkip,
  completing,
}: {
  onContinue: () => void;
  onSkip: () => void;
  completing?: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const filledCount = Object.values(values).filter((v) => v.trim()).length;

  const handleSave = useCallback(async () => {
    const toSave = Object.entries(values).filter(([, v]) => v.trim());
    if (toSave.length === 0) {
      onContinue();
      return;
    }

    setSaving(true);
    const baseUrl = getActiveOpenCodeUrl();

    try {
      for (const [key, value] of toSave) {
        const res = await authenticatedFetch(`${baseUrl}/env/${encodeURIComponent(key)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: value.trim() }),
        });
        if (!res.ok) {
          console.warn(`[Setup] Failed to save ${key}`);
        }
      }
      onContinue();
    } catch (err) {
      console.warn('[Setup] Failed to save some secrets:', err);
      // Continue anyway — user can fix in Settings later
      onContinue();
    } finally {
      setSaving(false);
    }
  }, [values, onContinue]);

  return (
    <div className="w-full max-w-sm space-y-5">
      {/* Header */}
      <div className="text-center space-y-2">
        <h2 className="text-[15px] font-medium text-foreground/90">Add tool keys</h2>
        <p className="text-[12px] text-muted-foreground/50 leading-relaxed">
          Optional API keys for agent capabilities
        </p>
      </div>

      {/* Secret list */}
      <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1 -mr-1">
        {TOOL_SECRETS.map((secret) => {
          const Icon = secret.icon;
          return (
            <div
              key={secret.key}
              className="flex items-start gap-3 p-2.5 rounded-xl border border-foreground/[0.06] bg-foreground/[0.02]"
            >
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.05]">
                <Icon className="h-3.5 w-3.5 text-foreground/40" />
              </div>
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-foreground/80">{secret.label}</span>
                  <a
                    href={secret.signupUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto text-foreground/20 hover:text-foreground/50 transition-colors"
                    title={`Get ${secret.label} API key`}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <p className="text-[11px] text-foreground/35 leading-relaxed">{secret.description}</p>
                <Input
                  type="password"
                  placeholder={secret.key}
                  value={values[secret.key] || ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [secret.key]: e.target.value }))}
                  className="h-8 text-xs font-mono shadow-none bg-foreground/[0.04] border-foreground/[0.08] rounded-lg"
                  autoComplete="off"
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Button
          variant="outline"
          onClick={onSkip}
          className="flex-1 h-10 text-[13px] rounded-xl shadow-none border-foreground/[0.08]"
          disabled={saving || completing}
        >
          {completing ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Finishing…
            </>
          ) : (
            'Skip for now'
          )}
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving || completing}
          className="flex-1 h-10 text-[13px] rounded-xl shadow-none"
        >
          {saving || completing ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {saving ? 'Saving…' : 'Finishing setup…'}
            </>
          ) : filledCount > 0 ? (
            'Save & continue'
          ) : (
            'Continue'
          )}
        </Button>
      </div>

      <p className="text-[11px] text-foreground/25 text-center">
        You can add or change keys later in Settings.
      </p>
    </div>
  );
}

// ─── Step 3: Pipedream Integrations ─────────────────────────────────────────

const PIPEDREAM_KEYS = [
  {
    key: 'PIPEDREAM_CLIENT_ID',
    label: 'Client ID',
    placeholder: 'e.g. z8PKSGuQdorPj4UErE…',
    secret: false,
  },
  {
    key: 'PIPEDREAM_CLIENT_SECRET',
    label: 'Client Secret',
    placeholder: 'e.g. UeZCz2PeNdOeHJfw…',
    secret: true,
  },
  {
    key: 'PIPEDREAM_PROJECT_ID',
    label: 'Project ID',
    placeholder: 'e.g. proj_x9s97z5',
    secret: false,
  },
] as const;

function PipedreamStep({
  onContinue,
  onSkip,
  completing,
}: {
  onContinue: () => void;
  onSkip: () => void;
  completing?: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const allFilled = PIPEDREAM_KEYS.every((k) => (values[k.key] || '').trim());

  const handleSave = useCallback(async () => {
    if (!allFilled) {
      onContinue();
      return;
    }

    setSaving(true);
    try {
      const keys: Record<string, string> = {
        INTEGRATION_AUTH_PROVIDER: 'pipedream',
        PIPEDREAM_ENVIRONMENT: 'production',
      };
      for (const k of PIPEDREAM_KEYS) {
        keys[k.key] = (values[k.key] || '').trim();
      }

      const result = await backendApi.post('/admin/api/env', { keys });
      if (!result.success) {
        console.warn('[Setup] Failed to save Pipedream config:', result.error);
      }
      onContinue();
    } catch (err) {
      console.warn('[Setup] Failed to save Pipedream config:', err);
      onContinue();
    } finally {
      setSaving(false);
    }
  }, [values, allFilled, onContinue]);

  return (
    <div className="w-full max-w-sm space-y-5">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center">
          <div className="h-11 w-11 rounded-full flex items-center justify-center bg-muted/60">
            <Link className="h-5 w-5 text-muted-foreground/50" />
          </div>
        </div>
        <h2 className="text-[15px] font-medium text-foreground/90">
          Third-party integrations
        </h2>
        <p className="text-[12px] text-muted-foreground/50 leading-relaxed">
          Connect to 3,000+ apps via{' '}
          <a
            href="https://pipedream.com/connect"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-muted-foreground/70 transition-colors"
          >
            Pipedream Connect
          </a>
          . Optional — you can add this later.
        </p>
      </div>

      {/* Fields */}
      <div className="space-y-3">
        {PIPEDREAM_KEYS.map((field) => (
          <div key={field.key} className="space-y-1">
            <label className="text-[12px] font-medium text-foreground/60">
              {field.label}
            </label>
            <Input
              type={field.secret ? 'password' : 'text'}
              placeholder={field.placeholder}
              value={values[field.key] || ''}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
              }
              className="h-9 text-xs font-mono shadow-none bg-foreground/[0.04] border-foreground/[0.08] rounded-lg"
              autoComplete="off"
            />
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Button
          variant="outline"
          onClick={onSkip}
          className="flex-1 h-10 text-[13px] rounded-xl shadow-none border-foreground/[0.08]"
          disabled={saving || completing}
        >
          {completing ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Finishing…
            </>
          ) : (
            'Skip for now'
          )}
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving || completing || !allFilled}
          className="flex-1 h-10 text-[13px] rounded-xl shadow-none"
        >
          {saving || completing ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {saving ? 'Saving…' : 'Finishing…'}
            </>
          ) : (
            'Save & finish'
          )}
        </Button>
      </div>

      <p className="text-[11px] text-foreground/25 text-center">
        Get your credentials at{' '}
        <a
          href="https://pipedream.com/connect"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          pipedream.com/connect
        </a>
        . You can add them later in Settings.
      </p>
    </div>
  );
}

// ─── Main flow ──────────────────────────────────────────────────────────────

export interface InstanceSetupFlowProps {
  onComplete: () => void;
}

export function InstanceSetupFlow({ onComplete }: InstanceSetupFlowProps) {
  const isCloud = isBillingEnabled();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [completing, setCompleting] = useState(false);

  const handleProviderContinue = useCallback(() => {
    setStep(2);
  }, []);

  const handleToolKeysDone = useCallback(() => {
    if (isCloud) {
      // Cloud mode: skip Pipedream (managed by platform)
      setCompleting(true);
      onComplete();
    } else {
      setStep(3);
    }
  }, [isCloud, onComplete]);

  const handlePipedreamDone = useCallback(() => {
    setCompleting(true);
    onComplete();
  }, [onComplete]);

  const totalSteps = isCloud ? 2 : 3;

  const handleStepClick = useCallback(
    (s: number) => {
      if (s < step) setStep(s as 1 | 2 | 3);
    },
    [step],
  );

  return (
    <div className="w-full max-w-[400px] flex flex-col items-center">
      {/* Mode label */}
      {!isCloud && (
        <p className="text-[10px] font-medium text-muted-foreground/30 uppercase tracking-[0.2em] mb-4">
          Self-Hosted Setup
        </p>
      )}

      <StepIndicator currentStep={step} totalSteps={totalSteps} onStepClick={handleStepClick} />

      {step === 1 && <ProviderStep onContinue={handleProviderContinue} />}

      {step === 2 && (
        <ToolSecretsStep
          onContinue={handleToolKeysDone}
          onSkip={handleToolKeysDone}
          completing={isCloud ? completing : false}
        />
      )}

      {step === 3 && !isCloud && (
        <PipedreamStep
          onContinue={handlePipedreamDone}
          onSkip={handlePipedreamDone}
          completing={completing}
        />
      )}
    </div>
  );
}
