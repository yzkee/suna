'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getServerTypes, type ServerTypesResponse, type ServerType } from '@/lib/api/billing';
import { isBillingEnabled } from '@/lib/config';

// ─── Display pricing ────────────────────────────────────────────────────────
// Clean round prices for the 3 tiers we expose.  The API returns raw provider
// prices which are uneven ($39, $56, $77 …).  We override the display price
// (`priceMonthlyMarkup`) to the business-decided values below.
// The *actual* Stripe charge is computed server-side and may differ slightly.

const ALLOWED_TIERS = new Set(['pro', 'power', 'ultra']);

const DISPLAY_PRICES: Record<string, number> = {
  pro:   40,
  power: 60,
  ultra: 80,
};

/** Static fallback — used when the API is unreachable (e.g. guest on homepage). */
const fb = (name: string, cores: number, memory: number, disk: number, price: number, markup: number): ServerType => ({
  name, description: '', cores, memory, disk, cpuType: 'shared', architecture: 'x86', priceMonthly: price, priceMonthlyMarkup: markup, location: 'hel1',
});

const FALLBACK_TYPES: ServerType[] = [
  fb('pro',   8,  16, 320, 40, 40),
  fb('power', 12, 24, 480, 60, 60),
  fb('ultra', 16, 32, 640, 80, 80),
];

const FALLBACK: ServerTypesResponse = {
  serverTypes: FALLBACK_TYPES,
  location: 'hel1',
  defaultServerType: 'pro',
  defaultLocation: 'hel1',
};

/** Filter to allowed tiers and apply clean display pricing. */
function applyDisplayPricing(types: ServerType[]): ServerType[] {
  return types
    .filter((t) => ALLOWED_TIERS.has(t.name))
    .map((t) => ({
      ...t,
      priceMonthlyMarkup: DISPLAY_PRICES[t.name] ?? t.priceMonthlyMarkup,
    }));
}

export function useServerTypes(location: string) {
  const query = useQuery<ServerTypesResponse>({
    queryKey: ['server-types', location],
    queryFn: () => getServerTypes(location),
    enabled: isBillingEnabled(),
    retry: 1,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  // Memoize so consumers get a referentially-stable serverTypes array.
  // Without this, applyDisplayPricing() creates a new array every render,
  // which breaks downstream useMemo/useEffect dependency checks.
  const data = useMemo<ServerTypesResponse>(() => {
    const raw = query.data && query.data.serverTypes.length > 0 ? query.data : null;
    if (!raw) return FALLBACK;
    return {
      ...raw,
      serverTypes: applyDisplayPricing(raw.serverTypes),
      defaultServerType: 'pro',
      defaultLocation: 'hel1',
    };
  }, [query.data]);

  return {
    ...query,
    data,
    isLoading: query.isLoading && !query.isError,
  };
}
