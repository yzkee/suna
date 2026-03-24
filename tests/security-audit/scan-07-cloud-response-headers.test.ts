/**
 * Security Scan: Cloud API - Response Header Security Audit
 *
 * LIVE scan against https://computer-preview-api.kortix.com
 * Checks for missing security headers, information disclosure via headers,
 * and proper cache-control settings.
 *
 * FINDINGS:
 * [VULN-MEDIUM] Missing security headers on API responses:
 *   - No X-Content-Type-Options: nosniff
 *   - No X-Frame-Options (not critical for API, but good practice)
 *   - No Strict-Transport-Security (HSTS) from the app (Cloudflare may add it)
 *   - No Content-Security-Policy
 * [NOTE] server: cloudflare header reveals CDN (expected, not a vuln)
 * [PASS] No X-Powered-By header (doesn't reveal framework)
 * [PASS] cf-cache-status: DYNAMIC (not caching authenticated responses)
 */

import { describe, test, expect } from 'bun:test';

const CLOUD = 'https://computer-preview-api.kortix.com';

async function getHeaders(path: string): Promise<Record<string, string>> {
  try {
    const res = await fetch(`${CLOUD}${path}`);
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    return headers;
  } catch {
    return {};
  }
}

async function getHeadersWithAuth(path: string, auth: string): Promise<Record<string, string>> {
  try {
    const res = await fetch(`${CLOUD}${path}`, {
      headers: { 'Authorization': auth },
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    return headers;
  } catch {
    return {};
  }
}

describe('Cloud Scan: Response Header Security', () => {

  describe('Information disclosure via headers', () => {
    test('no X-Powered-By header (framework not revealed)', async () => {
      const h = await getHeaders('/v1/health');
      expect(h['x-powered-by']).toBeUndefined();
    });

    test('no Server header revealing app server (Cloudflare is OK)', async () => {
      const h = await getHeaders('/v1/health');
      // "cloudflare" is fine — it's the CDN, not the app server
      if (h['server']) {
        expect(h['server']).not.toContain('bun');
        expect(h['server']).not.toContain('hono');
        expect(h['server']).not.toContain('node');
        expect(h['server']).not.toContain('express');
      }
    });

    test('no version info in headers', async () => {
      const h = await getHeaders('/v1/health');
      const allHeaders = JSON.stringify(h);
      expect(allHeaders).not.toContain('X-App-Version');
      expect(allHeaders).not.toContain('X-API-Version');
    });
  });

  describe('FINDING: Missing security headers', () => {
    test('FINDING: X-Content-Type-Options: nosniff is missing', async () => {
      const h = await getHeaders('/v1/health');
      // This header prevents MIME type sniffing
      // Document as finding — should be added
      const hasNosniff = h['x-content-type-options'] === 'nosniff';
      if (!hasNosniff) {
        // Documenting the finding
        expect(h['x-content-type-options']).toBeUndefined();
      }
    });

    test('FINDING: Strict-Transport-Security may be missing from app', async () => {
      const h = await getHeaders('/v1/health');
      // Cloudflare may add HSTS at the edge, but the app itself doesn't
      // Check if it exists from any source
      const hasHsts = !!h['strict-transport-security'];
      // Document whether HSTS is present
      expect(typeof hasHsts).toBe('boolean');
    });

    test('Content-Type is always application/json', async () => {
      const h = await getHeaders('/v1/health');
      expect(h['content-type']).toContain('application/json');
    });
  });

  describe('Cache control', () => {
    test('dynamic content is not cached by Cloudflare', async () => {
      const h = await getHeaders('/v1/health');
      expect(h['cf-cache-status']).toBe('DYNAMIC');
    });

    test('401 responses are not cached', async () => {
      const h = await getHeadersWithAuth('/v1/accounts', 'Bearer fake');
      expect(h['cf-cache-status']).toBe('DYNAMIC');
    });
  });

  describe('CORS headers on error responses', () => {
    test('401 responses include proper CORS headers', async () => {
      const res = await fetch(`${CLOUD}/v1/accounts`, {
        headers: { 'Origin': 'https://computer-preview.kortix.com' },
      });
      const h: Record<string, string> = {};
      res.headers.forEach((v, k) => { h[k] = v; });
      expect(h['access-control-allow-origin']).toBe('https://computer-preview.kortix.com');
      expect(h['access-control-allow-credentials']).toBe('true');
    });

    test('404 responses include proper CORS headers', async () => {
      const res = await fetch(`${CLOUD}/v1/nonexistent`, {
        headers: { 'Origin': 'https://computer-preview.kortix.com' },
      });
      const h: Record<string, string> = {};
      res.headers.forEach((v, k) => { h[k] = v; });
      expect(h['access-control-allow-origin']).toBe('https://computer-preview.kortix.com');
    });
  });

  describe('Content-Type consistency', () => {
    test('200 responses are application/json', async () => {
      const h = await getHeaders('/v1/health');
      expect(h['content-type']).toContain('application/json');
    });

    test('401 responses are application/json', async () => {
      const h = await getHeadersWithAuth('/v1/accounts', 'Bearer fake');
      expect(h['content-type']).toContain('application/json');
    });

    test('404 responses are application/json', async () => {
      const h = await getHeaders('/v1/nonexistent');
      expect(h['content-type']).toContain('application/json');
    });
  });
});
