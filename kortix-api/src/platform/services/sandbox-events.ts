import { EventEmitter } from 'events';
import { eq, sql, and } from 'drizzle-orm';
import { sandboxes } from '@kortix/db';
import { db } from '../../shared/db';

export interface SandboxProvisionEvent {
  sandboxId: string;
  externalId: string;
  event: string;
  stage?: string;
  status?: string;
  message?: string;
  timestamp: string;
}

export type SandboxEventListener = (event: SandboxProvisionEvent) => void;

const STAGE_ORDER: Record<string, number> = {
  server_creating: 1,
  server_created: 2,
  cloud_init_running: 3,
  cloud_init_done: 4,
  docker_pulling: 5,
  docker_running: 6,
  services_starting: 7,
  services_ready: 8,
};

class SandboxEventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(500);
  }

  emit(event: SandboxProvisionEvent): void {
    this.emitter.emit(`sandbox:${event.sandboxId}`, event);
  }

  on(sandboxId: string, listener: SandboxEventListener): void {
    this.emitter.on(`sandbox:${sandboxId}`, listener);
  }

  off(sandboxId: string, listener: SandboxEventListener): void {
    this.emitter.off(`sandbox:${sandboxId}`, listener);
  }

  async processWebhook(payload: {
    event: string;
    data: {
      machineId: string;
      event: string;
      stage?: string;
      status?: string;
      message?: string;
      metadata?: Record<string, unknown>;
      timestamp: string;
    };
  }): Promise<void> {
    const { data } = payload;
    const externalId = data.machineId;

    // Skip heartbeat events — they don't update sandbox state and cause
    // read-modify-write races that clobber stage updates
    if (data.event === 'heartbeat' || payload.event === 'machine.heartbeat') {
      return;
    }

    // Skip test/dummy events immediately
    if (!externalId || externalId === '00000000-0000-0000-0000-000000000000' || payload.event === 'machine.test') {
      return;
    }

    let sandbox: typeof sandboxes.$inferSelect | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      const [row] = await db
        .select()
        .from(sandboxes)
        .where(eq(sandboxes.externalId, externalId))
        .limit(1);
      if (row) { sandbox = row; break; }
      if (attempt < 4) {
        console.log(`[SANDBOX-EVENTS] Sandbox not found for externalId=${externalId}, retrying (${attempt + 1}/5)...`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    if (!sandbox) {
      console.warn(`[SANDBOX-EVENTS] No sandbox found for externalId=${externalId} after retries, dropping event`);
      return;
    }

    const incomingStage = data.stage || '';
    const incomingRank = STAGE_ORDER[incomingStage] ?? 0;

    // Atomic stage update — merge into JSONB with forward-only WHERE clause.
    // No read-modify-write race: the DB enforces ordering in a single UPDATE.
    if (incomingStage && incomingRank > 0) {
      const patch: Record<string, unknown> = {
        provisioningStage: incomingStage,
        provisioningMessage: data.message,
        provisioningUpdatedAt: data.timestamp,
      };
      if (data.stage === 'server_created' && data.metadata?.ip) {
        patch.publicIp = data.metadata.ip;
      }

      // Build the rank check for all stages that are "behind" the incoming one
      const stagesBehind = Object.entries(STAGE_ORDER)
        .filter(([_, rank]) => rank < incomingRank)
        .map(([stage]) => stage);

      // Atomic: only update if current stage is behind incoming stage (or not set)
      const result = await db
        .update(sandboxes)
        .set({
          metadata: sql`metadata || ${JSON.stringify(patch)}::jsonb`,
          updatedAt: new Date(),
          ...(data.stage === 'server_created' && data.metadata?.ip && sandbox.provider === 'justavps' ? (() => {
            const meta = (sandbox.metadata as Record<string, unknown>) ?? {};
            const slug = meta.justavpsSlug as string;
            if (slug) {
              const { JUSTAVPS_PROXY_DOMAIN } = require('../../config').config;
              return { baseUrl: `https://${slug}.${JUSTAVPS_PROXY_DOMAIN}` };
            }
            return {};
          })() : data.stage === 'server_created' && data.metadata?.ip ? { baseUrl: `http://${data.metadata.ip}:8000` } : {}),
        } as any)
        .where(
          and(
            eq(sandboxes.sandboxId, sandbox.sandboxId),
            sql`COALESCE(metadata->>'provisioningStage', '') IN (${sql.join(
              ['', ...stagesBehind].map(s => sql`${s}`),
              sql`, `,
            )})`,
          ),
        );
    }

    // Only provider-confirmed "ready" should flip the sandbox active.
    // services_ready means the VM boot flow finished, but port 8000 / Kortix
    // may still be starting. The billing/setup/status endpoint performs the
    // final /kortix/health check before marking active.
    if (data.status === 'ready') {
      if (sandbox.status === 'provisioning') {
        await db
          .update(sandboxes)
          .set({ status: 'active', updatedAt: new Date() } as any)
          .where(
            and(
              eq(sandboxes.sandboxId, sandbox.sandboxId),
              eq(sandboxes.status, 'provisioning'),
            ),
          );
        console.log(`[SANDBOX-EVENTS] Sandbox ${sandbox.sandboxId} → active`);
      }
    }

    if (data.status === 'error') {
      await db
        .update(sandboxes)
        .set({
          status: 'error',
          metadata: sql`metadata || ${JSON.stringify({ provisioningError: data.message })}::jsonb`,
          updatedAt: new Date(),
        } as any)
        .where(eq(sandboxes.sandboxId, sandbox.sandboxId));
      console.log(`[SANDBOX-EVENTS] Sandbox ${sandbox.sandboxId} → error: ${data.message}`);
    }

    this.emit({
      sandboxId: sandbox.sandboxId,
      externalId,
      event: data.event,
      stage: data.stage,
      status: data.status,
      message: data.message,
      timestamp: data.timestamp,
    });
  }
}

export const sandboxEventBus = new SandboxEventBus();
