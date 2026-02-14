/**
 * Slack webhook handler.
 *
 * Handles incoming Slack Events API payloads, verifies the
 * request signature via HMAC-SHA256, and dispatches messages
 * to the engine.
 *
 * Uses a single /slack/events endpoint for all workspaces.
 * Routes events to the correct channel config via team_id lookup.
 */

import type { Context } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../../../shared/db';
import { channelConfigs } from '@kortix/db';
import type { ChannelConfig } from '@kortix/db';
import type { NormalizedMessage, ChatType } from '../../types';
import type { ChannelEngine } from '../base';
import { WebhookVerificationError } from '../../../errors';
import { config as appConfig } from '../../../config';

// Slack Events API payload types
interface SlackUrlVerification {
  type: 'url_verification';
  challenge: string;
  token: string;
}

interface SlackEventCallback {
  type: 'event_callback';
  token: string;
  team_id: string;
  event: SlackEvent;
  event_id: string;
  event_time: number;
}

interface SlackEvent {
  type: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  channel?: string;
  channel_type?: string; // 'im' | 'channel' | 'group' | 'mpim'
  ts?: string;
  thread_ts?: string;
  event_ts?: string;
}

type SlackPayload = SlackUrlVerification | SlackEventCallback | { type: string };

/**
 * Verify Slack request signature using HMAC-SHA256.
 */
async function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  body: string,
  signature: string,
): Promise<boolean> {
  const basestring = `v0:${timestamp}:${body}`;
  const key = new TextEncoder().encode(signingSecret);
  const message = new TextEncoder().encode(basestring);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, message);
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const expected = `v0=${hex}`;

  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Handle an incoming Slack webhook request.
 *
 * Single endpoint for all workspaces. The signing secret is platform-level
 * (from env). Events are routed to the correct channel config via team_id.
 */
export async function handleSlackWebhook(
  c: Context,
  engine: ChannelEngine,
): Promise<Response> {
  // Read raw body for signature verification
  const rawBody = await c.req.text();

  // Verify signature using platform-level signing secret
  const signingSecret = appConfig.SLACK_SIGNING_SECRET;
  if (signingSecret) {
    const timestamp = c.req.header('X-Slack-Request-Timestamp') || '';
    const signature = c.req.header('X-Slack-Signature') || '';

    // Reject requests older than 5 minutes (replay attack protection)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number(timestamp)) > 300) {
      throw new WebhookVerificationError('Slack request timestamp too old');
    }

    const valid = await verifySlackSignature(signingSecret, timestamp, rawBody, signature);
    if (!valid) {
      throw new WebhookVerificationError('Invalid Slack request signature');
    }
  }

  // Parse payload
  const payload = JSON.parse(rawBody) as SlackPayload;

  // Handle URL verification challenge — no config needed
  if (payload.type === 'url_verification') {
    const verification = payload as SlackUrlVerification;
    return c.json({ challenge: verification.challenge });
  }

  // Only process event_callback
  if (payload.type !== 'event_callback') {
    return c.json({ ok: true });
  }

  const eventPayload = payload as SlackEventCallback;
  const event = eventPayload.event;

  // Only handle message and app_mention events
  if (event.type !== 'message' && event.type !== 'app_mention') {
    return c.json({ ok: true });
  }

  // Skip bot messages
  if (event.bot_id || event.subtype === 'bot_message') {
    return c.json({ ok: true });
  }

  // Skip non-user message subtypes (edits, deletes, etc.)
  if (event.subtype) {
    return c.json({ ok: true });
  }

  // Extract text
  let content = event.text || '';
  if (!content) {
    return c.json({ ok: true });
  }

  // Look up channel config by team_id
  const channelConfig = await findConfigByTeamId(eventPayload.team_id);
  if (!channelConfig) {
    console.warn(`[SLACK] No channel config found for team_id=${eventPayload.team_id}`);
    return c.json({ ok: true });
  }

  const credentials = channelConfig.credentials as Record<string, unknown>;
  const botUserId = credentials?.botUserId as string | undefined;

  // Detect if this is a mention
  const isMention = event.type === 'app_mention';

  // Strip bot mention from text
  if (botUserId) {
    content = content.replace(new RegExp(`<@${botUserId}>`, 'g'), '').trim();
  }

  // Determine chat type
  const chatType = detectChatType(event.channel_type);

  // In group/channel, only respond if mentioned (unless configured otherwise)
  if (chatType === 'group') {
    const platformConfig = channelConfig.platformConfig as Record<string, unknown> | null;
    const groupConfig = (platformConfig?.groups as Record<string, unknown>) ?? {};
    const requireMention = groupConfig.requireMention !== false;

    if (requireMention && !isMention) {
      return c.json({ ok: true });
    }
  }

  // Build normalized message
  const normalized: NormalizedMessage = {
    externalId: event.ts || event.event_ts || '',
    channelType: 'slack',
    channelConfigId: channelConfig.channelConfigId,
    chatType,
    content,
    attachments: [],
    platformUser: {
      id: event.user || '',
      name: event.user || 'Unknown',
    },
    threadId: event.thread_ts,
    groupId: chatType !== 'dm' ? event.channel : undefined,
    isMention,
    raw: eventPayload,
  };

  // Process asynchronously — respond to Slack immediately (3s requirement)
  engine.processMessage(normalized).catch((err) => {
    console.error('[SLACK] Failed to process message:', err);
  });

  return c.json({ ok: true });
}

/**
 * Find the enabled Slack channel config for a given Slack team_id.
 * The team_id is stored in credentials.teamId during OAuth.
 */
async function findConfigByTeamId(teamId: string): Promise<ChannelConfig | null> {
  // Query all enabled slack configs and find the one matching team_id
  const configs = await db
    .select()
    .from(channelConfigs)
    .where(
      and(
        eq(channelConfigs.channelType, 'slack'),
        eq(channelConfigs.enabled, true),
      ),
    );

  for (const cfg of configs) {
    const creds = cfg.credentials as Record<string, unknown>;
    if (creds?.teamId === teamId) {
      return cfg;
    }
  }

  return null;
}

function detectChatType(channelType?: string): ChatType {
  switch (channelType) {
    case 'im':
      return 'dm';
    case 'channel':
    case 'group':
    case 'mpim':
      return 'group';
    default:
      return 'dm';
  }
}
