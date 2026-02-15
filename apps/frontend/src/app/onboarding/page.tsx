'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ArrowRight, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { isLocalMode } from '@/lib/config';
import { getClient, resetClient } from '@/lib/opencode-sdk';
import { useOpenCodeEventStream } from '@/hooks/opencode/use-opencode-events';
import { SessionChat } from '@/components/session/session-chat';
import { KortixLogo } from '@/components/sidebar/kortix-logo';
import { Button } from '@/components/ui/button';
import { SidebarProvider } from '@/components/ui/sidebar';

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8008/v1';

const LLM_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'XAI_API_KEY',
];

// Standalone QueryClient for the onboarding page (isolated from dashboard)
const onboardingQueryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, staleTime: 5000 },
  },
});

function OpenCodeEventStreamProvider() {
  useOpenCodeEventStream();
  return null;
}

function unwrap<T>(result: { data?: T; error?: unknown }): T {
  if (result.error) {
    const err = result.error as any;
    const msg =
      err?.data?.message ||
      err?.message ||
      (typeof err === 'string' ? err : 'SDK request failed');
    throw new Error(msg);
  }
  return result.data as T;
}

function CompletionCelebration({ onContinue }: { onContinue: () => void }) {
  const animationRef = useRef<number | null>(null);
  const endTimeRef = useRef<number>(0);

  useEffect(() => {
    const colors = ['#a786ff', '#fd8bbc', '#eca184', '#f8deb1'];
    endTimeRef.current = Date.now() + 2500;

    const frame = () => {
      if (Date.now() > endTimeRef.current) {
        animationRef.current = null;
        return;
      }
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        startVelocity: 60,
        origin: { x: 0, y: 0.5 },
        colors,
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        startVelocity: 60,
        origin: { x: 1, y: 0.5 },
        colors,
      });
      animationRef.current = requestAnimationFrame(frame);
    };
    frame();

    const timer = setTimeout(onContinue, 5000);

    return () => {
      clearTimeout(timer);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      endTimeRef.current = 0;
    };
  }, [onContinue]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      <motion.div
        className="flex flex-col items-center gap-6 text-center"
        initial={{ scale: 0.8, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.5, type: 'spring', stiffness: 200, damping: 20 }}
      >
        <KortixLogo size={32} variant="logomark" />
        <div className="space-y-2">
          <h2 className="text-xl font-semibold tracking-tight">You&apos;re all set!</h2>
          <p className="text-sm text-muted-foreground">Your AI computer is ready to go.</p>
        </div>
        <Button size="default" onClick={onContinue} className="gap-2 mt-1">
          Go to Dashboard
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </motion.div>
    </motion.div>
  );
}

function OnboardingContent() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [checking, setChecking] = useState(true);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attemptedRef = useRef(false);

  // Gate: local only, require at least one LLM key.
  useEffect(() => {
    if (!isLocalMode()) {
      router.replace('/dashboard');
      return;
    }

    let cancelled = false;

    const check = async () => {
      try {
        // If already complete, go straight to dashboard.
        const statusRes = await fetch(`${BACKEND_URL}/setup/onboarding-status`);
        if (statusRes.ok) {
          const data = await statusRes.json();
          if (data?.complete) {
            router.replace('/dashboard');
            return;
          }
        }

        const envRes = await fetch(`${BACKEND_URL}/setup/env`);
        if (!envRes.ok) {
          throw new Error('Local API not reachable');
        }
        const envData = (await envRes.json()) as { configured?: Record<string, boolean> };
        const configured = envData.configured || {};
        const hasKey = LLM_KEYS.some((k) => configured[k]);
        if (!hasKey) {
          router.replace('/dashboard');
          return;
        }

        if (!cancelled) {
          setCreating(true);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || 'Failed to prepare onboarding');
        }
      } finally {
        if (!cancelled) {
          setChecking(false);
        }
      }
    };

    check();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Create the onboarding session — retry with backoff.
  useEffect(() => {
    if (!creating) return;
    if (attemptedRef.current) return;
    attemptedRef.current = true;

    let cancelled = false;

    const createSession = async () => {
      const MAX_RETRIES = 20;
      const RETRY_DELAY_MS = 3000;
      let lastMessage = '';

      for (let i = 0; i < MAX_RETRIES; i++) {
        if (cancelled) return;

        try {
          const client = getClient();
          const createResult = await client.session.create({ title: 'Kortix Onboarding' });
          const session = unwrap(createResult);
          if (!session?.id) throw new Error('No session ID returned');

          if (cancelled) return;
          setSessionId(session.id);

          // Send initial prompt.
          const promptResult = await client.session.promptAsync({
            sessionID: session.id,
            parts: [{ type: 'text', text: 'Hey! I just installed Kortix.' }],
            agent: 'kortix-onboarding',
          });

          if (promptResult?.error) {
            console.warn('Prompt error (non-fatal):', promptResult.error);
          }

          return;
        } catch (err: any) {
          lastMessage = err?.message || String(err);
          if (i === 3) resetClient();
          if (i < MAX_RETRIES - 1) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          }
        }
      }

      if (!cancelled) {
        setError(lastMessage || 'Could not start onboarding session');
      }
    };

    createSession();
    return () => {
      cancelled = true;
    };
  }, [creating]);

  // Poll for onboarding completion.
  useEffect(() => {
    if (!sessionId || complete) return;

    const poll = setInterval(async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/setup/onboarding-status`);
        if (res.ok) {
          const data = await res.json();
          if (data.complete) {
            setComplete(true);
            clearInterval(poll);
          }
        }
      } catch {
        // ignore
      }
    }, 3000);

    return () => clearInterval(poll);
  }, [sessionId, complete]);

  const handleComplete = useCallback(() => {
    router.replace('/dashboard');
  }, [router]);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Preparing onboarding…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="flex flex-col items-center gap-5 text-center max-w-sm">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle className="h-5 w-5 text-destructive" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Could not start onboarding</p>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
          <div className="flex gap-3">
            <Button variant="default" size="sm" onClick={() => window.location.reload()}>
              Retry
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.push('/dashboard')}>
              Setup
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Connecting to your AI agent…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-background">
        <KortixLogo size={20} variant="logomark" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-tight">Kortix Onboarding</p>
          <p className="text-xs text-muted-foreground leading-tight">Let&apos;s get you set up</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground h-7"
          onClick={() => router.push('/dashboard')}
        >
          Setup
        </Button>
      </div>

      <div className="flex-1 min-h-0 relative">
        <OpenCodeEventStreamProvider />
        <SessionChat sessionId={sessionId} />
      </div>

      <AnimatePresence>
        {complete && <CompletionCelebration onContinue={handleComplete} />}
      </AnimatePresence>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <QueryClientProvider client={onboardingQueryClient}>
      <SidebarProvider defaultOpen={false}>
        <OnboardingContent />
      </SidebarProvider>
    </QueryClientProvider>
  );
}
