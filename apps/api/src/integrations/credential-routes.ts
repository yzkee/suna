import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { resolveAccountId } from '../shared/resolve-account';
import { upsertAccountCreds, getAccountCreds, deleteAccountCreds } from './credential-store';

const schema = z.object({
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  project_id: z.string().min(1),
  environment: z.string().optional().default('production'),
});

export function createCredentialRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /**
   * PUT /credentials — save Pipedream creds for the authenticated account.
   * Works from frontend (supabase JWT → userId) or sandbox (apiKey → accountId).
   */
  app.put('/credentials', async (c) => {
    const accountId = await resolveAccount(c);
    const body = await c.req.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      throw new HTTPException(400, {
        message: `Invalid credentials: ${parsed.error.issues.map(i => i.message).join(', ')}`,
      });
    }

    await upsertAccountCreds(accountId, parsed.data);
    console.log(`[PIPEDREAM] Credentials saved for account=${accountId}`);
    return c.json({ success: true, source: 'account' });
  });

  /**
   * GET /credentials — check if creds are configured (no secrets returned).
   */
  app.get('/credentials', async (c) => {
    const accountId = await resolveAccount(c);
    const creds = await getAccountCreds(accountId);

    return c.json({
      configured: !!creds,
      source: creds ? 'account' : 'default',
      provider: 'pipedream',
    });
  });

  /**
   * DELETE /credentials — remove per-account creds (revert to API defaults).
   */
  app.delete('/credentials', async (c) => {
    const accountId = await resolveAccount(c);
    await deleteAccountCreds(accountId);
    console.log(`[PIPEDREAM] Credentials deleted for account=${accountId}`);
    return c.json({ success: true });
  });

  return app;
}

/**
 * Resolve accountId from either supabase auth (userId) or api key auth (accountId).
 */
async function resolveAccount(c: any): Promise<string> {
  // apiKeyAuth sets accountId directly
  const direct = c.get('accountId') as string | undefined;
  if (direct) return direct;

  // supabaseAuth sets userId — resolve to accountId
  const userId = c.get('userId') as string | undefined;
  if (userId) return resolveAccountId(userId);

  throw new HTTPException(401, { message: 'Unable to determine account' });
}
