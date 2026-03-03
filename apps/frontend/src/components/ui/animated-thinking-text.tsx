'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';

const THINKING_MESSAGES = [
  'Considering next steps...',
  'Analyzing the problem...',
  'Working through the details...',
  'Piecing it together...',
  'Processing information...',
  'Forming a response...',
  'Reasoning through this...',
  'Evaluating options...',
  'Connecting the dots...',
  'Building on context...',
];

const TYPING_SPEED = 24;       // ms per character
const SHIMMER_DURATION = 900;  // ms per shimmer sweep
const SHIMMER_COUNT = 2;       // number of shimmer sweeps
const SHIMMER_GAP = 400;       // ms gap between shimmer sweeps
const CLEAR_DURATION = 300;    // ms for fade-out
const PAUSE_AFTER_CLEAR = 150; // ms pause before next message

type Phase = 'typing' | 'shimmer' | 'clearing';

interface AnimatedThinkingTextProps {
  /** Override text — when provided (e.g. a real status from the server),
   *  it types that text in then shimmers it on loop.
   *  When undefined, cycles through ambient THINKING_MESSAGES. */
  statusText?: string;
  className?: string;
}

function AnimatedThinkingTextComponent({ statusText, className }: AnimatedThinkingTextProps) {
  // ── core state ──
  const [msgIdx, setMsgIdx] = useState(() =>
    Math.floor(Math.random() * THINKING_MESSAGES.length),
  );
  const [phase, setPhase] = useState<Phase>('typing');
  const [visibleText, setVisibleText] = useState('');
  const [opacity, setOpacity] = useState(1);
  const [blur, setBlur] = useState(0);

  // shimmer CSS state
  const [shimmerActive, setShimmerActive] = useState(false);
  const shimmerNodeRef = useRef<HTMLSpanElement>(null);

  // refs that survive across renders
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const charRef = useRef(0);
  const shimmersDone = useRef(0);
  const prevStatus = useRef(statusText);
  const fullText = useRef(
    statusText || THINKING_MESSAGES[msgIdx % THINKING_MESSAGES.length],
  );

  // Resolve the target message for the *current* render.
  // We keep it in a ref so the single‑effect loop always reads the latest.
  const resolveText = useCallback(
    (idx: number) => statusText || THINKING_MESSAGES[idx % THINKING_MESSAGES.length],
    [statusText],
  );

  // ── on statusText change, trigger a clear→retype ──
  useEffect(() => {
    if (statusText === prevStatus.current) return;
    prevStatus.current = statusText;
    // interrupt whatever is running
    clearTimeout(timerRef.current);
    setPhase('clearing');
  }, [statusText]);

  // ── TYPING ──
  useEffect(() => {
    if (phase !== 'typing') return;
    // reset
    fullText.current = resolveText(msgIdx);
    charRef.current = 0;
    setVisibleText('');
    setOpacity(1);
    setBlur(0);
    setShimmerActive(false);

    const tick = () => {
      charRef.current += 1;
      const txt = fullText.current.slice(0, charRef.current);
      setVisibleText(txt);
      if (charRef.current < fullText.current.length) {
        timerRef.current = setTimeout(tick, TYPING_SPEED);
      } else {
        // typing done → shimmer
        shimmersDone.current = 0;
        timerRef.current = setTimeout(() => setPhase('shimmer'), 200);
      }
    };
    timerRef.current = setTimeout(tick, TYPING_SPEED);
    return () => clearTimeout(timerRef.current);
  }, [phase, msgIdx, resolveText]);

  // ── SHIMMER ──
  useEffect(() => {
    if (phase !== 'shimmer') return;

    // Make sure full text is visible (in case of rapid transitions)
    fullText.current = resolveText(msgIdx);
    setVisibleText(fullText.current);
    setOpacity(1);
    setBlur(0);

    let cancelled = false;

    const runSweep = () => {
      if (cancelled) return;
      shimmersDone.current += 1;

      // activate shimmer CSS animation
      setShimmerActive(true);

      // after sweep completes
      timerRef.current = setTimeout(() => {
        if (cancelled) return;
        setShimmerActive(false);

        if (shimmersDone.current < SHIMMER_COUNT) {
          // pause then sweep again
          timerRef.current = setTimeout(runSweep, SHIMMER_GAP);
        } else if (statusText) {
          // real status → loop shimmers indefinitely
          shimmersDone.current = 0;
          timerRef.current = setTimeout(runSweep, SHIMMER_GAP);
        } else {
          // ambient → clear and move on
          timerRef.current = setTimeout(() => setPhase('clearing'), SHIMMER_GAP);
        }
      }, SHIMMER_DURATION);
    };

    // small delay before first sweep
    timerRef.current = setTimeout(runSweep, 100);
    return () => {
      cancelled = true;
      clearTimeout(timerRef.current);
    };
  }, [phase, msgIdx, statusText, resolveText]);

  // ── CLEARING ──
  useEffect(() => {
    if (phase !== 'clearing') return;
    setShimmerActive(false);
    // fade + blur out
    setOpacity(0);
    setBlur(4);

    timerRef.current = setTimeout(() => {
      setMsgIdx((i) => (i + 1) % THINKING_MESSAGES.length);
      setVisibleText('');
      setOpacity(1);
      setBlur(0);
      setPhase('typing');
    }, CLEAR_DURATION + PAUSE_AFTER_CLEAR);

    return () => clearTimeout(timerRef.current);
  }, [phase]);

  // cleanup on unmount
  useEffect(() => () => clearTimeout(timerRef.current), []);

  // ── shimmer background styles (matches TextShimmer gradient approach) ──
  const shimmerStyle: React.CSSProperties = shimmerActive
    ? {
        backgroundImage:
          'linear-gradient(90deg, transparent calc(50% - var(--spread)), var(--highlight), transparent calc(50% + var(--spread))), linear-gradient(var(--base), var(--base))',
        backgroundSize: '250% 100%, auto',
        backgroundRepeat: 'no-repeat, padding-box',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
        animation: `thinking-shimmer ${SHIMMER_DURATION}ms linear forwards`,
        // CSS vars consumed by the gradient
        '--spread': `${(fullText.current.length || 10) * 2}px`,
        '--base': 'var(--shimmer-base)',
        '--highlight': 'var(--shimmer-highlight)',
      } as React.CSSProperties
    : {};

  return (
    <span
      className={cn(
        'relative inline-flex items-center min-h-[1.2em]',
        // CSS custom props for light/dark shimmer colours
        '[--shimmer-base:#a1a1aa] [--shimmer-highlight:#000]',
        'dark:[--shimmer-base:#71717a] dark:[--shimmer-highlight:#fff]',
        className,
      )}
    >
      <span
        ref={shimmerNodeRef}
        className={cn(
          'inline-block transition-[opacity,filter]',
          !shimmerActive && 'text-muted-foreground',
        )}
        style={{
          opacity,
          filter: `blur(${blur}px)`,
          transitionDuration: phase === 'clearing' ? `${CLEAR_DURATION}ms` : '0ms',
          ...shimmerStyle,
        }}
      >
        {visibleText || '\u00A0'}
      </span>
      {/* Blinking cursor during typing */}
      {phase === 'typing' && visibleText.length > 0 && (
        <span
          className="inline-block w-[1px] h-[0.85em] bg-muted-foreground/70 ml-[1px] align-text-bottom animate-cursor-blink"
        />
      )}
    </span>
  );
}

export const AnimatedThinkingText = React.memo(AnimatedThinkingTextComponent);
