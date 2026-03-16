"use client";

import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  CornerDownLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  CommandPopover,
  CommandPopoverTrigger,
  CommandPopoverContent,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandFooter,
  CommandKbd,
} from '@/components/ui/command';
import type { SandboxAgent } from '@/hooks/scheduled-tasks';

interface ScheduledTaskAgentSelectorProps {
  agents: SandboxAgent[];
  selectedAgent: string;
  onSelect: (agentName: string) => void;
  placeholder?: string;
  defaultLabel?: string;
}

export function ScheduledTaskAgentSelector({
  agents,
  selectedAgent,
  onSelect,
  placeholder = 'Default agent',
  defaultLabel = 'Default agent',
}: ScheduledTaskAgentSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const primaryAgents = useMemo(() => agents.filter((a) => a.mode !== 'subagent'), [agents]);
  const subAgents = useMemo(() => agents.filter((a) => a.mode === 'subagent'), [agents]);

  // Reset search when closing
  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  // Fuzzy filter
  const filteredPrimary = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return primaryAgents;
    return primaryAgents.filter((a) =>
      a.name.toLowerCase().includes(q) || (a.description || '').toLowerCase().includes(q),
    );
  }, [primaryAgents, search]);

  const filteredSub = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return subAgents;
    return subAgents.filter((a) =>
      a.name.toLowerCase().includes(q) || (a.description || '').toLowerCase().includes(q),
    );
  }, [subAgents, search]);

  const currentAgent = agents.find((a) => a.name === selectedAgent);
  const displayName = currentAgent?.name || placeholder;

  return (
    <CommandPopover open={open} onOpenChange={setOpen}>
      <CommandPopoverTrigger>
        <button
          type="button"
          className={cn(
            'inline-flex w-full items-center justify-between gap-1.5 h-9 px-3 rounded-md border border-input bg-background text-sm text-left',
            'hover:bg-muted/40 transition-colors',
            open && 'bg-muted/50',
          )}
        >
          <span className={cn('truncate', currentAgent ? 'text-foreground' : 'text-muted-foreground')}>
            {displayName}
          </span>
          <ChevronDown className={cn('size-4 opacity-50 transition-transform', open && 'rotate-180')} />
        </button>
      </CommandPopoverTrigger>

      <CommandPopoverContent side="bottom" align="start" sideOffset={4} className="w-[300px]">
        <CommandInput
        compact
        placeholder="Search agents..."
        value={search}
        onValueChange={setSearch}
      />

      <CommandList className="max-h-[320px]">
        {/* Default agent option */}
        <CommandGroup forceMount>
          <CommandItem
            value="default-agent"
            onSelect={() => {
              onSelect('');
              setOpen(false);
            }}
          >
            <span className="flex-1 truncate">{defaultLabel}</span>
            {!selectedAgent && <Check className="size-3.5 text-foreground shrink-0" />}
          </CommandItem>
        </CommandGroup>

        {/* Primary agents */}
        {filteredPrimary.length > 0 && (
          <CommandGroup heading="Agents" forceMount>
            {filteredPrimary.map((agent) => {
              const isSelected = selectedAgent === agent.name;
              return (
                <CommandItem
                  key={agent.name}
                  value={`agent-${agent.name}`}
                  onSelect={() => {
                    onSelect(agent.name);
                    setOpen(false);
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium truncate capitalize">{agent.name}</span>
                    </div>
                    {agent.description && (
                      <p className="text-[11px] text-muted-foreground/50 leading-snug mt-0.5 line-clamp-1">
                        {agent.description}
                      </p>
                    )}
                  </div>
                  {isSelected && <Check className="size-3.5 text-foreground shrink-0" />}
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {/* Sub-agents */}
        {filteredSub.length > 0 && (
          <CommandGroup heading="Subagents" forceMount>
            {filteredSub.map((agent) => {
              const isSelected = selectedAgent === agent.name;
              return (
                <CommandItem
                  key={agent.name}
                  value={`subagent-${agent.name}`}
                  onSelect={() => {
                    onSelect(agent.name);
                    setOpen(false);
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium truncate capitalize">{agent.name}</span>
                    </div>
                    {agent.description && (
                      <p className="text-[11px] text-muted-foreground/50 leading-snug mt-0.5 line-clamp-1">
                        {agent.description}
                      </p>
                    )}
                  </div>
                  {isSelected && <Check className="size-3.5 text-foreground shrink-0" />}
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {/* No results */}
        {filteredPrimary.length === 0 && filteredSub.length === 0 && search.trim() && (
          <div className="py-8 text-center text-xs text-muted-foreground/50">
            No agents match &ldquo;{search.trim()}&rdquo;
          </div>
        )}
      </CommandList>

      <CommandFooter>
        <div className="flex items-center gap-1">
          <ArrowUp className="h-3 w-3" />
          <ArrowDown className="h-3 w-3" />
          <span>navigate</span>
        </div>
        <div className="flex items-center gap-1">
          <CornerDownLeft className="h-3 w-3" />
          <span>select</span>
        </div>
        <div className="flex items-center gap-1">
          <CommandKbd>esc</CommandKbd>
          <span>close</span>
        </div>
      </CommandFooter>
      </CommandPopoverContent>
    </CommandPopover>
  );
}
