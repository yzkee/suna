/**
 * Local config hook — manages selected agent, model, and variant state.
 *
 * Mirrors the frontend's use-opencode-local.ts pattern:
 * - Persists per-agent model selections
 * - Resolves model fallback chain
 * - Manages variant (thinking mode) cycling
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Agent, FlatModel, OpenCodeConfig } from './use-opencode-data';

// ─── Persistent store ────────────────────────────────────────────────────────

interface LocalConfigState {
  /** Selected agent name */
  selectedAgent: string | null;
  /** Per-agent model selections: agentName -> { providerID, modelID } */
  agentModels: Record<string, { providerID: string; modelID: string }>;
  /** Per-model variant selections: "providerID/modelID" -> variantName */
  modelVariants: Record<string, string>;

  setAgent: (name: string | null) => void;
  setModelForAgent: (
    agentName: string,
    model: { providerID: string; modelID: string },
  ) => void;
  setVariant: (modelKey: string, variant: string | null) => void;
}

export const useLocalConfigStore = create<LocalConfigState>()(
  persist(
    (set) => ({
      selectedAgent: null,
      agentModels: {},
      modelVariants: {},

      setAgent: (name) => set({ selectedAgent: name }),

      setModelForAgent: (agentName, model) =>
        set((s) => ({
          agentModels: { ...s.agentModels, [agentName]: model },
        })),

      setVariant: (modelKey, variant) =>
        set((s) => {
          const newVariants = { ...s.modelVariants };
          if (variant === null) {
            delete newVariants[modelKey];
          } else {
            newVariants[modelKey] = variant;
          }
          return { modelVariants: newVariants };
        }),
    }),
    {
      name: 'opencode-local-config',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

// ─── Resolved config hook ────────────────────────────────────────────────────

export interface ResolvedConfig {
  agent: Agent | null;
  agents: Agent[];
  model: FlatModel | null;
  modelKey: { providerID: string; modelID: string } | null;
  variant: string | null;
  variants: string[];
  setAgent: (name: string) => void;
  setModel: (providerID: string, modelID: string) => void;
  cycleVariant: () => void;
}

export function useResolvedConfig(
  agents: Agent[],
  models: FlatModel[],
  config: OpenCodeConfig | undefined,
  defaults: Record<string, string>,
): ResolvedConfig {
  const store = useLocalConfigStore();

  // ── Resolve agent ──
  const primaryAgents = agents.filter((a) => a.mode === 'primary' || a.mode === 'all');
  const agent =
    primaryAgents.find((a) => a.name === store.selectedAgent) ||
    primaryAgents[0] ||
    null;

  // ── Resolve model (fallback chain) ──
  const agentName = agent?.name || '_default';

  // 1. Persisted per-agent selection
  const persisted = store.agentModels[agentName];
  let model: FlatModel | null = null;

  if (persisted) {
    model =
      models.find(
        (m) => m.providerID === persisted.providerID && m.modelID === persisted.modelID,
      ) || null;
  }

  // 2. Agent's configured model
  if (!model && agent?.model) {
    model =
      models.find(
        (m) =>
          m.providerID === agent.model!.providerID &&
          m.modelID === agent.model!.modelID,
      ) || null;
  }

  // 3. Config model ("provider/modelId")
  if (!model && config?.model) {
    const [pid, ...rest] = config.model.split('/');
    const mid = rest.join('/');
    model = models.find((m) => m.providerID === pid && m.modelID === mid) || null;
  }

  // 4. Provider defaults
  if (!model) {
    for (const [pid, mid] of Object.entries(defaults)) {
      model = models.find((m) => m.providerID === pid && m.modelID === mid) || null;
      if (model) break;
    }
  }

  // 5. First available
  if (!model && models.length > 0) {
    model = models[0];
  }

  // ── Resolve variant ──
  const modelKey = model ? `${model.providerID}/${model.modelID}` : '';
  const variants = model?.variants ? Object.keys(model.variants) : [];
  const variant = modelKey ? (store.modelVariants[modelKey] ?? null) : null;

  // ── Actions ──
  const setAgent = (name: string) => {
    store.setAgent(name);
  };

  const setModel = (providerID: string, modelID: string) => {
    store.setModelForAgent(agentName, { providerID, modelID });
  };

  const cycleVariant = () => {
    if (!modelKey || variants.length === 0) return;
    const currentIdx = variant ? variants.indexOf(variant) : -1;
    const nextIdx = currentIdx + 1;
    if (nextIdx >= variants.length) {
      // Back to default (null)
      store.setVariant(modelKey, null);
    } else {
      store.setVariant(modelKey, variants[nextIdx]);
    }
  };

  return {
    agent,
    agents: primaryAgents,
    model,
    modelKey: model ? { providerID: model.providerID, modelID: model.modelID } : null,
    variant,
    variants,
    setAgent,
    setModel,
    cycleVariant,
  };
}
