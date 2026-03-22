'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { backendApi } from '@/lib/api-client';
import { useServerStore } from '@/stores/server-store';

interface SetupConnectProps {
  onConnected: () => void;
  error?: string;
}

export function SetupConnect({ onConnected, error: externalError }: SetupConnectProps) {
  const [url, setUrl] = useState('http://localhost:8008/v1/p/kortix-sandbox/8000');
  const [label, setLabel] = useState('Local Instance');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');

  const displayError = externalError || error;

  const handleConnect = async () => {
    const trimmedUrl = url.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(trimmedUrl)) {
      setError('Instance URL must start with http:// or https://');
      return;
    }

    setConnecting(true);
    setError('');
    try {
      const id = (globalThis.crypto?.randomUUID?.() ?? `server_${Date.now()}`) as string;
      const finalLabel = label.trim() || trimmedUrl.replace(/^https?:\/\//, '');

      await backendApi.post('/servers', { id, label: finalLabel, url: trimmedUrl, isDefault: false });

      useServerStore.setState((state) => ({
        servers: state.servers.some((s) => s.id === id)
          ? state.servers
          : [...state.servers, { id, label: finalLabel, url: trimmedUrl, isDefault: false }],
        activeServerId: id,
        userSelected: true,
      }));

      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect instance');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <>
      {displayError && <p className="text-sm text-red-400 text-center mb-6">{displayError}</p>}
      <Card className="w-full bg-card border border-border py-0 gap-0">
        <CardContent className="p-6 space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-foreground/70">Instance URL</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm"
              placeholder="http://localhost:8008/v1/p/kortix-sandbox/8000"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-foreground/70">Label (optional)</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm"
              placeholder="My local instance"
            />
          </div>
          <Button onClick={handleConnect} disabled={connecting} className="w-full">
            {connecting ? 'Connecting...' : 'Connect Instance & Continue'}
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
