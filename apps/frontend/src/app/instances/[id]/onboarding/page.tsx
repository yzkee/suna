'use client';

import React, { useRef, useCallback, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';

import { useParams, useRouter } from 'next/navigation';

import { useAuth } from '@/components/AuthProvider';

import {
  useCreateOpenCodeSession,
} from '@/hooks/opencode/use-opencode-sessions';
import { SessionChat } from '@/components/session/session-chat';
import { SidebarContext } from '@/components/ui/sidebar';
import { OpenCodeEventStreamProvider } from '@/hooks/opencode/use-opencode-events';
import { getClient } from '@/lib/opencode-sdk';
import { useServerStore, switchToInstanceAsync } from '@/stores/server-store';
import { Button } from '@/components/ui/button';
import { WallpaperBackground } from '@/components/ui/wallpaper-background';
import { authenticatedFetch } from '@/lib/auth-token';
import { useSandbox } from '@/hooks/platform/use-sandbox';
import { GlobalProviderModal } from '@/components/providers/provider-modal';
import { buildInstancePath } from '@/lib/instance-routes';

/* ─── Constants ──────────────────────────────────────────────── */

const SYMBOL = "M25.5614 24.916H29.8268C29.8268 19.6306 26.9378 15.0039 22.6171 12.4587C26.9377 9.91355 29.8267 5.28685 29.8267 0.00146484H25.5613C25.5613 5.00287 21.8906 9.18692 17.0654 10.1679V0.00146484H12.8005V10.1679C7.9526 9.20401 4.3046 5.0186 4.3046 0.00146484H0.0391572C0.0391572 5.28685 2.92822 9.91355 7.24884 12.4587C2.92818 15.0039 0.0390625 19.6306 0.0390625 24.916H4.30451C4.30451 19.8989 7.95259 15.7135 12.8005 14.7496V24.9206H17.0654V14.7496C21.9133 15.7134 25.5614 19.8989 25.5614 24.916Z";

const BIOS_LINES: { text: string; bold?: boolean }[] = [
  { text: 'KORTIX BIOS v2.0.1', bold: true },
  { text: '' },
  { text: 'CPU: Kortix Inference Engine X1 @ 3.80 GHz' },
  { text: 'Memory test................. OK' },
  { text: 'Neural cores............... 8/8 online' },
  { text: 'Agent runtime.............. initialized' },
  { text: 'Tool registry.............. 47 tools loaded' },
  { text: 'Secure enclave............. active' },
  { text: 'Mounting workspace......... done' },
  { text: 'Connecting to services..... done' },
  { text: '' },
  { text: 'All systems nominal. Starting KORTIX OS...' },
];

/** No-op sidebar context so SessionChat's deep useSidebar() calls don't crash. */
const _noop = () => {};
const _sidebarStub = {
  state: 'collapsed' as const,
  open: false,
  setOpen: _noop as (open: boolean) => void,
  openMobile: false,
  setOpenMobile: _noop as (open: boolean) => void,
  isMobile: false,
  toggleSidebar: _noop,
};

/** Get the sandbox instance URL (routed through backend at /v1/p/{sandboxId}/8000) */
function getInstanceUrl() {
  return useServerStore.getState().getActiveServerUrl();
}

/* ─── Types ──────────────────────────────────────────────────── */

type BootPhase = 'bios' | 'logo' | 'onboarding' | 'session';

/* ─── Helpers ────────────────────────────────────────────────── */

/** Persist the onboarding session ID to the sandbox instance (fire-and-forget). */
function persistOnboardingSessionId(sessionId: string) {
  const instanceUrl = getInstanceUrl();
  authenticatedFetch(`${instanceUrl}/env/ONBOARDING_SESSION_ID`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: sessionId }),
  }).catch(() => {}); // best effort
}

/** Persist that the onboarding command has been fired (survives page refresh). */
function persistCommandFired() {
  const instanceUrl = getInstanceUrl();
  authenticatedFetch(`${instanceUrl}/env/ONBOARDING_COMMAND_FIRED`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: 'true' }),
  }).catch(() => {}); // best effort
}

