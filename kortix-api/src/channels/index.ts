/**
 * Channels Sub-Service
 *
 * Manages channel configurations (Slack, Discord, Telegram, etc.).
 * Uses the existing kortix.channel_configs and related tables already
 * present in the DB (managed by the channels migration, not Drizzle push).
 *
 * Routes (mounted at /v1/channels):
 *   GET    /                     — list channels for the authenticated account
 *   POST   /                     — create a channel config
 *   GET    /:id                  — get a single channel config
 *   PATCH  /:id                  — update channel config
 *   DELETE /:id                  — delete a channel config
 *   POST   /:id/enable           — set enabled=true
 *   POST   /:id/disable          — set enabled=false
 *   POST   /:id/link             — link channel to a sandbox
 *   POST   /:id/unlink           — unlink channel from a sandbox
 *   GET    /:id/messages         — paginated message history
 *   GET    /:channelId/sessions  — list opencode sessions for this channel
 */

import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '../shared/db';

// ─── Router ───────────────────────────────────────────────────────────────────

export const channelsApp = new Hono();

// GET / — list all channel configs for account, left-joined with sandbox name
channelsApp.get('/', async (c: any) => {
  const accountId = c.get('userId') as string;
  const sandboxId = c.req.query('sandbox_id');

  try {
    const rows = await db.execute(sql`
      SELECT
        cc.channel_config_id   AS "channelConfigId",
        cc.account_id          AS "accountId",
        cc.sandbox_id          AS "sandboxId",
        cc.channel_type        AS "channelType",
        cc.name,
        cc.enabled,
        cc.platform_config     AS "platformConfig",
        cc.session_strategy    AS "sessionStrategy",
        cc.system_prompt       AS "systemPrompt",
        cc.agent_name          AS "agentName",
        cc.metadata,
        cc.created_at          AS "createdAt",
        cc.updated_at          AS "updatedAt",
        s.name                 AS "sandboxName",
        s.status               AS "sandboxStatus"
      FROM kortix.channel_configs cc
      LEFT JOIN kortix.sandboxes s ON cc.sandbox_id = s.sandbox_id
      WHERE cc.account_id = ${accountId}
      ${sandboxId ? sql`AND cc.sandbox_id = ${sandboxId}` : sql``}
      ORDER BY cc.created_at DESC
    `);

    const data = rows.map((r: any) => ({
      channelConfigId: r.channelConfigId,
      accountId: r.accountId,
      sandboxId: r.sandboxId ?? null,
      channelType: r.channelType,
      name: r.name,
      enabled: r.enabled,
      credentials: {},   // credentials are in channel_platform_credentials, not exposed here
      platformConfig: r.platformConfig ?? {},
      sessionStrategy: r.sessionStrategy,
      systemPrompt: r.systemPrompt ?? null,
      agentName: r.agentName ?? null,
      metadata: r.metadata ?? {},
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      ...(r.sandboxName ? { sandbox: { name: r.sandboxName, status: r.sandboxStatus ?? 'unknown' } } : {}),
    }));

    return c.json({ success: true, data, total: data.length });
  } catch (err) {
    console.error('[channels] GET / error:', err);
    return c.json({ success: false, error: 'Failed to fetch channels' }, 500);
  }
});

// POST / — create a channel config
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
      session_strategy = 'per-thread',
      system_prompt = null,
      agent_name = null,
      metadata = {},
    } = body;

    if (!channel_type || !name) {
      return c.json({ success: false, error: 'channel_type and name are required' }, 400);
    }

    const rows = await db.execute(sql`
      INSERT INTO kortix.channel_configs
        (account_id, sandbox_id, channel_type, name, enabled, platform_config, session_strategy, system_prompt, agent_name, metadata)
      VALUES
        (${accountId}, ${sandbox_id}, ${channel_type}::kortix.channel_type, ${name}, ${enabled},
         ${JSON.stringify(platform_config)}::jsonb, ${session_strategy}::kortix.session_strategy,
         ${system_prompt}, ${agent_name}, ${JSON.stringify(metadata)}::jsonb)
      RETURNING
        channel_config_id AS "channelConfigId",
        account_id AS "accountId",
        sandbox_id AS "sandboxId",
        channel_type AS "channelType",
        name,
        enabled,
        platform_config AS "platformConfig",
        session_strategy AS "sessionStrategy",
        system_prompt AS "systemPrompt",
        agent_name AS "agentName",
        metadata,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `);

    const r: any = rows[0];
    return c.json({
      success: true,
      data: {
        channelConfigId: r.channelConfigId,
        accountId: r.accountId,
        sandboxId: r.sandboxId ?? null,
        channelType: r.channelType,
        name: r.name,
        enabled: r.enabled,
        credentials: {},
        platformConfig: r.platformConfig ?? {},
        sessionStrategy: r.sessionStrategy,
        systemPrompt: r.systemPrompt ?? null,
        agentName: r.agentName ?? null,
        metadata: r.metadata ?? {},
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      },
    }, 201);
  } catch (err) {
    console.error('[channels] POST / error:', err);
    return c.json({ success: false, error: 'Failed to create channel' }, 500);
  }
});

