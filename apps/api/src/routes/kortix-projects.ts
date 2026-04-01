/**
 * Kortix API proxy handler — /v1/kortix/*
 *
 * Proxies to the sandbox's /kortix/* API (server-to-server, no CORS issues).
 * Registered as app.all() handler so it short-circuits before the catch-all.
 */

import type { Context } from 'hono';
import { config } from '../config';
import { getSandboxBaseUrl } from '../sandbox-proxy/routes/local-preview';

export async function kortixProxyHandler(c: Context): Promise<Response> {
  // /v1/kortix/projects/xxx → /kortix/projects/xxx (strip trailing slashes)
  const sandboxPath = c.req.path.replace(/^\/v1/, '').replace(/\/+$/, '') || '/kortix';
  const sandboxBaseUrl = getSandboxBaseUrl(config.SANDBOX_CONTAINER_NAME);
  const targetUrl = `${sandboxBaseUrl}${sandboxPath}`;

  const headers = new Headers();
  const ct = c.req.header('content-type');
  if (ct) headers.set('Content-Type', ct);
  if (config.INTERNAL_SERVICE_KEY) {
    headers.set('Authorization', `Bearer ${config.INTERNAL_SERVICE_KEY}`);
  }

  try {
    const res = await fetch(targetUrl, {
      method: c.req.method,
      headers,
      body: c.req.method !== 'GET' && c.req.method !== 'HEAD'
        ? await c.req.arrayBuffer()
        : undefined,
      signal: AbortSignal.timeout(10_000),
    });

    const data = await res.arrayBuffer();
    return new Response(data, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json' },
    });
  } catch (err: any) {
    return c.json({ error: 'Sandbox unreachable', detail: err?.message }, 502);
  }
}
