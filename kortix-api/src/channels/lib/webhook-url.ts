import { eq, and } from 'drizzle-orm';
import { sandboxes } from '@kortix/db';
import { db } from '../../shared/db';
import { config } from '../../config';
import type { ChannelType } from '../types';

interface WebhookUrlResult {
  webhook_url: string;
  proxy_token?: string;
  channel_type: ChannelType;
}

export function buildPlatformWebhookUrl(channelType: ChannelType): string {
  const base = config.KORTIX_URL.replace(/\/v1\/router\/?$/, '').replace(/\/$/, '');
  return `${base}/webhooks/${channelType}`;
}

export async function buildDirectWebhookUrl(
  sandboxId: string,
  channelType: ChannelType,
): Promise<WebhookUrlResult | null> {
  const [sandbox] = await db
    .select({
      provider: sandboxes.provider,
      metadata: sandboxes.metadata,
    })
    .from(sandboxes)
    .where(eq(sandboxes.sandboxId, sandboxId))
    .limit(1);

  if (!sandbox) return null;

  const meta = (sandbox.metadata || {}) as Record<string, unknown>;
  const slug = meta.justavpsSlug as string | undefined;
  const proxyToken = meta.justavpsProxyToken as string | undefined;

  if (sandbox.provider === 'justavps' && slug && proxyToken) {
    const proxyDomain = config.JUSTAVPS_PROXY_DOMAIN;
    const url = `https://3456--${slug}.${proxyDomain}/api/webhooks/${channelType}?__proxy_token=${proxyToken}`;
    return { webhook_url: url, proxy_token: proxyToken, channel_type: channelType };
  }
  return { webhook_url: buildPlatformWebhookUrl(channelType), channel_type: channelType };
}

export async function resolveWebhookUrl(
  sandboxId: string | null,
  channelType: ChannelType,
): Promise<WebhookUrlResult> {
  if (sandboxId) {
    const direct = await buildDirectWebhookUrl(sandboxId, channelType);
    if (direct) return direct;
  }

  return { webhook_url: buildPlatformWebhookUrl(channelType), channel_type: channelType };
}
