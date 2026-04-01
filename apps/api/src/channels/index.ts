/**
 * Channels Sub-Service
 *
 * CRUD for channel configurations (Slack, Discord, Telegram, etc.).
 * Each channel config records which platform is connected, which sandbox
 * it's linked to, and lightweight metadata (name, instructions, selected agent/model, etc.).
 *
 * Credentials are NOT stored here — they live in the sandbox's SecretStore
 * (pushed as env vars). The actual bot runtime is `opencode-channels`
 * running inside the sandbox.
 *
 * Routes (mounted at /v1/channels):
 *   GET    /              — list channels for the authenticated account
 *   POST   /              — create a channel config
 *   GET    /:id           — get a single channel config
 *   PATCH  /:id           — update channel config
 *   DELETE /:id           — delete a channel config
 *   POST   /:id/enable    — set enabled=true
 *   POST   /:id/disable   — set enabled=false
 */

import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '../shared/db';
import { resolveAccountId } from '../shared/resolve-account';
import { slackWizardApp } from './slack-wizard';

export const channelsApp = new Hono();

// Slack wizard routes: /v1/channels/slack-wizard/detect-url, /v1/channels/slack-wizard/generate-manifest
channelsApp.route('/slack-wizard', slackWizardApp);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Standard SELECT for channel_configs with sandbox join. */
const CHANNEL_SELECT = sql`
  SELECT
    cc.channel_config_id   AS "channelConfigId",
    cc.account_id          AS "accountId",
    cc.sandbox_id          AS "sandboxId",
    cc.channel_type        AS "channelType",
    cc.name,
    cc.enabled,
    cc.platform_config     AS "platformConfig",
    cc.instructions        AS "instructions",
    cc.agent_name          AS "agentName",
    cc.metadata,
    cc.created_at          AS "createdAt",
    cc.updated_at          AS "updatedAt",
    s.name                 AS "sandboxName",
    s.status               AS "sandboxStatus"
  FROM kortix.channel_configs cc
  LEFT JOIN kortix.sandboxes s ON cc.sandbox_id = s.sandbox_id
`;

function formatRow(r: any) {
  return {
    channelConfigId: r.channelConfigId,
    accountId: r.accountId,
    sandboxId: r.sandboxId ?? null,
    channelType: r.channelType,
    name: r.name,
    enabled: r.enabled,
    platformConfig: r.platformConfig ?? {},
    instructions: r.instructions ?? null,
    agentName: r.agentName ?? null,
    metadata: r.metadata ?? {},
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    ...(r.sandboxName
      ? { sandbox: { name: r.sandboxName, status: r.sandboxStatus ?? 'unknown' } }
      : {}),
  };
}

async function resolveChannelAccount(c: any): Promise<string> {
  const direct = c.get('accountId') as string | undefined;
  if (direct) return direct;
  const userId = c.get('userId') as string | undefined;
  if (userId) return resolveAccountId(userId);
  throw new Error('Unable to determine account');
}

// ─── GET /internal/config/:id ───────────────────────────────────────────────
// Sandbox/channels runtime lookup. Authenticated via sandbox api key / KORTIX_TOKEN.

channelsApp.get('/internal/config/:id', async (c: any) => {
  const id = c.req.param('id');
  try {
    const accountId = await resolveChannelAccount(c);
    const rows = await db.execute(sql`
      ${CHANNEL_SELECT}
      WHERE cc.channel_config_id = ${id} AND cc.account_id = ${accountId}
      LIMIT 1
    `);
    if (!rows.length) return c.json({ success: false, error: 'Channel not found' }, 404);
    return c.json({ success: true, data: formatRow(rows[0]) });
  } catch (err) {
    console.error('[channels] GET /internal/config/:id error:', err);
    return c.json({ success: false, error: 'Failed to fetch channel config' }, 500);
  }
});

// ─── GET / ────────────────────────────────────────────────────────────────────

channelsApp.get('/', async (c: any) => {
  const accountId = c.get('userId') as string;
  const sandboxId = c.req.query('sandbox_id');

  try {
    const rows = await db.execute(sql`
      ${CHANNEL_SELECT}
      WHERE cc.account_id = ${accountId}
      ${sandboxId ? sql`AND cc.sandbox_id = ${sandboxId}` : sql``}
      ORDER BY cc.created_at DESC
    `);

    return c.json({ success: true, data: rows.map(formatRow), total: rows.length });
  } catch (err) {
    console.error('[channels] GET / error:', err);
    return c.json({ success: false, error: 'Failed to fetch channels' }, 500);
  }
});

// ─── POST / ───────────────────────────────────────────────────────────────────

channelsApp.post('/', async (c: any) => {
  const accountId = c.get('userId') as string;

  try {
    const body = await c.req.json();
    const {
      sandbox_id = null,
      channel_type,
      name,
      enabled = true,
      platform_config = {},
      instructions = null,
      agent_name = null,
      metadata = {},
    } = body;

    if (!channel_type || !name) {
      return c.json({ success: false, error: 'channel_type and name are required' }, 400);
    }

    const rows = await db.execute(sql`
      INSERT INTO kortix.channel_configs
         (account_id, sandbox_id, channel_type, name, enabled, platform_config,
          instructions, agent_name, metadata)
      VALUES
        (${accountId}, ${sandbox_id}, ${channel_type}::kortix.channel_type, ${name}, ${enabled},
         ${JSON.stringify(platform_config)}::jsonb,
         ${instructions}, ${agent_name}, ${JSON.stringify(metadata)}::jsonb)
      RETURNING
        channel_config_id AS "channelConfigId",
        account_id AS "accountId",
        sandbox_id AS "sandboxId",
        channel_type AS "channelType",
        name, enabled,
        platform_config AS "platformConfig",
        instructions AS "instructions",
        agent_name AS "agentName",
        metadata,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `);

    return c.json({ success: true, data: formatRow(rows[0]) }, 201);
  } catch (err) {
    console.error('[channels] POST / error:', err);
    return c.json({ success: false, error: 'Failed to create channel' }, 500);
  }
});

