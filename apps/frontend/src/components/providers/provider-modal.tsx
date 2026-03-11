'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Plus, Search, Unplug } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
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
import { ConnectProviderContent } from '@/components/providers/connect-provider-content';
import {
  MODEL_SELECTOR_PROVIDER_IDS,
  PROVIDER_LABELS,
  ProviderLogo,
} from '@/components/providers/provider-branding';
import type { ProviderListResponse } from '@/hooks/opencode/use-opencode-sessions';
import { useOpenCodeProviders } from '@/hooks/opencode/use-opencode-sessions';
import { useModelStore } from '@/hooks/opencode/use-model-store';
import type { FlatModel } from '@/components/session/session-chat-input';
import { getClient } from '@/lib/opencode-sdk';
import { useQueryClient } from '@tanstack/react-query';
import { opencodeKeys } from '@/hooks/opencode/use-opencode-sessions';
import { toast } from '@/lib/toast';
import { useProviderModalStore } from '@/stores/provider-modal-store';
import type { ProviderModalTab } from '@/stores/provider-modal-store';

export type { ProviderModalTab };

type Provider = NonNullable<ProviderListResponse['all']>[number];

const TAB_CONFIG: { id: ProviderModalTab; label: string }[] = [
  { id: 'providers', label: 'Add Provider' },
  { id: 'connected', label: 'Connected' },
  { id: 'models', label: 'Models' },
];

// ─── Shared search input ────────────────────────────────────────────────────

function TabSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 rounded-lg border-border/40 bg-muted/30 pl-9 text-xs shadow-none focus-visible:ring-1 focus-visible:ring-ring/30 placeholder:text-muted-foreground/40"
      />
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({ message, action }: { message: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 text-center">
      <p className="text-xs text-muted-foreground/60">{message}</p>
      {action && (
        <Button variant="outline" size="sm" className="h-7 rounded-lg px-3 text-[11px]" onClick={action.onClick}>
          <Plus className="h-3 w-3" />
          {action.label}
        </Button>
      )}
    </div>
  );
}

// ─── Connected tab ───────────────────────────────────────────────────────────

