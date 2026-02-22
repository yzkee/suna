'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { KortixLoader } from '@/components/ui/kortix-loader';
import { toast } from '@/lib/toast';
import { createClient } from '@/lib/supabase/client';

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

interface SelfHostedFormProps {
  returnUrl: string | null;
  installed: boolean | null;
}

export function SelfHostedForm({ returnUrl, installed }: SelfHostedFormProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  if (installed === null) {
    return <KortixLoader size="medium" />;
  }

  const isInstaller = !installed;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);
    setPending(true);

    const form = e.currentTarget;
    const email = (form.elements.namedItem('email') as HTMLInputElement).value.trim().toLowerCase();
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;

    if (!email || !email.includes('@')) {
      setErrorMessage('Please enter a valid email address');
      setPending(false);
      return;
    }

    if (!password || password.length < 6) {
      setErrorMessage('Password must be at least 6 characters');
      setPending(false);
      return;
    }

    const supabase = createClient();

    try {
      if (isInstaller) {
        // Installer: sign up + sign in
        const confirmPassword = (form.elements.namedItem('confirmPassword') as HTMLInputElement).value;
        if (password !== confirmPassword) {
          setErrorMessage('Passwords do not match');
          setPending(false);
          return;
        }

        const { error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) {
          setErrorMessage(signUpError.message);
          setPending(false);
          return;
        }

        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          setErrorMessage(signInError.message);
          setPending(false);
          return;
        }

        // Provision sandbox (fire-and-forget)
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8008/v1';
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          fetch(`${backendUrl}/platform/init`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
          }).catch(() => {});
        }
      } else {
        // Returning user: just sign in
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setErrorMessage(error.message);
          setPending(false);
          return;
        }
      }

      // Auth succeeded — AuthProvider will pick up the session via onAuthStateChange.
      // Navigate to onboarding/dashboard.
      router.push(returnUrl || '/onboarding');
    } catch (err: any) {
      setErrorMessage(err?.message || 'An unexpected error occurred');
      setPending(false);
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

        <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
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

          <Button
            type="submit"
            disabled={pending}
            className="w-full h-10 sm:h-11 text-sm sm:text-base"
          >
            {pending ? 'Setting up...' : 'Create account & continue'}
          </Button>
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

      <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
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

        <Button
          type="submit"
          disabled={pending}
          className="w-full h-10 sm:h-11 text-sm sm:text-base"
        >
          {pending ? 'Signing in...' : 'Sign in'}
        </Button>
      </form>

      <p className="text-[11px] sm:text-xs text-muted-foreground text-center mt-6 leading-relaxed">
        Self-hosted Kortix instance
      </p>
    </div>
  );
}