// ─── GET /:id ─────────────────────────────────────────────────────────────────

channelsApp.get('/:id', async (c: any) => {
  const accountId = c.get('userId') as string;
  const id = c.req.param('id');

  if (!id.match(/^[0-9a-f-]{36}$/i)) {
    return c.json({ success: false, error: 'Invalid channel id' }, 400);
  }

  try {
    const rows = await db.execute(sql`
      ${CHANNEL_SELECT}
      WHERE cc.channel_config_id = ${id} AND cc.account_id = ${accountId}
      LIMIT 1
    `);

    if (!rows.length) return c.json({ success: false, error: 'Channel not found' }, 404);
    return c.json({ success: true, data: formatRow(rows[0]) });
  } catch (err) {
    console.error('[channels] GET /:id error:', err);
    return c.json({ success: false, error: 'Failed to fetch channel' }, 500);
  }
});

// ─── PATCH /:id ───────────────────────────────────────────────────────────────

channelsApp.patch('/:id', async (c: any) => {
  const accountId = c.get('userId') as string;
  const id = c.req.param('id');

  try {
    const body = await c.req.json();

    const setClauses: ReturnType<typeof sql>[] = [sql`updated_at = now()`];
    if (body.name !== undefined) setClauses.push(sql`name = ${body.name}`);
    if (body.enabled !== undefined) setClauses.push(sql`enabled = ${body.enabled}`);
    if (body.platform_config !== undefined)
      setClauses.push(sql`platform_config = ${JSON.stringify(body.platform_config)}::jsonb`);
    if (body.instructions !== undefined)
      setClauses.push(sql`instructions = ${body.instructions}`);
    if (body.agent_name !== undefined) setClauses.push(sql`agent_name = ${body.agent_name}`);
    if (body.metadata !== undefined)
      setClauses.push(sql`metadata = ${JSON.stringify(body.metadata)}::jsonb`);
    if (body.sandbox_id !== undefined) setClauses.push(sql`sandbox_id = ${body.sandbox_id}`);

    const setClause = sql.join(setClauses, sql`, `);

    const rows = await db.execute(sql`
      UPDATE kortix.channel_configs
      SET ${setClause}
      WHERE channel_config_id = ${id} AND account_id = ${accountId}
      RETURNING
        channel_config_id AS "channelConfigId",
        account_id AS "accountId",
        sandbox_id AS "sandboxId",
        channel_type AS "channelType",
        name, enabled,
        platform_config AS "platformConfig",
        instructions AS "instructions",
        agent_name AS "agentName",
        metadata, created_at AS "createdAt", updated_at AS "updatedAt"
    `);

    if (!rows.length) return c.json({ success: false, error: 'Channel not found' }, 404);
    return c.json({ success: true, data: formatRow(rows[0]) });
  } catch (err) {
    console.error('[channels] PATCH /:id error:', err);
    return c.json({ success: false, error: 'Failed to update channel' }, 500);
  }
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────

channelsApp.delete('/:id', async (c: any) => {
  const accountId = c.get('userId') as string;
  const id = c.req.param('id');

  try {
    const rows = await db.execute(sql`
      DELETE FROM kortix.channel_configs
      WHERE channel_config_id = ${id} AND account_id = ${accountId}
      RETURNING channel_config_id AS "channelConfigId"
    `);
    if (!rows.length) return c.json({ success: false, error: 'Channel not found' }, 404);
    return c.json({ success: true });
  } catch (err) {
    console.error('[channels] DELETE /:id error:', err);
    return c.json({ success: false, error: 'Failed to delete channel' }, 500);
  }
});

// ─── POST /:id/enable ─────────────────────────────────────────────────────────

channelsApp.post('/:id/enable', async (c: any) => {
  const accountId = c.get('userId') as string;
  const id = c.req.param('id');
  try {
    const rows = await db.execute(sql`
      UPDATE kortix.channel_configs SET enabled = true, updated_at = now()
      WHERE channel_config_id = ${id} AND account_id = ${accountId}
      RETURNING channel_config_id AS "channelConfigId", enabled, updated_at AS "updatedAt"
    `);
    if (!rows.length) return c.json({ success: false, error: 'Channel not found' }, 404);
    return c.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[channels] POST /:id/enable error:', err);
    return c.json({ success: false, error: 'Failed to enable channel' }, 500);
  }
});

// ─── POST /:id/disable ───────────────────────────────────────────────────────

channelsApp.post('/:id/disable', async (c: any) => {
  const accountId = c.get('userId') as string;
  const id = c.req.param('id');
  try {
    const rows = await db.execute(sql`
      UPDATE kortix.channel_configs SET enabled = false, updated_at = now()
      WHERE channel_config_id = ${id} AND account_id = ${accountId}
      RETURNING channel_config_id AS "channelConfigId", enabled, updated_at AS "updatedAt"
    `);
    if (!rows.length) return c.json({ success: false, error: 'Channel not found' }, 404);
    return c.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[channels] POST /:id/disable error:', err);
    return c.json({ success: false, error: 'Failed to disable channel' }, 500);
  }
});
