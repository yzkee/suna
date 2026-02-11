'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FlatModel } from './session-chat-input';
import type { ProviderListResponse } from '@/hooks/opencode/use-opencode-sessions';

interface ModelSelectorProps {
  models: FlatModel[];
  selectedModel?: { providerID: string; modelID: string } | null;
  onSelect: (model: { providerID: string; modelID: string } | null) => void;
  providers?: ProviderListResponse;
}

export function ModelSelector({
  models,
  selectedModel,
  onSelect,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  const currentModel = models.find(
    (m) =>
      m.providerID === selectedModel?.providerID &&
      m.modelID === selectedModel?.modelID,
  );
  const displayName = currentModel?.modelName || models[0]?.modelName || 'Model';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
      >
        <span className="truncate max-w-[120px]">{displayName}</span>
        <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 z-50 bg-popover border border-border rounded-xl shadow-lg overflow-hidden min-w-[200px]">
          <div className="max-h-48 overflow-y-auto py-1">
            {models.map((model) => {
              const isSelected =
                selectedModel?.providerID === model.providerID &&
                selectedModel?.modelID === model.modelID;
              return (
                <button
                  key={`${model.providerID}/${model.modelID}`}
                  onClick={() => {
                    onSelect({
                      providerID: model.providerID,
                      modelID: model.modelID,
                    });
                    setOpen(false);
                  }}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted/60 transition-colors cursor-pointer',
                    isSelected && 'bg-muted/40',
                  )}
                >
                  <span className="flex-1 text-left truncate">{model.modelName}</span>
                  {isSelected && (
                    <Check className="size-3.5 text-foreground shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
