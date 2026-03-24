/**
 * Security Scan: Cloud API - HTTP Method Fuzzing
 *
 * LIVE scan against https://computer-preview-api.kortix.com
 * Tests unexpected HTTP methods on endpoints to find method confusion bugs.
 *
 * FINDINGS:
 * [PASS] DELETE/PUT/PATCH on GET-only routes return 404 (Hono doesn't route them)
 * [PASS] TRACE is blocked by Cloudflare with 405
 * [PASS] POST on GET-only public endpoints returns 404
 */

import { describe, test, expect } from 'bun:test';

const CLOUD = 'https://computer-preview-api.kortix.com';

async function probe(method: string, path: string): Promise<{ status: number; body: any }> {
  try {
    const res = await fetch(`${CLOUD}${path}`, { method });
    const text = await res.text();
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } catch (err: any) {
    return { status: 0, body: { error: err.message } };
  }
}

describe('Cloud Scan: HTTP Method Fuzzing', () => {

  describe('Health endpoint - wrong methods', () => {
    test('DELETE /health returns 404', async () => {
      const r = await probe('DELETE', '/health');
      expect(r.status).toBe(404);
    });

    test('PUT /health returns 404', async () => {
      const r = await probe('PUT', '/health');
      expect(r.status).toBe(404);
    });

    test('PATCH /health returns 404', async () => {
      const r = await probe('PATCH', '/health');
      expect(r.status).toBe(404);
    });

    test('POST /health returns 404', async () => {
      const r = await probe('POST', '/health');
      expect(r.status).toBe(404);
    });
  });

  describe('System status - wrong methods', () => {
    test('DELETE /v1/system/status returns 404', async () => {
      const r = await probe('DELETE', '/v1/system/status');
      expect(r.status).toBe(404);
    });

    test('POST /v1/system/status returns 404', async () => {
      const r = await probe('POST', '/v1/system/status');
      expect(r.status).toBe(404);
    });
  });

  describe('TRACE method (XST attack vector)', () => {
    test('TRACE is blocked (405 or 404)', async () => {
      const r = await probe('TRACE', '/v1/health');
      expect([404, 405]).toContain(r.status);
    });

    test('TRACE on root is blocked', async () => {
      const r = await probe('TRACE', '/');
      expect([404, 405]).toContain(r.status);
    });
  });

  describe('Protected endpoints - POST where only GET exists', () => {
    test('POST /v1/accounts returns 404 (not 401 — method not routed)', async () => {
      const r = await probe('POST', '/v1/accounts');
      expect(r.status).toBe(404);
    });

    test('DELETE /v1/accounts returns 404', async () => {
      const r = await probe('DELETE', '/v1/accounts');
      expect(r.status).toBe(404);
    });
  });

  describe('Public POST endpoints - GET should not work', () => {
    test('GET /v1/access/check-email returns 404 (POST only)', async () => {
      const r = await probe('GET', '/v1/access/check-email');
      expect(r.status).toBe(404);
    });

    test('GET /v1/access/request-access returns 404 (POST only)', async () => {
      const r = await probe('GET', '/v1/access/request-access');
      expect(r.status).toBe(404);
    });
  });

  describe('Method consistency on authenticated routes', () => {
    test('GET on POST-only /v1/prewarm returns 404', async () => {
      const r = await probe('GET', '/v1/prewarm');
      expect(r.status).toBe(404);
    });
  });
});
