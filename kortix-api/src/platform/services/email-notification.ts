/**
 * email-notification.ts
 *
 * Sends transactional emails via Mailtrap when sandbox provisioning completes.
 * Degrades gracefully when MAILTRAP_API_TOKEN is not configured.
 */

import { config } from '../../config';
import { getSupabase } from '../../shared/supabase';

const MAILTRAP_SEND_URL = 'https://send.api.mailtrap.io/api/send';

/**
 * Send a "workspace ready" email to the sandbox owner.
 * Fire-and-forget — never throws, just logs on failure.
 */
export async function sendWorkspaceReadyEmail(opts: {
  accountId: string;
  sandboxName: string;
  sandboxId: string;
}): Promise<void> {
  if (!config.MAILTRAP_API_TOKEN) {
    return; // Mailtrap not configured — skip silently
  }

  const { accountId, sandboxName, sandboxId } = opts;

  try {
    // Look up user email from Supabase auth
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.admin.getUserById(accountId);
    if (error || !data?.user?.email) {
      console.warn(`[email-notification] Could not resolve email for account ${accountId}:`, error?.message ?? 'no email');
      return;
    }

    const email = data.user.email;
    const frontendUrl = config.FRONTEND_URL || 'https://app.kortix.com';
    const instanceUrl = `${frontendUrl}/instances/${sandboxId}`;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 0; background: #f8f9fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .container { max-width: 520px; margin: 40px auto; background: #fff; border-radius: 12px; border: 1px solid #e5e7eb; overflow: hidden; }
    .header { padding: 32px 32px 24px; text-align: center; }
    .logo { font-size: 18px; font-weight: 700; letter-spacing: 0.5px; color: #111; }
    .check { display: inline-flex; align-items: center; justify-content: center; width: 48px; height: 48px; border-radius: 50%; background: #ecfdf5; margin-bottom: 16px; }
    .check svg { width: 24px; height: 24px; color: #10b981; }
    .body { padding: 0 32px 32px; text-align: center; }
    h1 { font-size: 20px; font-weight: 600; color: #111; margin: 0 0 8px; }
    p { font-size: 14px; color: #6b7280; line-height: 1.6; margin: 0 0 24px; }
    .name { font-weight: 600; color: #111; }
    .btn { display: inline-block; padding: 10px 24px; background: #111; color: #fff; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 500; }
    .footer { padding: 16px 32px; text-align: center; border-top: 1px solid #f3f4f6; }
    .footer p { font-size: 12px; color: #9ca3af; margin: 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">Kortix</div>
    </div>
    <div class="body">
      <div class="check">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h1>Your workspace is ready</h1>
      <p><span class="name">${escapeHtml(sandboxName)}</span> has finished provisioning and is ready to use.</p>
      <a href="${escapeHtml(instanceUrl)}" class="btn">Open Workspace</a>
    </div>
    <div class="footer">
      <p>Kortix &mdash; The Autonomous Company Operating System</p>
    </div>
  </div>
</body>
</html>`.trim();

    const res = await fetch(MAILTRAP_SEND_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.MAILTRAP_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: {
          email: config.MAILTRAP_FROM_EMAIL,
          name: config.MAILTRAP_FROM_NAME,
        },
        to: [{ email }],
        subject: `Your workspace "${sandboxName}" is ready`,
        html,
        category: 'workspace-ready',
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[email-notification] Mailtrap API error ${res.status}: ${body}`);
    } else {
      console.log(`[email-notification] Workspace ready email sent to ${email} for sandbox ${sandboxId}`);
    }
  } catch (err) {
    console.warn('[email-notification] Failed to send workspace ready email:', (err as Error).message);
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
