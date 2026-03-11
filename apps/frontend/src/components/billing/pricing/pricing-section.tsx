'use client';

import React, { useState, useCallback } from 'react';
import Image from 'next/image';
import { Check, ShoppingCart, ChevronDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { createCheckoutSession } from '@/lib/api/billing';
import { toast } from '@/lib/toast';
import { isBillingEnabled } from '@/lib/config';
import { useAccountState } from '@/hooks/billing';
import { useAuth } from '@/components/AuthProvider';
import { ScheduledDowngradeCard } from '@/components/billing/scheduled-downgrade-card';
import { CreditPurchaseModal } from '@/components/billing/credit-purchase';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOCATIONS = [
  { id: 'ash',  label: 'US', sublabel: 'Ashburn',   flag: '🇺🇸' },
  { id: 'nbg1', label: 'EU', sublabel: 'Nuremberg', flag: '🇩🇪' },
] as const;
type LocationId = (typeof LOCATIONS)[number]['id'];

const MACHINES = [
  { id: 'ccx13', label: 'Starter',     vcpu: 2,  ram: 8,  disk: 80,  price: 20,  isDefault: true  },
  { id: 'ccx23', label: 'Standard',    vcpu: 4,  ram: 16, disk: 160, price: 49,  isDefault: false },
  { id: 'ccx33', label: 'Performance', vcpu: 8,  ram: 32, disk: 240, price: 99,  isDefault: false },
  { id: 'ccx43', label: 'Pro',         vcpu: 16, ram: 64, disk: 360, price: 199, isDefault: false },
] as const;
type MachineId = (typeof MACHINES)[number]['id'];

const INCLUDED = [
  '24/7 always-on AI Computer',
  'Full SSH & root access',
  'LLM compute credits included',
  'Multi-model — use any model',
  'Persistent memory & filesystem',
  'Unlimited agents & workflows',
  'OpenCode engine & MCP ecosystem',
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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
  const [location, setLocation] = useState<LocationId>('ash');
  const [selectedMachine, setSelectedMachine] = useState<MachineId>('ccx13');
  const [configOpen, setConfigOpen] = useState(false);

  const machine = MACHINES.find((m) => m.id === selectedMachine)!;
  const selectedLocation = LOCATIONS.find((l) => l.id === location)!;
  const isCurrent = accountState?.subscription?.tier_key === 'pro';

  // ------- checkout -------
  const handleSelect = useCallback(async () => {
    if (!isAuthenticated) {
      window.location.href = '/auth?mode=signup';
      return;
    }
    try {
      setIsLoading(true);
      // Build success URL carefully: returnUrl may contain Stripe template variables
      // like {CHECKOUT_SESSION_ID} that must NOT be percent-encoded by URLSearchParams.
      // Append extra params as raw query string fragments instead.
      const baseSuccessUrl = returnUrl.startsWith('http')
        ? returnUrl
        : `${window.location.origin}${returnUrl}`;
      const separator = baseSuccessUrl.includes('?') ? '&' : '?';
      const successUrlStr = `${baseSuccessUrl}${separator}location=${encodeURIComponent(location)}&server_type=${encodeURIComponent(selectedMachine)}`;
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
  }, [isAuthenticated, returnUrl, location, selectedMachine, refetch, onSubscriptionUpdate]);

  // ------- guard -------
  if (!isBillingEnabled()) {
    return (
      <div className="p-4 bg-foreground/[0.04] border border-foreground/[0.08] rounded-xl text-center">
        <p className="text-sm text-muted-foreground">Billing is disabled in this environment.</p>
      </div>
    );
  }

  const hasScheduledChange = accountState?.subscription.has_scheduled_change && accountState?.subscription.scheduled_change;
  const hasCustomConfig = !machine.isDefault || location !== 'ash';

  return (
    <div className={cn('w-full', !insideDialog && !noPadding && 'py-12')}>

      {/* ── Alert header (credit exhaustion etc.) ── */}
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

      {/* ── Two-column grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-2">

        {/* ─── Left: product visual + price + configure ─── */}
        <div className="flex flex-col p-8 sm:p-10 md:p-12 md:border-r border-border/30 bg-muted/20">

          {/* Product image */}
          <div className="flex-1 flex items-center justify-center">
            <div className="relative w-full max-w-[240px]">
              <Image
                src="/kortix-computer.png"
                alt="Kortix Computer"
                width={240}
                height={240}
                className="w-full h-auto object-contain select-none"
                draggable={false}
                priority
              />
            </div>
          </div>

          {/* Price */}
          <div className="text-center mt-8">
            <div className="flex items-baseline justify-center gap-1.5">
              <span className="text-4xl sm:text-5xl font-medium tracking-tight text-foreground leading-none">
                ${machine.price}
              </span>
              <span className="text-sm text-muted-foreground/50">/month</span>
            </div>
            <p className="text-[11px] text-muted-foreground/40 mt-2 leading-relaxed max-w-[260px] mx-auto">
              {machine.isDefault
                ? 'Starting price. Scale compute & credits as you grow.'
                : `${machine.label} — ${machine.vcpu} vCPU · ${machine.ram} GB RAM · ${machine.disk} GB SSD`}
            </p>
          </div>

          {/* Configure toggle */}
          <div className="mt-6">
            <button
              type="button"
              onClick={() => setConfigOpen((p) => !p)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-colors cursor-pointer text-left',
                configOpen
                  ? 'bg-foreground/[0.04] border-foreground/[0.08]'
                  : 'border-transparent hover:bg-foreground/[0.03]',
              )}
            >
              <ChevronDown className={cn('size-3.5 text-muted-foreground/40 transition-transform shrink-0', configOpen && 'rotate-180')} />
              <span className="text-[12px] text-muted-foreground/50">Configure machine & region</span>
              {hasCustomConfig && !configOpen && (
                <span className="ml-auto text-[11px] text-muted-foreground/60">
                  {!machine.isDefault && machine.label}
                  {!machine.isDefault && location !== 'ash' && ' · '}
                  {location !== 'ash' && `${selectedLocation.flag} ${selectedLocation.label}`}
                </span>
              )}
            </button>

            {configOpen && (
              <div className="mt-3 space-y-4 px-1 animate-in fade-in slide-in-from-top-1 duration-200">
                {/* Machine size */}
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground/40 mb-2">Machine</p>
                  <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-foreground/[0.03] border border-foreground/[0.06]">
                    {MACHINES.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setSelectedMachine(m.id)}
                        className={cn(
                          'flex flex-col items-center py-2.5 px-1 rounded-lg transition-all cursor-pointer text-center',
                          selectedMachine === m.id
                            ? 'bg-background text-foreground shadow-sm border border-foreground/[0.08]'
                            : 'text-muted-foreground/40 hover:text-muted-foreground/70 border border-transparent',
                        )}
                      >
                        <span className="text-xs font-medium leading-none">${m.price}</span>
                        <span className="text-[9px] mt-1.5 text-muted-foreground/40 leading-none">{m.vcpu}v · {m.ram}G</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Region */}
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground/40 mb-2">Region</p>
                  <div className="flex gap-2">
                    {LOCATIONS.map((loc) => (
                      <button
                        key={loc.id}
                        type="button"
                        onClick={() => setLocation(loc.id)}
                        className={cn(
                          'flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs transition-all cursor-pointer',
                          location === loc.id
                            ? 'bg-foreground/[0.04] border-foreground/[0.08] text-foreground/80'
                            : 'border-foreground/[0.04] text-muted-foreground/40 hover:text-muted-foreground/70 hover:border-foreground/[0.08]',
                        )}
                      >
                        <span>{loc.flag}</span>
                        <span className="font-medium">{loc.label}</span>
                        <span className="text-[10px] text-muted-foreground/35">{loc.sublabel}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── Right: product info + CTA ─── */}
        <div className="p-8 sm:p-10 md:p-12 flex flex-col">
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground/40 mb-4">
            Kortix Cloud
          </span>

          <h2 className="text-2xl sm:text-3xl font-medium tracking-tight text-foreground mb-1">
            Kortix Computer
          </h2>
          <p className="text-sm text-muted-foreground/55 mb-6">
            Your 24/7 AI machine, managed by us.
          </p>

          <div className="border-t border-border/30 mb-6" />

          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground/40 mb-3">
            Included
          </p>
          <ul className="space-y-2.5 flex-1">
            {INCLUDED.map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <Check className="size-3.5 text-foreground/25 mt-0.5 shrink-0" />
                <span className="text-[13px] text-muted-foreground/65">{item}</span>
              </li>
            ))}
          </ul>

          {/* CTA */}
          <div className="mt-auto pt-8">
            <Button
              size="lg"
              className="w-full h-12 text-sm rounded-xl shadow-none font-medium"
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

            <p className="text-[11px] text-center text-muted-foreground/30 mt-3">
              Free to try &middot; No commitment &middot; Cancel anytime
            </p>

            {showBuyCredits && isAuthenticated && accountState?.subscription.can_purchase_credits && (
              <div className="mt-3 flex justify-center">
                <Button
                  onClick={() => setShowCreditPurchaseModal(true)}
                  variant="ghost"
                  size="sm"
                  className="gap-2 text-xs text-muted-foreground/40 hover:text-foreground"
                >
                  <ShoppingCart className="h-3.5 w-3.5" />
                  Get Additional Credits
                </Button>
              </div>
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
