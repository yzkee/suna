import { Hono } from 'hono';
import { supabaseAuth, combinedAuth } from '../middleware/auth';
import { createAdapters } from './adapters/registry';
import { createChannelsRouter } from './routes/channels';
import { createSlackWizardRouter } from './routes/slack-wizard';
import { webhooksRouter } from './routes/webhooks';
import { filesRouter } from './routes/files';
import { startChannels, stopChannels, getChannelsStatus } from './core/lifecycle';
import { config } from '../config';
import { createInternalChannelsRouter } from './routes/channels-internal';
import { resolveSandboxEndpointForChannel } from './core/resolve-webhook-target';

const adapters = createAdapters();

const channelsApp = new Hono();

// Internal route for sandbox → api calls (Kortix token auth, not user JWT)
// Must be registered BEFORE the supabaseAuth middleware on /v1/channels/*
channelsApp.use('/v1/channels/internal/*', combinedAuth);
channelsApp.route('/v1/channels/internal', createInternalChannelsRouter());

channelsApp.use('/v1/channels/*', supabaseAuth);
// NOTE: platform-credentials router REMOVED — all creds now live in sandbox SecretStore
channelsApp.route('/v1/channels/slack-wizard', createSlackWizardRouter());
channelsApp.route('/v1/channels', createChannelsRouter(adapters));
channelsApp.route('/v1/files', filesRouter);

for (const [type, adapter] of adapters) {
  console.log(`[CHANNELS] Registering routes for ${type} adapter`);
  adapter.registerRoutes(webhooksRouter);
}

webhooksRouter.post('/telegram', async (c) => {
  const rawBody = await c.req.text();

  const secretToken = c.req.header('X-Telegram-Bot-Api-Secret-Token');

  resolveSandboxEndpointForChannel('telegram').then(({ url, headers: resolvedHeaders }) => {
    const headers: Record<string, string> = {
      ...resolvedHeaders,
      'Content-Type': c.req.header('Content-Type') || 'application/json',
    };
    if (secretToken) {
      headers['X-Telegram-Bot-Api-Secret-Token'] = secretToken;
    }

    return fetch(`${url}/channels/api/webhooks/telegram`, {
      method: 'POST',
      headers,
      body: rawBody,
    });
  }).catch(err => console.error('[TELEGRAM] Proxy to sandbox failed:', err));

  return c.text('OK');
});

channelsApp.route('/webhooks', webhooksRouter);

async function startChannelService(): Promise<void> {
  if (!config.CHANNELS_ENABLED) {
    console.log('[CHANNELS] Channels disabled (CHANNELS_ENABLED=false)');
    return;
  }
  await startChannels(adapters);
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
