'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * /subscription now redirects to /instances.
 * The checkout modal lives on the /instances page directly.
 * This page exists only for legacy links and Stripe return URLs.
 */
export default function SubscriptionRedirect() {
  const router = useRouter();

  useEffect(() => {
    // Preserve query params (subscription=success, session_id, etc.)
    const search = typeof window !== 'undefined' ? window.location.search : '';
    router.replace(`/instances${search}`);
  }, [router]);

  return null;
}
