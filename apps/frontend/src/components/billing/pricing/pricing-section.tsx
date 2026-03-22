'use client';

import React, { useState, useCallback } from 'react';
import { Check, ShoppingCart, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { createCheckoutSession } from '@/lib/api/billing';
import { toast } from '@/lib/toast';
import { isBillingEnabled } from '@/lib/config';
import { useAccountState } from '@/hooks/billing';
import { useAuth } from '@/components/AuthProvider';
import { ScheduledDowngradeCard } from '@/components/billing/scheduled-downgrade-card';
import { CreditPurchaseModal } from '@/components/billing/credit-purchase';
import { GlobeRegionPicker } from '@/components/instance/globe-region-picker';
import { INSTANCE_CONFIG } from '@/components/instance/config';
import { getSizeLabel, formatMemory, formatDisk } from '@/components/instance/size-picker';
import { getServerTypes, type ServerType } from '@/lib/api/billing';

interface PricingSectionProps {
  returnUrl?: string;
  showTitleAndTabs?: boolean;
  hideFree?: boolean;
  insideDialog?: boolean;
  noPadding?: boolean;
  onSubscriptionUpdate?: () => void;
  customTitle?: string;
  isAlert?: boolean;
  alertTitle?: string;
  alertSubtitle?: string;
  showBuyCredits?: boolean;
  onboardingFlow?: boolean;
}

const INCLUDED = [
  '24/7 always-on cloud computer',
  'Full SSH & root access',
  '$10 LLM credits included',
  'All AI models available',
  'Persistent filesystem',
  'Unlimited agents & workflows',
];

export function PricingSection({
  returnUrl = typeof window !== 'undefined' ? window.location.href : '/',
  showTitleAndTabs = true,
  insideDialog = false,
  noPadding = false,
  onSubscriptionUpdate,
  customTitle,
  isAlert = false,
  alertTitle,
  alertSubtitle,
  showBuyCredits = false,
}: PricingSectionProps) {
  const { user } = useAuth();
  const isAuthenticated = !!user;
  const { data: accountState, refetch } = useAccountState({ enabled: isAuthenticated });

  const [isLoading, setIsLoading] = useState(false);
  const [showCreditPurchaseModal, setShowCreditPurchaseModal] = useState(false);
  const [location, setLocation] = useState(INSTANCE_CONFIG.defaultRegion);
  const [serverTypes, setServerTypes] = useState<ServerType[]>([]);
  const [selectedMachine, setSelectedMachine] = useState<string | null>(null);

  const isCurrent = accountState?.subscription?.tier_key === 'pro';

  const fetchTypes = React.useCallback(async (loc: string) => {
    try {
      const result = await getServerTypes(loc);
      setServerTypes(result.serverTypes);
      if (result.serverTypes.length > 0 && !selectedMachine) {
        setSelectedMachine(result.serverTypes[0].name);
      }
    } catch {
      setServerTypes([]);
    }
  }, [selectedMachine]);

  React.useEffect(() => {
    fetchTypes(location);
  }, [location, fetchTypes]);

  const handleSelect = useCallback(async () => {
    if (!isAuthenticated) {
      window.location.href = '/auth?mode=signup';
      return;
    }
    try {
      setIsLoading(true);
      const baseSuccessUrl = returnUrl.startsWith('http')
        ? returnUrl
        : `${window.location.origin}${returnUrl}`;
      const separator = baseSuccessUrl.includes('?') ? '&' : '?';
      const successUrlStr = `${baseSuccessUrl}${separator}location=${encodeURIComponent(location)}`;
      const response = await createCheckoutSession({
        tier_key: 'pro',
        success_url: successUrlStr,
        cancel_url: window.location.href,
        commitment_type: 'monthly',
      });
      if (response.url || response.checkout_url) {
        window.location.href = response.url || response.checkout_url!;
        return;
      }
      if (response.message) toast.success(response.message);
      await refetch();
      onSubscriptionUpdate?.();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update plan');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, returnUrl, location, refetch, onSubscriptionUpdate]);

  if (!isBillingEnabled()) {
    return (
      <div className="p-4 bg-foreground/[0.04] border border-foreground/[0.08] rounded-xl text-center">
        <p className="text-sm text-muted-foreground">Billing is disabled in this environment.</p>
      </div>
    );
  }

  const hasScheduledChange = accountState?.subscription.has_scheduled_change && accountState?.subscription.scheduled_change;

  return (
    <div className={cn('w-full', !insideDialog && !noPadding && 'py-8')}>

      {(isAlert || (showTitleAndTabs && customTitle)) && (
        <div className="px-8 sm:px-10 pt-8 sm:pt-10 pb-0">
          <h2 className="text-xl sm:text-2xl font-medium tracking-tight text-foreground">
            {alertTitle || customTitle || 'Upgrade your plan'}
          </h2>
          {alertSubtitle && <p className="text-sm text-muted-foreground/60 mt-1">{alertSubtitle}</p>}
        </div>
      )}

      {isAuthenticated && hasScheduledChange && accountState?.subscription.scheduled_change && (
        <div className="px-8 sm:px-10 pt-4">
          <ScheduledDowngradeCard
            scheduledChange={accountState.subscription.scheduled_change}
            variant="compact"
            onCancel={() => { void refetch(); onSubscriptionUpdate?.(); }}
          />
        </div>
      )}

      <div className={cn('flex flex-col', !insideDialog && 'md:flex-row md:items-center')}>

        {/* Left: Globe (hidden in dialog mode) */}
        {!insideDialog && (
          <div className="hidden md:flex w-[400px] shrink-0 p-6 pr-0">
            <GlobeRegionPicker location={location} onLocationChange={setLocation} />
          </div>
        )}

        {/* Plan details + CTA */}
        <div className={cn('flex-1 flex flex-col min-h-0', insideDialog ? 'p-8 sm:p-10' : 'p-6 md:p-8 md:py-10')}>

          {/* Plan header */}
          <div className="mb-6">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">
              Kortix Cloud
            </span>
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground mt-1">
              Kortix Computer
            </h2>
            <p className="text-sm text-muted-foreground/60 mt-1">
              Your 24/7 AI machine, managed by us.
            </p>
          </div>

          {/* Price */}
          <div className="flex items-baseline gap-2 mb-6">
            <span className="text-4xl font-semibold text-foreground tabular-nums tracking-tight">$20</span>
            <span className="text-sm text-muted-foreground/40">/month</span>
          </div>

          {/* Included machine */}
          {serverTypes.length > 0 && serverTypes[0] && (
            <div className="mb-6 flex items-center gap-3.5 px-3 py-2.5 rounded-xl border border-border/40 bg-muted/20">
              <div className="shrink-0 w-11 h-11 rounded-lg border bg-foreground text-background flex flex-col items-center justify-center">
                <span className="text-[15px] font-bold tabular-nums leading-none">{serverTypes[0].cores}</span>
                <span className="text-[8px] font-medium opacity-60 mt-0.5">vCPU</span>
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-[13px] font-semibold text-foreground">{getSizeLabel(serverTypes[0].cores)}</span>
                <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground/60">
                  <span>{formatMemory(serverTypes[0].memory)} RAM</span>
                  <span className="text-muted-foreground/20">{'\u00B7'}</span>
                  <span>{formatDisk(serverTypes[0].disk)} SSD</span>
                </div>
              </div>
              <span className="text-[12px] font-medium text-primary/70 shrink-0">Included</span>
            </div>
          )}

          {/* Features */}
          <div className="border-t border-border/30 pt-5 mb-8">
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
              {INCLUDED.map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <Check className="size-3.5 text-primary/50 mt-0.5 shrink-0" />
                  <span className="text-[13px] text-muted-foreground/65">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* CTA */}
          <div className="mt-auto space-y-3">
            <Button
              size="lg"
              className="w-full sm:w-auto h-12 px-10 text-sm rounded-xl shadow-none font-medium"
              disabled={isCurrent || isLoading}
              onClick={handleSelect}
            >
              {isLoading ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing...</>
              ) : isCurrent ? (
                'Current Plan'
              ) : (
                'Get Your Kortix'
              )}
            </Button>

            <p className="text-[11px] text-muted-foreground/30">
              Free to try &middot; No commitment &middot; Cancel anytime
            </p>

            {showBuyCredits && isAuthenticated && accountState?.subscription.can_purchase_credits && (
              <Button
                onClick={() => setShowCreditPurchaseModal(true)}
                variant="ghost"
                size="sm"
                className="gap-2 text-xs text-muted-foreground/40 hover:text-foreground"
              >
                <ShoppingCart className="h-3.5 w-3.5" />
                Get Additional Credits
              </Button>
            )}
          </div>
        </div>
      </div>

      <CreditPurchaseModal
        open={showCreditPurchaseModal}
        onOpenChange={setShowCreditPurchaseModal}
        currentBalance={accountState?.credits.total || 0}
        canPurchase={accountState?.subscription.can_purchase_credits || false}
        onPurchaseComplete={() => { void refetch(); onSubscriptionUpdate?.(); }}
      />
    </div>
  );
}
