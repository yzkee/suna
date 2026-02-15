'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { ArrowRight, CheckCircle, Key, Loader2 } from 'lucide-react';
import { isLocalMode } from '@/lib/config';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';

import { Button } from '@/components/ui/button';
import { LocalEnvManager } from '@/components/env-manager/local-env-manager';
import { KortixLogo } from '@/components/sidebar/kortix-logo';

// ─── Types ──────────────────────────────────────────────────────────────────

interface EnvData {
  configured: Record<string, boolean>;
}

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

// ─── Welcome Step ───────────────────────────────────────────────────────────

function WelcomeStep({ onContinue }: { onContinue: () => void }) {
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
        particleCount: 2,
        angle: 60,
        spread: 55,
        startVelocity: 60,
        origin: { x: 0, y: 0.5 },
        colors,
      });
      confetti({
        particleCount: 2,
        angle: 120,
        spread: 55,
        startVelocity: 60,
        origin: { x: 1, y: 0.5 },
        colors,
      });
      animationRef.current = requestAnimationFrame(frame);
    };
    frame();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      endTimeRef.current = 0;
    };
  }, []);

  return (
    <motion.div
      className="flex min-h-screen items-center justify-center bg-background"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.35 }}
    >
      <div className="flex flex-col items-center gap-8 text-center px-4">
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{
            delay: 0.1,
            duration: 0.5,
            type: 'spring',
            stiffness: 200,
            damping: 20,
          }}
        >
          <KortixLogo size={36} variant="logomark" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.4 }}
          className="space-y-3"
        >
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome to Kortix
          </h1>
          <p className="text-sm text-muted-foreground max-w-sm">
            Your AI computer is ready. Let&apos;s configure it.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55, duration: 0.35 }}
        >
          <Button
            size="default"
            onClick={onContinue}
            className="gap-2"
          >
            Get Started
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </motion.div>
      </div>
    </motion.div>
  );
}

// ─── API Keys Step ──────────────────────────────────────────────────────────

function ApiKeysStep({ onContinue }: { onContinue: () => void }) {
  const [hasLLMKey, setHasLLMKey] = useState(false);
  const [checking, setChecking] = useState(true);

  const checkKeys = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/setup/env`);
      if (!res.ok) throw new Error('Failed');
      const data: EnvData = await res.json();
      setHasLLMKey(LLM_KEYS.some((k) => data.configured[k]));
    } catch {
      // ignore
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    checkKeys();
    const interval = setInterval(checkKeys, 3000);
    return () => clearInterval(interval);
  }, [checkKeys]);

  return (
    <motion.div
      className="flex min-h-screen items-center justify-center bg-background p-4"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
    >
      <div className="w-full max-w-xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            {hasLLMKey ? (
              <CheckCircle className="h-5 w-5 text-green-500" />
            ) : (
              <Key className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight">
              Configure API Keys
            </h2>
            <p className="text-sm text-muted-foreground">
              Add at least one LLM provider key to power your AI agent.
            </p>
          </div>
        </div>

        {/* Env Manager */}
        <div className="rounded-lg border bg-card">
          <div className="p-4">
            <LocalEnvManager />
          </div>
        </div>

        {/* Action */}
        <div className="flex justify-center pt-2">
          <Button
            size="default"
            onClick={onContinue}
            disabled={!hasLLMKey && checking}
            className="gap-2"
            variant={hasLLMKey ? 'default' : 'outline'}
          >
            {hasLLMKey ? 'Continue' : 'Skip for now'}
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main Setup Page ────────────────────────────────────────────────────────

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<'welcome' | 'keys'>(() => {
    if (typeof window === 'undefined') return 'welcome';
    const sp = new URLSearchParams(window.location.search);
    return sp.get('step') === 'keys' ? 'keys' : 'welcome';
  });
  const [loading, setLoading] = useState(true);

  // Check if already onboarded
  useEffect(() => {
    const checkOnboarding = async () => {
      if (!isLocalMode()) {
        router.replace('/dashboard');
        return;
      }

      try {
        const res = await fetch(`${BACKEND_URL}/setup/onboarding-status`);
        if (res.ok) {
          const data = await res.json();
          if (data.complete) {
            router.replace('/dashboard');
            return;
          }
        }
      } catch {
        // Backend not ready yet, show setup
      }
      setLoading(false);
    };
    checkOnboarding();
  }, [router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      {step === 'welcome' && (
        <WelcomeStep
          key="welcome"
          onContinue={() => {
            if (isLocalMode()) {
              setStep('keys');
            } else {
              router.push('/onboarding');
            }
          }}
        />
      )}
      {step === 'keys' && (
        <ApiKeysStep
          key="keys"
          onContinue={() => router.push('/onboarding')}
        />
      )}
    </AnimatePresence>
  );
}
