import { EventEmitter } from 'events';
import { eq } from 'drizzle-orm';
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

    const currentMeta = (sandbox.metadata as Record<string, unknown>) ?? {};
    const updatedMeta: Record<string, unknown> = {
      ...currentMeta,
      provisioningStage: data.stage || data.status,
      provisioningMessage: data.message,
      provisioningUpdatedAt: data.timestamp,
    };

    const updates: Record<string, unknown> = {
      metadata: updatedMeta,
      updatedAt: new Date(),
    };

    if (data.stage === 'server_created' && data.metadata?.ip) {
      const ip = data.metadata.ip as string;
      updates.baseUrl = `http://${ip}:8000`;
      updatedMeta.publicIp = ip;
      console.log(`[SANDBOX-EVENTS] Sandbox ${sandbox.sandboxId} baseUrl → http://${ip}:8000`);
    }

    if (data.stage === 'services_ready' || data.status === 'ready') {
      if (sandbox.status === 'provisioning') {
        updates.status = 'active';
        console.log(`[SANDBOX-EVENTS] Sandbox ${sandbox.sandboxId} → active (services_ready)`);
      }
    }

    if (data.status === 'error') {
      updates.status = 'error';
      console.log(`[SANDBOX-EVENTS] Sandbox ${sandbox.sandboxId} → error: ${data.message}`);
    }

    await db
      .update(sandboxes)
      .set(updates as any)
      .where(eq(sandboxes.sandboxId, sandbox.sandboxId));

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
