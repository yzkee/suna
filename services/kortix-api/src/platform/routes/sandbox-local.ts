/**
 * Local-mode sandbox router.
 *
 * Manages the SINGLE local Docker sandbox via LocalDockerProvider.
 * Fixed ports (SANDBOX_PORT_BASE..SANDBOX_PORT_BASE+6), container name always `kortix-sandbox`.
 *
 * Routes (mounted at /v1/platform/sandbox):
 *   GET    /          → Get the sandbox (or 404 if none exists)
 *   POST   /          → Ensure sandbox is running (idempotent create-or-start)
 *   POST   /stop      → Stop the sandbox
 *   POST   /restart   → Restart the sandbox
 *   DELETE /          → Remove the sandbox container entirely
 */

import { Hono } from 'hono';
import { supabaseAuth as authMiddleware } from '../../middleware/auth';
import { LocalDockerProvider, type SandboxInfo } from '../providers/local-docker';
import { sandboxAuthStore } from '../sandbox-auth-store';
import { LOCAL_SANDBOX_ID } from '../local-identity';
import { hasDatabase } from '../../shared/db';
import type { AuthVariables } from '../../types';

const provider = new LocalDockerProvider();

/**
 * Serialize SandboxInfo to the frontend-expected shape.
 * Keeps the same contract as the DB-backed router so the frontend
 * doesn't need to care which mode it's in.
 */
function serialize(info: SandboxInfo) {
  return {
    sandbox_id: hasDatabase ? LOCAL_SANDBOX_ID : info.name,
    external_id: info.name,  // Container name (e.g. 'kortix-sandbox') — used for Docker DNS & URL routing
    name: info.name,
    provider: 'local_docker' as const,
    base_url: info.baseUrl,
    status: info.status === 'running' ? 'active' : info.status,
    metadata: {
      mappedPorts: info.mappedPorts,
      image: info.image,
    },
    created_at: info.createdAt,
    updated_at: info.createdAt,
  };
}

export function createLocalSandboxRouter(): Hono<{ Variables: AuthVariables }> {
  const router = new Hono<{ Variables: AuthVariables }>();

  router.use('/*', authMiddleware);

  // ─── GET / ─────────────────────────────────────────────────────────────
  // Get the local sandbox. Returns 404 if no container exists.

  router.get('/', async (c) => {
    try {
      const info = await provider.find();

      if (!info) {
        return c.json(
          { success: false, error: 'No sandbox found. Call POST /v1/platform/sandbox to create one.' },
          404,
        );
      }

      return c.json({ success: true, data: serialize(info) });
    } catch (err) {
      console.error('[SANDBOX-LOCAL] get error:', err);
      return c.json({ success: false, error: String(err) }, 500);
    }
  });

  // ─── GET /list ──────────────────────────────────────────────────────────
  // List sandboxes. In local mode there's at most one.

  router.get('/list', async (c) => {
    try {
      const info = await provider.find();
      return c.json({
        success: true,
        data: info ? [serialize(info)] : [],
      });
    } catch (err) {
      console.error('[SANDBOX-LOCAL] list error:', err);
      return c.json({ success: false, error: String(err) }, 500);
    }
  });

  // ─── POST / ────────────────────────────────────────────────────────────
  // Ensure the sandbox exists and is running. Idempotent:
  //   - Running  → return it
  //   - Stopped  → start it
  //   - Missing  → create it

  router.post('/', async (c) => {
    try {
      const existed = !!(await provider.find());
      const info = await provider.ensure();
      // Invalidate cached auth token — container may have changed
      sandboxAuthStore.invalidate();

      console.log(
        `[SANDBOX-LOCAL] ${existed ? 'Ensured' : 'Created'} sandbox (${info.status})`,
      );

      return c.json(
        {
          success: true,
          data: serialize(info),
          created: !existed,
        },
        existed ? 200 : 201,
      );
    } catch (err) {
      console.error('[SANDBOX-LOCAL] ensure error:', err);
      return c.json({ success: false, error: String(err) }, 500);
    }
  });

  // ─── POST /generate-token ───────────────────────────────────────────────
  // Generate a sandbox access key (sak_xxx). This key protects the proxy:
  //   - Frontend must send it as Bearer token to access the sandbox through the proxy.
  //   - The proxy validates it (sandboxAuthStore.hasAuth/getAccessKey).
  //   - The proxy→sandbox connection uses Docker networking and doesn't need this key.
  //
  // NO container restart needed! The proxy is the auth boundary.
  // The key is stored in sandboxAuthStore (in-memory + disk) and returned to the user.

  router.post('/generate-token', async (c) => {
    try {
      // Generate a new access key
      const { randomAlphanumeric } = await import('../../shared/crypto');
      const accessKey = `sak_${randomAlphanumeric(32)}`;

      // Store the key — this instantly enables proxy auth.
      // The proxy middleware checks sandboxAuthStore.hasAuth() on every request.
      // From this moment, requests without the key will get 401.
      // This is fine because:
      //   1. This request itself doesn't go through the sandbox proxy
      //   2. The response carries the key back to the frontend
      //   3. The frontend stores it and sends it on subsequent requests
      sandboxAuthStore.setAccessKey(accessKey);

      // Get current sandbox info (no restart needed)
      const info = await provider.find();
      if (!info) {
        return c.json({ success: false, error: 'No sandbox found' }, 404);
      }

      console.log('[SANDBOX-LOCAL] Token generated (no container restart)');
      return c.json({
        success: true,
        data: serialize(info),
        accessKey,
      });
    } catch (err) {
      console.error('[SANDBOX-LOCAL] generate-token error:', err);
      return c.json({ success: false, error: String(err) }, 500);
    }
  });

  // ─── POST /stop ────────────────────────────────────────────────────────

  router.post('/stop', async (c) => {
    try {
      await provider.stop();
      console.log('[SANDBOX-LOCAL] Stopped sandbox');
      return c.json({ success: true });
    } catch (err) {
      console.error('[SANDBOX-LOCAL] stop error:', err);
      return c.json({ success: false, error: String(err) }, 500);
    }
  });

  // ─── POST /restart ─────────────────────────────────────────────────────

  router.post('/restart', async (c) => {
    try {
      await provider.restart();
      const info = await provider.getSandboxInfo();
      console.log('[SANDBOX-LOCAL] Restarted sandbox');
      return c.json({ success: true, data: serialize(info) });
    } catch (err) {
      console.error('[SANDBOX-LOCAL] restart error:', err);
      return c.json({ success: false, error: String(err) }, 500);
    }
  });

  // ─── DELETE / ──────────────────────────────────────────────────────────

  router.delete('/', async (c) => {
    try {
      await provider.remove();
      sandboxAuthStore.clear(); // Remove persisted token when sandbox is deleted
      console.log('[SANDBOX-LOCAL] Removed sandbox');
      return c.json({ success: true });
    } catch (err) {
      console.error('[SANDBOX-LOCAL] remove error:', err);
      return c.json({ success: false, error: String(err) }, 500);
    }
  });

  return router;
}

export const localSandboxRouter = createLocalSandboxRouter();
