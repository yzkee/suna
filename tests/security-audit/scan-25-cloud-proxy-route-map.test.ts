/**
 * Security Scan: Cloud API - Complete Proxy Route Map
 *
 * LIVE scan against https://computer-preview-api.kortix.com
 *
 * Maps every proxy route and whether it forwards requests without
 * a kortix_ token (Mode 3 passthrough).
 *
 * ALL of these should require a kortix_ token on cloud.
 * Currently Mode 3 forwards to upstream without any auth gate.
 *
 * The upstream providers reject because the attacker has no valid key,
 * BUT the request still goes through Kortix's infrastructure:
 * - Bandwidth consumed
 * - Kortix IP used for the upstream request
 * - xAI actually processes the request (returns 400 bad data, not 401)
 */

import { describe, test, expect } from 'bun:test';

const CLOUD = 'https://computer-preview-api.kortix.com';

async function probeProxy(path: string, body: any): Promise<{ status: number; body: any }> {
  try {
    const res = await fetch(`${CLOUD}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } catch (err: any) {
    return { status: 0, body: { error: err.message } };
  }
}

describe('Cloud Scan: Proxy Route Map — All Should Require kortix_ Token', () => {

  describe('Proxy routes that forward to upstream without auth (Mode 3)', () => {
    test('Tavily — forwards to api.tavily.com (upstream rejects)', async () => {
      const r = await probeProxy('/v1/router/tavily/search', { query: 'x' });
      // Returns Tavily's own error — request was forwarded
      expect(r.status).toBe(401);
    });

    test('Serper — forwards to google.serper.dev (upstream rejects)', async () => {
      const r = await probeProxy('/v1/router/serper/search', { q: 'x' });
      // Returns Serper's 403 — request was forwarded
      expect(r.status).toBe(403);
    });

    test('Firecrawl — forwards to api.firecrawl.dev (upstream rejects)', async () => {
      const r = await probeProxy('/v1/router/firecrawl/v1/scrape', { url: 'http://example.com' });
      expect(r.status).toBe(401);
    });

    test('OpenAI — forwards to api.openai.com (upstream rejects)', async () => {
      const r = await probeProxy('/v1/router/openai/chat/completions', {
        model: 'gpt-4', messages: [],
      });
      expect(r.status).toBe(401);
    });

    test('xAI — forwards to api.x.ai (upstream PROCESSES request!)', async () => {
      const r = await probeProxy('/v1/router/xai/chat/completions', {
        model: 'grok-1', messages: [],
      });
      // xAI returns 400 "Messages cannot be empty" — it PROCESSED the request
      // Not an auth error — it accepted the request and validated the body
      // This means xAI's API might not require auth for some endpoints
      expect(r.status).toBe(400);
    });

    test('Groq — forwards to api.groq.com (upstream rejects)', async () => {
      const r = await probeProxy('/v1/router/groq/chat/completions', {
        model: 'mixtral', messages: [],
      });
      expect(r.status).toBe(401);
    });
  });

  describe('These should all return Kortix 401 instead of upstream errors', () => {
    test('EXPECTED: all non-kortix requests should get Kortix 401', () => {
      // Current: request forwards to upstream, upstream auth error leaks through
      // Expected: Kortix rejects BEFORE forwarding
      // Fix in proxy.ts handleProxy():
      //   if (!auth.isKortixUser && config.isCloud()) {
      //     throw new HTTPException(401, { message: 'Kortix API key required' });
      //   }
      expect(true).toBe(true);
    });
  });

  describe('LLM-specific routes (chat/completions, /messages)', () => {
    test('/v1/router/chat/completions requires apiKeyAuth (separate from proxy)', async () => {
      const r = await probeProxy('/v1/router/chat/completions', {
        model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }],
      });
      // This route uses apiKeyAuth middleware — properly protected
      expect(r.status).toBe(401);
      expect(r.body.message).toBe('Missing or invalid Authorization header');
    });

    test('/v1/router/models requires apiKeyAuth (properly protected)', async () => {
      const res = await fetch(`${CLOUD}/v1/router/models`);
      expect(res.status).toBe(401);
    });

    test('/v1/router/web-search requires apiKeyAuth (properly protected)', async () => {
      const r = await probeProxy('/v1/router/web-search', { query: 'test' });
      expect(r.status).toBe(401);
    });
  });
});
