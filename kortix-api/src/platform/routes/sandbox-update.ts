/**
 * Sandbox update route — Docker image-based updates.
 *
 * Supports both local_docker (Docker API) and justavps (remote exec via toolbox).
 *
 * Flow:
 *   1. Frontend POSTs /v1/platform/sandbox/update with { version, sandboxId? }
 *   2. For local_docker: calls LocalDockerProvider.updateSandbox(version)
 *   3. For justavps: runs pull → patch script → restart via toolbox exec
 *   4. Frontend polls GET /status?sandboxId=xxx for progress
 */

import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { sandboxes } from '@kortix/db';
import { db } from '../../shared/db';
import {
  LocalDockerProvider,
  getSandboxUpdateStatus,
  resetSandboxUpdateStatus,
} from '../providers/local-docker';
import { getProvider, type ProviderName } from '../providers';
import { supabaseAuth as authMiddleware } from '../../middleware/auth';
import { resolveAccountId } from '../../shared/resolve-account';
import {
  executeUpdate,
  getUpdateStatus,
  resetUpdateStatus,
} from '../../update';
import type { AuthVariables } from '../../types';

const sandboxUpdateRouter = new Hono<{ Variables: AuthVariables }>();

sandboxUpdateRouter.use('/*', authMiddleware);

async function findActiveSandbox(accountId: string, sandboxId?: string) {
  if (sandboxId) {
    const [row] = await db
      .select()
      .from(sandboxes)
      .where(and(eq(sandboxes.sandboxId, sandboxId), eq(sandboxes.accountId, accountId)))
      .limit(1);
    return row ?? null;
  }
  const [row] = await db
    .select()
    .from(sandboxes)
    .where(and(eq(sandboxes.accountId, accountId), eq(sandboxes.status, 'active')))
    .orderBy(desc(sandboxes.updatedAt))
    .limit(1);
  return row ?? null;
}

/**
 * POST /v1/platform/sandbox/update
 * Body: { version: "0.8.19", sandboxId?: "uuid" }
 */
sandboxUpdateRouter.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const targetVersion = body?.version;
  const sandboxId = body?.sandboxId;

  if (!targetVersion || typeof targetVersion !== 'string') {
    return c.json({ success: false, error: 'Missing or invalid version' }, 400);
  }

  const userId = c.get('userId');
  const accountId = await resolveAccountId(userId);
  const sandbox = await findActiveSandbox(accountId, sandboxId);

  if (!sandbox) {
    return c.json({ success: false, error: 'No active sandbox found' }, 404);
  }

  // Route to the right update path based on provider
  if (sandbox.provider === 'justavps') {
    const status = await getUpdateStatus(sandbox.sandboxId);
    if (status.phase !== 'idle' && status.phase !== 'complete' && status.phase !== 'failed') {
      return c.json({
        success: false,
        error: `Update already in progress (phase: ${status.phase})`,
        status,
      }, 409);
    }

    executeUpdate(sandbox.sandboxId, targetVersion).catch((err) => {
      console.error('[SANDBOX-UPDATE] JustAVPS update failed:', err.message || err);
    });

    return c.json({
      success: true,
      started: true,
      message: `Update to v${targetVersion} started. Poll GET /status for progress.`,
      targetVersion,
      sandboxId: sandbox.sandboxId,
      provider: 'justavps',
    });
  }

  // Fallback: local_docker
  let provider: LocalDockerProvider;
  try {
    const p = getProvider('local_docker' as ProviderName);
    if (!(p instanceof LocalDockerProvider)) {
      return c.json({ success: false, error: `Update not supported for provider: ${sandbox.provider}` }, 400);
    }
    provider = p;
  } catch {
    return c.json({ success: false, error: 'local_docker provider not available' }, 400);
  }

  const currentStatus = getSandboxUpdateStatus();
  if (currentStatus.phase !== 'idle' && currentStatus.phase !== 'complete' && currentStatus.phase !== 'failed') {
    return c.json({
      success: false,
      error: `Update already in progress (phase: ${currentStatus.phase})`,
      status: currentStatus,
    }, 409);
  }

  provider.updateSandbox(targetVersion).catch((err) => {
    console.error('[SANDBOX-UPDATE] Local Docker update failed:', err.message || err);
  });

  return c.json({
    success: true,
    started: true,
    message: `Update to v${targetVersion} started. Poll GET /status for progress.`,
    targetVersion,
    sandboxId: sandbox.sandboxId,
    provider: 'local_docker',
  });
});

/**
 * GET /v1/platform/sandbox/update/status?sandboxId=xxx
 */
sandboxUpdateRouter.get('/status', async (c) => {
  const sandboxId = c.req.query('sandboxId');
  const userId = c.get('userId');

  if (sandboxId) {
    const accountId = await resolveAccountId(userId);
    const sandbox = await findActiveSandbox(accountId, sandboxId);
    if (sandbox?.provider === 'justavps') {
      return c.json(await getUpdateStatus(sandbox.sandboxId));
    }
  }

  // Fallback: local_docker in-memory status
  return c.json(getSandboxUpdateStatus());
});

/**
 * POST /v1/platform/sandbox/update/reset
 * Body: { sandboxId?: "uuid" }
 */
sandboxUpdateRouter.post('/reset', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const sandboxId = body?.sandboxId;
  const userId = c.get('userId');

  if (sandboxId) {
    const accountId = await resolveAccountId(userId);
    const sandbox = await findActiveSandbox(accountId, sandboxId);
    if (sandbox?.provider === 'justavps') {
      await resetUpdateStatus(sandbox.sandboxId);
      return c.json({ success: true, message: 'Update status reset' });
    }
  }

  resetSandboxUpdateStatus();
  return c.json({ success: true, message: 'Update status reset to idle' });
});

export { sandboxUpdateRouter };