/** Check if the onboarding command was already fired (persisted across refreshes). */
async function wasCommandFired(): Promise<boolean> {
  try {
    const instanceUrl = getInstanceUrl();
    const res = await authenticatedFetch(`${instanceUrl}/env/ONBOARDING_COMMAND_FIRED`);
    if (res.ok) {
      const data = await res.json();
      return data.ONBOARDING_COMMAND_FIRED === 'true';
    }
  } catch { /* ignore */ }
  return false;
}

/* ─── Sub-components ─────────────────────────────────────────── */

function LoadingDots() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-1 h-1 rounded-full bg-foreground/30"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
          />
        ))}
      </div>
    </div>
  );
}

/* ─── Main page ──────────────────────────────────────────────── */

export default function OnboardingPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const createSession = useCreateOpenCodeSession();
  const creatingRef = useRef(false);
  const commandFiredRef = useRef(false);
  const commandRetryRef = useRef(false);
  const retriesRef = useRef(0);
  const { user, session, isLoading, signOut, supabase } = useAuth();

  // Ensure sandbox is registered in server store (same as dashboard layout).
  // This makes getInstanceUrl() return the correct sandbox URL.
  const { sandbox, refetch: refetchSandbox } = useSandbox();

  const [phase, setPhase] = useState<BootPhase>('bios');
  const [visibleLines, setVisibleLines] = useState(0);
  const [progressFill, setProgressFill] = useState(false);
  const [sessionError, setSessionError] = useState(false);
  const [isRedoResetting, setIsRedoResetting] = useState(false);
  const [sessionErrorMessage, setSessionErrorMessage] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bootTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [biosReady, setBiosReady] = useState(false);

  // Track whether we're in the process of skipping — blocks boot sequence
  const [isSkipping, setIsSkipping] = useState(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.has('skip_onboarding') || params.has('skip');
  });

  const createSessionRef = useRef(createSession);
  createSessionRef.current = createSession;

  // Gate: is the server store pointing at the correct instance?
  // All onboarding logic waits for this before touching the sandbox.
  const activeInstanceId = useServerStore((s) => {
    const active = s.servers.find((server) => server.id === s.activeServerId);
    return active?.instanceId;
  });
  const isInstanceReady = React.useMemo(() => {
    if (!id) return !!getInstanceUrl();
    return activeInstanceId === id && !!getInstanceUrl();
  }, [id, activeInstanceId]);



  const isSandboxAuthError = useCallback((err: unknown): boolean => {
    const msg = err instanceof Error ? err.message : String(err ?? '');
    return /not authorized to access this sandbox/i.test(msg);
  }, []);

  const isTransientSandboxStartupError = useCallback((err: unknown): boolean => {
    const msg = err instanceof Error ? err.message : String(err ?? '');
    return /still syncing|still provisioning|still starting|still loading|not ready|sandbox route is still syncing|sandbox is waking up|failed to fetch|networkerror when attempting to fetch resource|load failed/i.test(msg);
  }, []);

  const refreshSandboxRouting = useCallback(async () => {
    // Allow auto-switch to the sandbox after refetch/register.
    useServerStore.setState({ activeServerId: '', userSelected: false });
    try {
      await refetchSandbox();
    } catch {
      // best effort
    }
  }, [refetchSandbox]);

  // Keep onboarding pinned to the route instance (/instances/:id/onboarding).
  // Without this, onboarding can talk to one sandbox for /env reads and another
  // sandbox for OpenCode session creation.
  useEffect(() => {
    if (!id || !user) return;

    let cancelled = false;
    switchToInstanceAsync(id, { validate: true })
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          router.replace(`/instances/${id}`);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [id, user, router]);

  // ── Query param controls ───────────────────────────────────────
  // ?skip_onboarding / ?skip → set ONBOARDING_COMPLETE=true & go to dashboard
  // ?redo                    → set ONBOARDING_COMPLETE=false so flow reruns
  // Depends on `user` so it only fires after auth hydrates — avoids naked requests.
  useEffect(() => {
    if (!user) return;
    if (!isInstanceReady) return;
    const params = new URLSearchParams(window.location.search);

    if (params.has('skip_onboarding') || params.has('skip')) {
      setIsSkipping(true);
      // Use an async IIFE: await the PUT, then hard-redirect to stop all
      // component execution. router.replace() is async and lets the boot
      // sequence keep running — window.location.replace() is a full navigation
      // that unloads the page immediately.
      (async () => {
        const instanceUrl = getInstanceUrl();
        if (instanceUrl) {
          try {
            await authenticatedFetch(`${instanceUrl}/env/ONBOARDING_COMPLETE`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ value: 'true' }),
            });
          } catch {
            // Best effort — ONBOARDING_COMPLETE may already be true
          }
        }
        window.location.replace(buildInstancePath(id, '/dashboard'));
      })();
      return;
    }

    if (params.has('redo')) {
      setIsRedoResetting(true);
      void (async () => {
        const instanceUrl = getInstanceUrl();
        if (instanceUrl) {
          try {
            await authenticatedFetch(`${instanceUrl}/env/ONBOARDING_COMPLETE`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ value: 'false' }),
            });
          } catch {
            // best effort — we still clear the query param and let normal
            // onboarding routing/session logic continue.
          }
        }
        const clean = new URL(window.location.href);
        clean.searchParams.delete('redo');
        window.history.replaceState({}, '', clean.pathname + clean.search);
        setIsRedoResetting(false);
      })();
      return;
    }
  }, [user, id, isInstanceReady]);

  // ── Redirect if already onboarded ─────────────────────────────
  // Re-runs when auth state or sandbox registration changes so it doesn't
  // silently fail if auth wasn't ready on first mount.
  useEffect(() => {
    if (isSkipping) return;
    if (isRedoResetting) return;
    if (!isInstanceReady) return;
    const params = new URLSearchParams(window.location.search);
    if (params.has('redo')) return;
    let cancelled = false;
    const check = async () => {
      const instanceUrl = getInstanceUrl();
      if (!instanceUrl) return;
      try {
        const res = await authenticatedFetch(`${instanceUrl}/env/ONBOARDING_COMPLETE`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.ONBOARDING_COMPLETE === 'true') {
          router.replace(buildInstancePath(id, '/dashboard'));
        }
      } catch {
        // Sandbox not reachable yet — stay on onboarding
      }
    };
    check();
    return () => { cancelled = true; };
  // Re-run when auth resolves (user changes from null→object) or sandbox registers
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSkipping, isRedoResetting, isInstanceReady, user, activeInstanceId]);



  // ── Redirect to auth if not logged in ─────────────────────────
  useEffect(() => {
    if (isLoading || user || session?.user) return;

    let cancelled = false;

    const verifyAndRedirect = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        if (data.session?.user) return;
      } catch {
        if (cancelled) return;
      }

      const currentSearch = window.location.search;
      const redirectTarget = encodeURIComponent(buildInstancePath(id, '/onboarding') + currentSearch);
      router.replace(`/auth?redirect=${redirectTarget}`);
    };

    void verifyAndRedirect();

    return () => {
      cancelled = true;
    };
  }, [user, session, isLoading, router, supabase, id]);

  // ── Onboarding session lifecycle ──────────────────────────────
  // When we reach the 'onboarding' phase:
  // 1. Resume existing session or create a new one
  // 2. Fire /onboarding command (fire-and-forget via mutation .mutate())
  // 3. Transition to 'session' phase — renders SessionChat full-page
  // 4. Poll ONBOARDING_COMPLETE — the onboarding AGENT sets it when done
  // 5. When complete → redirect to /dashboard
  const MAX_RETRIES = 3;
  const [onboardingSessionId, setOnboardingSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (phase !== 'onboarding') return;
    if (sessionError) return;
    if (creatingRef.current) return;
    creatingRef.current = true;

    let retryTimer: ReturnType<typeof setTimeout>;
    const instanceUrl = getInstanceUrl();

    (async () => {
      try {
        let finalSessionId: string | null = null;
        let needsCommand = false;

        // 1. Check if the command was already fired (persisted flag survives
        //    page refresh, unlike the in-memory commandFiredRef).
        const alreadyFired = await wasCommandFired();
        if (alreadyFired) {
          commandFiredRef.current = true;
        }

        // 2. Try to resume an existing onboarding session
        const res = await authenticatedFetch(`${instanceUrl}/env/ONBOARDING_SESSION_ID`).catch(() => null);
        const existingId = res?.ok ? (await res.json()).ONBOARDING_SESSION_ID : null;

        if (existingId && existingId !== '' && existingId !== null) {
          try {
            const client = getClient();
            const result = await client.session.get({ sessionID: existingId });
            if (result.data) {
              finalSessionId = existingId;
              // Always inspect messages for liveness. A stale persisted
              // ONBOARDING_COMMAND_FIRED=true can exist even if the command
              // never actually started (network/proxy failure). In that case,
              // re-fire the onboarding command to guarantee progress.
              const msgs = await client.session.messages({ sessionID: existingId });
              const hasAssistantMessage = (msgs.data ?? []).some(
                (m) => m.info?.role === 'assistant',
              );
              if (!hasAssistantMessage) {
                needsCommand = true;
              }
            }
          } catch {
            authenticatedFetch(`${instanceUrl}/env/ONBOARDING_SESSION_ID`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ value: '' }),
            }).catch(() => {});
          }
        }

        // 3. No valid session — create + persist
        if (!finalSessionId) {
          const session = await createSessionRef.current.mutateAsync({ title: 'Kortix Onboarding' });
          persistOnboardingSessionId(session.id);
          finalSessionId = session.id;
          needsCommand = true;
        }

        // 4. Fire /onboarding command if needed.
        //    - commandFiredRef guards within this component lifecycle
        //    - wasCommandFired() guards across page refreshes
        //    - Fire-and-forget via SDK directly (NOT through TanStack Query)
        //      to avoid mutation retry on proxy timeouts. The /command endpoint
        //      blocks until the agent finishes, which can take minutes.
        if (needsCommand && !commandFiredRef.current) {
          commandFiredRef.current = true;
          persistCommandFired(); // persist to sandbox env — survives refresh
          const client = getClient();
          void client.session.command({
            sessionID: finalSessionId,
            command: 'onboarding',
            arguments: '',
          }).catch(() => {
            // Command POST failed or timed out — the agent may still be
            // processing server-side. Do NOT retry; the SSE stream will
            // deliver updates if processing is underway.
            commandFiredRef.current = false;
          });
        }

        // 5. Show the session chat full-page
        commandRetryRef.current = false;
        setOnboardingSessionId(finalSessionId);
        setPhase('session');
      } catch (err) {
        if (isSandboxAuthError(err)) {
          creatingRef.current = false;
          toast.warning('Refreshing sandbox connection…');
          await refreshSandboxRouting();
          retryTimer = setTimeout(() => {
            creatingRef.current = false;
            setRetryTick((t) => t + 1);
          }, 600);
          return;
        }

        if (isTransientSandboxStartupError(err)) {
          creatingRef.current = false;
          setSessionError(false);
          setSessionErrorMessage(null);
          retryTimer = setTimeout(() => {
            creatingRef.current = false;
            setRetryTick((t) => t + 1);
          }, 2000);
          return;
        }

        creatingRef.current = false;
        retriesRef.current += 1;
        const msg = err instanceof Error ? err.message : String(err ?? '');
        setSessionErrorMessage(msg || null);
        if (retriesRef.current >= MAX_RETRIES) {
          setSessionError(true);
          toast.error(msg || 'Could not start onboarding. The sandbox may not be ready — try refreshing.');
        } else {
          const delay = Math.pow(2, retriesRef.current) * 1000;
          toast.warning(`Retrying onboarding session (${retriesRef.current}/${MAX_RETRIES})…`);
          retryTimer = setTimeout(() => {
            creatingRef.current = false;
            setRetryTick((t) => t + 1);
          }, delay);
        }
      }
    })();

    return () => clearTimeout(retryTimer);
  }, [phase, sessionError, retryTick, router, isSandboxAuthError, isTransientSandboxStartupError, refreshSandboxRouting, isInstanceReady]);

  // ── Liveness fallback: if session is mounted but assistant never starts ──
  // This recovers from transient command delivery failures that can leave the
  // chat blank (input visible, but no onboarding messages/questions).
  useEffect(() => {
    if (phase !== 'session') return;
    if (!onboardingSessionId) return;

    const timer = setTimeout(async () => {
      try {
        const client = getClient();
        const msgs = await client.session.messages({ sessionID: onboardingSessionId });
        const hasAssistantMessage = (msgs.data ?? []).some(
          (m) => m.info?.role === 'assistant',
        );
        if (hasAssistantMessage || commandRetryRef.current) return;

        commandRetryRef.current = true;
        commandFiredRef.current = true;
        persistCommandFired();
        void client.session.command({
          sessionID: onboardingSessionId,
          command: 'onboarding',
          arguments: '',
        }).catch(() => {
          commandFiredRef.current = false;
        });
      } catch {
        // ignore — normal session startup flow/polling continues
      }
    }, 8000);

    return () => clearTimeout(timer);
  }, [phase, onboardingSessionId]);

  // ── Poll ONBOARDING_COMPLETE while in session phase ──────────
  // Reads directly from sandbox env — same as Secrets Manager.
  useEffect(() => {
    if (phase !== 'session') return;
    const interval = setInterval(async () => {
      try {
        const instanceUrl = getInstanceUrl();
        if (!instanceUrl) return;
        const res = await authenticatedFetch(`${instanceUrl}/env/ONBOARDING_COMPLETE`);
        if (res.ok) {
          const data = await res.json();
          if (data?.ONBOARDING_COMPLETE === 'true') {
            clearInterval(interval);
            router.replace(buildInstancePath(id, '/dashboard'));
          }
        }
      } catch { /* sandbox not reachable — keep polling */ }
    }, 3000);
    return () => clearInterval(interval);
  }, [phase, router, id]);

  // ── Boot sequence audio ───────────────────────────────────────
  useEffect(() => {
    const audio = new Audio('/sounds/kortix/bootup.wav');
    audio.volume = 0.6;
    audio.preload = 'auto';
    audioRef.current = audio;
    const timers = bootTimers.current;
    return () => {
      audio.pause();
      audioRef.current = null;
      timers.forEach(clearTimeout);
    };
  }, []);

  const startBoot = useCallback(() => {
    const t = bootTimers.current;
    BIOS_LINES.forEach((_, i) => {
      t.push(setTimeout(() => setVisibleLines(i + 1), 100 + i * 160));
    });
    // After all lines appear, show the "Press Enter" prompt
    const allLinesMs = 100 + (BIOS_LINES.length - 1) * 160 + 300;
    t.push(setTimeout(() => setBiosReady(true), allLinesMs));
  }, []);

  const continueBoot = useCallback(() => {
    if (phase !== 'bios' || !biosReady) return;
    audioRef.current?.play().catch(() => {});
    setPhase('logo');
    const t = bootTimers.current;
    t.push(setTimeout(() => setProgressFill(true), 200));
    t.push(setTimeout(() => setPhase('onboarding'), 3400));
  }, [phase, biosReady]);

  // Auto-continue once the BIOS screen is ready. Requiring Enter here makes the
  // onboarding page look blank/stuck after redirect for self-hosted installs.
  useEffect(() => {
    if (phase !== 'bios' || !biosReady) return;
    const id = setTimeout(() => continueBoot(), 600);
    return () => clearTimeout(id);
  }, [phase, biosReady, continueBoot]);

  // Enter key triggers continueBoot during bios phase
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      continueBoot();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [continueBoot]);

  // Auto-start boot on mount — no click needed (skip if we're redirecting away)
  useEffect(() => {
    if (isSkipping) return;
    startBoot();
  }, [startBoot, isSkipping]);

  const activeUser = user || session?.user || null;

  if (isLoading) return null;
  if (!activeUser) return null;

  // Show a minimal loading state when skip is in progress — don't render the
  // full boot sequence which could confuse the user or start sessions.
  if (isSkipping) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex items-center justify-center">
        <LoadingDots />
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-background overflow-hidden">
      <AnimatePresence mode="wait">

        {/* ═══ BIOS POST ═══ */}
        {phase === 'bios' && (
          <motion.div
            key="bios"
            className="absolute inset-0 p-8 sm:p-12"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
          >
            <div className="font-mono text-[13px] sm:text-sm leading-relaxed">
              {BIOS_LINES.slice(0, visibleLines).map((line, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.04 }}
                  className={
                    line.bold
                      ? 'text-foreground font-bold mb-2 tracking-wide'
                      : line.text === ''
                        ? 'h-3'
                        : 'text-foreground/70'
                  }
                >
                  {line.text}
                </motion.div>
              ))}
              {visibleLines > 0 && !biosReady && (
                <motion.span
                  className="inline-block w-2 h-[14px] bg-foreground/70 ml-0.5 mt-0.5"
                  animate={{ opacity: [1, 0] }}
                  transition={{ duration: 0.5, repeat: Infinity }}
                />
              )}
              {biosReady && (
                <motion.div
                  className="mt-5 cursor-pointer"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3 }}
                  onClick={continueBoot}
                >
                  <motion.span
                    className="font-mono text-[13px] sm:text-sm text-foreground/90"
                    animate={{ opacity: [1, 0.3] }}
                    transition={{ duration: 0.7, repeat: Infinity, repeatType: 'reverse' }}
                  >
                    Press Enter to boot...
                  </motion.span>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}

        {/* ═══ LOGO + PROGRESS ═══ */}
        {phase === 'logo' && (
          <motion.div
            key="logo"
            className="absolute inset-0 flex flex-col items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.5 } }}
            transition={{ duration: 0.5 }}
          >
            <motion.div
              className="relative z-10 flex flex-col items-center"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            >
              <svg viewBox="0 0 30 25" className="h-11 sm:h-[52px] w-auto text-foreground">
                <path d={SYMBOL} fill="currentColor" />
              </svg>
              <div className="mt-10 w-44 sm:w-52 h-px bg-foreground/[0.06] overflow-hidden">
                <div
                  className="h-full bg-foreground/30"
                  style={{
                    width: progressFill ? '100%' : '0%',
                    transition: progressFill ? 'width 2.5s cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
                  }}
                />
              </div>
            </motion.div>
          </motion.div>
        )}

        {/* ═══ ONBOARDING — creating session, loading spinner ═══ */}
        {phase === 'onboarding' && (
          <motion.div
            key="onboarding"
            className="absolute inset-0 z-10 flex items-center justify-center"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          >
            <WallpaperBackground />
            <div className="relative z-10 flex flex-col items-center gap-4">
              {sessionError ? (
                <div className="flex flex-col items-center justify-center gap-4 bg-background/95 backdrop-blur-xl rounded-xl border border-border/40 p-8">
                  <p className="text-sm text-muted-foreground text-center max-w-[340px]">
                    {sessionErrorMessage && /provisioning|syncing|still starting|still loading|sandbox is waking up|failed to fetch|networkerror when attempting to fetch resource|load failed/i.test(sessionErrorMessage)
                      ? 'The sandbox is still starting up or reconnecting. Give it a moment, then retry.'
                      : 'Could not connect to the sandbox.'}
                  </p>
                  {sessionErrorMessage && (
                    <p className="text-[11px] text-muted-foreground/50 text-center max-w-[340px] break-words">
                      {sessionErrorMessage}
                    </p>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      retriesRef.current = 0;
                      setSessionError(false);
                      setSessionErrorMessage(null);
                      setRetryTick((t) => t + 1);
                    }}
                  >
                    Retry
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <LoadingDots />
                  <p className="text-xs text-muted-foreground">Setting up your workspace…</p>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* ═══ SESSION — full-screen chat with the onboarding agent ═══ */}
        {phase === 'session' && onboardingSessionId && (
          <motion.div
            key="session"
            className="absolute inset-0 z-10 flex flex-col"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
          >
            {/* Floating KORTIX logo — absolutely positioned, no layout impact */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logomark-white.svg"
              alt="Kortix"
              className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none invert dark:invert-0"
              style={{ height: '16px', width: 'auto' }}
            />
            {/* SSE event stream — must be mounted for messages/questions to flow */}
            <OpenCodeEventStreamProvider />
            {/* Bare sidebar context (no wrapping div) so useSidebar() doesn't crash */}
            <SidebarContext.Provider value={_sidebarStub}>
              <SessionChat sessionId={onboardingSessionId} hideHeader />
            </SidebarContext.Provider>
          </motion.div>
        )}

      </AnimatePresence>

      {phase === 'onboarding' && (
        <button
          onClick={() => signOut()}
          className="absolute bottom-4 left-4 z-30 px-3 py-1 text-[10px] text-foreground/20 hover:text-foreground/40 transition-colors"
        >
          Sign out
        </button>
      )}

      <GlobalProviderModal />
    </div>
  );
}
