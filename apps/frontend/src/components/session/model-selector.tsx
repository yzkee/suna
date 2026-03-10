'use client';

import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import {
  Search,
  ChevronUp,
  Check,
  X,
  Plus,
  SlidersHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import { useModelStore } from '@/hooks/opencode/use-model-store';
import type { FlatModel } from './session-chat-input';
import type { ProviderListResponse } from '@/hooks/opencode/use-opencode-sessions';
import {
  MODEL_SELECTOR_PROVIDER_IDS,
  PROVIDER_LABELS,
  ProviderLogo,
} from '@/components/providers/provider-branding';
import { useProviderModalStore } from '@/stores/provider-modal-store';
import type { ProviderModalTab } from '@/stores/provider-modal-store';

// Re-export for consumers
export { ConnectProviderContent } from '@/components/providers/connect-provider-content';

// ─── Backward-compat re-exports ───────────────────────────────────────────────
// Thin wrappers — delegate to the global ProviderModal via the store.

export function ConnectProviderDialog({
  open,
  onOpenChange,
  providers: _providers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: ProviderListResponse | undefined;
}) {
  const { openProviderModal, closeProviderModal } = useProviderModalStore();

  useEffect(() => {
    if (open) openProviderModal('providers');
    else closeProviderModal();
  }, [open, openProviderModal, closeProviderModal]);

  // Listen for store close → sync back
  const isStoreOpen = useProviderModalStore((s) => s.isOpen);
  useEffect(() => {
    if (!isStoreOpen && open) onOpenChange(false);
  }, [isStoreOpen, open, onOpenChange]);

  return null; // Rendered globally via GlobalProviderModal
}

export function ManageModelsDialog({
  open,
  onOpenChange,
  models: _models,
  modelStore: _modelStore,
  onConnectProvider: _onConnectProvider,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  models: FlatModel[];
  modelStore: ReturnType<typeof useModelStore>;
  onConnectProvider: () => void;
}) {
  const { openProviderModal, closeProviderModal } = useProviderModalStore();

  useEffect(() => {
    if (open) openProviderModal('models');
    else closeProviderModal();
  }, [open, openProviderModal, closeProviderModal]);

  const isStoreOpen = useProviderModalStore((s) => s.isOpen);
  useEffect(() => {
    if (!isStoreOpen && open) onOpenChange(false);
  }, [isStoreOpen, open, onOpenChange]);

  return null;
}

// =============================================================================
// Helpers
// =============================================================================

function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  return `${Math.round(tokens / 1000)}K`;
}

const RECOMMENDED_MODEL_MATCHERS = [
  {
    label: 'Sonnet 4.6',
    matches: (model: FlatModel) =>
      model.providerID === 'anthropic' &&
      (model.modelID === 'claude-sonnet-4-6' || model.modelName.toLowerCase().includes('sonnet 4.6')),
  },
  {
    label: 'Opus 4.6',
    matches: (model: FlatModel) =>
      model.providerID === 'anthropic' &&
      (model.modelID === 'claude-opus-4-6' || model.modelName.toLowerCase().includes('opus 4.6')),
  },
  {
    label: 'GLM-5',
    matches: (model: FlatModel) =>
      (model.providerID === 'zhipuai' || model.providerID === 'zhipuai-cn') &&
      (model.modelID.toLowerCase().includes('glm-5') || model.modelName.toLowerCase().includes('glm-5')),
  },
  {
    label: 'Kimi K2.5',
    matches: (model: FlatModel) => {
      const haystack = `${model.modelID} ${model.modelName}`.toLowerCase();
      return haystack.includes('kimi') && (haystack.includes('k2.5') || haystack.includes('k2'));
    },
  },
  {
    label: 'MiniMax M2.5',
    matches: (model: FlatModel) => {
      const haystack = `${model.modelID} ${model.modelName}`.toLowerCase();
      return haystack.includes('minimax') && haystack.includes('m2.5');
    },
  },
  {
    label: 'GPT-5.4',
    matches: (model: FlatModel) =>
      model.providerID === 'openai' &&
      (model.modelID === 'gpt-5.4' || model.modelName.toLowerCase().includes('gpt-5.4')),
  },
] as const;

