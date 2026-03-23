import { Hono } from 'hono';
import type { AppEnv } from '../../types';
import { config } from '../../config';
import {
  getPoolStatus,
  replenishPool,
  cleanupPool,
  drainPool,
  listPoolSandboxes,
  forceCreatePool,
  getAllResources,
  createResource,
  updateResource,
  deleteResource,
} from '../services/sandbox-pool';

export const sandboxPoolAdminApp = new Hono<AppEnv>();

// ─── Resources CRUD ──────────────────────────────────────────────────────────

sandboxPoolAdminApp.get('/resources', async (c) => {
  const resources = await getAllResources();
  return c.json({ resources });
});

sandboxPoolAdminApp.post('/resources', async (c) => {
  const body = await c.req.json() as {
    provider: string;
    server_type: string;
    location: string;
    desired_count: number;
  };

  if (!body.provider || !body.server_type || !body.location) {
    return c.json({ error: 'provider, server_type, and location are required' }, 400);
  }

  const resource = await createResource({
    provider: body.provider,
    serverType: body.server_type,
    location: body.location,
    desiredCount: body.desired_count || 2,
  });

  return c.json({ resource }, 201);
});

sandboxPoolAdminApp.patch('/resources/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json() as {
    desired_count?: number;
    enabled?: boolean;
  };

  const resource = await updateResource(id, {
    desiredCount: body.desired_count,
    enabled: body.enabled,
  });

  if (!resource) return c.json({ error: 'Resource not found' }, 404);
  return c.json({ resource });
});

sandboxPoolAdminApp.delete('/resources/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = await deleteResource(id);
  if (!deleted) return c.json({ error: 'Resource not found' }, 404);
  return c.json({ success: true });
});

// ─── Pool Status & Actions ───────────────────────────────────────────────────

sandboxPoolAdminApp.get('/health', async (c) => {
  const status = await getPoolStatus();

  const totalDesired = status.resources
    .filter((r) => r.enabled)
    .reduce((sum, r) => sum + r.desiredCount, 0);

  let healthStatus: 'healthy' | 'warning' | 'critical' | 'disabled' = 'disabled';
  const issues: string[] = [];

  if (totalDesired === 0 && status.resources.length === 0) {
    healthStatus = 'disabled';
  } else if (status.ready >= totalDesired) {
    healthStatus = 'healthy';
  } else if (status.ready > 0 || status.provisioning > 0) {
    healthStatus = 'warning';
    issues.push(`Pool below desired: ${status.ready}/${totalDesired}`);
  } else {
    healthStatus = 'critical';
    issues.push('Pool is empty');
  }

  return c.json({
    status: healthStatus,
    service_running: true,
    pool_enabled: true,
    pool_size: status.ready,
    min_size: totalDesired,
    replenish_threshold: 0,
    issues,
  });
});

sandboxPoolAdminApp.get('/stats', async (c) => {
  const status = await getPoolStatus();
  const totalDesired = status.resources.filter((r) => r.enabled).reduce((sum, r) => sum + r.desiredCount, 0);

  return c.json({
    pool_size: status.ready,
    provisioning: status.provisioning,
    total_created: 0,
    total_claimed: 0,
    total_expired: 0,
    avg_claim_time_ms: 0,
    pool_hit_rate: 0,
    last_replenish_at: null,
    last_cleanup_at: null,
    config: {
      min_size: totalDesired,
      max_size: config.POOL_MAX_SIZE,
      max_age_hours: config.POOL_MAX_AGE_HOURS,
    },
  });
});

sandboxPoolAdminApp.get('/list', async (c) => {
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const list = await listPoolSandboxes(limit);

  return c.json({
    count: list.length,
    sandboxes: list.map((s) => ({
      id: s.id,
      external_id: s.externalId,
      provider: s.provider,
      status: s.status,
      server_type: s.serverType,
      location: s.location,
      pooled_at: s.readyAt?.toISOString() ?? null,
      created_at: s.createdAt?.toISOString() ?? null,
    })),
  });
});

sandboxPoolAdminApp.post('/replenish', async (c) => {
  if (!config.isPoolEnabled()) {
    return c.json({ error: 'Pool is not enabled. Set POOL_ENABLED=true and POOL_ACCOUNT_ID.' }, 503);
  }

  const before = await getPoolStatus();
  const result = await replenishPool();
  const after = await getPoolStatus();

  return c.json({
    success: true,
    sandboxes_created: result.created,
    pool_size_before: before.ready,
    pool_size_after: after.ready,
  });
});

sandboxPoolAdminApp.post('/force-create', async (c) => {
  if (!config.isPoolEnabled()) {
    return c.json({ error: 'Pool is not enabled' }, 503);
  }

  const body = await c.req.json().catch(() => ({})) as { count?: number; resource_id?: string };
  const count = body.count || 1;

  const before = await getPoolStatus();
  const result = await forceCreatePool(count, body.resource_id);
  const after = await getPoolStatus();

  return c.json({
    success: true,
    requested: count,
    created_count: result.created,
    created_ids: [],
    failed_count: result.failed,
    failed_errors: [],
    pool_size_before: before.ready,
    pool_size_after: after.ready,
  });
});

sandboxPoolAdminApp.post('/cleanup', async (c) => {
  const before = await getPoolStatus();
  const result = await cleanupPool();
  const after = await getPoolStatus();

  return c.json({
    success: true,
    cleaned_count: result.cleaned,
    pool_size_before: before.ready,
    pool_size_after: after.ready,
  });
});

sandboxPoolAdminApp.post('/restart-service', async (c) => {
  return c.json({
    success: true,
    was_running: config.isPoolEnabled(),
    is_running: config.isPoolEnabled(),
    message: config.isPoolEnabled() ? 'Pool service is running' : 'Pool is not enabled',
  });
});

sandboxPoolAdminApp.post('/remove', async (c) => {
  const result = await drainPool();
  return c.json({
    success: true,
    removed_count: result.drained,
    removed_ids: [],
    failed_count: 0,
    failed: [],
  });
});
