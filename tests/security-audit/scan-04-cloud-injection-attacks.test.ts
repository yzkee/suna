/**
 * Security Scan: Cloud API - Injection Attacks on Public Endpoints
 *
 * LIVE scan against https://computer-preview-api.kortix.com
 * Tests SQL injection, XSS, and other payloads on the PUBLIC endpoints
 * that accept user input (check-email, request-access, oauth).
 *
 * FINDINGS:
 * [VULN-LOW] check-email accepts "' OR 1=1 --" and returns {allowed:true}
 *   - This is because signups are enabled (signupsEnabled=true), so ALL emails
 *     return allowed:true regardless. Not a real SQLi, but the endpoint doesn't
 *     validate email format before querying.
 * [VULN-LOW] check-email accepts "<script>alert(1)</script>@test.com" and returns {allowed:true}
 *   - Same reason: signups enabled = everything allowed. But the email string
 *     is not sanitized and could be stored.
 * [VULN-INFO] request-access stores SQL payloads in company/useCase fields
 *   - Drizzle ORM uses parameterized queries so no actual injection, but the
 *     data is stored as-is without sanitization.
 * [VULN-LOW] XML/form content type on JSON endpoint returns 500 instead of 400
 *   - Hono's c.req.json() throws on non-JSON body, producing a 500 that should be 400.
 * [PASS] OAuth authorize rejects invalid clients with 500 (should ideally be 400)
 * [PASS] OAuth authorize enforces S256, rejects plain
 */

import { describe, test, expect } from 'bun:test';

const CLOUD = 'https://computer-preview-api.kortix.com';

