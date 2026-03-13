import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface NgrokStatus {
  detected: boolean;
  url: string | null;
  forwardPort: number | null;
  portMatches: boolean | null;
  ngrokInstalled: boolean;
}

export interface NgrokStartResult {
  started: boolean;
  alreadyRunning?: boolean;
  url: string | null;
  forwardPort?: number | null;
  error?: string;
}

/**
 * Detect running ngrok tunnel from the host machine.
 * Calls the Next.js server-side API route which probes localhost:4040.
 */
export function useNgrokStatus(port: number = 8008) {
  return useQuery({
    queryKey: ['ngrok-status', port],
    queryFn: async (): Promise<NgrokStatus> => {
      try {
        const res = await fetch(`/api/ngrok?port=${port}`, {
          signal: AbortSignal.timeout(5_000),
        });
        if (res.ok) {
          return await res.json() as NgrokStatus;
        }
      } catch { /* unreachable */ }
      return {
        detected: false,
        url: null,
        forwardPort: null,
        portMatches: null,
        ngrokInstalled: false,
      };
    },
    staleTime: 0,
    retry: false,
  });
}

/**
 * Auto-start ngrok on a given port.
 * Spawns ngrok via the Next.js server-side route and polls up to 15s.
 */
export function useNgrokStart() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ port }: { port: number }): Promise<NgrokStartResult> => {
      const res = await fetch('/api/ngrok', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port }),
        signal: AbortSignal.timeout(20_000),
      });
      const data = await res.json() as NgrokStartResult;
      if (!res.ok) {
        throw new Error(data.error || 'Failed to start ngrok');
      }
      return data;
    },
    onSuccess: () => {
      // Invalidate status queries so detection picks up the new tunnel
      queryClient.invalidateQueries({ queryKey: ['ngrok-status'] });
    },
  });
}
