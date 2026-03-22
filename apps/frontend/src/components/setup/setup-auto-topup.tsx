'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { configureAutoTopup } from '@/lib/api/billing';

interface SetupAutoTopupProps {
  onContinue: () => void;
  onSkip: () => void;
  error?: string;
}

export function SetupAutoTopup({ onContinue, onSkip, error: externalError }: SetupAutoTopupProps) {
  const [enabled, setEnabled] = useState(false);
  const [threshold, setThreshold] = useState(5);
  const [amount, setAmount] = useState(15);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const displayError = externalError || error;

  const handleSave = async () => {
    if (!enabled) { onContinue(); return; }

    if (threshold < 5) { setError('Auto-topup threshold must be at least $5.'); return; }
    if (amount < 15) { setError('Auto-topup amount must be at least $15.'); return; }
    if (amount < threshold * 2) { setError('Auto-topup amount must be at least 2x the threshold.'); return; }

    setSaving(true);
    setError('');
    try {
      await configureAutoTopup({ enabled: true, threshold, amount });
      onContinue();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save auto-topup settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full flex flex-col items-center gap-6">
      {displayError && <p className="text-sm text-red-400 text-center">{displayError}</p>}

      <button
        type="button"
        onClick={() => setEnabled(!enabled)}
        className={`w-full rounded-xl border p-4 text-left transition-colors ${
          enabled ? 'border-primary/30 bg-primary/5' : 'border-border bg-card hover:bg-muted/40'
        }`}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Enable Auto-Topup</p>
            <p className="text-xs text-foreground/40 mt-0.5">Never run out of credits mid-task</p>
          </div>
          <div className={`h-5 w-9 rounded-full transition-colors flex items-center px-0.5 ${
            enabled ? 'bg-primary justify-end' : 'bg-foreground/10 justify-start'
          }`}>
            <div className="h-4 w-4 rounded-full bg-white shadow-sm transition-all" />
          </div>
        </div>
      </button>

      {enabled && (
        <div className="w-full grid grid-cols-2 gap-3" style={{ animation: 'setting-up-fade-in 0.3s ease-out forwards' }}>
          <div className="space-y-1.5">
            <label className="text-[11px] text-foreground/40 uppercase tracking-wider">When balance drops below</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground/30">$</span>
              <input
                type="number"
                min={1}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value || 0))}
                className="w-full h-10 pl-7 pr-3 rounded-lg border border-border bg-card text-sm tabular-nums"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] text-foreground/40 uppercase tracking-wider">Reload amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground/30">$</span>
              <input
                type="number"
                min={5}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value || 0))}
                className="w-full h-10 pl-7 pr-3 rounded-lg border border-border bg-card text-sm tabular-nums"
              />
            </div>
          </div>
        </div>
      )}

      <div className="w-full flex gap-3 pt-2">
        <Button variant="outline" className="flex-1 h-10" onClick={onSkip}>
          Skip
        </Button>
        <Button className="flex-1 h-10" onClick={handleSave} disabled={saving}>
          {enabled ? (saving ? 'Saving...' : 'Save & Continue') : 'Continue'}
        </Button>
      </div>
    </div>
  );
}