function ConnectedTabContent({
  connectedProviders,
  onDisconnected,
  onAddProvider,
}: {
  connectedProviders: Provider[];
  onDisconnected?: () => void;
  onAddProvider: () => void;
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const filteredProviders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return connectedProviders;
    return connectedProviders.filter((provider) => {
      const label = (PROVIDER_LABELS[provider.id] || provider.name || provider.id).toLowerCase();
      return label.includes(q) || provider.id.toLowerCase().includes(q);
    });
  }, [connectedProviders, search]);

  const doDisconnect = useCallback(
    async (providerID: string) => {
      setDisconnecting(providerID);
      setConfirmDisconnect(null);
      try {
        const client = getClient();
        try {
          await client.auth.remove({ providerID });
        } catch (err) {
          const isEndpointMissing =
            err instanceof Error &&
            (err.message.includes('404') ||
              err.message.includes('405') ||
              err.message.includes('Not Found') ||
              err.message.includes('Method Not Allowed'));
          if (isEndpointMissing) {
            await client.auth.set({ providerID, auth: { type: 'api', key: '' } });
          } else {
            throw err;
          }
        }
        await client.global.dispose();
        await queryClient.refetchQueries({ queryKey: opencodeKeys.providers() });
        toast.success(`${PROVIDER_LABELS[providerID] || providerID} disconnected`);
        onDisconnected?.();
      } catch {
        toast.error('Failed to disconnect provider');
      } finally {
        setDisconnecting(null);
      }
    },
    [onDisconnected, queryClient],
  );

  return (
    <div className="flex h-full min-h-0 flex-col px-5 py-3">
      <div className="mb-3 flex items-center gap-2">
        <TabSearch value={search} onChange={setSearch} placeholder="Search connected..." />
        <Button variant="outline" size="sm" className="h-8 rounded-lg px-3 text-[11px]" onClick={onAddProvider}>
          <Plus className="h-3 w-3" />
          Add
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto space-y-2 pr-0.5">
        {filteredProviders.length === 0 ? (
          <EmptyState
            message={connectedProviders.length === 0 ? 'No providers connected yet' : 'No match'}
            action={{ label: 'Connect provider', onClick: onAddProvider }}
          />
        ) : (
          filteredProviders.map((provider) => {
            const modelCount = Object.keys(provider.models ?? {}).length;
            const isExpanded = expanded === provider.id;
            const isDisconnecting = disconnecting === provider.id;
            const source = (provider as { source?: string }).source;

            return (
              <div key={provider.id} className="overflow-hidden rounded-xl border border-border/40 bg-muted/15">
                <div className="flex items-center gap-3 px-3.5 py-3">
                  <ProviderLogo providerID={provider.id} name={provider.name} size="default" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {PROVIDER_LABELS[provider.id] || provider.name || provider.id}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-px text-[9px] font-medium text-emerald-600 dark:text-emerald-400">
                        <span className="h-1 w-1 rounded-full bg-emerald-500" />
                        connected
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground/50 mt-0.5">
                      {modelCount} model{modelCount === 1 ? '' : 's'}
                      {source ? ` · ${source}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmDisconnect(provider.id)}
                    disabled={isDisconnecting}
                    className="rounded-md p-1.5 text-muted-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                    title="Disconnect"
                  >
                    {isDisconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unplug className="h-3.5 w-3.5" />}
                  </button>
                </div>

                {modelCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setExpanded(isExpanded ? null : provider.id)}
                    className="flex w-full items-center gap-1 px-3.5 pb-2.5 text-left text-[11px] text-muted-foreground/50 transition-colors hover:text-foreground"
                  >
                    {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    {isExpanded ? 'Hide models' : 'Show models'}
                  </button>
                )}

                {isExpanded && (
                  <div className="border-t border-border/20 bg-background/40">
                    {Object.values(provider.models ?? {}).map((model: any) => (
                      <div key={model.id} className="px-3.5 py-1.5 text-xs text-muted-foreground/60 hover:bg-muted/20">
                        {model.name || model.id}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <AlertDialog open={!!confirmDisconnect} onOpenChange={(open) => !open && setConfirmDisconnect(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect provider?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              {confirmDisconnect && (
                <>
                  Remove <span className="font-medium text-foreground">{PROVIDER_LABELS[confirmDisconnect] || confirmDisconnect}</span>?
                  {' '}You&apos;ll need to reconnect it to use it again.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmDisconnect && doDisconnect(confirmDisconnect)} className="bg-destructive text-white hover:bg-destructive/90">
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Models tab ──────────────────────────────────────────────────────────────

function ModelsTabContent({
  models,
  modelStore,
  onAddProvider,
}: {
  models: FlatModel[];
  modelStore: ReturnType<typeof useModelStore>;
  onAddProvider: () => void;
}) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return models
      .filter(
        (model) =>
          !q ||
          model.modelName.toLowerCase().includes(q) ||
          model.modelID.toLowerCase().includes(q) ||
          model.providerName.toLowerCase().includes(q),
      )
      .sort((a, b) => a.modelName.localeCompare(b.modelName));
  }, [models, search]);

  const grouped = useMemo(() => {
    const groups = new Map<string, FlatModel[]>();
    for (const model of filtered) {
      const list = groups.get(model.providerID) || [];
      list.push(model);
      groups.set(model.providerID, list);
    }
    const entries = Array.from(groups.entries());
    entries.sort((a, b) => {
      const ai = MODEL_SELECTOR_PROVIDER_IDS.indexOf(a[0]);
      const bi = MODEL_SELECTOR_PROVIDER_IDS.indexOf(b[0]);
      if (ai >= 0 && bi < 0) return -1;
      if (ai < 0 && bi >= 0) return 1;
      if (ai >= 0 && bi >= 0) return ai - bi;
      return a[0].localeCompare(b[0]);
    });
    return entries;
  }, [filtered]);

  return (
    <div className="flex h-full min-h-0 flex-col px-5 py-3">
      <div className="mb-3 flex items-center gap-2">
        <TabSearch value={search} onChange={setSearch} placeholder="Search models..." />
        <Button variant="outline" size="sm" className="h-8 rounded-lg px-3 text-[11px]" onClick={onAddProvider}>
          <Plus className="h-3 w-3" />
          Add
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto space-y-3 pr-0.5">
        {grouped.length === 0 ? (
          <EmptyState message="No models found" />
        ) : (
          grouped.map(([providerID, providerModels]) => (
            <div key={providerID}>
              <div className="mb-1.5 flex items-center gap-2 px-0.5">
                <ProviderLogo providerID={providerID} name={providerModels[0]?.providerName || providerID} size="small" />
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                  {PROVIDER_LABELS[providerID] || providerModels[0]?.providerName || providerID}
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground/40">{providerModels.length}</span>
              </div>
              <div className="overflow-hidden rounded-xl border border-border/40 bg-muted/15 divide-y divide-border/20">
                {providerModels.map((model) => {
                  const key = { providerID: model.providerID, modelID: model.modelID };
                  const visible = modelStore.isVisible(key);
                  return (
                    <div
                      key={`${model.providerID}:${model.modelID}`}
                      className="flex items-center justify-between gap-3 px-3.5 py-2.5 transition-colors hover:bg-muted/25 cursor-pointer"
                      onClick={() => modelStore.setVisibility(key, !visible)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-foreground">{model.modelName}</div>
                        <div className="truncate text-[10px] text-muted-foreground/40 mt-0.5">{model.modelID}</div>
                      </div>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Switch checked={visible} onCheckedChange={(checked) => modelStore.setVisibility(key, checked)} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Provider Modal ──────────────────────────────────────────────────────────

export interface ProviderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: ProviderModalTab;
  providers: ProviderListResponse | undefined;
  models?: FlatModel[];
  onProviderConnected?: () => void;
}

export function ProviderModal({
  open,
  onOpenChange,
  defaultTab = 'providers',
  providers: providersProp,
  models,
  onProviderConnected,
}: ProviderModalProps) {
  const [tab, setTab] = useState<ProviderModalTab>(defaultTab);
  const { data: fetchedProviders } = useOpenCodeProviders();
  const providers = providersProp ?? fetchedProviders;

  useEffect(() => {
    if (open) setTab(defaultTab);
  }, [defaultTab, open]);

  const connectedProviders = useMemo(() => {
    if (!providers) return [];
    const connectedIds = new Set(providers.connected ?? []);
    return (providers.all ?? []).filter((provider) => connectedIds.has(provider.id));
  }, [providers]);

  const modelStore = useModelStore(models ?? []);
  const hasModelsTab = !!models?.length;
  const visibleTabs = hasModelsTab ? TAB_CONFIG : TAB_CONFIG.filter((tabItem) => tabItem.id !== 'models');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!grid h-[min(80vh,680px)] w-[calc(100vw-2rem)] max-w-[520px] grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden p-0 gap-0">
        <DialogHeader className="px-5 pb-2 pt-5">
          <DialogTitle className="text-sm font-semibold">LLM Providers</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground/60">
            Connect providers and manage which models appear in chat.
          </DialogDescription>
        </DialogHeader>

        {/* Tab bar */}
        <div className="px-5 pb-2">
          <div className="flex items-center gap-0.5 rounded-lg border border-border/30 bg-muted/20 p-0.5">
            {visibleTabs.map((tabItem) => (
              <button
                key={tabItem.id}
                type="button"
                onClick={() => setTab(tabItem.id)}
                className={cn(
                  'flex-1 rounded-md px-3 py-1.5 text-[11px] font-medium transition-all',
                  tab === tabItem.id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground/60 hover:text-foreground/80',
                )}
              >
                {tabItem.label}
                {tabItem.id === 'connected' && connectedProviders.length > 0 && (
                  <span className="ml-1 text-[10px] text-muted-foreground/40">{connectedProviders.length}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="min-h-0 overflow-hidden">
          {tab === 'providers' && (
            <div className="h-full overflow-y-auto">
              <ConnectProviderContent
                providers={providers}
                onClose={() => onOpenChange(false)}
                onProviderConnected={onProviderConnected}
              />
            </div>
          )}

          {tab === 'connected' && (
            <ConnectedTabContent
              connectedProviders={connectedProviders}
              onDisconnected={onProviderConnected}
              onAddProvider={() => setTab('providers')}
            />
          )}

          {tab === 'models' && hasModelsTab && (
            <ModelsTabContent
              models={models!}
              modelStore={modelStore}
              onAddProvider={() => setTab('providers')}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Global Provider Modal ───────────────────────────────────────────────────

export function GlobalProviderModal() {
  const { isOpen, defaultTab, closeProviderModal } = useProviderModalStore();
  const { data: providers } = useOpenCodeProviders();

  const models = useMemo(() => {
    if (!providers) return [];
    const connectedIds = new Set(providers.connected ?? []);
    const result: FlatModel[] = [];
    for (const provider of providers.all ?? []) {
      if (!connectedIds.has(provider.id)) continue;
      for (const [modelID, model] of Object.entries(provider.models ?? {})) {
        const caps = (model as any).capabilities;
        const modalities = (model as any).modalities;
        result.push({
          providerID: provider.id,
          providerName: provider.name,
          modelID,
          modelName: ((model as any).name || modelID).replace('(latest)', '').trim(),
          variants: (model as any).variants,
          capabilities: caps
            ? {
                reasoning: caps.reasoning ?? false,
                vision: caps.input?.image ?? false,
                toolcall: caps.toolcall ?? false,
              }
            : {
                reasoning: (model as any).reasoning ?? false,
                vision: modalities?.input?.includes('image') ?? false,
                toolcall: (model as any).tool_call ?? false,
              },
          contextWindow: (model as any).limit?.context,
          releaseDate: (model as any).release_date,
          family: (model as any).family,
          cost: (model as any).cost,
          providerSource: (provider as any).source,
        });
      }
    }
    return result;
  }, [providers]);

  if (!isOpen) return null;

  return (
    <ProviderModal
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) closeProviderModal();
      }}
      defaultTab={defaultTab}
      providers={providers}
      models={models.length > 0 ? models : undefined}
    />
  );
}
