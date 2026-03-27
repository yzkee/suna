/**
 * SandboxContext — provides sandboxUrl to the entire app after auth.
 *
 * 1. After login, calls useSandbox() to ensure user has a sandbox
 * 2. Mounts the SSE event stream once sandbox is ready
 * 3. Passes sandboxUrl down to all children via context
 * 4. Supports switching to a different sandbox via switchSandbox()
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useSandbox } from '@/lib/platform/hooks';
import { getSandboxUrl, type SandboxInfo } from '@/lib/platform/client';
import { useOpenCodeEventStream } from '@/lib/opencode/event-stream';
import { useAuthContext } from '@/contexts/AuthContext';
import { useSyncStore } from '@/lib/opencode/sync-store';
import { log } from '@/lib/logger';

interface SandboxContextValue {
  sandboxUrl: string | undefined;
  sandboxId: string | undefined;
  sandboxName: string | undefined;
  isLoading: boolean;
  error: Error | null;
  switchSandbox: (sandbox: SandboxInfo) => void;
}

const SandboxContext = createContext<SandboxContextValue>({
  sandboxUrl: undefined,
  sandboxId: undefined,
  sandboxName: undefined,
  isLoading: false,
  error: null,
  switchSandbox: () => {},
});

export function useSandboxContext() {
  return useContext(SandboxContext);
}

export function SandboxProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();

  // Only fetch sandbox when user is fully authenticated (not loading, not anonymous)
  const shouldFetch = isAuthenticated === true && !authLoading;

  const { data, isLoading, error } = useSandbox(shouldFetch);

  // Override state — when user manually switches sandbox
  const [override, setOverride] = useState<{ sandboxUrl: string; sandboxId: string; sandboxName: string } | null>(null);

  const switchSandbox = useCallback((sandbox: SandboxInfo) => {
    const url = getSandboxUrl(sandbox.external_id);
    log.log('🔄 [SandboxContext] Switching to sandbox:', sandbox.external_id, '→', url);
    setOverride({ sandboxUrl: url, sandboxId: sandbox.external_id, sandboxName: sandbox.name });
  }, []);

  // Derive values — override takes precedence
  const sandboxUrl = override?.sandboxUrl ?? (shouldFetch ? data?.sandboxUrl : undefined);
  const sandboxId = override?.sandboxId ?? (shouldFetch ? data?.sandboxId : undefined);
  const sandboxName = override?.sandboxName ?? (shouldFetch ? data?.sandbox?.name : undefined);

  // Mount SSE event stream globally (no-ops when sandboxUrl is undefined)
  useOpenCodeEventStream(sandboxUrl);

  // Reset sync store on logout and clear override
  useEffect(() => {
    if (!isAuthenticated) {
      useSyncStore.getState().reset();
      setOverride(null);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (sandboxUrl) {
      log.log('✅ [SandboxContext] Sandbox ready:', sandboxUrl);
    }
    if (error && shouldFetch) {
      log.error('❌ [SandboxContext] Sandbox error:', error?.message || error);
    }
  }, [sandboxUrl, error, shouldFetch]);

  return (
    <SandboxContext.Provider
      value={{
        sandboxUrl,
        sandboxId,
        sandboxName,
        isLoading: shouldFetch ? isLoading : false,
        error: shouldFetch ? (error as Error | null) : null,
        switchSandbox,
      }}
    >
      {children}
    </SandboxContext.Provider>
  );
}
