'use client';

import { useState, useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { KortixLoader } from '@/components/ui/kortix-loader';
import { toast } from '@/lib/toast';
import { signInWithPassword, installOwner } from '@/app/auth/actions';

/* ─── Install Status Hook ──────────────────────────────────────────────────── */

export function useInstallStatus() {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8008/v1';
    fetch(`${backendUrl}/setup/install-status`)
      .then((res) => res.json())
      .then((data) => {
        setInstalled(data.installed === true);
        setLoading(false);
      })
      .catch(() => {
        setInstalled(false);
        setLoading(false);
      });
  }, []);

  return { installed, loading };
}

/* ─── Self-Hosted Form Panel ───────────────────────────────────────────────── */
// This renders JUST the form content — no full-page wrapper, no layout.
// It's meant to slot into the left panel of the auth page layout.

interface SelfHostedFormProps {
  returnUrl: string | null;
  installed: boolean | null;
}

export function SelfHostedForm({ returnUrl, installed }: SelfHostedFormProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (installed === null) {
    return <KortixLoader size="medium" />;
  }

  const isInstaller = !installed;

  const handleAuth = async (prevState: any, formData: FormData) => {
    setErrorMessage(null);

    formData.set('returnUrl', returnUrl || '/onboarding');
    formData.set('origin', typeof window !== 'undefined' ? window.location.origin : '');

    try {
      const result = isInstaller
        ? await installOwner(prevState, formData)
        : await signInWithPassword(prevState, formData);

      if (result && typeof result === 'object') {
        if ('success' in result && result.success && 'redirectTo' in result) {
          window.location.href = result.redirectTo as string;
          return result;
        }
        if ('message' in result) {
          setErrorMessage(result.message as string);
          toast.error(result.message as string);
          return result;
        }
      }
    } catch (error: any) {
      if (error?.digest?.startsWith('NEXT_REDIRECT')) {
        return;
      }
      const errorMsg = error?.message || 'An unexpected error occurred';
      setErrorMessage(errorMsg);
      toast.error(errorMsg);
    }
  };

  if (isInstaller) {
    return (
      <div className="w-full max-w-sm">
        {/* Wizard badge */}
        <div className="flex justify-center mb-5">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Setup Wizard
          </span>
        </div>

        <div className="mb-4 sm:mb-6 flex items-center flex-col gap-2 justify-center">
          <h1 className="text-lg sm:text-xl md:text-2xl font-semibold text-foreground text-center leading-tight">
            Welcome to Kortix
          </h1>
          <p className="text-sm text-muted-foreground text-center max-w-xs">
            Create your admin account to complete the installation. You'll be the owner of this instance.
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-6 px-1">
          <div className="flex items-center gap-1.5 flex-1">
            <div className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[11px] font-semibold shrink-0">1</div>
            <span className="text-xs font-medium text-foreground truncate">Create account</span>
          </div>
          <div className="h-px flex-1 bg-border max-w-8" />
          <div className="flex items-center gap-1.5 flex-1">
            <div className="w-5 h-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-[11px] font-semibold shrink-0">2</div>
            <span className="text-xs text-muted-foreground truncate">Set up agent</span>
          </div>
          <div className="h-px flex-1 bg-border max-w-8" />
          <div className="flex items-center gap-1.5 flex-1">
            <div className="w-5 h-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-[11px] font-semibold shrink-0">3</div>
            <span className="text-xs text-muted-foreground truncate">Start using</span>
          </div>
        </div>

        {errorMessage && (
          <div className="mb-4 p-3 rounded-lg flex items-center gap-2 bg-destructive/10 border border-destructive/20 text-destructive">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm">{errorMessage}</span>
          </div>
        )}

        <form className="space-y-3 sm:space-y-4">
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="Email address"
            required
            autoComplete="email"
            className="h-10 sm:h-11 text-[16px] sm:text-sm"
          />
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="Password"
            required
            autoComplete="new-password"
            className="h-10 sm:h-11 text-[16px] sm:text-sm"
          />
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            placeholder="Confirm password"
            required
            autoComplete="new-password"
            className="h-10 sm:h-11 text-[16px] sm:text-sm"
          />

          <SubmitButton
            formAction={handleAuth}
            className="w-full h-10 sm:h-11 text-sm sm:text-base"
            pendingText="Setting up..."
          >
            Create account & continue
          </SubmitButton>
        </form>

        <p className="text-[11px] sm:text-xs text-muted-foreground text-center mt-6 leading-relaxed">
          This will be the owner account for this Kortix instance.
        </p>
      </div>
    );
  }

  // ── Returning user sign-in ──
  return (
    <div className="w-full max-w-sm">
      <div className="mb-4 sm:mb-6 flex items-center flex-col gap-2 sm:gap-4 justify-center">
        <h1 className="text-lg sm:text-xl md:text-2xl font-semibold text-foreground text-center leading-tight">
          Sign in to Kortix
        </h1>
        <p className="text-sm text-muted-foreground text-center">
          Enter your credentials to continue.
        </p>
      </div>

      {errorMessage && (
        <div className="mb-4 p-3 rounded-lg flex items-center gap-2 bg-destructive/10 border border-destructive/20 text-destructive">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span className="text-sm">{errorMessage}</span>
        </div>
      )}

      <form className="space-y-3 sm:space-y-4">
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="Email address"
          required
          autoComplete="email"
          className="h-10 sm:h-11 text-[16px] sm:text-sm"
        />
        <Input
          id="password"
          name="password"
          type="password"
          placeholder="Password"
          required
          autoComplete="current-password"
          className="h-10 sm:h-11 text-[16px] sm:text-sm"
        />

        <SubmitButton
          formAction={handleAuth}
          className="w-full h-10 sm:h-11 text-sm sm:text-base"
          pendingText="Signing in..."
        >
          Sign in
        </SubmitButton>
      </form>

      <p className="text-[11px] sm:text-xs text-muted-foreground text-center mt-6 leading-relaxed">
        Self-hosted Kortix instance
      </p>
    </div>
  );
}
