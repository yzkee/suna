'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Check, Loader2, ArrowRight, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { isBillingEnabled } from '@/lib/config';
import { createCheckoutSession, type ServerType } from '@/lib/api/billing';
import { useServerTypes } from '@/hooks/instance/use-server-types';
import { useAuth } from '@/components/AuthProvider';
import { INSTANCE_CONFIG } from '@/components/instance/config';
import { Skeleton } from '@/components/ui/skeleton';
import Image from 'next/image';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMem(gb: number) { return gb >= 1 ? `${gb} GB` : `${Math.round(gb * 1024)} MB`; }

function pickDefault(types: ServerType[], apiDefault?: string): string | null {
  if (!types.length) return null;
  return types.find((t) => t.cores === 4)?.name
    ?? (apiDefault ? types.find((t) => t.name === apiDefault)?.name : null)
    ?? types[0].name;
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export interface NewInstanceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnUrl?: string;
  title?: string;
}

export function NewInstanceModal({ open, onOpenChange, returnUrl, title }: NewInstanceModalProps) {
  const { user } = useAuth();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [showConfigure, setShowConfigure] = useState(false);

  const defaultReturnUrl = typeof window !== 'undefined' ? `${window.location.origin}/instances?subscription=success` : '/instances';
  const resolvedReturnUrl = returnUrl || defaultReturnUrl;

  const [location, setLocation] = useState<string>(INSTANCE_CONFIG.fallbackRegion);
  const [selected, setSelected] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: serverTypesData, isLoading: typesLoading } = useServerTypes(location);
  const serverTypes = React.useMemo(() => serverTypesData?.serverTypes ?? [], [serverTypesData?.serverTypes]);

  const defaultLocationApplied = useRef(false);
  useEffect(() => {
    if (!serverTypesData?.defaultLocation || defaultLocationApplied.current) return;
    defaultLocationApplied.current = true;
    if (serverTypesData.defaultLocation !== location) setLocation(serverTypesData.defaultLocation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverTypesData?.defaultLocation]);

  useEffect(() => {
    if (!serverTypes.length) return;
    setSelected(pickDefault(serverTypes, serverTypesData?.defaultServerType));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverTypes]);

  useEffect(() => { if (open) setError(null); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !isLoading) { e.preventDefault(); onOpenChange(false); } };
    document.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, isLoading, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const selectedType = serverTypes.find((t) => t.name === selected) || null;
  const LOCS = INSTANCE_CONFIG.regions;

  const handleLocationChange = useCallback((id: string) => {
    setLocation(id);
    setSelected(null);
  }, []);

  const handleCta = useCallback(async () => {
    // No auth gate — unauthenticated users go straight to Stripe Checkout
    // (guest checkout). Stripe collects the email. The webhook creates the account.
    try {
      setIsLoading(true);
      setError(null);
      const base = resolvedReturnUrl.startsWith('http') ? resolvedReturnUrl : `${window.location.origin}${resolvedReturnUrl}`;
      const sep = base.includes('?') ? '&' : '?';
      const response = await createCheckoutSession({
        tier_key: 'pro',
        success_url: `${base}${sep}location=${encodeURIComponent(location)}`,
        cancel_url: window.location.href,
        commitment_type: 'monthly',
        ...(selected ? { server_type: selected } : {}),
        location,
      });
      if (response.url || response.checkout_url) { window.location.href = response.url || response.checkout_url!; return; }
      if (response.status === 'subscription_created' || response.status === 'no_change') {
        toast.success(response.message || 'Your Kortix is on its way');
        onOpenChange(false);
        window.location.href = '/instances';
        return;
      }
      if (response.message) toast.success(response.message);
      onOpenChange(false);
    } catch (err: any) {
      // If API requires auth, redirect to signup
      if (err?.status === 401 || err?.message?.includes('auth')) {
        window.location.href = '/auth?mode=signup';
        return;
      }
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [selected, resolvedReturnUrl, location, onOpenChange]);

  if (!open || !isBillingEnabled()) return null;

  const price = selectedType ? `$${selectedType.priceMonthlyMarkup.toFixed(2)}` : '–';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !isLoading && onOpenChange(false)} />

      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative bg-background rounded-2xl border border-border overflow-hidden flex flex-col md:flex-row max-h-[90vh] outline-none animate-in fade-in-0 zoom-in-[0.97] duration-150"
      >
        {/* ─── Left: Product + Configure ─── */}
        <div className="hidden md:flex w-[300px] shrink-0 flex-col bg-neutral-50 dark:bg-neutral-950 border-r border-border">
          {/* Kortix Box */}
          <div className="flex-1 flex items-center justify-center p-6">
            <Image src="/kortix-computer.png" alt="Kortix Computer" width={220} height={220} className="object-contain" priority />
          </div>

          {/* Configure */}
          <div className="px-5 pb-5 space-y-3">
            <button
              type="button"
              onClick={() => setShowConfigure(!showConfigure)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <ChevronDown className={cn('size-3 transition-transform duration-200', showConfigure && 'rotate-180')} />
              Configure
            </button>

            {showConfigure && (
              <div className="space-y-3 animate-in fade-in slide-in-from-top-1 duration-150">
                {/* Sizes */}
                {typesLoading ? (
                  <Skeleton className="h-8 w-full rounded-md" />
                ) : serverTypes.length > 0 ? (
                  <div className="flex gap-1.5 flex-wrap">
                    {serverTypes.map((t) => (
                      <button
                        key={t.name}
                        type="button"
                        onClick={() => setSelected(t.name)}
                        className={cn(
                          'flex items-center gap-1.5 px-2 py-1 rounded-md border transition-all cursor-pointer text-[11px] tabular-nums',
                          selected === t.name
                            ? 'border-foreground bg-background text-foreground font-medium'
                            : 'border-transparent hover:border-border text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {t.cores}v · {fmtMem(t.memory)} · ${t.priceMonthlyMarkup.toFixed(0)}
                      </button>
                    ))}
                  </div>
                ) : null}

                {/* Region */}
                <div className="flex gap-1.5">
                  {LOCS.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => handleLocationChange(l.id)}
                      className={cn(
                        'flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded-md border transition-all cursor-pointer text-[11px]',
                        location === l.id
                          ? 'border-foreground bg-background text-foreground font-medium'
                          : 'border-transparent hover:border-border text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {l.icon} {l.shorthand}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── Right: Content ─── */}
        <div className="flex flex-col min-w-0 min-h-0 w-full md:w-[400px]">

          {/* Close */}
          <button onClick={() => onOpenChange(false)} className="absolute top-4 right-4 z-10 p-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors cursor-pointer" aria-label="Close">
            <X className="size-4" />
          </button>

          {/* Content */}
          <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-6 pb-5">

            {/* Mobile image + configure */}
            <div className="md:hidden mb-5">
              <div className="flex justify-center py-4 -mx-6 bg-neutral-50 dark:bg-neutral-950 border-b border-border">
                <Image src="/kortix-computer.png" alt="Kortix Computer" width={150} height={150} className="object-contain" />
              </div>
              <div className="mt-4 space-y-3">
                <button
                  type="button"
                  onClick={() => setShowConfigure(!showConfigure)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  <ChevronDown className={cn('size-3 transition-transform duration-200', showConfigure && 'rotate-180')} />
                  Configure
                </button>
                {showConfigure && (
                  <div className="space-y-3 animate-in fade-in slide-in-from-top-1 duration-150">
                    {serverTypes.length > 0 && (
                      <div className="flex gap-1.5 flex-wrap">
                        {serverTypes.map((t) => (
                          <button
                            key={t.name}
                            type="button"
                            onClick={() => setSelected(t.name)}
                            className={cn(
                              'flex items-center gap-1.5 px-2 py-1 rounded-md border transition-all cursor-pointer text-[11px] tabular-nums',
                              selected === t.name
                                ? 'border-foreground text-foreground font-medium'
                                : 'border-border text-muted-foreground',
                            )}
                          >
                            {t.cores}v · {fmtMem(t.memory)} · ${t.priceMonthlyMarkup.toFixed(0)}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-1.5">
                      {LOCS.map((l) => (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => handleLocationChange(l.id)}
                          className={cn(
                            'flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded-md border transition-all cursor-pointer text-[11px]',
                            location === l.id
                              ? 'border-foreground text-foreground font-medium'
                              : 'border-border text-muted-foreground',
                          )}
                        >
                          {l.icon} {l.shorthand}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Header */}
            <h2 className="text-lg font-medium tracking-tight text-foreground">{title || 'Your Kortix'}</h2>
            <p className="text-sm text-muted-foreground mt-1 mb-4">
              One machine. All your tools. Agents that run themselves.
            </p>

            {/* Features */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-2">
              {[
                'Always-on computer',
                'Runs while you sleep',
                '$5 in credits included',
                'Bring your own API key',
                'Persistent storage',
                'Full root access',
              ].map((f) => (
                <div key={f} className="flex items-center gap-1.5 py-0.5">
                  <Check className="size-3 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground">{f}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Works with Claude Code, ChatGPT, Gemini, and any OpenAI-compatible key.
            </p>

            {/* Error */}
            {error && (
              <div className="mt-4 rounded-lg border border-destructive bg-destructive/10 px-3 py-2.5">
                <p className="text-xs text-destructive">{error}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="shrink-0 border-t border-border px-6 py-4 flex items-center justify-between gap-4">
            <div>
              <div className="flex items-baseline gap-0.5">
                <span className="text-xl font-medium tabular-nums text-foreground">{price}</span>
                <span className="text-xs text-muted-foreground">/mo</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">Cancel anytime</p>
            </div>
            <Button className="h-10 px-6 text-sm rounded-lg font-medium" disabled={isLoading || !selected} onClick={handleCta}>
              {isLoading ? <Loader2 className="size-4 animate-spin" /> : <>Get Your Kortix<ArrowRight className="size-3.5 ml-1.5" /></>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
