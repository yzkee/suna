import type { Context } from 'hono';
import { resolveSandboxEndpointForChannel } from '../../core/resolve-webhook-target';

export async function proxySlackWebhook(c: Context): Promise<Response> {
  const rawBody = await c.req.text();

  try {
    const payload = JSON.parse(rawBody);
    if (payload.type === 'url_verification') {
      return c.json({ challenge: payload.challenge });
    }
  } catch {
  }

  const slackTimestamp = c.req.header('X-Slack-Request-Timestamp') || '';
  const slackSignature = c.req.header('X-Slack-Signature') || '';

  resolveSandboxEndpointForChannel('slack').then(({ url, headers: resolvedHeaders }) => {
    const headers: Record<string, string> = {
      ...resolvedHeaders,
      'Content-Type': 'application/json',
      'X-Slack-Request-Timestamp': slackTimestamp,
      'X-Slack-Signature': slackSignature,
    };

    return fetch(`${url}/channels/api/webhooks/slack`, {
      method: 'POST',
      headers,
      body: rawBody,
    });
  }).catch(err => console.error('[SLACK] Proxy to sandbox failed:', err));

  return c.json({ ok: true });
}
