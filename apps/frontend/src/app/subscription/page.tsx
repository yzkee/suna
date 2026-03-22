'use client';

import { useEffect, Suspense, lazy } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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

// Skeleton for immediate FCP
function SubscriptionSkeleton() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 flex items-center justify-center p-4">
      <Card className="w-full max-w-6xl">
        <CardHeader className="text-center">
          <Skeleton className="h-10 w-64 mx-auto mb-2" />
          <Skeleton className="h-6 w-96 mx-auto" />
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-3 gap-6">
            <Skeleton className="h-96 w-full" />
            <Skeleton className="h-96 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
        </CardContent>
      </Card>
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
          <Suspense fallback={
            <div className="flex items-center justify-center py-24">
              <Skeleton className="h-[500px] w-full rounded-2xl" />
            </div>
          }>
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
