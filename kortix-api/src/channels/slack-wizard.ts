/**
 * Slack Setup Wizard — backend routes for the frontend wizard.
 *
 * GET  /detect-url         — detect ngrok or configured public URL
 * POST /generate-manifest  — generate a Slack App Manifest JSON
 *
 * Mounted at /v1/channels/slack-wizard (behind auth).
 */

import { Hono } from 'hono';

export const slackWizardApp = new Hono();

// ─── GET /detect-url ──────────────────────────────────────────────────────────

slackWizardApp.get('/detect-url', async (c) => {
  // Try ngrok local API
  try {
    const res = await fetch('http://127.0.0.1:4040/api/tunnels', {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        tunnels: Array<{ public_url: string; proto: string }>;
      };
      const httpsTunnel = data.tunnels.find((t) => t.proto === 'https');
      const tunnel = httpsTunnel ?? data.tunnels[0];
      if (tunnel) {
        return c.json({ url: tunnel.public_url, source: 'ngrok', detected: true });
      }
    }
  } catch {
    // ngrok not running
  }

  return c.json({ url: '', source: 'none', detected: false });
});

// ─── POST /generate-manifest ──────────────────────────────────────────────────

slackWizardApp.post('/generate-manifest', async (c) => {
  const body = await c.req.json<{ publicUrl: string; botName?: string }>();
  const { publicUrl, botName = 'Kortix Agent' } = body;

  if (!publicUrl) {
    return c.json({ error: 'publicUrl is required' }, 400);
  }

  const baseUrl = publicUrl.replace(/\/+$/, '');

  const manifest = {
    display_information: { name: botName },
    features: {
      bot_user: { display_name: botName, always_online: true },
      slash_commands: [
        {
          command: '/oc',
          url: `${baseUrl}/webhooks/slack/commands`,
          description: `Ask ${botName}`,
          usage_hint: '/oc [message]',
          should_escape: false,
        },
      ],
    },
    oauth_config: {
      scopes: {
        bot: [
          'app_mentions:read',
          'channels:history',
          'channels:read',
          'chat:write',
          'chat:write.public',
          'commands',
          'files:read',
          'files:write',
          'groups:history',
          'groups:read',
          'im:history',
          'im:read',
          'im:write',
          'mpim:history',
          'mpim:read',
          'reactions:read',
          'reactions:write',
          'users:read',
        ],
      },
    },
    settings: {
      event_subscriptions: {
        request_url: `${baseUrl}/webhooks/slack/events`,
        bot_events: [
          'app_mention',
          'message.channels',
          'message.groups',
          'message.im',
          'message.mpim',
          'reaction_added',
        ],
      },
      interactivity: {
        is_enabled: true,
        request_url: `${baseUrl}/webhooks/slack/interactivity`,
      },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };

  return c.json({ manifest });
});
