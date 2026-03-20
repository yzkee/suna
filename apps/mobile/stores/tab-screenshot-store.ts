/**
 * Tab Screenshot Store — stores captured screenshots for the tabs overview.
 *
 * Screenshots are base64 data URIs captured via react-native-view-shot
 * when the user opens the tabs overview or navigates between tabs.
 * Not persisted — screenshots are transient and recaptured each session.
 */

import { create } from 'zustand';

interface TabScreenshotState {
  /** Map of tabId → file URI of the captured screenshot */
  screenshots: Record<string, string>;
  /** Store a screenshot for a tab */
  setScreenshot: (tabId: string, uri: string) => void;
  /** Remove a screenshot (when tab is closed) */
  removeScreenshot: (tabId: string) => void;
  /** Clear all screenshots */
  clear: () => void;
}

export const useTabScreenshotStore = create<TabScreenshotState>((set) => ({
  screenshots: {},

  setScreenshot: (tabId, uri) =>
    set((state) => ({
      screenshots: { ...state.screenshots, [tabId]: uri },
    })),

  removeScreenshot: (tabId) =>
    set((state) => {
      const { [tabId]: _, ...rest } = state.screenshots;
      return { screenshots: rest };
    }),

  clear: () => set({ screenshots: {} }),
}));