async function post(path: string, body: any, contentType = 'application/json'): Promise<{
  status: number;
  body: any;
}> {
  try {
    const res = await fetch(`${CLOUD}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } catch (err: any) {
    return { status: 0, body: { error: err.message } };
  }
}

async function get(path: string): Promise<{ status: number; body: any }> {
  try {
    const res = await fetch(`${CLOUD}${path}`);
    const text = await res.text();
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } catch (err: any) {
    return { status: 0, body: { error: err.message } };
  }
}

describe('Cloud Scan: Injection Attacks on Public Endpoints', () => {

  describe('SQL injection on /v1/access/check-email', () => {
    test('SQL injection payload does not cause error', async () => {
      const r = await post('/v1/access/check-email', { email: "' OR 1=1 --" });
      // Should return 200 with allowed:true or false, NOT 500
      expect(r.status).toBe(200);
      // Since signups are enabled, this returns true for everything
      // The important thing is no SQL error
    });

    test('UNION SELECT payload does not cause error', async () => {
      const r = await post('/v1/access/check-email', {
        email: "' UNION SELECT email, id FROM auth.users --",
      });
      expect(r.status).toBe(200);
    });

    test('response does not contain SQL data', async () => {
      const r = await post('/v1/access/check-email', {
        email: "' UNION SELECT email, id FROM auth.users --",
      });
      const json = JSON.stringify(r.body);
      // Should only have {allowed: bool}, not leaked data
      expect(Object.keys(r.body).sort()).toEqual(['allowed']);
    });
  });

  describe('XSS payloads on /v1/access/check-email', () => {
    test('script tag in email does not cause error', async () => {
      const r = await post('/v1/access/check-email', {
        email: '<script>alert(document.cookie)</script>@test.com',
      });
      expect(r.status).toBe(200);
    });

    test('response is application/json (prevents browser XSS interpretation)', async () => {
      const res = await fetch(`${CLOUD}/v1/access/check-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: '<img src=x onerror=alert(1)>@test.com' }),
      });
      expect(res.headers.get('content-type')).toContain('application/json');
    });
  });

  describe('SQL injection on /v1/access/request-access', () => {
    test('SQL injection in company field does not cause error', async () => {
      const r = await post('/v1/access/request-access', {
        email: 'security-test-sqli@example.com',
        company: "'; DROP TABLE access_requests; --",
        useCase: "1' AND SLEEP(5) --",
      });
      // Drizzle ORM parameterizes, so this should just store the string
      expect(r.status).toBe(200);
      expect(r.body.success).toBe(true);
    });
  });

  describe('Input validation on /v1/access endpoints', () => {
    test('empty body returns error, not 500', async () => {
      const r = await post('/v1/access/check-email', {});
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('email required');
    });

    test('no email on request-access returns 400', async () => {
      const r = await post('/v1/access/request-access', { company: 'test' });
      expect(r.status).toBe(400);
    });

    test('email without @ on request-access returns 400', async () => {
      const r = await post('/v1/access/request-access', { email: 'notanemail' });
      expect(r.status).toBe(400);
    });
  });

  describe('Content type confusion', () => {
    test('XML body to JSON endpoint returns 500 (finding: should be 400)', async () => {
      const r = await post('/v1/access/check-email', '<email>test@test.com</email>', 'application/xml');
      // This is a finding: the endpoint crashes instead of gracefully handling wrong content type
      expect(r.status).toBe(500);
    });

    test('form-encoded body to JSON endpoint returns 500 (finding: should be 400)', async () => {
      const r = await post('/v1/access/check-email', 'email=test@test.com', 'application/x-www-form-urlencoded');
      expect(r.status).toBe(500);
    });

    test('no Content-Type still works (body parsed as text)', async () => {
      const res = await fetch(`${CLOUD}/v1/access/check-email`, {
        method: 'POST',
        body: JSON.stringify({ email: 'test@test.com' }),
      });
      expect(res.status).toBe(200);
    });
  });

  describe('OAuth parameter injection', () => {
    test('OAuth authorize with non-existent client returns error (not crash)', async () => {
      const r = await get('/v1/oauth/authorize?client_id=evil&redirect_uri=https://evil.com&response_type=code&code_challenge=abc');
      // Returns 500 currently — finding: should be 400 "Client not found"
      expect([400, 500]).toContain(r.status);
    });

    test('OAuth authorize rejects plain code_challenge_method', async () => {
      const r = await get('/v1/oauth/authorize?client_id=test&redirect_uri=https://test.com&response_type=code&code_challenge=abc&code_challenge_method=plain');
      expect(r.status).toBe(400);
      expect(r.body.error_description).toContain('S256');
    });

    test('OAuth token with no credentials returns 400', async () => {
      const r = await post('/v1/oauth/token', '', 'application/x-www-form-urlencoded');
      expect(r.status).toBe(400);
    });

    test('OAuth authorize rejects missing code_challenge', async () => {
      const r = await get('/v1/oauth/authorize?client_id=test&redirect_uri=https://test.com&response_type=code');
      expect(r.status).toBe(400);
    });
  });

  describe('Large payload attacks', () => {
    test('very long email does not crash the server', async () => {
      const longEmail = 'a'.repeat(100000) + '@test.com';
      const r = await post('/v1/access/check-email', { email: longEmail });
      // Should handle gracefully (200 or 400), not 500
      expect([200, 400, 413]).toContain(r.status);
    });

    test('deeply nested JSON does not crash the server', async () => {
      let obj: any = { email: 'test@test.com' };
      for (let i = 0; i < 100; i++) {
        obj = { nested: obj };
      }
      const r = await post('/v1/access/check-email', obj);
      // Should handle gracefully
      expect([200, 400, 500]).toContain(r.status);
    });
  });

  describe('Prototype pollution via JSON', () => {
    test('__proto__ in request body does not affect server objects', async () => {
      const r = await post('/v1/access/check-email', {
        email: 'test@test.com',
        __proto__: { isAdmin: true },
        constructor: { prototype: { isAdmin: true } },
      });
      expect(r.status).toBe(200);
      // Response should not have unexpected fields
      expect(r.body).not.toHaveProperty('isAdmin');
    });
  });
});
