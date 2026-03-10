'use client';

/**
 * ProviderSettings — unified provider management UI.
 *
 * Used in:
 * - Settings page  (variant="settings"): connected list + "Add Provider" opens ProviderModal
 * - Setup wizard   (variant="setup"):    inline connect flow + Continue footer
 */

import { ConnectProviderContent } from '@/components/providers/connect-provider-content';
import { ProviderList } from '@/components/providers/provider-list';
import { useOpenCodeProviders } from '@/hooks/opencode/use-opencode-sessions';
import { Button } from '@/components/ui/button';
import { KortixLoader } from '@/components/ui/kortix-loader';
import { Plus } from 'lucide-react';
import { useMemo, useRef, useEffect, useState } from 'react';
import { useProviderModalStore } from '@/stores/provider-modal-store';

const LLM_PROVIDERS = new Set(['anthropic', 'openai', 'openrouter', 'google', 'groq', 'xai']);

interface ProviderSettingsProps {
  variant?: 'settings' | 'setup';
  onContinue?: () => void;
  onProviderChange?: () => void;
}

export function ProviderSettings({
  variant = 'settings',
  onContinue,
  onProviderChange,
}: ProviderSettingsProps) {
  const { data: providersData, isLoading, isError, refetch } = useOpenCodeProviders();
  const prevCountRef = useRef(0);
  const openProviderModal = useProviderModalStore((s) => s.openProviderModal);

  // Retry polling when data is unavailable (sandbox not ready yet)
  useEffect(() => {
    if (!isLoading && (!providersData || isError)) {
      const timer = setInterval(() => { refetch(); }, 3000);
      return () => clearInterval(timer);
    }
  }, [isLoading, providersData, isError, refetch]);

  const connectedProviders = useMemo(() => {
    if (!providersData) return [];
    const connectedIds = new Set(providersData.connected ?? []);
    return (providersData.all ?? []).filter((p) => connectedIds.has(p.id));
  }, [providersData]);

  const hasLLMProvider = connectedProviders.some((p) => LLM_PROVIDERS.has(p.id));
  const canContinue = variant === 'setup' ? hasLLMProvider : true;
  const connecting = isLoading || (!providersData && !isError);

  useEffect(() => {
    prevCountRef.current = connectedProviders.length;
  }, [connectedProviders]);

  if (connecting) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <KortixLoader size="medium" />
        <p className="text-sm text-muted-foreground animate-pulse">Connecting to sandbox…</p>
      </div>
    );
  }

  // ── Setup wizard: keep inline flow ──────────────────────────────────────────
  if (variant === 'setup') {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
          <ConnectProviderContent
            providers={providersData}
            onProviderConnected={onProviderChange}
          />
          {connectedProviders.length > 0 && (
            <ProviderList
              connectedProviders={connectedProviders}
              onDisconnected={onProviderChange}
              showConnectButton={false}
              compact
            />
          )}
        </div>
        <div className="flex-shrink-0 pt-4 mt-2 border-t border-border/40">
          {!canContinue && (
            <p className="text-xs text-muted-foreground/50 text-center mb-3">
              Connect at least one LLM provider to continue
            </p>
          )}
          <Button
            onClick={onContinue}
            disabled={!canContinue}
            className="w-full h-11 rounded-xl shadow-none"
          >
            Continue
          </Button>
        </div>
      </div>
    );
  }

  // ── Settings page: connected list + modal trigger ────────────────────────────
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4">

        <div className="flex items-center justify-between">
          <p className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wider">
            {connectedProviders.length > 0 ? `Connected (${connectedProviders.length})` : 'No providers connected'}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs gap-1.5 rounded-lg"
            onClick={() => openProviderModal('providers')}
          >
            <Plus className="h-3 w-3" />
            Add Provider
          </Button>
        </div>

        {connectedProviders.length > 0 ? (
          <ProviderList
            connectedProviders={connectedProviders}
            onConnect={() => openProviderModal('providers')}
            onDisconnected={onProviderChange}
            showConnectButton={false}
          />
        ) : (
          <div className="rounded-2xl border border-dashed border-border/60 py-12 flex flex-col items-center gap-3">
            <p className="text-sm text-muted-foreground/60">No providers connected yet</p>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-4 text-xs gap-1.5 rounded-lg"
              onClick={() => openProviderModal('providers')}
            >
              <Plus className="h-3.5 w-3.5" />
              Connect your first provider
            </Button>
          </div>
        )}

      </div>
    </div>
  );
}
