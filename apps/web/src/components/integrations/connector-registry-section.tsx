"use client";

import React from 'react';
import { Link, Terminal, KeyRound, Plug, Globe, FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useKortixConnectors, type KortixConnector } from '@/hooks/kortix/use-kortix-connectors';
import type { IntegrationConnection } from '@/hooks/integrations';

const SOURCE_CONFIG: Record<string, { icon: typeof Plug; label: string; color: string }> = {
  pipedream: { icon: Plug, label: 'Pipedream', color: 'text-emerald-500' },
  cli:       { icon: Terminal, label: 'CLI', color: 'text-blue-500' },
  'api-key': { icon: KeyRound, label: 'API Key', color: 'text-amber-500' },
  mcp:       { icon: Globe, label: 'MCP', color: 'text-purple-500' },
  custom:    { icon: FileText, label: 'Custom', color: 'text-muted-foreground' },
};

function ConnectorCard({
  connector,
  pipedreamConnections,
}: {
  connector: KortixConnector;
  pipedreamConnections: IntegrationConnection[];
}) {
  const source = connector.source || 'custom';
  const cfg = SOURCE_CONFIG[source] || SOURCE_CONFIG.custom!;
  const Icon = cfg.icon;

  // Check if this connector is actually live on Pipedream
  const slug = connector.pipedream_slug || connector.name;
  const liveConnection = pipedreamConnections.find(
    (c) => c.app === slug || c.app === connector.name || c.appName?.toLowerCase() === connector.name
  );
  const isLive = !!liveConnection;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-card px-4 py-3 transition-colors hover:bg-accent/30">
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/30 bg-muted/50 ${cfg.color}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{connector.name}</span>
          {isLive && (
            <span className="flex h-2 w-2 rounded-full bg-emerald-500" title="Connected" />
          )}
        </div>
        {connector.description && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">{connector.description}</p>
        )}
      </div>
      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal shrink-0">
        {cfg.label}
      </Badge>
    </div>
  );
}

export function ConnectorRegistrySection({
  pipedreamConnections,
}: {
  pipedreamConnections: IntegrationConnection[];
}) {
  const { data: connectors, isLoading } = useKortixConnectors();

  if (isLoading || !connectors || connectors.length === 0) return null;

  // Sort: live connections first, then alphabetical
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

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Your Connectors
        </h2>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
          {liveCount} live · {connectors.length} total
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        File-based registry of your connected services. Each connector is a <code className="text-[10px] bg-muted px-1 py-0.5 rounded">CONNECTOR.md</code> in your workspace.
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
