import { eq, and } from 'drizzle-orm';
import { channelConfigs, sandboxes } from '@kortix/db';
import { db } from '../../shared/db';
import { config } from '../../config';
import { resolveDirectEndpoint } from './opencode-connector';
import type { ChannelType, SandboxTarget } from '../types';

interface ResolvedWebhookTarget {
  url: string;
  headers: Record<string, string>;
}

export async function resolveSandboxEndpointForChannel(
  channelType: ChannelType,
): Promise<ResolvedWebhookTarget> {
  const [channelConfig] = await db
    .select({ sandboxId: channelConfigs.sandboxId })
    .from(channelConfigs)
    .where(
      and(
        eq(channelConfigs.channelType, channelType),
        eq(channelConfigs.enabled, true),
      ),
    )
    .limit(1);

  if (channelConfig?.sandboxId) {
    const [sandbox] = await db
      .select({
        sandboxId: sandboxes.sandboxId,
        baseUrl: sandboxes.baseUrl,
        provider: sandboxes.provider,
        externalId: sandboxes.externalId,
      })
      .from(sandboxes)
      .where(eq(sandboxes.sandboxId, channelConfig.sandboxId))
      .limit(1);

    if (sandbox) {
      return resolveDirectEndpoint(sandbox as SandboxTarget);
    }
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.INTERNAL_SERVICE_KEY) {
    headers['Authorization'] = `Bearer ${config.INTERNAL_SERVICE_KEY}`;
  }
  return { url: `http://localhost:${config.SANDBOX_PORT_BASE || 14000}`, headers };
}
