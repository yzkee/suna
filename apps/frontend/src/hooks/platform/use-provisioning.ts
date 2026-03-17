import { useState, useCallback, useRef, useEffect } from 'react';
import { getEnv } from '@/lib/env-config';
import { createClient as createBrowserSupabaseClient } from '@/lib/supabase/client';

export interface ProvisioningState {
  status: 'idle' | 'initializing' | 'provisioning' | 'ready' | 'error';
  progress: number;
  message: string;
  stage?: string;
  sandbox?: any;
  error?: string;
}

interface UseProvisioningOpts {
  provider?: string;
  onReady?: (sandbox: any) => void;
}

const POLL_INTERVAL = 3000;
const MAX_POLL_TIME = 10 * 60 * 1000;

function initialState(): ProvisioningState {
  return { status: 'idle', progress: 0, message: '' };
}

async function getJwt(jwtRef: React.MutableRefObject<string | null>): Promise<string | null> {
  if (jwtRef.current) return jwtRef.current;
  const supabase = createBrowserSupabaseClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function callInit(backendUrl: string, jwt: string, provider?: string) {
  const res = await fetch(`${backendUrl}/platform/init`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(provider ? { provider } : {}),
  });
  return res.json();
}

async function callInitStatus(backendUrl: string, jwt: string) {
  const res = await fetch(`${backendUrl}/platform/init/status`, {
    headers: { 'Authorization': `Bearer ${jwt}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export function useProvisioning(opts: UseProvisioningOpts = {}) {
  const [state, setState] = useState<ProvisioningState>(initialState);
  const pollingRef = useRef(false);
  const stoppedRef = useRef(false);
  const jwtRef = useRef<string | null>(null);

  const setJwt = useCallback((jwt: string) => {
    jwtRef.current = jwt;
  }, []);

  const stopPolling = useCallback(() => {
    stoppedRef.current = true;
    pollingRef.current = false;
  }, []);

  const startPolling = useCallback((backendUrl: string, jwt: string, onReady?: (sandbox: any) => void) => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    stoppedRef.current = false;

    const startTime = Date.now();

    const poll = async () => {
      if (stoppedRef.current) return;
      if (Date.now() - startTime > MAX_POLL_TIME) {
        setState({ status: 'error', progress: 0, message: 'Provisioning timed out', error: 'timeout' });
        pollingRef.current = false;
        return;
      }

      try {
        const data = await callInitStatus(backendUrl, jwt);
        if (!data) { schedulePoll(); return; }

        if (data.status === 'ready' && data.data) {
          setState({ status: 'ready', progress: 100, message: 'Ready', sandbox: data.data });
          pollingRef.current = false;
          onReady?.(data.data);
          return;
        }

        if (data.status === 'error') {
          setState({ status: 'error', progress: 0, message: data.message || 'Provisioning failed', error: data.message });
          pollingRef.current = false;
          return;
        }

        if (data.status === 'provisioning') {
          setState({
            status: 'provisioning',
            progress: data.progress ?? 10,
            message: data.message || 'Provisioning...',
            stage: data.stage,
          });
        }

        if (data.status === 'none') {
          setState({ status: 'idle', progress: 0, message: 'No sandbox found' });
          pollingRef.current = false;
          return;
        }

        schedulePoll();
      } catch {
        schedulePoll();
      }
    };

    const schedulePoll = () => {
      if (!stoppedRef.current) setTimeout(poll, POLL_INTERVAL);
    };

    poll();
  }, []);

  const start = useCallback(async () => {
    const backendUrl = getEnv().BACKEND_URL || 'http://localhost:8008/v1';
    const jwt = await getJwt(jwtRef);
    if (!jwt) {
      setState({ status: 'error', progress: 0, message: 'Not authenticated', error: 'auth' });
      return;
    }

    setState({ status: 'initializing', progress: 5, message: 'Initializing...' });

    try {
      const initData = await callInit(backendUrl, jwt, opts.provider);

      if (!initData.success) {
        setState({ status: 'error', progress: 0, message: initData.error || 'Failed to initialize', error: initData.error });
        return;
      }

      const sandbox = initData.data;

      if (sandbox?.status === 'active') {
        setState({ status: 'ready', progress: 100, message: 'Ready', sandbox });
        opts.onReady?.(sandbox);
        return;
      }

      setState({
        status: 'provisioning',
        progress: 10,
        message: 'Creating sandbox...',
        sandbox,
      });

      startPolling(backendUrl, jwt, opts.onReady);
    } catch (err: any) {
      setState({ status: 'error', progress: 0, message: err?.message || 'Network error', error: err?.message });
    }
  }, [opts.provider, opts.onReady, startPolling]);

  const retry = useCallback(() => {
    stopPolling();
    setState(initialState());
    start();
  }, [start, stopPolling]);

  const checkExisting = useCallback(async () => {
    const backendUrl = getEnv().BACKEND_URL || 'http://localhost:8008/v1';
    const jwt = await getJwt(jwtRef);
    if (!jwt) return;

    try {
      const data = await callInitStatus(backendUrl, jwt);
      if (!data) return;

      if (data.status === 'ready' && data.data) {
        setState({ status: 'ready', progress: 100, message: 'Ready', sandbox: data.data });
        opts.onReady?.(data.data);
        return;
      }

      if (data.status === 'provisioning') {
        setState({
          status: 'provisioning',
          progress: data.progress ?? 10,
          message: data.message || 'Provisioning...',
          stage: data.stage,
        });
        startPolling(backendUrl, jwt, opts.onReady);
        return;
      }

      if (data.status === 'error') {
        setState({ status: 'error', progress: 0, message: data.message || 'Failed', error: data.message });
      }
    } catch {
      // ignore
    }
  }, [opts.onReady, startPolling]);

  useEffect(() => {
    return () => { stoppedRef.current = true; };
  }, []);

  return { state, start, retry, checkExisting, setJwt, stopPolling };
}
