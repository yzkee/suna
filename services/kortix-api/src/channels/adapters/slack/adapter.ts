/**
 * Slack Adapter.
 *
 * Implements the ChannelAdapter interface for the Slack Events API.
 * Uses a single events endpoint for all workspaces (one Slack app, many installs).
 * Uses the Web API for sending responses.
 */

import type { Context } from 'hono';
import type { Hono } from 'hono';
import type { ChannelAdapter, ChannelEngine } from '../base';
import type { ChannelCapabilities, NormalizedMessage, AgentResponse } from '../../types';
import type { ChannelConfig } from '@kortix/db';
import { SlackApi } from './api';
import { handleSlackWebhook } from './webhook';
import { splitMessage } from '../../lib/message-splitter';
import { config } from '../../../config';
import { db } from '../../../shared/db';
import { channelConfigs } from '@kortix/db';

export class SlackAdapter implements ChannelAdapter {
  readonly type = 'slack' as const;
  readonly name = 'Slack';
  readonly capabilities: ChannelCapabilities = {
    textChunkLimit: 4000,
    supportsRichText: true,
    supportsEditing: true,
    supportsTypingIndicator: false,
    supportsAttachments: true,
    connectionType: 'webhook',
  };

  registerRoutes(router: Hono, engine: ChannelEngine): void {
    // Single events endpoint for all workspaces
    router.post('/slack/events', (c) => handleSlackWebhook(c, engine));
    // "Add to Slack" install redirect
    router.get('/slack/install', (c) => this.handleInstall(c));
    // OAuth callback for "Add to Slack" flow
    router.get('/slack/oauth_callback', (c) => this.handleOAuthCallback(c));
  }

  parseInbound(payload: unknown, _config: ChannelConfig): NormalizedMessage | null {
    // Parsing is handled in webhook.ts directly since it needs
    // the HTTP context for signature verification
    return null;
  }

  async sendResponse(
    channelConfig: ChannelConfig,
    message: NormalizedMessage,
    response: AgentResponse,
  ): Promise<void> {
    const credentials = channelConfig.credentials as Record<string, unknown>;
    const botToken = credentials.botToken as string;
    if (!botToken) {
      console.error('[SLACK] No bot token in credentials');
      return;
    }

    const api = new SlackApi(botToken);

    // Determine target channel from raw event
    const rawPayload = message.raw as Record<string, unknown> | undefined;
    const event = rawPayload?.event as Record<string, unknown> | undefined;
    const channel = event?.channel as string;

    if (!channel) {
      console.error('[SLACK] Cannot determine channel from message');
      return;
    }

    // Thread handling: reply in existing thread, or start a new thread
    // on the original message to keep channels clean
    const threadTs = message.threadId || (message.chatType !== 'dm' ? message.externalId : undefined);

    // Split response into chunks respecting Slack's 4000 char limit
    const chunks = splitMessage(response.content, this.capabilities.textChunkLimit);

    for (const chunk of chunks) {
      const result = await api.postMessage({
        channel,
        text: chunk,
        thread_ts: threadTs,
      });

      if (!result.ok) {
        console.error(`[SLACK] postMessage failed: ${result.error}`);
      }
    }
  }

  async sendTypingIndicator(
    _config: ChannelConfig,
    _message: NormalizedMessage,
  ): Promise<void> {
    // Slack doesn't support typing indicators for bots via the Events API
  }

  async onChannelCreated(_channelConfig: ChannelConfig): Promise<void> {
    // Nothing to do — events endpoint and OAuth are configured at the platform level
  }

  async onChannelRemoved(channelConfig: ChannelConfig): Promise<void> {
    console.log(
      `[SLACK] Channel ${channelConfig.channelConfigId} removed.`,
    );
  }

  async validateCredentials(
    credentials: Record<string, unknown>,
  ): Promise<{ valid: boolean; error?: string }> {
    const botToken = credentials.botToken as string;
    if (!botToken) {
      return { valid: false, error: 'botToken is required' };
    }

    try {
      const api = new SlackApi(botToken);
      const result = await api.authTest();
      if (!result.ok) {
        return { valid: false, error: `Invalid bot token: ${result.error}` };
      }
      // Store bot info in credentials for filtering bot's own messages
      if (result.user_id) {
        credentials.botUserId = result.user_id;
      }
      if (result.team_id) {
        credentials.teamId = result.team_id;
      }
      return { valid: true };
    } catch {
      return { valid: false, error: 'Failed to validate Slack credentials' };
    }
  }

