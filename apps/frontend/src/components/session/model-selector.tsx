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

// ─── Backward-compat wrappers ────────────────────────────────────────────────

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

  const isStoreOpen = useProviderModalStore((s) => s.isOpen);
  useEffect(() => {
    if (!isStoreOpen && open) onOpenChange(false);
  }, [isStoreOpen, open, onOpenChange]);

  return null;
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Tag ─────────────────────────────────────────────────────────────────────

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

// ─── Model Tooltip ───────────────────────────────────────────────────────────

function ModelTooltipContent({ model, isLatest, isFree }: { model: FlatModel; isLatest: boolean; isFree: boolean }) {
  const tags: string[] = [];
  if (isLatest) tags.push('Latest');
  if (isFree) tags.push('Free');
  const suffix = tags.length ? ` (${tags.join(', ')})` : '';

  const caps: string[] = [];
  if (model.capabilities?.vision) caps.push('Image');
  if (model.capabilities?.reasoning) caps.push('Reasoning');
  if (model.capabilities?.toolcall) caps.push('Tool Use');

  return (
    <div className="flex flex-col gap-0.5 py-0.5 max-w-[220px]">
      <div className="text-xs font-medium">{model.providerName} {model.modelName}{suffix}</div>
      {caps.length > 0 && (
        <div className="text-[11px] text-muted-foreground">Supports: {caps.join(', ')}</div>
      )}
      {model.contextWindow && model.contextWindow > 0 && (
        <div className="text-[11px] text-muted-foreground">Context: {formatContext(model.contextWindow)}</div>
      )}
    </div>
  );
}

// ─── Model Row ───────────────────────────────────────────────────────────────

function ModelRow({
  model,
  isSelected,
  isHighlighted,
  isLatest,
  isFree,
  subtitle,
  onSelect,
  onHover,
}: {
  model: FlatModel;
  isSelected: boolean;
  isHighlighted: boolean;
  isLatest: boolean;
  isFree: boolean;
  subtitle: string;
  onSelect: () => void;
  onHover: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors cursor-pointer',
            (isHighlighted || isSelected)
              ? 'bg-muted/60'
              : 'hover:bg-muted/30',
          )}
          onClick={onSelect}
          onMouseEnter={onHover}
        >
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-[13px]">{model.modelName}</div>
            <div className="text-[11px] text-muted-foreground/50 truncate mt-0.5">{subtitle}</div>
          </div>
          {isFree && <Tag variant="free">Free</Tag>}
          {isSelected && <Check className="h-3.5 w-3.5 text-foreground flex-shrink-0" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" align="start" sideOffset={12} className="p-3">
        <ModelTooltipContent model={model} isLatest={isLatest} isFree={isFree} />
      </TooltipContent>
    </Tooltip>
  );
}

// ─── ModelSelector Popover ───────────────────────────────────────────────────

export interface ModelSelectorProps {
  models: FlatModel[];
  selectedModel: { providerID: string; modelID: string } | null;
  onSelect: (model: { providerID: string; modelID: string } | null) => void;
  providers?: ProviderListResponse;
}

