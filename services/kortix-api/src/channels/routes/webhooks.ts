/**
 * Webhook routes for channel adapters.
 *
 * Each adapter registers its own routes here during startup.
 * These routes are UNAUTHENTICATED (platforms need to POST directly).
 * Each adapter handles its own signature verification.
 */

import { Hono } from 'hono';

const webhooksRouter = new Hono();

// Adapters register their webhook routes via adapter.registerRoutes()
// which receives this router and mounts under /webhooks/<type>/*

export { webhooksRouter };
