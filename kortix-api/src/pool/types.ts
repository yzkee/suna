import type { poolResources, poolSandboxes, sandboxes } from '@kortix/db';

export type PoolResource = typeof poolResources.$inferSelect;
export type PoolSandbox = typeof poolSandboxes.$inferSelect;

export interface ClaimedSandbox {
  poolSandbox: PoolSandbox;
  externalId: string;
  baseUrl: string;
  metadata: Record<string, unknown>;
}

export interface PoolStatus {
  resources: PoolResource[];
  ready: number;
  provisioning: number;
}

export interface CreateResult {
  created: number;
  failed: number;
  errors: string[];
}

export interface ClaimOpts {
  serverType?: string;
  location?: string;
}

export interface ResourceInput {
  provider: string;
  serverType: string;
  location: string;
  desiredCount: number;
}