export function ModelSelector({ models, selectedModel, onSelect }: ModelSelectorProps) {
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

  // ── Filtered + grouped models ──

  const visibleModels = useMemo(() => {
    const q = search.toLowerCase();
    return models
      .filter((m) => {
        if (!q && !modelStore.isVisible({ providerID: m.providerID, modelID: m.modelID })) return false;
        return !q || m.modelName.toLowerCase().includes(q) || m.modelID.toLowerCase().includes(q) || m.providerName.toLowerCase().includes(q);
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
        groups.set(m.providerID, { providerID: m.providerID, providerName: PROVIDER_LABELS[m.providerID] || m.providerName, models: [m] });
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

  const recommendedModels = useMemo(() => (search ? [] : getRecommendedModels(visibleModels)), [search, visibleModels]);
  const recommendedKeys = useMemo(() => new Set(recommendedModels.map((m) => `${m.providerID}:${m.modelID}`)), [recommendedModels]);

  const groupedWithoutRecommended = useMemo(
    () => grouped
      .map((g) => ({ ...g, models: g.models.filter((m) => !recommendedKeys.has(`${m.providerID}:${m.modelID}`)) }))
      .filter((g) => g.models.length > 0),
    [grouped, recommendedKeys],
  );

  const flatList = useMemo(
    () => [...recommendedModels, ...groupedWithoutRecommended.flatMap((g) => g.models)],
    [recommendedModels, groupedWithoutRecommended],
  );

  // ── Interaction ──

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50);
    else { setSearch(''); setHighlightedIndex(-1); }
  }, [open]);

  const handleSelect = useCallback(
    (model: FlatModel) => { onSelect({ providerID: model.providerID, modelID: model.modelID }); setOpen(false); },
    [onSelect],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      e.stopPropagation();
      const len = flatList.length;
      if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightedIndex((i) => (i < len - 1 ? i + 1 : 0)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightedIndex((i) => (i > 0 ? i - 1 : len - 1)); }
      else if (e.key === 'Enter' && highlightedIndex >= 0 && flatList[highlightedIndex]) { e.preventDefault(); handleSelect(flatList[highlightedIndex]); }
      else if (e.key === 'Escape') { setOpen(false); }
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
                  'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-200 cursor-pointer',
                  open && 'bg-muted text-foreground',
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
          className="w-[320px] p-0 overflow-hidden rounded-xl border border-border/40 bg-background shadow-xl"
        >
          <div className="flex flex-col max-h-[380px] overflow-hidden">
            {/* Search + actions */}
            <div className="flex items-center gap-1.5 p-2.5 border-b border-border/30 flex-shrink-0">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none" />
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="Search models..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full h-8 pl-8 pr-7 rounded-lg text-xs bg-muted/30 border-0 focus:outline-none focus:ring-1 focus:ring-ring/30 placeholder:text-muted-foreground/40 transition-colors"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => handleOpenProviderModal('providers')}
                    className="size-7 rounded-md flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">Connect provider</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => handleOpenProviderModal('models')}
                    className="size-7 rounded-md flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">Manage models</TooltipContent>
              </Tooltip>
            </div>

            {/* Model list */}
            <div className="flex-1 min-h-0 overflow-y-auto p-1.5">
              {flatList.length > 0 ? (
                <>
                  {/* Recommended section */}
                  {recommendedModels.length > 0 && (
                    <div className="mb-2 last:mb-0">
                      <div className="px-2 pb-1.5 pt-1">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                          Recommended
                        </span>
                      </div>
                      {recommendedModels.map((model) => {
                        flatIndex++;
                        const idx = flatIndex;
                        return (
                          <ModelRow
                            key={`${model.providerID}:${model.modelID}`}
                            model={model}
                            isSelected={selectedModel?.providerID === model.providerID && selectedModel?.modelID === model.modelID}
                            isHighlighted={idx === highlightedIndex}
                            isLatest={modelStore.isLatest({ providerID: model.providerID, modelID: model.modelID })}
                            isFree={model.providerID === 'opencode' && (!model.cost || model.cost.input === 0)}
                            subtitle={PROVIDER_LABELS[model.providerID] || model.providerName}
                            onSelect={() => handleSelect(model)}
                            onHover={() => setHighlightedIndex(idx)}
                          />
                        );
                      })}
                    </div>
                  )}

                  {/* Provider groups */}
                  {groupedWithoutRecommended.map((group) => (
                    <div key={group.providerID} className="mb-2 last:mb-0">
                      <div className="flex items-center gap-2 px-2 pb-1.5 pt-1">
                        <ProviderLogo providerID={group.providerID} name={group.providerName} size="small" />
                        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                          {PROVIDER_LABELS[group.providerID] || group.providerName}
                        </span>
                        <span className="ml-auto text-[10px] text-muted-foreground/30">
                          {group.models.length}
                        </span>
                      </div>
                      {group.models.map((model) => {
                        flatIndex++;
                        const idx = flatIndex;
                        return (
                          <ModelRow
                            key={`${model.providerID}:${model.modelID}`}
                            model={model}
                            isSelected={selectedModel?.providerID === model.providerID && selectedModel?.modelID === model.modelID}
                            isHighlighted={idx === highlightedIndex}
                            isLatest={modelStore.isLatest({ providerID: model.providerID, modelID: model.modelID })}
                            isFree={model.providerID === 'opencode' && (!model.cost || model.cost.input === 0)}
                            subtitle={model.modelID}
                            onSelect={() => handleSelect(model)}
                            onHover={() => setHighlightedIndex(idx)}
                          />
                        );
                      })}
                    </div>
                  ))}
                </>
              ) : (
                <div className="text-xs text-center py-8 text-muted-foreground/50">
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
