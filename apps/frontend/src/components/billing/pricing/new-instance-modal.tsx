'use client';

/**
 * NewInstanceModal — single component for creating a new Kortix instance.
 *
 * Globe + region on the left. Machine picker + CTA on the right.
 * 1 instance = 1 Stripe subscription. Always creates a new one.
 */

import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { X, Check, Loader2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { isBillingEnabled } from '@/lib/config';
import { createCheckoutSession, type ServerType } from '@/lib/api/billing';
import { useServerTypes } from '@/hooks/instance/use-server-types';
import { useAuth } from '@/components/AuthProvider';
import { INSTANCE_CONFIG } from '@/components/instance/config';
import { Skeleton } from '@/components/ui/skeleton';

const Globe = lazy(() => import('@/components/ui/globe').then((m) => ({ default: m.Globe })));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SIZE_LABELS: Record<number, string> = { 2: 'Small', 3: 'Small', 4: 'Medium', 8: 'Large', 12: 'XL', 16: '2XL', 32: '4XL' };
function getSizeLabel(cores: number) { return SIZE_LABELS[cores] || `${cores}x`; }
function fmtMemory(gb: number) { return gb >= 1 ? `${gb} GB` : `${Math.round(gb * 1024)} MB`; }
function fmtDisk(gb: number) { return gb >= 1000 ? `${(gb / 1000).toFixed(0)} TB` : `${gb} GB`; }

function pickDefaultType(types: ServerType[], apiDefault?: string): string | null {
  if (!types.length) return null;
  return types.find((t) => t.cores === 4)?.name
    ?? (apiDefault ? types.find((t) => t.name === apiDefault)?.name : null)
    ?? types[0].name;
}

const FEATURES = [
  '24/7 always-on cloud computer',
  'Full SSH & root access',
  '$10 LLM credits included',
  'All AI models available',
  'Persistent filesystem',
  'Unlimited agents & workflows',
];

// ─── Globe panel ──────────────────────────────────────────────────────────────

function useIsDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const check = () => setDark(document.documentElement.classList.contains('dark'));
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

function GlobePanel({ location, onLocationChange }: { location: string; onLocationChange: (id: string) => void }) {
  const isDark = useIsDark();
  const LOCS = INSTANCE_CONFIG.regions;
  const sel = LOCS.find((l) => l.id === location) ?? LOCS[0];

  return (
    <div className="rounded-2xl w-full h-full flex flex-col bg-muted/80 dark:bg-black/60 relative overflow-hidden">
      <div className="relative z-10 px-5 pt-5">
        <p className="text-[11px] font-semibold text-muted-foreground/60 dark:text-white/30 uppercase tracking-widest">Region</p>
        <p className="text-sm font-medium text-foreground dark:text-white/80 mt-0.5">{sel.label} <span className="font-normal">{sel.icon}</span></p>
      </div>
      <div className="relative z-10 px-5 mt-4">
        <div className="flex items-center gap-0.5 p-1 rounded-full bg-background/80 dark:bg-white/10 backdrop-blur-xl border border-border/50 dark:border-white/10 shadow-sm w-fit">
          {LOCS.map((l) => (
            <button key={l.id} type="button" onClick={() => onLocationChange(l.id)}
              className={cn('px-5 py-1.5 rounded-full text-[13px] font-medium transition-all cursor-pointer',
                location === l.id ? 'bg-foreground text-background dark:bg-white dark:text-black shadow-sm' : 'text-muted-foreground hover:text-foreground dark:text-white/40 dark:hover:text-white/70',
              )}>
              {l.shorthand}
            </button>
          ))}
        </div>
      </div>
      <div className="relative h-[340px] mt-auto">
        <div className="absolute left-1/2 -translate-x-1/2 top-0 w-[560px] h-[560px]">
          <Suspense fallback={null}>
            <Globe
              config={{
                width: 800, height: 800, onRender: () => {}, devicePixelRatio: 2,
                phi: sel.phi, theta: sel.theta,
                dark: isDark ? 1 : 0, diffuse: isDark ? 0.4 : 1.2,
                mapSamples: 16000, mapBrightness: isDark ? 6 : 1.2,
                baseColor: (isDark ? [0.3, 0.3, 0.3] : [0.95, 0.95, 0.95]) as [number, number, number],
                markerColor: [0.3, 0.5, 1] as [number, number, number],
                glowColor: (isDark ? [0.1, 0.1, 0.2] : [0.9, 0.9, 1]) as [number, number, number],
                markers: LOCS.map((l) => ({ location: [l.lat, l.lng] as [number, number], size: l.id === location ? 0.08 : 0.03 })),
              }}
              autoRotate={false} targetPhi={sel.phi} targetTheta={sel.theta}
              className="!static !w-full !h-full !max-w-none"
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

// ─── Region toggle (mobile) ───────────────────────────────────────────────────

function RegionToggle({ location, onLocationChange }: { location: string; onLocationChange: (id: string) => void }) {
  const LOCS = INSTANCE_CONFIG.regions;
  return (
    <div className="flex items-center gap-0.5 p-1 rounded-full bg-muted/40 border border-border/30 w-fit">
      {LOCS.map((l) => (
        <button key={l.id} type="button" onClick={() => onLocationChange(l.id)}
          className={cn('px-4 py-1.5 rounded-full text-[12px] font-medium transition-all cursor-pointer',
            location === l.id ? 'bg-foreground text-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}>
          {l.shorthand}
        </button>
      ))}
    </div>
  );
}

// ─── Machine picker ───────────────────────────────────────────────────────────

function MachinePicker({ types, selected, onSelect, isLoading }: {
  types: ServerType[]; selected: string | null; onSelect: (name: string) => void; isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3.5 px-3 py-2.5 rounded-xl border border-border/40">
            <Skeleton className="w-11 h-11 rounded-lg shrink-0" />
            <div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-16" /><Skeleton className="h-3 w-28" /></div>
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    );
  }
  if (!types.length) return null;
  return (
    <div className="space-y-1.5">
      {types.map((t) => {
        const active = selected === t.name;
        return (
          <button key={t.name} type="button" onClick={() => onSelect(t.name)}
            className={cn(
              'flex items-center gap-3.5 w-full px-3 py-2.5 rounded-xl border text-left transition-all cursor-pointer',
              active ? 'border-foreground/20 bg-foreground/[0.04] shadow-sm' : 'border-border/40 hover:bg-muted/40 hover:border-border/60',
            )}>
            <div className={cn('size-4 rounded-full border-[1.5px] flex items-center justify-center shrink-0 transition-colors',
              active ? 'border-foreground bg-foreground' : 'border-border/60')}>
              {active && <Check className="size-2.5 text-background" />}
            </div>
            <div className={cn('shrink-0 w-11 h-11 rounded-lg border flex flex-col items-center justify-center',
              active ? 'bg-foreground text-background' : 'bg-muted/60 text-foreground/70')}>
              <span className="text-[15px] font-bold tabular-nums leading-none">{t.cores}</span>
              <span className="text-[8px] font-medium opacity-60 mt-0.5">vCPU</span>
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-[13px] font-semibold text-foreground">{getSizeLabel(t.cores)}</span>
              <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground/60">
                <span>{fmtMemory(t.memory)} RAM</span>
                <span className="text-muted-foreground/20">·</span>
                <span>{fmtDisk(t.disk)} SSD</span>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <span className="text-[14px] font-semibold tabular-nums tracking-tight text-foreground">${t.priceMonthlyMarkup.toFixed(2)}</span>
              <span className="text-[11px] text-muted-foreground/40">/mo</span>
            </div>
          </button>
        );
      })}
    </div>
  );
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
  const isAuthenticated = !!user;
  const dialogRef = useRef<HTMLDivElement>(null);

  const defaultReturnUrl = typeof window !== 'undefined' ? `${window.location.origin}/instances?subscription=success` : '/instances';
  const resolvedReturnUrl = returnUrl || defaultReturnUrl;

  const [location, setLocation] = useState<string>(INSTANCE_CONFIG.fallbackRegion);
  const [selected, setSelected] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: serverTypesData, isLoading: typesLoading } = useServerTypes(location);
  const serverTypes = React.useMemo(() => serverTypesData?.serverTypes ?? [], [serverTypesData?.serverTypes]);

  // Auto-apply default location (once)
  const defaultLocationApplied = useRef(false);
  useEffect(() => {
    if (!serverTypesData?.defaultLocation || defaultLocationApplied.current) return;
    defaultLocationApplied.current = true;
    if (serverTypesData.defaultLocation !== location) setLocation(serverTypesData.defaultLocation);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverTypesData?.defaultLocation]);

  // Auto-select preferred machine size
  useEffect(() => {
    if (!serverTypes.length) return;
    setSelected(pickDefaultType(serverTypes, serverTypesData?.defaultServerType));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverTypes]);

  // Reset error on open
  useEffect(() => { if (open) setError(null); }, [open]);

  // ESC to close + focus trap
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) { e.preventDefault(); onOpenChange(false); }
    };
    document.addEventListener('keydown', onKey);
    // Auto-focus dialog for immediate keyboard access
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, isLoading, onOpenChange]);

  // Lock body scroll when open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const selectedType = serverTypes.find((t) => t.name === selected) || null;

  const handleLocationChange = useCallback((id: string) => {
    setLocation(id);
    setSelected(null);
  }, []);

  const handleCta = useCallback(async () => {
    if (!selected) return;
    if (!isAuthenticated) { window.location.href = '/auth?mode=signup'; return; }
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
        server_type: selected,
        location,
      });
      if (response.url || response.checkout_url) { window.location.href = response.url || response.checkout_url!; return; }
      if (response.status === 'subscription_created') {
        toast.success(response.message || 'Instance purchase successful');
        onOpenChange(false);
        window.location.href = '/instances';
        return;
      }
      if (response.message) toast.success(response.message);
      onOpenChange(false);
    } catch (err: any) {
      setError(err?.message || 'Failed to start checkout');
    } finally {
      setIsLoading(false);
    }
  }, [selected, isAuthenticated, resolvedReturnUrl, location, onOpenChange]);

  if (!open || !isBillingEnabled()) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6" role="dialog" aria-modal="true" aria-label="Create Instance">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in-0 duration-150" onClick={() => !isLoading && onOpenChange(false)} />

      {/* Dialog */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative w-full max-w-[900px] bg-background rounded-2xl border border-border/30 overflow-hidden shadow-2xl flex max-h-[92vh] outline-none animate-in fade-in-0 zoom-in-95 duration-200"
      >
        {/* Left: Globe */}
        <div className="hidden md:flex w-[400px] shrink-0 p-4 pr-0">
          <GlobePanel location={location} onLocationChange={handleLocationChange} />
        </div>

        {/* Right: Content */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* Header */}
          <div className="shrink-0 px-6 pt-6 pb-4 flex items-start justify-between gap-4">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">Kortix Cloud</span>
              <h2 className="text-xl font-semibold tracking-tight mt-0.5">{title || 'Create Instance'}</h2>
              <p className="text-sm text-muted-foreground/60 mt-0.5">Your 24/7 AI machine, managed by us.</p>
            </div>
            <button
              onClick={() => onOpenChange(false)}
              className="shrink-0 p-2 rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-accent/50 transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Mobile region toggle */}
          <div className="md:hidden px-6 pb-3">
            <RegionToggle location={location} onLocationChange={handleLocationChange} />
          </div>

          {/* Body */}
          <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4 space-y-5">
            {/* Features */}
            <div className="border-t border-border/30 pt-4">
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                {FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <Check className="size-3.5 text-primary/50 mt-0.5 shrink-0" />
                    <span className="text-[13px] text-muted-foreground/65">{f}</span>
                  </li>
                ))}
              </ul>
            </div>
            {/* Machine picker */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/40 mb-2">Choose your machine</p>
              {error && (
                <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 mb-3">
                  <p className="text-[13px] text-destructive">{error}</p>
                </div>
              )}
              <MachinePicker types={serverTypes} selected={selected} onSelect={setSelected} isLoading={typesLoading} />
            </div>
          </div>

          {/* Footer */}
          <div className="shrink-0 border-t border-border/20 px-6 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                {selectedType ? (
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg font-semibold text-foreground tracking-tight">${selectedType.priceMonthlyMarkup.toFixed(2)}</span>
                    <span className="text-[13px] text-muted-foreground/50">/mo</span>
                  </div>
                ) : (
                  <div className="h-6" />
                )}
                <p className="text-[11px] text-muted-foreground/30">No commitment · Cancel anytime</p>
              </div>
              <Button size="lg" className="h-12 px-10 text-sm rounded-xl font-medium" disabled={isLoading || !selected} onClick={handleCta}>
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><span>Create Instance</span><ArrowRight className="h-4 w-4 ml-2" /></>}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
