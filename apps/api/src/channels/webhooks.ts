/**
 * Channel Webhook Forwarder
 *
 * Receives unauthenticated webhook events from platforms (Slack, Telegram, etc.)
 * and forwards them to the correct sandbox's opencode-channels service.
 *
 * Flow: Platform → kortix-api /webhooks/{type} → sandbox:8000/channels/api/webhooks/{type}
 *
 * The sandbox's Kortix Master proxies /channels/* to opencode-channels on port 3456.
 *
 * These routes are PUBLIC (no auth) — platforms can't send JWTs.
 * Security is handled by each adapter (Slack signing secret, Telegram secret token, etc.).
 */

import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '../shared/db';
import { getSandboxBaseUrl } from '../sandbox-proxy/routes/local-preview';
import { config } from '../config';

export const channelWebhooksApp = new Hono();

// ─── Helpers ──────────────────────────────────────────────────────────────────

type ChannelType = 'telegram' | 'slack' | 'discord';

/**
 * Find the sandbox that has an enabled channel of the given type,
 * then return the base URL for that sandbox.
 */
async function resolveSandboxUrl(channelType: ChannelType): Promise<string | null> {
  try {
    const rows = await db.execute(sql`
      SELECT cc.sandbox_id AS "sandboxId",
             s.provider,
             s.base_url AS "baseUrl",
             s.metadata
      FROM kortix.channel_configs cc
      JOIN kortix.sandboxes s ON cc.sandbox_id = s.sandbox_id
      WHERE cc.channel_type = ${channelType}
        AND cc.enabled = true
        AND cc.sandbox_id IS NOT NULL
      LIMIT 1
    `);

    if (!rows.length) return null;

    const sandbox = rows[0] as {
      sandboxId: string;
      provider: string;
      baseUrl: string | null;
      metadata: Record<string, unknown> | null;
    };

    // Cloud (JustAVPS): use the proxy domain with port 3456
    if (sandbox.provider === 'justavps' && sandbox.metadata) {
      const slug = sandbox.metadata.justavpsSlug as string | undefined;
      const proxyToken = sandbox.metadata.justavpsProxyToken as string | undefined;
      if (slug && proxyToken && config.JUSTAVPS_PROXY_DOMAIN) {
        return `https://3456--${slug}.${config.JUSTAVPS_PROXY_DOMAIN}?__proxy_token=${proxyToken}`;
      }
    }

    // Cloud: use baseUrl if set
    if (sandbox.baseUrl) {
      return sandbox.baseUrl;
    }

    // Local: Docker DNS or localhost
    return getSandboxBaseUrl(sandbox.sandboxId);
  } catch (err) {
    console.error(`[channel-webhooks] Failed to resolve sandbox for ${channelType}:`, err);
    return null;
  }
}

/**
 * Forward a webhook request to the sandbox's opencode-channels service.
 */
async function forwardWebhook(
  channelType: ChannelType,
  c: { req: { raw: Request; header: (name: string) => string | undefined } },
): Promise<Response> {
  const sandboxUrl = await resolveSandboxUrl(channelType);
  if (!sandboxUrl) {
    console.warn(`[channel-webhooks] No enabled ${channelType} channel with linked sandbox`);
    return new Response('No channel configured', { status: 404 });
  }

  const rawBody = await c.req.raw.clone().arrayBuffer();

  // Build target URL — for cloud (3456 port proxy), hit the webhook directly.
  // For local/Docker, go through Kortix Master's /channels/ proxy.
  let targetUrl: string;
  if (sandboxUrl.includes('3456--')) {
    // Cloud: opencode-channels is directly exposed on port 3456
    targetUrl = `${sandboxUrl.split('?')[0]}/api/webhooks/${channelType}`;
    const proxyToken = new URL(sandboxUrl).searchParams.get('__proxy_token');
    if (proxyToken) {
      targetUrl += `?__proxy_token=${proxyToken}`;
    }
  } else {
    // Local/Docker: go through Kortix Master's /channels/ proxy
    targetUrl = `${sandboxUrl}/channels/api/webhooks/${channelType}`;
  }

  // Forward relevant headers
  const headers: Record<string, string> = {
    'Content-Type': c.req.header('Content-Type') || 'application/json',
  };

  // Telegram secret token header
  const telegramSecret = c.req.header('X-Telegram-Bot-Api-Secret-Token');
  if (telegramSecret) {
    headers['X-Telegram-Bot-Api-Secret-Token'] = telegramSecret;
  }

  // Slack signing headers
  const slackSig = c.req.header('X-Slack-Signature');
  const slackTs = c.req.header('X-Slack-Request-Timestamp');
  if (slackSig) headers['X-Slack-Signature'] = slackSig;
  if (slackTs) headers['X-Slack-Request-Timestamp'] = slackTs;

  console.log(`[channel-webhooks] Forwarding ${channelType} webhook to ${targetUrl}`);

  try {
    const resp = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: rawBody,
      signal: AbortSignal.timeout(30_000),
    });

    // Return the response from opencode-channels
    const body = await resp.text();
    return new Response(body, {
      status: resp.status,
      headers: { 'Content-Type': resp.headers.get('Content-Type') || 'text/plain' },
    });
  } catch (err) {
    console.error(`[channel-webhooks] Failed to forward ${channelType} webhook:`, err);
    return new Response('Webhook forwarding failed', { status: 502 });
  }
}

// ─── Routes (mounted at /webhooks) ──────────────────────────────────────────

// Slack — single endpoint handles events, commands, and interactivity
channelWebhooksApp.post('/slack', (c: any) => forwardWebhook('slack', c));
channelWebhooksApp.post('/slack/events', (c: any) => forwardWebhook('slack', c));
channelWebhooksApp.post('/slack/commands', (c: any) => forwardWebhook('slack', c));
channelWebhooksApp.post('/slack/interactivity', (c: any) => forwardWebhook('slack', c));

// Telegram
channelWebhooksApp.post('/telegram', (c: any) => forwardWebhook('telegram', c));

// Discord (future)
channelWebhooksApp.post('/discord', (c: any) => forwardWebhook('discord', c));
