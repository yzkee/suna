'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { buildInstancePath } from '@/lib/instance-routes';
import { KortixLoader } from '@/components/ui/kortix-loader';

/**
 * Legacy onboarding route — redirects to the dashboard.
 * Onboarding is now handled as a state within the dashboard layout itself,
 * so this page just forwards there.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  useEffect(() => {
    router.replace(buildInstancePath(id, '/dashboard'));
  }, [router, id]);

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <KortixLoader size="medium" />
    </div>
  );
}
