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
import {
  createTestApp,
  cleanupTestData,
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
      session_strategy: 'per-thread',
      system_prompt: 'You are a helpful bot.',
      metadata: { test: true },
    });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.channelType).toBe('slack');
    expect(body.data.name).toBe('Test Slack Channel');
    expect(body.data.enabled).toBe(true);
    expect(body.data.sessionStrategy).toBe('per-thread');
    expect(body.data.systemPrompt).toBe('You are a helpful bot.');
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
    expect(body.data.sessionStrategy).toBe('per-thread');
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

  it('PATCH /v1/channels/:id updates system prompt', async () => {
    const res = await jsonPatch(app, `/v1/channels/${channelId}`, {
      system_prompt: 'New prompt',
      session_strategy: 'per-message',
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.systemPrompt).toBe('New prompt');
    expect(body.data.sessionStrategy).toBe('per-message');
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

describe('Webhook Forwarding', () => {
  // Mount the webhook forwarder on the test app
  const { channelWebhooksApp } = require('../channels/webhooks');
  const webhookApp = createTestApp({ mountChannels: true });
  webhookApp.route('/webhooks', channelWebhooksApp);

  it('POST /webhooks/slack returns 404 when no enabled channel exists', async () => {
    const res = await jsonPost(webhookApp, '/webhooks/slack', {
      type: 'url_verification',
      challenge: 'test_challenge',
    });
    // 404 because no channel_config with a linked sandbox
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
