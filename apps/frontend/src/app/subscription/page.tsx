'use client';

import { useEffect, Suspense, lazy } from 'react';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { KortixLogo } from '@/components/sidebar/kortix-logo';
import { createClient } from '@/lib/supabase/client';
import { clearUserLocalStorage } from '@/lib/utils/clear-local-storage';
import { useMaintenanceNoticeQuery } from '@/hooks/edge-flags';
import { useAdminRole } from '@/hooks/admin';
import { useAccountState } from '@/hooks/billing';

// Lazy load heavy components
const PricingSection = lazy(() => import('@/components/billing/pricing').then(mod => ({ default: mod.PricingSection })));
const MaintenancePage = lazy(() => import('@/components/maintenance/maintenance-page').then(mod => ({ default: mod.MaintenancePage })));

function SubscriptionSkeleton() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex items-center justify-between px-6 py-4 shrink-0">
        <Skeleton className="h-5 w-5 rounded" />
        <Skeleton className="h-8 w-20 rounded-lg" />
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-5xl mx-auto px-4">
          <div className="flex flex-col md:flex-row gap-6 py-8">
            <div className="hidden md:block w-[400px] shrink-0">
              <Skeleton className="w-full h-[460px] rounded-2xl" />
            </div>
            <div className="flex-1 space-y-6 py-10">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-10 w-28" />
              <div className="flex items-center gap-3.5 px-3 py-2.5 rounded-xl border border-border/40">
                <Skeleton className="w-11 h-11 rounded-lg" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="h-4 w-14" />
              </div>
              <div className="grid grid-cols-2 gap-3 pt-2">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-28" />
              </div>
              <Skeleton className="h-12 w-44 rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SubscriptionRequiredPage() {
  const router = useRouter();
  const { data: maintenanceNotice, isLoading: maintenanceLoading } = useMaintenanceNoticeQuery();
  const { data: adminRoleData, isLoading: isCheckingAdminRole } = useAdminRole();
  const { data: accountState, isLoading: isLoadingSubscription, refetch: refetchSubscription } = useAccountState({ enabled: true });
  const subscriptionData = accountState;
  const isAdmin = adminRoleData?.isAdmin ?? false;

  useEffect(() => {
    if (!isLoadingSubscription && subscriptionData) {
      // Skip redirect when ?preview=1 is set (for testing)
      if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('preview') === '1') return;

      const hasActiveSubscription = subscriptionData.subscription &&
        subscriptionData.subscription.status === 'active' &&
        !(subscriptionData.subscription as any).cancel_at_period_end;

      const hasActiveTrial = subscriptionData.subscription?.is_trial === true;

      const tierKey = subscriptionData.subscription?.tier_key || subscriptionData.tier?.name;
      const hasValidTier = tierKey && tierKey !== 'none';
      const isFreeTier = tierKey === 'free';

      if ((hasActiveSubscription && hasValidTier) || (hasActiveTrial && hasValidTier)) {
        router.push('/dashboard');
      } else if (isFreeTier) {
        router.push('/setting-up');
      }
    }
  }, [subscriptionData, isLoadingSubscription, router]);

  const handleSubscriptionUpdate = () => {
    setTimeout(() => {
      refetchSubscription();
    }, 1000);
  };

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    clearUserLocalStorage();
    router.push('/auth');
  };

  // Show skeleton immediately for FCP instead of blocking loader
  if (maintenanceNotice?.enabled && !maintenanceLoading && !isCheckingAdminRole && !isAdmin) {
    return (
      <Suspense fallback={<SubscriptionSkeleton />}>
        <MaintenancePage />
      </Suspense>
    );
  }

  // Show skeleton during initial load
  if (isLoadingSubscription || maintenanceLoading || isCheckingAdminRole) {
    return <SubscriptionSkeleton />;
  }

  const isTrialExpired = (subscriptionData as any)?.trial_status === 'expired' ||
    (subscriptionData as any)?.trial_status === 'cancelled' ||
    (subscriptionData as any)?.trial_status === 'used';

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Minimal top bar */}
      <div className="flex items-center justify-between px-6 py-4 shrink-0">
        <KortixLogo size={20} className="opacity-50" />
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className="gap-2 text-muted-foreground/50 hover:text-foreground"
        >
          <LogOut className="h-3.5 w-3.5" />
          Log Out
        </Button>
      </div>

      {/* Full-screen pricing */}
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-5xl mx-auto px-4">
          <Suspense fallback={null}>
            <PricingSection
              returnUrl={`${typeof window !== 'undefined' ? window.location.origin : ''}/setting-up?subscription=success&session_id={CHECKOUT_SESSION_ID}`}
              showTitleAndTabs={false}
              noPadding
              onSubscriptionUpdate={handleSubscriptionUpdate}
              onboardingFlow={true}
            />
          </Suspense>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-[12px] text-muted-foreground/30 py-4 shrink-0">
        Questions? <a href="mailto:support@kortix.com" className="underline hover:text-foreground/50">support@kortix.com</a>
      </div>
    </div>
  );
}
