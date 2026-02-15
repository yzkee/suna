'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import { ArrowRight, Key, CheckCircle, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { KortixLogo } from '@/components/sidebar/kortix-logo';
import { LocalEnvManager } from '@/components/env-manager/local-env-manager';
import { Button } from '@/components/ui/button';
import { backendApi } from '@/lib/api-client';

// ─── Constants ──────────────────────────────────────────────────────────────

const LLM_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'XAI_API_KEY',
];

// ─── Welcome Step (confetti celebration overlay) ────────────────────────────

function WelcomeStep({ onDone }: { onDone: () => void }) {
  const animationRef = useRef<number | null>(null);
  const endTimeRef = useRef<number>(0);

  useEffect(() => {
    const colors = ['#a786ff', '#fd8bbc', '#eca184', '#f8deb1'];
    endTimeRef.current = Date.now() + 3000;

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

    // Auto-advance after 4s
    const timer = setTimeout(onDone, 4000);

    return () => {
      clearTimeout(timer);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      endTimeRef.current = 0;
    };
  }, [onDone]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Backdrop — see dashboard underneath */}
      <motion.div
        className="absolute inset-0 bg-background/60 backdrop-blur-[2px] cursor-pointer"
        onClick={onDone}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />

      {/* Content */}
      <motion.div
        className="relative flex flex-col items-center gap-4 pointer-events-none select-none"
        initial={{ scale: 0.8, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: -10 }}
        transition={{
          duration: 0.5,
          type: 'spring',
          stiffness: 200,
          damping: 20,
        }}
      >
        {/* "Welcome to" */}
        <motion.p
          className="text-lg text-muted-foreground"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.4 }}
        >
          Welcome to
        </motion.p>

        {/* Kortix Logo */}
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{
            delay: 0.25,
            duration: 0.5,
            type: 'spring',
            stiffness: 250,
            damping: 18,
          }}
        >
          <KortixLogo size={48} variant="logomark" />
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

// ─── API Keys Step (overlay with card) ──────────────────────────────────────

function ApiKeysStep({ onDone }: { onDone: () => void }) {
  // Share the same React Query cache key as LocalEnvManager
  // so when LocalEnvManager saves + invalidates, we pick it up instantly.
  const { data: envData, isLoading } = useQuery<{
    configured: Record<string, boolean>;
  }>({
    queryKey: ['setup-env'],
    queryFn: async () => {
      const res = await backendApi.get('/setup/env');
      return res.data;
    },
    refetchInterval: 3000,
  });

  const hasLLMKey = LLM_KEYS.some((k) => envData?.configured?.[k]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-background/60 backdrop-blur-[2px]" />

      {/* Card */}
      <motion.div
        className="relative w-full max-w-xl max-h-[85vh] flex flex-col rounded-xl border bg-card shadow-lg overflow-hidden"
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 10 }}
        transition={{ duration: 0.35, type: 'spring', stiffness: 300, damping: 25 }}
      >
        {/* Header */}
        <div className="flex flex-col items-center gap-3 px-6 pt-6 pb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            {hasLLMKey ? (
              <CheckCircle className="h-5 w-5 text-green-500" />
            ) : (
              <Key className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <div className="text-center space-y-1">
            <h2 className="text-lg font-semibold tracking-tight">
              Configure API Keys
            </h2>
            <p className="text-sm text-muted-foreground">
              Add at least one LLM provider key to power your AI agent.
            </p>
          </div>
        </div>

        {/* Scrollable key manager */}
        <div className="flex-1 overflow-y-auto px-6 pb-2">
          <LocalEnvManager />
        </div>

        {/* Footer */}
        <div className="flex justify-center px-6 py-4 border-t bg-card">
          <Button
            size="default"
            onClick={onDone}
            disabled={!hasLLMKey}
            className="gap-2"
          >
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : hasLLMKey ? (
              <>
                Continue
                <ArrowRight className="h-3.5 w-3.5" />
              </>
            ) : (
              'Add a key to continue'
            )}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Main SetupOverlay ──────────────────────────────────────────────────────

interface SetupOverlayProps {
  onComplete: () => void;
}

/**
 * Full-screen overlay that guides new users through setup.
 * Renders ON TOP of the dashboard so users can see the product underneath.
 *
 * Steps:
 *   1. Welcome splash (confetti, "Welcome to" + Kortix logo)
 *   2. API Keys configuration (card overlay with LocalEnvManager)
 *
 * After completion, calls `onComplete` to dismiss and proceed to onboarding.
 */
export function SetupOverlay({ onComplete }: SetupOverlayProps) {
  const [step, setStep] = useState<'welcome' | 'keys'>('welcome');

  const handleWelcomeDone = useCallback(() => {
    setStep('keys');
  }, []);

  return (
    <AnimatePresence mode="wait">
      {step === 'welcome' && (
        <WelcomeStep key="welcome" onDone={handleWelcomeDone} />
      )}
      {step === 'keys' && (
        <ApiKeysStep key="keys" onDone={onComplete} />
      )}
    </AnimatePresence>
  );
}