// GET /:id — get single channel config
channelsApp.get('/:id', async (c: any) => {
  const accountId = c.get('userId') as string;
  const id = c.req.param('id');

  // Guard: don't accidentally match sub-resource routes
  if (!id.match(/^[0-9a-f-]{36}$/i)) {
    return c.json({ success: false, error: 'Invalid channel id' }, 400);
  }

  try {
    const rows = await db.execute(sql`
      SELECT
        cc.channel_config_id   AS "channelConfigId",
        cc.account_id          AS "accountId",
        cc.sandbox_id          AS "sandboxId",
        cc.channel_type        AS "channelType",
        cc.name,
        cc.enabled,
        cc.platform_config     AS "platformConfig",
        cc.session_strategy    AS "sessionStrategy",
        cc.system_prompt       AS "systemPrompt",
        cc.agent_name          AS "agentName",
        cc.metadata,
        cc.created_at          AS "createdAt",
        cc.updated_at          AS "updatedAt",
        s.name                 AS "sandboxName",
        s.status               AS "sandboxStatus"
      FROM kortix.channel_configs cc
      LEFT JOIN kortix.sandboxes s ON cc.sandbox_id = s.sandbox_id
      WHERE cc.channel_config_id = ${id} AND cc.account_id = ${accountId}
      LIMIT 1
    `);

    if (!rows.length) return c.json({ success: false, error: 'Channel not found' }, 404);

    const r: any = rows[0];
    return c.json({
      success: true,
      data: {
        channelConfigId: r.channelConfigId,
        accountId: r.accountId,
        sandboxId: r.sandboxId ?? null,
        channelType: r.channelType,
        name: r.name,
        enabled: r.enabled,
        credentials: {},
        platformConfig: r.platformConfig ?? {},
        sessionStrategy: r.sessionStrategy,
        systemPrompt: r.systemPrompt ?? null,
        agentName: r.agentName ?? null,
        metadata: r.metadata ?? {},
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        ...(r.sandboxName ? { sandbox: { name: r.sandboxName, status: r.sandboxStatus ?? 'unknown' } } : {}),
      },
    });
  } catch (err) {
    console.error('[channels] GET /:id error:', err);
    return c.json({ success: false, error: 'Failed to fetch channel' }, 500);
  }
});

