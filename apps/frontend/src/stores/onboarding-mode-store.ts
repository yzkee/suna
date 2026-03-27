import { create } from 'zustand';

interface OnboardingModeState {
  /** Dashboard is in onboarding mode (full-screen thread, no chrome) */
  active: boolean;
  /** Sidebars are animating in (onboarding → dashboard morph) */
  morphing: boolean;
  /** Show BIOS + logo boot overlay */
  showBoot: boolean;
  /** Onboarding session ID once created/resumed */
  sessionId: string | null;

  enter: (opts?: { skipBoot?: boolean }) => void;
  setSessionId: (id: string | null) => void;
  hideBoot: () => void;
  morph: () => void;
  done: () => void;
}

export const useOnboardingModeStore = create<OnboardingModeState>((set) => ({
  active: false,
  morphing: false,
  showBoot: false,
  sessionId: null,

  enter: (opts) => set({ active: true, showBoot: !opts?.skipBoot, morphing: false, sessionId: null }),
  setSessionId: (id) => set({ sessionId: id }),
  hideBoot: () => set({ showBoot: false }),
  morph: () => set({ morphing: true }),
  done: () => set({ active: false, morphing: false, sessionId: null, showBoot: false }),
}));
