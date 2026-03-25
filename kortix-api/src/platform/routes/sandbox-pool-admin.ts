import { Hono } from 'hono';
import type { AppEnv } from '../../types';
import { config } from '../../config';
import * as pool from '../../pool';

export const sandboxPoolAdminApp = new Hono<AppEnv>();

sandboxPoolAdminApp.get('/resources', async (c) => {
  const resources = await pool.resources.list();
  return c.json({ resources });
});

sandboxPoolAdminApp.post('/resources', async (c) => {
  const body = await c.req.json() as { provider: string; server_type: string; location: string; desired_count: number };
  if (!body.provider || !body.server_type || !body.location) {
    return c.json({ error: 'provider, server_type, and location are required' }, 400);
  }
  const resource = await pool.resources.upsert({
    provider: body.provider,
    serverType: body.server_type,
    location: body.location,
    desiredCount: body.desired_count || 2,
  });
  return c.json({ resource }, 201);
});

sandboxPoolAdminApp.patch('/resources/:id', async (c) => {
  const body = await c.req.json() as { desired_count?: number; enabled?: boolean };
  const resource = await pool.resources.update(c.req.param('id'), {
    desiredCount: body.desired_count,
    enabled: body.enabled,
  });
  if (!resource) return c.json({ error: 'Resource not found' }, 404);
  return c.json({ resource });
});

sandboxPoolAdminApp.delete('/resources/:id', async (c) => {
  const deleted = await pool.resources.remove(c.req.param('id'));
  if (!deleted) return c.json({ error: 'Resource not found' }, 404);
  return c.json({ success: true });
});

sandboxPoolAdminApp.get('/health', async (c) => {
  const s = await pool.status();
  const totalDesired = s.resources.filter((r) => r.enabled).reduce((sum, r) => sum + r.desiredCount, 0);

  let healthStatus: 'healthy' | 'warning' | 'critical' | 'disabled' = 'disabled';
  const issues: string[] = [];

  if (totalDesired === 0 && s.resources.length === 0) {
    healthStatus = 'disabled';
  } else if (s.ready >= totalDesired) {
    healthStatus = 'healthy';
  } else if (s.ready > 0 || s.provisioning > 0) {
    healthStatus = 'warning';
    issues.push(`Pool below desired: ${s.ready}/${totalDesired}`);
  } else {
    healthStatus = 'critical';
    issues.push('Pool is empty');
  }

  return c.json({
    status: healthStatus,
    service_running: true,
    pool_enabled: true,
    pool_size: s.ready,
    min_size: totalDesired,
    replenish_threshold: 0,
    issues,
  });
});

sandboxPoolAdminApp.get('/stats', async (c) => {
  const s = await pool.status();
  const totalDesired = s.resources.filter((r) => r.enabled).reduce((sum, r) => sum + r.desiredCount, 0);
  const st = pool.stats.getStats();

  return c.json({
    pool_size: s.ready,
    provisioning: s.provisioning,
    total_created: st.totalCreated,
    total_claimed: st.totalClaimed,
    total_expired: st.totalExpired,
    avg_claim_time_ms: st.avgClaimTimeMs,
    pool_hit_rate: st.poolHitRate,
    last_replenish_at: st.lastReplenishAt?.toISOString() ?? null,
    last_cleanup_at: st.lastCleanupAt?.toISOString() ?? null,
    config: { min_size: totalDesired, max_age_hours: config.POOL_MAX_AGE_HOURS },
  });
});

sandboxPoolAdminApp.get('/list', async (c) => {
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const list = await pool.inventory.listActive(limit);

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
  const before = await pool.status();
  const result = await pool.replenish();
  const after = await pool.status();
  return c.json({ success: true, sandboxes_created: result.created, pool_size_before: before.ready, pool_size_after: after.ready });
});

sandboxPoolAdminApp.post('/force-create', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { count?: number; resource_id?: string };
  try {
    const before = await pool.status();
    const result = await pool.forceCreate(body.count || 1, body.resource_id);
    const after = await pool.status();
    return c.json({ success: true, requested: body.count || 1, created_count: result.created, failed_count: result.failed, failed_errors: result.errors, pool_size_before: before.ready, pool_size_after: after.ready });
  } catch (err: any) {
    return c.json({ error: err.message || 'Force create failed' }, 500);
  }
});

sandboxPoolAdminApp.post('/cleanup', async (c) => {
  const before = await pool.status();
  const result = await pool.cleanup();
  const after = await pool.status();
  return c.json({ success: true, cleaned_count: result.cleaned, pool_size_before: before.ready, pool_size_after: after.ready });
});

sandboxPoolAdminApp.post('/restart-service', async (c) => {
  return c.json({ success: true, was_running: true, is_running: true, message: 'Pool service is running' });
});

sandboxPoolAdminApp.post('/remove', async (c) => {
  const result = await pool.drain();
  return c.json({ success: true, removed_count: result.drained, removed_ids: [], failed_count: 0, failed: [] });
});
