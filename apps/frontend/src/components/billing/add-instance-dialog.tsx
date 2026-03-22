'use client';

import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ChevronRight, ArrowLeft } from 'lucide-react';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { getServerTypes, createInstance, type ServerType } from '@/lib/api/billing';
import { toast } from '@/lib/toast';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateAccountState } from '@/hooks/billing';
import { Button } from '@/components/ui/button';
import type { COBEOptions } from 'cobe';

const Globe = lazy(() => import('@/components/ui/globe').then((m) => ({ default: m.Globe })));

const LOCATIONS = [
  { id: 'hil', label: 'United States', shorthand: 'US', icon: '🇺🇸', lat: 45.5231, lng: -122.6765, phi: 2.1, theta: 0.25 },
  { id: 'hel1', label: 'Europe', shorthand: 'EU', icon: '🇪🇺', lat: 60.1699, lng: 24.9384, phi: 5.85, theta: 0.35 },
] as const;

function formatMemory(gb: number): string {
  return gb >= 1 ? `${gb} GB` : `${Math.round(gb * 1024)} MB`;
}

function formatDisk(gb: number): string {
  return gb >= 1000 ? `${(gb / 1000).toFixed(0)} TB` : `${gb} GB`;
}

function formatPrice(price: number): string {
  return `$${price.toFixed(2)}`;
}

function useIsDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const check = () => setDark(document.documentElement.classList.contains('dark'));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