  /**
   * Redirect user to Slack's OAuth authorization page.
   * Query params: sandboxId, accountId — encoded into the state param.
   */
  private handleInstall(c: Context): Response {
    const sandboxId = c.req.query('sandboxId');
    const accountId = c.req.query('accountId');

    if (!sandboxId || !accountId) {
      return c.json({ error: 'Missing sandboxId or accountId' }, 400);
    }

    const clientId = config.SLACK_CLIENT_ID;
    if (!clientId) {
      return c.json({ error: 'Slack OAuth not configured (missing client ID)' }, 500);
    }

    const publicUrl = config.CHANNELS_PUBLIC_URL;
    if (!publicUrl) {
      return c.json({ error: 'CHANNELS_PUBLIC_URL not configured' }, 500);
    }

    const redirectUri = `${publicUrl}/webhooks/slack/oauth_callback`;
    const state = JSON.stringify({ sandboxId, accountId });
    const scopes = 'chat:write,app_mentions:read,im:history,channels:history,groups:history,mpim:history';

    const slackUrl = new URL('https://slack.com/oauth/v2/authorize');
    slackUrl.searchParams.set('client_id', clientId);
    slackUrl.searchParams.set('scope', scopes);
    slackUrl.searchParams.set('redirect_uri', redirectUri);
    slackUrl.searchParams.set('state', state);

    return c.redirect(slackUrl.toString());
  }

  /**
   * Handle Slack OAuth callback.
   * Exchanges the authorization code for a bot token, creates the channel config,
   * and redirects to the frontend.
   */
  private async handleOAuthCallback(c: Context): Promise<Response> {
    const frontendUrl = config.FRONTEND_URL;
    const code = c.req.query('code');
    const stateRaw = c.req.query('state');

    if (!code || !stateRaw) {
      return c.redirect(`${frontendUrl}/channels?slack=error&message=${encodeURIComponent('Missing code or state')}`);
    }

    let sandboxId: string;
    let accountId: string;
    try {
      const parsed = JSON.parse(stateRaw) as { sandboxId?: string; accountId?: string };
      if (!parsed.sandboxId || !parsed.accountId) throw new Error('incomplete state');
      sandboxId = parsed.sandboxId;
      accountId = parsed.accountId;
    } catch {
      return c.redirect(`${frontendUrl}/channels?slack=error&message=${encodeURIComponent('Invalid state parameter')}`);
    }

    const clientId = config.SLACK_CLIENT_ID;
    const clientSecret = config.SLACK_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return c.redirect(`${frontendUrl}/channels?slack=error&message=${encodeURIComponent('Slack OAuth not configured')}`);
    }

    const publicUrl = config.CHANNELS_PUBLIC_URL;
    const redirectUri = publicUrl ? `${publicUrl}/webhooks/slack/oauth_callback` : undefined;

    // Exchange code for token
    const body: Record<string, string> = {
      client_id: clientId,
      client_secret: clientSecret,
      code,
    };
    if (redirectUri) body.redirect_uri = redirectUri;

    const res = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });

    const data = (await res.json()) as {
      ok: boolean;
      access_token?: string;
      bot_user_id?: string;
      team?: { id: string; name: string };
      error?: string;
    };

    if (!data.ok) {
      console.error(`[SLACK] OAuth exchange failed: ${data.error}`);
      return c.redirect(`${frontendUrl}/channels?slack=error&message=${encodeURIComponent(data.error || 'OAuth exchange failed')}`);
    }

    console.log(`[SLACK] OAuth success for team ${data.team?.name} (${data.team?.id})`);

    // Verify the token works
    const api = new SlackApi(data.access_token!);
    const authResult = await api.authTest();
    if (!authResult.ok) {
      return c.redirect(`${frontendUrl}/channels?slack=error&message=${encodeURIComponent('Token verification failed')}`);
    }

    // Create channel config in DB
    try {
      const teamName = data.team?.name || 'Slack';
      await db
        .insert(channelConfigs)
        .values({
          sandboxId,
          accountId,
          channelType: 'slack',
          name: `${teamName} Slack`,
          enabled: true,
          credentials: {
            botToken: data.access_token,
            botUserId: data.bot_user_id || authResult.user_id,
            teamId: data.team?.id || authResult.team_id,
            teamName,
          },
          sessionStrategy: 'per-user',
          metadata: {},
        });
    } catch (err) {
      console.error('[SLACK] Failed to create channel config:', err);
      return c.redirect(`${frontendUrl}/channels?slack=error&message=${encodeURIComponent('Failed to save channel config')}`);
    }

    return c.redirect(`${frontendUrl}/channels?slack=connected`);
  }
}
