import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { sandboxes, accountUser } from '@kortix/db';
import { db } from '../db';
import { generateSandboxToken } from '../lib/token';
import { authMiddleware } from '../middleware/auth';
import {
  getProvider,
  getDefaultProviderName,
  getAvailableProviders,
  type ProviderName,
} from '../providers';
import type { AuthVariables } from '../types';

const accountRouter = new Hono<{ Variables: AuthVariables }>();

// All routes require authentication
accountRouter.use('/*', authMiddleware);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve the accountId for a user.
 * In basejump, each user has a personal account where userId == accountId.
 * If the user belongs to a team, we'd pick their primary account.
 * For now, use the first account the user belongs to (personal = userId).
 */
async function resolveAccountId(userId: string): Promise<string> {
  const [membership] = await db
    .select({ accountId: accountUser.accountId })
    .from(accountUser)
    .where(eq(accountUser.userId, userId))
    .limit(1);

  if (membership) {
    return membership.accountId;
  }

  // Fallback: in basejump, personal accounts have id == userId
  return userId;
}

/**
 * Serialize a sandbox row for API responses.
 */
function serializeSandbox(row: typeof sandboxes.$inferSelect) {
  return {
    sandbox_id: row.sandboxId,
    external_id: row.externalId,
    name: row.name,
    provider: row.provider,
    base_url: row.baseUrl,
    status: row.status,
    metadata: row.metadata,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /v1/account/providers
 *
 * Returns the list of available sandbox providers.
 */
accountRouter.get('/providers', async (c) => {
  return c.json({
    success: true,
    data: {
      providers: getAvailableProviders(),
      default: getDefaultProviderName(),
    },
  });
});

/**
 * POST /v1/account/init
 *
 * Initialize a user's account. Ensures they have at least one sandbox.
 * If no sandbox exists, provisions one via the requested (or default) provider.
 *
 * Body (optional):
 *   { "provider": "daytona" | "local_docker" }
 *
 * Returns the user's sandbox info (idempotent -- safe to call multiple times).
 */
accountRouter.post('/init', async (c) => {
  const userId = c.get('userId');

  try {
    const body = await c.req.json().catch(() => ({}));
    const requestedProvider = (body?.provider as ProviderName) || undefined;
    const providerName = requestedProvider || getDefaultProviderName();

    const accountId = await resolveAccountId(userId);

    // Check if user already has an active sandbox (from any provider)
    const [existing] = await db
      .select()
      .from(sandboxes)
      .where(
        and(
          eq(sandboxes.accountId, accountId),
          eq(sandboxes.status, 'active'),
        ),
      )
      .limit(1);

    if (existing) {
      return c.json({
        success: true,
        data: serializeSandbox(existing),
        created: false,
      });
    }

    // No sandbox — provision one
    const provider = getProvider(providerName);
    const authToken = generateSandboxToken();

    const result = await provider.create({
      accountId,
      userId,
      name: `sandbox-${accountId.slice(0, 8)}`,
    });

    // Insert into kortix.sandboxes
    const [sandbox] = await db
      .insert(sandboxes)
      .values({
        accountId,
        name: `sandbox-${accountId.slice(0, 8)}`,
        provider: providerName,
        externalId: result.externalId,
        status: 'active',
        baseUrl: result.baseUrl,
        authToken,
        config: {},
        metadata: result.metadata,
      })
      .returning();

    console.log(
      `[PLATFORM] Provisioned sandbox ${sandbox.sandboxId} via ${providerName} ` +
      `(external: ${result.externalId}) for account ${accountId}`,
    );

    return c.json(
      {
        success: true,
        data: serializeSandbox(sandbox),
        created: true,
      },
      201,
    );
  } catch (err) {
    console.error('[PLATFORM] initAccount error:', err);
    return c.json({ success: false, error: 'Failed to initialize account' }, 500);
  }
});

/**
 * GET /v1/account/sandbox
 *
 * Get the user's current (first active) sandbox. Returns 404 if none exists.
 */
accountRouter.get('/sandbox', async (c) => {
  const userId = c.get('userId');

  try {
    const accountId = await resolveAccountId(userId);

    const [sandbox] = await db
      .select()
      .from(sandboxes)
      .where(
        and(
          eq(sandboxes.accountId, accountId),
          eq(sandboxes.status, 'active'),
        ),
      )
      .limit(1);

    if (!sandbox) {
      return c.json(
        { success: false, error: 'No sandbox found. Call POST /v1/account/init first.' },
        404,
      );
    }

    return c.json({
      success: true,
      data: serializeSandbox(sandbox),
    });
  } catch (err) {
    console.error('[PLATFORM] getSandbox error:', err);
    return c.json({ success: false, error: 'Failed to get sandbox' }, 500);
  }
});

/**
 * GET /v1/account/sandboxes
 *
 * List all sandboxes for the user's account (all statuses).
 */
accountRouter.get('/sandboxes', async (c) => {
  const userId = c.get('userId');

  try {
    const accountId = await resolveAccountId(userId);

    const rows = await db
      .select()
      .from(sandboxes)
      .where(eq(sandboxes.accountId, accountId))
      .orderBy(desc(sandboxes.createdAt));

    return c.json({
      success: true,
      data: rows.map(serializeSandbox),
    });
  } catch (err) {
    console.error('[PLATFORM] listSandboxes error:', err);
    return c.json({ success: false, error: 'Failed to list sandboxes' }, 500);
  }
});

/**
 * POST /v1/account/sandbox/:id/start
 *
 * Start a stopped sandbox.
 */
accountRouter.post('/sandbox/:id/start', async (c) => {
  const userId = c.get('userId');
  const sandboxId = c.req.param('id');

  try {
    const accountId = await resolveAccountId(userId);

    const [sandbox] = await db
      .select()
      .from(sandboxes)
      .where(
        and(
          eq(sandboxes.sandboxId, sandboxId),
          eq(sandboxes.accountId, accountId),
        ),
      )
      .limit(1);

    if (!sandbox) {
      return c.json({ success: false, error: 'Sandbox not found' }, 404);
    }

    if (!sandbox.externalId) {
      return c.json({ success: false, error: 'Sandbox has no external ID' }, 400);
    }

    const provider = getProvider(sandbox.provider);
    await provider.start(sandbox.externalId);

    // Update status in DB
    await db
      .update(sandboxes)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(sandboxes.sandboxId, sandboxId));

    console.log(`[PLATFORM] Started sandbox ${sandboxId} via ${sandbox.provider}`);

    return c.json({ success: true });
  } catch (err) {
    console.error('[PLATFORM] startSandbox error:', err);
    return c.json({ success: false, error: 'Failed to start sandbox' }, 500);
  }
});

/**
 * POST /v1/account/sandbox/:id/stop
 *
 * Stop a running sandbox.
 */
accountRouter.post('/sandbox/:id/stop', async (c) => {
  const userId = c.get('userId');
  const sandboxId = c.req.param('id');

  try {
    const accountId = await resolveAccountId(userId);

    const [sandbox] = await db
      .select()
      .from(sandboxes)
      .where(
        and(
          eq(sandboxes.sandboxId, sandboxId),
          eq(sandboxes.accountId, accountId),
        ),
      )
      .limit(1);

    if (!sandbox) {
      return c.json({ success: false, error: 'Sandbox not found' }, 404);
    }

    if (!sandbox.externalId) {
      return c.json({ success: false, error: 'Sandbox has no external ID' }, 400);
    }

    const provider = getProvider(sandbox.provider);
    await provider.stop(sandbox.externalId);

    await db
      .update(sandboxes)
      .set({ status: 'stopped', updatedAt: new Date() })
      .where(eq(sandboxes.sandboxId, sandboxId));

    console.log(`[PLATFORM] Stopped sandbox ${sandboxId} via ${sandbox.provider}`);

    return c.json({ success: true });
  } catch (err) {
    console.error('[PLATFORM] stopSandbox error:', err);
    return c.json({ success: false, error: 'Failed to stop sandbox' }, 500);
  }
});

/**
 * DELETE /v1/account/sandbox/:id
 *
 * Remove a sandbox. Stops the container/instance and marks as archived in DB.
 */
accountRouter.delete('/sandbox/:id', async (c) => {
  const userId = c.get('userId');
  const sandboxId = c.req.param('id');

  try {
    const accountId = await resolveAccountId(userId);

    const [sandbox] = await db
      .select()
      .from(sandboxes)
      .where(
        and(
          eq(sandboxes.sandboxId, sandboxId),
          eq(sandboxes.accountId, accountId),
        ),
      )
      .limit(1);

    if (!sandbox) {
      return c.json({ success: false, error: 'Sandbox not found' }, 404);
    }

    if (sandbox.externalId) {
      const provider = getProvider(sandbox.provider);
      try {
        await provider.remove(sandbox.externalId);
      } catch (err) {
        console.warn(`[PLATFORM] Failed to remove external sandbox ${sandbox.externalId}:`, err);
        // Continue — mark as archived in DB even if external removal fails
      }
    }

    await db
      .update(sandboxes)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(eq(sandboxes.sandboxId, sandboxId));

    console.log(`[PLATFORM] Removed sandbox ${sandboxId} via ${sandbox.provider}`);

    return c.json({ success: true });
  } catch (err) {
    console.error('[PLATFORM] removeSandbox error:', err);
    return c.json({ success: false, error: 'Failed to remove sandbox' }, 500);
  }
});

export { accountRouter };
