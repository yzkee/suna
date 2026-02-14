/**
 * Channels sub-service.
 *
 * Mounts authenticated CRUD routes on /v1/channels/*
 * and unauthenticated webhook routes on /webhooks/*.
 */

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import { createAdapters } from './adapters/registry';
import { ChannelEngineImpl } from './core/engine';
import { createChannelsRouter } from './routes/channels';
import { webhooksRouter } from './routes/webhooks';
import { startChannels, stopChannels, getChannelsStatus } from './core/lifecycle';
import { config } from '../config';

// ─── Initialize ──────────────────────────────────────────────────────────────

const adapters = createAdapters();
const engine = new ChannelEngineImpl(adapters);

// ─── Hono Sub-App ────────────────────────────────────────────────────────────

const channelsApp = new Hono();

// Authenticated CRUD routes
channelsApp.use('/v1/channels/*', supabaseAuth);
channelsApp.route('/v1/channels', createChannelsRouter(engine));

// Register adapter routes on the webhook router BEFORE mounting
// (Hono's .route() copies routes at call time)
for (const [type, adapter] of adapters) {
  console.log(`[CHANNELS] Registering routes for ${type} adapter`);
  adapter.registerRoutes(webhooksRouter, engine);
}

// Unauthenticated webhook routes (adapters handle their own verification)
channelsApp.route('/webhooks', webhooksRouter);

// ─── Lifecycle Exports ───────────────────────────────────────────────────────

async function startChannelService(): Promise<void> {
  if (!config.CHANNELS_ENABLED) {
    console.log('[CHANNELS] Channels disabled (CHANNELS_ENABLED=false)');
    return;
  }
  await startChannels(engine, adapters);
}

async function stopChannelService(): Promise<void> {
  await stopChannels(adapters);
}

function getChannelServiceStatus() {
  return getChannelsStatus(adapters);
}

export {
  channelsApp,
  startChannelService,
  stopChannelService,
  getChannelServiceStatus,
};
