/**
 * Marketplace Store — tracks which marketplace skills are installed or skipped.
 * 
 * Uses localStorage to persist:
 * - installed: Set of skill names that user has installed
 * - skipped: Set of skill names user has explicitly skipped
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface MarketplaceState {
  installed: string[];
  skipped: string[];
  
  // Actions
  markInstalled: (skillName: string) => void;
  markSkipped: (skillName: string) => void;
  unmark: (skillName: string) => void;
  isInstalled: (skillName: string) => boolean;
  isSkipped: (skillName: string) => boolean;
}

export const useMarketplaceStore = create<MarketplaceState>()(
  persist(
    (set, get) => ({
      installed: [],
      skipped: [],
      
      markInstalled: (skillName: string) =>
        set((state) => ({
          installed: [...state.installed, skillName],
          skipped: state.skipped.filter((s) => s !== skillName),
        })),
      
      markSkipped: (skillName: string) =>
        set((state) => ({
          skipped: [...state.skipped, skillName],
          installed: state.installed.filter((s) => s !== skillName),
        })),
      
      unmark: (skillName: string) =>
        set((state) => ({
          installed: state.installed.filter((s) => s !== skillName),
          skipped: state.skipped.filter((s) => s !== skillName),
        })),
      
      isInstalled: (skillName: string) => get().installed.includes(skillName),
      
      isSkipped: (skillName: string) => get().skipped.includes(skillName),
    }),
    {
      name: 'kortix-marketplace',
    }
  )
);