export function AddInstanceDialog() {
  const [step, setStep] = useState<'select' | 'review'>('select');
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState('hil');
  const [serverTypes, setServerTypes] = useState<ServerType[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const isDark = useIsDark();

  const queryClient = useQueryClient();
  const router = useRouter();

  const selectedLoc = LOCATIONS.find((l) => l.id === location) ?? LOCATIONS[0];
  const globeConfig = useMemo<COBEOptions>(() => ({
    width: 800,
    height: 800,
    onRender: () => {},
    devicePixelRatio: 2,
    phi: selectedLoc.phi,
    theta: selectedLoc.theta,
    dark: isDark ? 1 : 0,
    diffuse: isDark ? 0.4 : 1.2,
    mapSamples: 16000,
    mapBrightness: isDark ? 6 : 1.2,
    baseColor: isDark ? [0.3, 0.3, 0.3] : [0.95, 0.95, 0.95],
    markerColor: [0.3, 0.5, 1],
    glowColor: isDark ? [0.1, 0.1, 0.2] : [0.9, 0.9, 1],
    markers: LOCATIONS.map((loc) => ({
      location: [loc.lat, loc.lng] as [number, number],
      size: loc.id === location ? 0.08 : 0.03,
    })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [isDark]);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('open-add-instance-dialog', handler);
    return () => window.removeEventListener('open-add-instance-dialog', handler);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('open_add_instance') === '1') {
      setOpen(true);
      params.delete('open_add_instance');
      const newUrl = window.location.pathname + (params.toString() ? `?${params.toString()}` : '');
      window.history.replaceState({}, '', newUrl);
    }
  }, []);

  const fetchTypes = useCallback(async (loc: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await getServerTypes(loc);
      setServerTypes(result.serverTypes);
      if (result.serverTypes.length > 0) {
        setSelected(result.serverTypes[0].name);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load server types');
      setServerTypes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchTypes(location);
      setSelected(null);
      setStep('select');
      setError(null);
      setPortalUrl(null);
    }
  }, [open, location, fetchTypes]);

  const handleCreate = async () => {
    if (!selected) return;
    setCreating(true);
    setError(null);
    setPortalUrl(null);
    try {
      const result = await createInstance({
        provider: 'justavps',
        serverType: selected,
        location,
        backgroundProvisioning: true,
      });
      invalidateAccountState(queryClient, true, true);
      setOpen(false);
      const sandboxId = result?.data?.sandbox_id;
      if (sandboxId) {
        router.push(`/setting-up?mode=instance&sandbox_id=${sandboxId}`);
      } else {
        toast.success('Instance provisioning started. It should be ready in 2-3 minutes.');
      }
    } catch (err: any) {
      const code = err?.code ?? err?.data?.code;
      const msg: string = err?.message || '';
      if (code === 'no_payment_method') {
        const url = err?.data?.portal_url ?? null;
        setPortalUrl(url);
        setError(err?.message || 'No payment method on file.');
      } else if (/disabled|unavailable|not available/i.test(msg)) {
        setError(`${msg} Please select a different location.`);
        setStep('select');
      } else {
        setError(msg || 'Failed to create instance');
      }
    } finally {
      setCreating(false);
    }
  };

  const selectedType = serverTypes.find((t) => t.name === selected);
  const selectedLocation = LOCATIONS.find((loc) => loc.id === location);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-0 gap-0 overflow-hidden flex flex-col h-[min(92vh,600px)] w-[min(95vw,900px)] sm:max-w-[900px] rounded-2xl border-border/30">
        <div className="flex flex-1 min-h-0 h-full">

          {/* Left column — Globe */}
          <div className="hidden md:flex w-[400px] shrink-0 p-4 pr-0">
            <div className="rounded-2xl w-full h-full flex flex-col bg-muted/80 dark:bg-black/60 relative overflow-hidden">
              {/* Region label */}
              <div className="relative z-10 px-5 pt-5">
                <p className="text-[11px] font-semibold text-muted-foreground/60 dark:text-white/30 uppercase tracking-widest">
                  Region
                </p>
                <p className="text-sm font-medium text-foreground dark:text-white/80 mt-0.5">
                  {selectedLoc.label} <span className="font-normal">{selectedLoc.icon}</span>
                </p>
              </div>

              {/* Region toggle */}
              <div className="relative z-10 px-5 mt-4">
                <div className="flex items-center gap-0.5 p-1 rounded-full bg-background/80 dark:bg-white/10 backdrop-blur-xl border border-border/50 dark:border-white/10 shadow-sm w-fit">
                  {LOCATIONS.map((loc) => (
                    <button
                      key={loc.id}
                      type="button"
                      onClick={() => setLocation(loc.id)}
                      className={cn(
                        'px-5 py-1.5 rounded-full text-[13px] font-medium transition-all cursor-pointer',
                        location === loc.id
                          ? 'bg-foreground text-background dark:bg-white dark:text-black shadow-sm'
                          : 'text-muted-foreground hover:text-foreground dark:text-white/40 dark:hover:text-white/70',
                      )}
                    >
                      {loc.shorthand}
                    </button>
                  ))}
                </div>
              </div>

              {/* Globe — oversized, bottom half clipped by parent overflow-hidden */}
              <div className="relative h-[340px] mt-auto">
                <div className="absolute left-1/2 -translate-x-1/2 top-0 w-[560px] h-[560px]">
                  <Suspense fallback={null}>
                    <Globe
                      config={globeConfig}
                      autoRotate={false}
                      targetPhi={selectedLoc.phi}
                      targetTheta={selectedLoc.theta}
                      className="!static !w-full !h-full !max-w-none"
                    />
                  </Suspense>
                </div>
              </div>
            </div>
          </div>

          {/* Right column — Selection / Review */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Header */}
            <div className="px-6 pt-6 pb-4 shrink-0">
              <div className="flex items-center gap-3">
                {step === 'review' && (
                  <button
                    type="button"
                    onClick={() => setStep('select')}
                    className="flex items-center justify-center h-8 w-8 rounded-full hover:bg-muted/60 transition-colors -ml-1"
                  >
                    <ArrowLeft className="h-4 w-4 text-muted-foreground" />
                  </button>
                )}
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">
                    {step === 'select' ? 'New Instance' : 'Confirm'}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {step === 'select'
                      ? 'Choose your machine size.'
                      : 'Review your configuration.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Mobile-only region selector (no globe on mobile) */}
            <div className="md:hidden px-6 pb-4">
              <div className="flex items-center gap-0.5 p-1 rounded-full bg-muted/40 border border-border/30 w-fit">
                {LOCATIONS.map((loc) => (
                  <button
                    key={loc.id}
                    type="button"
                    onClick={() => setLocation(loc.id)}
                    className={cn(
                      'px-5 py-1.5 rounded-full text-[13px] font-medium transition-all cursor-pointer',
                      location === loc.id
                        ? 'bg-foreground text-background shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {loc.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="px-6 pb-6">
                {step === 'select' ? (
                  <div className="space-y-4">
                    {error && (
                      <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3">
                        <p className="text-[13px] text-destructive leading-relaxed">{error}</p>
                      </div>
                    )}

                    {loading && (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/40" />
                      </div>
                    )}

                    {!loading && serverTypes.length > 0 && (
                      <SizePicker
                        types={serverTypes}
                        selected={selected}
                        onSelect={setSelected}
                      />
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {selectedType && (
                      <div className="rounded-xl border border-border/50 overflow-hidden">
                        <div className="px-5 py-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-[13px] text-muted-foreground">Machine</span>
                            <span className="text-[13px] font-medium text-foreground">{selectedType.description || selectedType.name}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[13px] text-muted-foreground">Region</span>
                            <span className="text-[13px] text-foreground">{selectedLocation?.label ?? location}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[13px] text-muted-foreground">CPU</span>
                            <span className="text-[13px] text-foreground">{selectedType.cores} vCPU{selectedType.cores > 1 ? 's' : ''}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[13px] text-muted-foreground">Memory</span>
                            <span className="text-[13px] text-foreground">{formatMemory(selectedType.memory)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[13px] text-muted-foreground">Storage</span>
                            <span className="text-[13px] text-foreground">{formatDisk(selectedType.disk)} NVMe</span>
                          </div>
                        </div>
                        <div className="border-t border-border/40 bg-muted/20 px-5 py-3.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[13px] font-medium text-muted-foreground">Monthly</span>
                            <span className="text-base font-semibold text-foreground tracking-tight">
                              {formatPrice(selectedType.priceMonthlyMarkup)}
                              <span className="text-muted-foreground/50 font-normal text-[13px]">/mo</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {error && (
                      <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 space-y-2">
                        <p className="text-[13px] text-destructive">{error}</p>
                        {portalUrl && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full text-xs h-8 rounded-lg"
                            onClick={() => window.open(portalUrl, '_blank')}
                          >
                            Add payment method
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="shrink-0">
              <div className="flex items-center justify-between px-6 py-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
                <div>
                  {selectedType && (
                    <div className="flex items-baseline gap-1">
                      <span className="text-lg font-semibold text-foreground tracking-tight">
                        {formatPrice(selectedType.priceMonthlyMarkup)}
                      </span>
                      <span className="text-[13px] text-muted-foreground/50">/mo</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-2.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-lg h-9 px-4"
                    onClick={() => step === 'select' ? setOpen(false) : setStep('select')}
                    disabled={creating}
                  >
                    {step === 'select' ? 'Cancel' : 'Back'}
                  </Button>
                  <Button
                    size="sm"
                    className="rounded-lg h-9 px-5 font-medium"
                    onClick={step === 'select' ? () => setStep('review') : handleCreate}
                    disabled={!selected || creating}
                  >
                    {creating ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : step === 'select' ? (
                      <>
                        Continue
                        <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                      </>
                    ) : (
                      'Deploy'
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}

const SIZE_LABELS: Record<number, string> = {
  2: 'Small',
  3: 'Small',
  4: 'Medium',
  8: 'Large',
  12: 'XL',
  16: '2XL',
  32: '4XL',
};

function getSizeLabel(cores: number): string {
  return SIZE_LABELS[cores] || `${cores}x`;
}

function SizePicker({
  types,
  selected,
  onSelect,
}: {
  types: ServerType[];
  selected: string | null;
  onSelect: (name: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-1.5">
      {types.map((t) => {
        const isSelected = selected === t.name;
        const label = getSizeLabel(t.cores);
        return (
          <button
            key={t.name}
            type="button"
            onClick={() => onSelect(t.name)}
            className={cn(
              'flex items-center gap-3.5 w-full px-3 py-2.5 rounded-xl border text-left transition-all cursor-pointer',
              isSelected
                ? 'border-foreground/20 bg-foreground/[0.04] shadow-sm'
                : 'border-border/40 hover:bg-muted/40 hover:border-border/60',
            )}
          >
            {/* CPU core count */}
            <div className={cn(
              'shrink-0 w-11 h-11 rounded-lg border flex flex-col items-center justify-center',
              isSelected ? 'bg-foreground text-background' : 'bg-muted/60 text-foreground/70',
            )}>
              <span className="text-[15px] font-bold tabular-nums leading-none">{t.cores}</span>
              <span className="text-[8px] font-medium opacity-60 mt-0.5">vCPU</span>
            </div>

            {/* Name + specs */}
            <div className="flex-1 min-w-0">
              <span className="text-[13px] font-semibold text-foreground">{label}</span>
              <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground/60">
                <span>{formatMemory(t.memory)} RAM</span>
                <span className="text-muted-foreground/20">·</span>
                <span>{formatDisk(t.disk)} SSD</span>
              </div>
            </div>

            {/* Price */}
            <div className="shrink-0 text-right">
              <span className="text-[14px] font-semibold text-foreground tabular-nums tracking-tight">
                {formatPrice(t.priceMonthlyMarkup)}
              </span>
              <span className="text-[11px] text-muted-foreground/40">/mo</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