function getRecommendedModels(models: FlatModel[]) {
  const used = new Set<string>();
  const recommended: FlatModel[] = [];

  for (const matcher of RECOMMENDED_MODEL_MATCHERS) {
    const match = models.find((model) => {
      const key = `${model.providerID}:${model.modelID}`;
      return !used.has(key) && matcher.matches(model);
    });
    if (!match) continue;
    used.add(`${match.providerID}:${match.modelID}`);
    recommended.push(match);
  }

  return recommended;
}

// =============================================================================
// Tag
// =============================================================================

export function Tag({ children, variant = 'default' }: { children: React.ReactNode; variant?: 'default' | 'free' | 'latest' | 'recommended' | 'custom' }) {
  return (
    <span
      className={cn(
        'px-1.5 py-0.5 rounded text-[10px] font-medium leading-none flex-shrink-0',
        variant === 'free' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
        variant === 'latest' && 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
        variant === 'recommended' && 'bg-primary/10 text-primary',
        variant === 'custom' && 'bg-muted text-muted-foreground',
        variant === 'default' && 'bg-muted text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

// =============================================================================
// Model Tooltip
// =============================================================================

function ModelTooltipContent({ model, isLatest, isFree }: { model: FlatModel; isLatest: boolean; isFree: boolean }) {
  const tags: string[] = [];
  if (isLatest) tags.push('Latest');
  if (isFree) tags.push('Free');
  const suffix = tags.length ? ` (${tags.join(', ')})` : '';

  const inputs: string[] = [];
  if (model.capabilities?.vision) inputs.push('Image');
  if (model.capabilities?.reasoning) inputs.push('Reasoning');
  if (model.capabilities?.toolcall) inputs.push('Tool Use');

  return (
    <div className="flex flex-col gap-0.5 py-0.5 max-w-[220px]">
      <div className="text-xs font-medium">{model.providerName} {model.modelName}{suffix}</div>
      {inputs.length > 0 && (
        <div className="text-[11px] text-muted-foreground">
          Supports: {inputs.join(', ')}
        </div>
      )}
      {model.capabilities?.reasoning !== undefined && (
        <div className="text-[11px] text-muted-foreground">
          {model.capabilities.reasoning ? 'Reasoning: allowed' : 'Reasoning: none'}
        </div>
      )}
      {model.contextWindow && model.contextWindow > 0 && (
        <div className="text-[11px] text-muted-foreground">
          Context: {formatContext(model.contextWindow)}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// ModelSelector Popover
// =============================================================================

export interface ModelSelectorProps {
  models: FlatModel[];
  selectedModel: { providerID: string; modelID: string } | null;
  onSelect: (model: { providerID: string; modelID: string } | null) => void;
  providers?: ProviderListResponse;
}

export function ModelSelector({ models, selectedModel, onSelect, providers }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const openProviderModal = useProviderModalStore((s) => s.openProviderModal);
  const searchRef = useRef<HTMLInputElement>(null);

  const modelStore = useModelStore(models);

  const current = models.find(
    (m) => m.providerID === selectedModel?.providerID && m.modelID === selectedModel?.modelID,
  );
  const displayName = current?.modelName || models[0]?.modelName || 'Model';

  const visibleModels = useMemo(() => {
    const q = search.toLowerCase();
    return models
      .filter((m) => {
        if (!q && !modelStore.isVisible({ providerID: m.providerID, modelID: m.modelID })) {
          return false;
        }
        return !q ||
          m.modelName.toLowerCase().includes(q) ||
          m.modelID.toLowerCase().includes(q) ||
          m.providerName.toLowerCase().includes(q);
      })
      .sort((a, b) => a.modelName.localeCompare(b.modelName));
  }, [models, search, modelStore]);

  const grouped = useMemo(() => {
    const groups = new Map<string, { providerName: string; providerID: string; models: FlatModel[] }>();
    for (const m of visibleModels) {
      const existing = groups.get(m.providerID);
      if (existing) {
        existing.models.push(m);
      } else {
        groups.set(m.providerID, {
          providerID: m.providerID,
          providerName: PROVIDER_LABELS[m.providerID] || m.providerName,
          models: [m],
        });
      }
    }
    const entries = Array.from(groups.values());
    entries.sort((a, b) => {
      const ai = MODEL_SELECTOR_PROVIDER_IDS.indexOf(a.providerID);
      const bi = MODEL_SELECTOR_PROVIDER_IDS.indexOf(b.providerID);
      if (ai >= 0 && bi < 0) return -1;
      if (ai < 0 && bi >= 0) return 1;
      if (ai >= 0 && bi >= 0) return ai - bi;
      return a.providerName.localeCompare(b.providerName);
    });
    return entries;
  }, [visibleModels]);

  const recommendedModels = useMemo(
    () => (search ? [] : getRecommendedModels(visibleModels)),
    [search, visibleModels],
  );

  const recommendedKeys = useMemo(
    () => new Set(recommendedModels.map((model) => `${model.providerID}:${model.modelID}`)),
    [recommendedModels],
  );

  const groupedWithoutRecommended = useMemo(
    () => grouped
      .map((group) => ({
        ...group,
        models: group.models.filter((model) => !recommendedKeys.has(`${model.providerID}:${model.modelID}`)),
      }))
      .filter((group) => group.models.length > 0),
    [grouped, recommendedKeys],
  );

  const flatList = useMemo(
    () => [...recommendedModels, ...groupedWithoutRecommended.flatMap((g) => g.models)],
    [recommendedModels, groupedWithoutRecommended],
  );

  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 50);
    } else {
      setSearch('');
      setHighlightedIndex(-1);
    }
  }, [open]);

  const handleSelect = useCallback(
    (model: FlatModel) => {
      onSelect({ providerID: model.providerID, modelID: model.modelID });
      setOpen(false);
    },
    [onSelect],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      e.stopPropagation();
      const len = flatList.length;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((i) => (i < len - 1 ? i + 1 : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((i) => (i > 0 ? i - 1 : len - 1));
      } else if (e.key === 'Enter' && highlightedIndex >= 0 && flatList[highlightedIndex]) {
        e.preventDefault();
        handleSelect(flatList[highlightedIndex]);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    },
    [flatList, highlightedIndex, handleSelect],
  );

  const handleOpenProviderModal = useCallback((tab: ProviderModalTab) => {
    setOpen(false);
    openProviderModal(tab);
  }, [openProviderModal]);

  let flatIndex = -1;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen} modal={false}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-200 cursor-pointer",
                  open && "bg-muted text-foreground",
                )}
              >
                <span className="truncate max-w-[120px]">{displayName}</span>
                <ChevronUp className={cn('size-3 opacity-50 transition-transform duration-200', open && 'rotate-180')} />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">Choose model</TooltipContent>
        </Tooltip>

        <PopoverContent
          side="top"
          align="start"
          sideOffset={8}
          className="w-[320px] p-0 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-background shadow-xl"
        >
          <div className="flex flex-col max-h-[380px] overflow-hidden">
            {/* Search bar */}
            <div className="flex items-center gap-2 p-3 border-b border-zinc-100 dark:border-zinc-800 flex-shrink-0">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="Search models..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full h-9 pl-9 pr-8 rounded-lg text-sm bg-zinc-50 dark:bg-zinc-900 border-0 focus:outline-none focus:ring-1 focus:ring-zinc-300 dark:focus:ring-zinc-700 placeholder:text-muted-foreground/50 transition-colors"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => handleOpenProviderModal('providers')}
                      className="size-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">Connect provider</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => handleOpenProviderModal('models')}
                      className="size-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">Manage models</TooltipContent>
                </Tooltip>
              </div>
            </div>

            {/* Model list */}
            <div className="flex-1 min-h-0 overflow-y-auto p-2">
              {flatList.length > 0 ? (
                <>
                  {recommendedModels.length > 0 && (
                    <div className="mb-3 last:mb-0">
                      <div className="flex items-center justify-between px-2 pb-2">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
                            Recommended
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            Best picks right now
                          </div>
                        </div>
                        <Tag variant="recommended">Starter Set</Tag>
                      </div>
                      {recommendedModels.map((model) => {
                        flatIndex++;
                        const idx = flatIndex;
                        const isSelected =
                          selectedModel?.providerID === model.providerID &&
                          selectedModel?.modelID === model.modelID;
                        const isHighlighted = idx === highlightedIndex;
                        const isLatestModel = modelStore.isLatest({ providerID: model.providerID, modelID: model.modelID });
                        const isFree = model.providerID === 'opencode' && (!model.cost || model.cost.input === 0);

                        return (
                          <Tooltip key={`${model.providerID}:${model.modelID}`}>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className={cn(
                                  'w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-left text-sm transition-colors cursor-pointer',
                                  (isHighlighted || isSelected) ? 'bg-zinc-100 dark:bg-zinc-800' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
                                )}
                                onClick={() => handleSelect(model)}
                                onMouseEnter={() => setHighlightedIndex(idx)}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="truncate font-medium">{model.modelName}</div>
                                  <div className="text-[11px] text-muted-foreground/60 truncate mt-0.5">
                                    {PROVIDER_LABELS[model.providerID] || model.providerName}
                                  </div>
                                </div>
                                <Tag variant="recommended">Recommended</Tag>
                                {isFree && <Tag variant="free">Free</Tag>}
                                {isLatestModel && <Tag variant="latest">New</Tag>}
                                {isSelected && <Check className="h-4 w-4 text-foreground flex-shrink-0" />}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="right" align="start" sideOffset={12} className="p-3">
                              <ModelTooltipContent model={model} isLatest={isLatestModel} isFree={isFree} />
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  )}

                  {groupedWithoutRecommended.map((group) => (
                  <div key={group.providerID} className="mb-3 last:mb-0">
                    <div className="flex items-center gap-2 px-2 pb-2">
                      <ProviderLogo providerID={group.providerID} name={group.providerName} size="small" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
                          {PROVIDER_LABELS[group.providerID] || group.providerName}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {group.models.length} {group.models.length === 1 ? 'model' : 'models'}
                        </div>
                      </div>
                    </div>
                    {group.models.map((model) => {
                      flatIndex++;
                      const idx = flatIndex;
                      const isSelected =
                        selectedModel?.providerID === model.providerID &&
                        selectedModel?.modelID === model.modelID;
                      const isHighlighted = idx === highlightedIndex;
                      const isLatestModel = modelStore.isLatest({ providerID: model.providerID, modelID: model.modelID });
                      const isFree = model.providerID === 'opencode' && (!model.cost || model.cost.input === 0);

                      return (
                        <Tooltip key={`${model.providerID}:${model.modelID}`}>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className={cn(
                                'w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-left text-sm transition-colors cursor-pointer',
                                (isHighlighted || isSelected) ? 'bg-zinc-100 dark:bg-zinc-800' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
                              )}
                              onClick={() => handleSelect(model)}
                              onMouseEnter={() => setHighlightedIndex(idx)}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-medium">{model.modelName}</div>
                                <div className="text-[11px] text-muted-foreground/60 truncate mt-0.5">
                                  {model.modelID}
                                </div>
                              </div>
                              {isFree && <Tag variant="free">Free</Tag>}
                              {isLatestModel && <Tag variant="latest">New</Tag>}
                              {isSelected && <Check className="h-4 w-4 text-foreground flex-shrink-0" />}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="right" align="start" sideOffset={12} className="p-3">
                            <ModelTooltipContent model={model} isLatest={isLatestModel} isFree={isFree} />
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                  ))}
                </>
              ) : (
                <div className="text-xs text-center py-8 text-muted-foreground/60">
                  No models found
                </div>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* ProviderModal is rendered globally via GlobalProviderModal */}
    </>
  );
}
