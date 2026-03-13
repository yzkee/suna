/**
 * SandboxContext — provides sandboxUrl to the entire app after auth.
 *
 * 1. After login, calls useSandbox() to ensure user has a sandbox
 * 2. Mounts the SSE event stream once sandbox is ready
 * 3. Passes sandboxUrl down to all children via context
 */

import React, { createContext, useContext, useEffect } from 'react';
import { useSandbox } from '@/lib/platform/hooks';
import { useOpenCodeEventStream } from '@/lib/opencode/event-stream';
import { useAuthContext } from '@/contexts/AuthContext';
import { useSyncStore } from '@/lib/opencode/sync-store';
import { log } from '@/lib/logger';

interface SandboxContextValue {
  sandboxUrl: string | undefined;
  sandboxId: string | undefined;
  isLoading: boolean;
  error: Error | null;
}

const SandboxContext = createContext<SandboxContextValue>({
  sandboxUrl: undefined,
  sandboxId: undefined,
  isLoading: false,
  error: null,
});

export function useSandboxContext() {
  return useContext(SandboxContext);
}

export function SandboxProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();

  // Only fetch sandbox when user is fully authenticated (not loading, not anonymous)
  const shouldFetch = isAuthenticated === true && !authLoading;

  const { data, isLoading, error } = useSandbox(shouldFetch);

  // Derive values — only expose when authenticated
  const sandboxUrl = shouldFetch ? data?.sandboxUrl : undefined;
  const sandboxId = shouldFetch ? data?.sandboxId : undefined;

  // Mount SSE event stream globally (no-ops when sandboxUrl is undefined)
  useOpenCodeEventStream(sandboxUrl);

  // Reset sync store on logout
  useEffect(() => {
    if (!isAuthenticated) {
      useSyncStore.getState().reset();
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
        isLoading: shouldFetch ? isLoading : false,
        error: shouldFetch ? (error as Error | null) : null,
      }}
    >
      {children}
    </SandboxContext.Provider>
  );
}
