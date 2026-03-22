'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ChevronRight, ArrowLeft } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getServerTypes, createInstance, type ServerType } from '@/lib/api/billing';
import { toast } from '@/lib/toast';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateAccountState } from '@/hooks/billing';
import { GlobeRegionPicker, RegionToggle, LOCATIONS } from '@/components/instance/globe-region-picker';
import { INSTANCE_CONFIG } from '@/components/instance/config';
import { SizePicker, formatPrice } from '@/components/instance/size-picker';

function formatMemory(gb: number): string {
  return gb >= 1 ? `${gb} GB` : `${Math.round(gb * 1024)} MB`;
}

function formatDisk(gb: number): string {
  return gb >= 1000 ? `${(gb / 1000).toFixed(0)} TB` : `${gb} GB`;
}

export function AddInstanceDialog() {
  const [step, setStep] = useState<'select' | 'review'>('select');
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState(INSTANCE_CONFIG.defaultRegion);
  const [serverTypes, setServerTypes] = useState<ServerType[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [portalUrl, setPortalUrl] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const router = useRouter();

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
            <GlobeRegionPicker location={location} onLocationChange={setLocation} />
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
                    {step === 'select' ? 'Choose your machine size.' : 'Review your configuration.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Mobile-only region selector */}
            <div className="md:hidden px-6 pb-4">
              <RegionToggle location={location} onLocationChange={setLocation} />
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
                      <SizePicker types={serverTypes} selected={selected} onSelect={setSelected} />
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
                          <Button size="sm" variant="outline" className="w-full text-xs h-8 rounded-lg" onClick={() => window.open(portalUrl, '_blank')}>
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