// PATCH /:id
channelsApp.patch('/:id', async (c: any) => {
  const accountId = c.get('userId') as string;
  const id = c.req.param('id');

  try {
    const body = await c.req.json();

    // Build SET clauses dynamically only for provided fields
    const setClauses: ReturnType<typeof sql>[] = [sql`updated_at = now()`];
    if (body.name !== undefined) setClauses.push(sql`name = ${body.name}`);
    if (body.enabled !== undefined) setClauses.push(sql`enabled = ${body.enabled}`);
    if (body.platform_config !== undefined) setClauses.push(sql`platform_config = ${JSON.stringify(body.platform_config)}::jsonb`);
    if (body.session_strategy !== undefined) setClauses.push(sql`session_strategy = ${body.session_strategy}::kortix.session_strategy`);
    if (body.system_prompt !== undefined) setClauses.push(sql`system_prompt = ${body.system_prompt}`);
    if (body.agent_name !== undefined) setClauses.push(sql`agent_name = ${body.agent_name}`);
    if (body.metadata !== undefined) setClauses.push(sql`metadata = ${JSON.stringify(body.metadata)}::jsonb`);
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
        session_strategy AS "sessionStrategy",
        system_prompt AS "systemPrompt",
        agent_name AS "agentName",
        metadata, created_at AS "createdAt", updated_at AS "updatedAt"
    `);

    if (!rows.length) return c.json({ success: false, error: 'Channel not found' }, 404);
    const r: any = rows[0];
    return c.json({ success: true, data: { ...r, credentials: {}, platformConfig: r.platformConfig ?? {}, metadata: r.metadata ?? {} } });
  } catch (err) {
    console.error('[channels] PATCH /:id error:', err);
    return c.json({ success: false, error: 'Failed to update channel' }, 500);
  }
});

// DELETE /:id
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

// POST /:id/enable
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

// POST /:id/disable
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

// POST /:id/link
channelsApp.post('/:id/link', async (c: any) => {
  const accountId = c.get('userId') as string;
  const id = c.req.param('id');
  try {
    const body = await c.req.json();
    if (!body.sandbox_id) return c.json({ success: false, error: 'sandbox_id is required' }, 400);
    const rows = await db.execute(sql`
      UPDATE kortix.channel_configs SET sandbox_id = ${body.sandbox_id}, updated_at = now()
      WHERE channel_config_id = ${id} AND account_id = ${accountId}
      RETURNING channel_config_id AS "channelConfigId", sandbox_id AS "sandboxId", updated_at AS "updatedAt"
    `);
    if (!rows.length) return c.json({ success: false, error: 'Channel not found' }, 404);
    return c.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[channels] POST /:id/link error:', err);
    return c.json({ success: false, error: 'Failed to link channel' }, 500);
  }
});

// POST /:id/unlink
channelsApp.post('/:id/unlink', async (c: any) => {
  const accountId = c.get('userId') as string;
  const id = c.req.param('id');
  try {
    const rows = await db.execute(sql`
      UPDATE kortix.channel_configs SET sandbox_id = NULL, updated_at = now()
      WHERE channel_config_id = ${id} AND account_id = ${accountId}
      RETURNING channel_config_id AS "channelConfigId", sandbox_id AS "sandboxId", updated_at AS "updatedAt"
    `);
    if (!rows.length) return c.json({ success: false, error: 'Channel not found' }, 404);
    return c.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[channels] POST /:id/unlink error:', err);
    return c.json({ success: false, error: 'Failed to unlink channel' }, 500);
  }
});

// GET /:id/messages
channelsApp.get('/:id/messages', async (c: any) => {
  const accountId = c.get('userId') as string;
  const id = c.req.param('id');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  try {
    // Verify ownership
    const owner = await db.execute(sql`
      SELECT channel_config_id FROM kortix.channel_configs
      WHERE channel_config_id = ${id} AND account_id = ${accountId} LIMIT 1
    `);
    if (!owner.length) return c.json({ success: false, error: 'Channel not found' }, 404);

    const [messages, countRows] = await Promise.all([
      db.execute(sql`
        SELECT
          channel_message_id AS "channelMessageId",
          channel_config_id  AS "channelConfigId",
          direction, external_id AS "externalId",
          session_id AS "sessionId", chat_type AS "chatType",
          content, attachments, platform_user AS "platformUser",
          metadata, created_at AS "createdAt"
        FROM kortix.channel_messages
        WHERE channel_config_id = ${id}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute(sql`
        SELECT count(*)::int AS total FROM kortix.channel_messages WHERE channel_config_id = ${id}
      `),
    ]);

    return c.json({ success: true, data: messages, total: (countRows[0] as any)?.total ?? 0 });
  } catch (err) {
    console.error('[channels] GET /:id/messages error:', err);
    return c.json({ success: false, error: 'Failed to fetch messages' }, 500);
  }
});

// GET /:channelId/sessions — list opencode sessions triggered by this channel
channelsApp.get('/:channelId/sessions', async (c: any) => {
  const accountId = c.get('userId') as string;
  const channelId = c.req.param('channelId');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);

  try {
    const owner = await db.execute(sql`
      SELECT channel_config_id FROM kortix.channel_configs
      WHERE channel_config_id = ${channelId} AND account_id = ${accountId} LIMIT 1
    `);
    if (!owner.length) return c.json({ success: false, error: 'Channel not found' }, 404);

    // channel_sessions maps strategy_key → opencode session_id
    const rows = await db.execute(sql`
      SELECT
        channel_session_id AS "channelSessionId",
        channel_config_id  AS "channelConfigId",
        strategy_key       AS "strategyKey",
        session_id         AS "sessionId",
        last_used_at       AS "lastUsedAt",
        created_at         AS "createdAt"
      FROM kortix.channel_sessions
      WHERE channel_config_id = ${channelId}
      ORDER BY last_used_at DESC
      LIMIT ${limit}
    `);

    return c.json({ success: true, data: rows, total: rows.length });
  } catch (err) {
    console.error('[channels] GET /:channelId/sessions error:', err);
    return c.json({ success: false, error: 'Failed to fetch channel sessions' }, 500);
  }
});
