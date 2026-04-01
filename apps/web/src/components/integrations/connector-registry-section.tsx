"use client";

import React, { useState } from 'react';
import { Terminal, KeyRound, Plug, Globe, FileText, ChevronDown, ChevronUp, ExternalLink, FolderOpen } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useKortixConnectors, type KortixConnector } from '@/hooks/kortix/use-kortix-connectors';
import type { IntegrationConnection } from '@/hooks/integrations';

const SOURCE_CONFIG: Record<string, { icon: typeof Plug; label: string; color: string }> = {
  pipedream: { icon: Plug,      label: 'Pipedream', color: 'text-emerald-500' },
  cli:       { icon: Terminal,  label: 'CLI',       color: 'text-blue-500' },
  'api-key': { icon: KeyRound,  label: 'API Key',   color: 'text-amber-500' },
  mcp:       { icon: Globe,     label: 'MCP',       color: 'text-purple-500' },
  custom:    { icon: FileText,  label: 'Custom',    color: 'text-muted-foreground' },
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function ConnectorCard({
  connector,
  pipedreamConnections,
}: {
  connector: KortixConnector;
  pipedreamConnections: IntegrationConnection[];
}) {
  const [expanded, setExpanded] = useState(false);
  const source = connector.source || 'custom';
  const cfg = SOURCE_CONFIG[source] || SOURCE_CONFIG.custom!;
  const Icon = cfg.icon;

  const slug = connector.pipedream_slug || connector.name;
  const liveConnection = pipedreamConnections.find(
    (c) => c.app === slug || c.app === connector.name || c.appName?.toLowerCase() === connector.name
  );
  const isLive = !!liveConnection;

  // Collect extra fields (not internal _ prefixed ones and not name/description/source)
  const extraFields = Object.entries(connector).filter(
    ([k, v]) => !k.startsWith('_') && !['name', 'description', 'source'].includes(k) && v
  );

  return (
    <div
      className="rounded-xl border border-border/50 bg-card transition-colors hover:border-border overflow-hidden cursor-pointer"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/30 bg-muted/50 ${cfg.color}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{connector.name}</span>
            {isLive && (
              <span className="flex h-2 w-2 rounded-full bg-emerald-500 shrink-0" title="Connected on Pipedream" />
            )}
          </div>
          {connector.description && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">{connector.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
            {cfg.label}
          </Badge>
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-3 pt-0 border-t border-border/30 space-y-2">
          {/* Extra fields */}
          {extraFields.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2">
              {extraFields.map(([k, v]) => (
                <div key={k} className="text-xs">
                  <span className="text-muted-foreground">{k}:</span>{' '}
                  <span className="font-mono text-foreground/80">{v}</span>
                </div>
              ))}
            </div>
          )}

          {/* Notes */}
          {connector._notes && (
            <p className="text-xs text-muted-foreground pt-1">{connector._notes}</p>
          )}

          {/* File path */}
          <div className="flex items-center gap-2 pt-1">
            <FolderOpen className="h-3 w-3 text-muted-foreground/50 shrink-0" />
            <code className="text-[10px] text-muted-foreground/70 font-mono truncate">
              {connector._path}
            </code>
          </div>

          {/* Modified time */}
          {connector._modified && (
            <div className="text-[10px] text-muted-foreground/50">
              Updated {timeAgo(connector._modified)}
            </div>
          )}

          {/* Live connection details */}
          {isLive && liveConnection && (
            <div className="flex items-center gap-2 pt-1">
              <span className="flex h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
              <span className="text-xs text-emerald-600">
                Live on Pipedream as <span className="font-mono">{liveConnection.app}</span>
                {liveConnection.label && ` — ${liveConnection.label}`}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ConnectorRegistrySection({
  pipedreamConnections,
}: {
  pipedreamConnections: IntegrationConnection[];
}) {
  const { data, isLoading } = useKortixConnectors();
  const connectors = data?.connectors;

  if (isLoading || !connectors || connectors.length === 0) return null;

  const sorted = [...connectors].sort((a, b) => {
    const aSlug = a.pipedream_slug || a.name;
    const bSlug = b.pipedream_slug || b.name;
    const aLive = pipedreamConnections.some(c => c.app === aSlug || c.app === a.name);
    const bLive = pipedreamConnections.some(c => c.app === bSlug || c.app === b.name);
    if (aLive !== bLive) return aLive ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const liveCount = sorted.filter(c => {
    const slug = c.pipedream_slug || c.name;
    return pipedreamConnections.some(pc => pc.app === slug || pc.app === c.name);
  }).length;

  // Group by source
  const bySource: Record<string, KortixConnector[]> = {};
  for (const c of sorted) {
    const s = c.source || 'custom';
    (bySource[s] ??= []).push(c);
  }

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Your Connectors
        </h2>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
          {liveCount} live · {connectors.length} registered
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        File-based registry in <code className="text-[10px] bg-muted px-1 py-0.5 rounded">.opencode/connectors/</code>. Click to expand details.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {sorted.map((c) => (
          <ConnectorCard
            key={c._dir}
            connector={c}
            pipedreamConnections={pipedreamConnections}
          />
        ))}
      </div>
    </div>
  );
}
