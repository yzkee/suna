/**
 * E2E tests for the channels CRUD API.
 *
 * Tests the full lifecycle:
 *   1. Create a channel config
 *   2. List channels
 *   3. Get a single channel
 *   4. Update a channel
 *   5. Enable/disable a channel
 *   6. Delete a channel
 *   7. Auth isolation (other user can't see your channels)
 *
 * Requires DATABASE_URL to be set.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { sql } from 'drizzle-orm';
import {
  createTestApp,
  cleanupTestData,
  getTestDb,
  jsonGet,
  jsonPost,
  jsonPatch,
  jsonDelete,
  TEST_USER_ID,
  OTHER_USER_ID,
} from './helpers';

const app = createTestApp({ mountChannels: true });
const otherApp = createTestApp({ mountChannels: true, userId: OTHER_USER_ID });

beforeAll(async () => {
  const db = getTestDb();
  await db.execute(sql`ALTER TABLE kortix.channel_configs DROP COLUMN IF EXISTS session_strategy`);
  await db.execute(sql`ALTER TABLE kortix.channel_configs RENAME COLUMN system_prompt TO instructions`)
    .catch(() => {});
  await cleanupTestData();
});

afterAll(async () => {
  await cleanupTestData();
});

describe('Channels CRUD', () => {
  let channelId: string;

  // ─── POST /v1/channels ──────────────────────────────────────────────────

  it('POST /v1/channels creates a Slack channel config', async () => {
    const res = await jsonPost(app, '/v1/channels', {
      channel_type: 'slack',
      name: 'Test Slack Channel',
      instructions: 'You are a helpful bot.',
      metadata: { test: true },
    });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.channelType).toBe('slack');
    expect(body.data.name).toBe('Test Slack Channel');
    expect(body.data.enabled).toBe(true);
    expect(body.data.instructions).toBe('You are a helpful bot.');
    expect(body.data.metadata.test).toBe(true);
    expect(body.data.channelConfigId).toBeDefined();

    channelId = body.data.channelConfigId;
  });

  it('POST /v1/channels creates a Telegram channel config', async () => {
    const res = await jsonPost(app, '/v1/channels', {
      channel_type: 'telegram',
      name: 'Test Telegram Channel',
    });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.channelType).toBe('telegram');
    expect(body.data.name).toBe('Test Telegram Channel');
    expect(body.data.enabled).toBe(true);
    expect(body.data.instructions).toBeNull();
  });

  it('POST /v1/channels rejects missing channel_type', async () => {
    const res = await jsonPost(app, '/v1/channels', {
      name: 'No type',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('POST /v1/channels rejects missing name', async () => {
    const res = await jsonPost(app, '/v1/channels', {
      channel_type: 'slack',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  // ─── GET /v1/channels ───────────────────────────────────────────────────

  it('GET /v1/channels lists all channels for the user', async () => {
    const res = await jsonGet(app, '/v1/channels');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.length).toBe(2);
    expect(body.total).toBe(2);
  });

  it('GET /v1/channels returns empty for other user', async () => {
    const res = await jsonGet(otherApp, '/v1/channels');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.length).toBe(0);
  });

  // ─── GET /v1/channels/:id ──────────────────────────────────────────────

  it('GET /v1/channels/:id returns a single channel', async () => {
    const res = await jsonGet(app, `/v1/channels/${channelId}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.channelConfigId).toBe(channelId);
    expect(body.data.name).toBe('Test Slack Channel');
  });

  it('GET /v1/channels/:id returns 404 for other user', async () => {
    const res = await jsonGet(otherApp, `/v1/channels/${channelId}`);
    expect(res.status).toBe(404);
  });

  it('GET /v1/channels/:id returns 400 for invalid UUID', async () => {
    const res = await jsonGet(app, '/v1/channels/not-a-uuid');
    expect(res.status).toBe(400);
  });

  // ─── PATCH /v1/channels/:id ────────────────────────────────────────────

  it('PATCH /v1/channels/:id updates channel name', async () => {
    const res = await jsonPatch(app, `/v1/channels/${channelId}`, {
      name: 'Updated Slack Channel',
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('Updated Slack Channel');
  });

  it('PATCH /v1/channels/:id updates instructions', async () => {
    const res = await jsonPatch(app, `/v1/channels/${channelId}`, {
      instructions: 'New prompt',
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.instructions).toBe('New prompt');
  });

  it('PATCH /v1/channels/:id returns 404 for other user', async () => {
    const res = await jsonPatch(otherApp, `/v1/channels/${channelId}`, {
      name: 'Hacked',
    });
    expect(res.status).toBe(404);
  });

  // ─── POST /v1/channels/:id/disable & enable ───────────────────────────

  it('POST /v1/channels/:id/disable disables the channel', async () => {
    const res = await jsonPost(app, `/v1/channels/${channelId}/disable`, {});
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.enabled).toBe(false);
  });

  it('POST /v1/channels/:id/enable re-enables the channel', async () => {
    const res = await jsonPost(app, `/v1/channels/${channelId}/enable`, {});
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.enabled).toBe(true);
  });

  // ─── DELETE /v1/channels/:id ───────────────────────────────────────────

  it('DELETE /v1/channels/:id returns 404 for other user', async () => {
    const res = await jsonDelete(otherApp, `/v1/channels/${channelId}`);
    expect(res.status).toBe(404);
  });

  it('DELETE /v1/channels/:id deletes the channel', async () => {
    const res = await jsonDelete(app, `/v1/channels/${channelId}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('GET /v1/channels/:id returns 404 after deletion', async () => {
    const res = await jsonGet(app, `/v1/channels/${channelId}`);
    expect(res.status).toBe(404);
  });

  it('GET /v1/channels shows one remaining after deletion', async () => {
    const res = await jsonGet(app, '/v1/channels');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].channelType).toBe('telegram');
  });
});

// ─── Webhook forwarding ─────────────────────────────────────────────────────
// The webhook forwarder is mounted at /webhooks/{platform} in production.
// It looks up the DB for a sandbox with an enabled channel of that type,
// then forwards the request. Without a linked sandbox, it should return 404.
// With a linked sandbox, it forwards to sandbox:PORT/channels/api/webhooks/{type}.

describe('Webhook Forwarding', () => {
  const { channelWebhooksApp } = require('../channels/webhooks');
  const webhookApp = createTestApp({ mountChannels: true });
  webhookApp.route('/webhooks', channelWebhooksApp);

  it('POST /webhooks/slack returns 404 when no enabled channel exists', async () => {
    const res = await jsonPost(webhookApp, '/webhooks/slack', {
      type: 'url_verification',
      challenge: 'test_challenge',
    });
    expect(res.status).toBe(404);
  });

  it('POST /webhooks/telegram returns 404 when no enabled channel exists', async () => {
    const res = await jsonPost(webhookApp, '/webhooks/telegram', {
      update_id: 123,
      message: { text: 'hello' },
    });
    expect(res.status).toBe(404);
  });

  it('POST /webhooks/discord returns 404 when no enabled channel exists', async () => {
    const res = await jsonPost(webhookApp, '/webhooks/discord', {
      type: 1,
    });
    expect(res.status).toBe(404);
  });
});

// ─── Full-stack webhook forwarding with mock sandbox ─────────────────────────
// Stands up a tiny HTTP server as a mock "sandbox", inserts a sandbox + channel
// config in the DB, then verifies kortix-api forwards webhooks to the sandbox
// and returns the response.

import { createServer, type Server } from 'node:http';
import { sql } from 'drizzle-orm';
import { getTestDb } from './helpers';

describe('Webhook Forwarding (with linked sandbox)', () => {
  const { channelWebhooksApp } = require('../channels/webhooks');
  const webhookApp = createTestApp({ mountChannels: true });
  webhookApp.route('/webhooks', channelWebhooksApp);

  let mockSandbox: Server;
  let mockPort: number;
  const receivedRequests: Array<{ path: string; body: string; headers: Record<string, string> }> = [];

  const SANDBOX_ID = '00000000-e2e0-4000-a000-000000000099';

  beforeAll(async () => {
    // 1. Start a mock "sandbox" HTTP server that records requests
    await new Promise<void>((resolve) => {
      mockSandbox = createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = Buffer.concat(chunks).toString();

        receivedRequests.push({
          path: req.url || '',
          body,
          headers: Object.fromEntries(
            Object.entries(req.headers).map(([k, v]) => [k, String(v)]),
          ),
        });

        // Simulate opencode-channels responses
        if (body.includes('url_verification')) {
          const parsed = JSON.parse(body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ challenge: parsed.challenge }));
        } else {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('OK');
        }
      });
      mockSandbox.listen(0, () => {
        const addr = mockSandbox.address();
        mockPort = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });

    // 2. Insert a sandbox row pointing at the mock server
    const db = getTestDb();
    await db.execute(sql`
      INSERT INTO kortix.sandboxes (sandbox_id, account_id, name, status, provider, base_url, external_id, metadata)
      VALUES (
        ${SANDBOX_ID},
        ${TEST_USER_ID},
        'mock-sandbox-for-webhook-test',
        'active',
        'local_docker',
        ${'http://localhost:' + mockPort},
        'mock-ext-id',
        '{}'::jsonb
      )
      ON CONFLICT (sandbox_id) DO UPDATE SET base_url = ${'http://localhost:' + mockPort}
    `);

    // 3. Insert enabled channel configs linked to this sandbox
    await db.execute(sql`
      INSERT INTO kortix.channel_configs (account_id, sandbox_id, channel_type, name, enabled)
      VALUES
        (${TEST_USER_ID}, ${SANDBOX_ID}, 'slack', 'Mock Slack', true),
        (${TEST_USER_ID}, ${SANDBOX_ID}, 'telegram', 'Mock Telegram', true)
      ON CONFLICT DO NOTHING
    `);
  });

  afterAll(async () => {
    mockSandbox?.close();
    const db = getTestDb();
    await db.execute(sql`DELETE FROM kortix.channel_configs WHERE sandbox_id = ${SANDBOX_ID}`);
    await db.execute(sql`DELETE FROM kortix.sandboxes WHERE sandbox_id = ${SANDBOX_ID}`);
  });

  it('forwards Slack webhook to the sandbox and returns its response', async () => {
    receivedRequests.length = 0;

    const res = await jsonPost(webhookApp, '/webhooks/slack', {
      type: 'url_verification',
      challenge: 'forwarded_challenge',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.challenge).toBe('forwarded_challenge');

    // Verify the request reached the mock sandbox
    expect(receivedRequests.length).toBe(1);
    expect(receivedRequests[0].path).toBe('/channels/api/webhooks/slack');
    expect(receivedRequests[0].body).toContain('forwarded_challenge');
  });

  it('forwards Slack signature headers to the sandbox', async () => {
    receivedRequests.length = 0;

    const res = await webhookApp.request('/webhooks/slack', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Slack-Signature': 'v0=test_sig',
        'X-Slack-Request-Timestamp': '1234567890',
      },
      body: JSON.stringify({ type: 'event_callback', event: { type: 'message' } }),
    });

    expect(res.status).toBe(200);
    expect(receivedRequests.length).toBe(1);
    expect(receivedRequests[0].headers['x-slack-signature']).toBe('v0=test_sig');
    expect(receivedRequests[0].headers['x-slack-request-timestamp']).toBe('1234567890');
  });

  it('forwards Telegram webhook to the sandbox', async () => {
    receivedRequests.length = 0;

    const res = await jsonPost(webhookApp, '/webhooks/telegram', {
      update_id: 42,
      message: { message_id: 1, text: 'forwarded_tg', chat: { id: 123, type: 'private' } },
    });

    expect(res.status).toBe(200);
    expect(receivedRequests.length).toBe(1);
    expect(receivedRequests[0].path).toBe('/channels/api/webhooks/telegram');
    expect(receivedRequests[0].body).toContain('forwarded_tg');
  });

  it('forwards Telegram secret token header to the sandbox', async () => {
    receivedRequests.length = 0;

    const res = await webhookApp.request('/webhooks/telegram', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'my_secret',
      },
      body: JSON.stringify({ update_id: 43, message: { text: 'with secret' } }),
    });

    expect(res.status).toBe(200);
    expect(receivedRequests[0].headers['x-telegram-bot-api-secret-token']).toBe('my_secret');
  });
});
