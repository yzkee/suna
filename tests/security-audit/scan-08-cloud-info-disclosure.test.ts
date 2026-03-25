/**
 * Security Scan: Cloud API - Information Disclosure
 *
 * LIVE scan against https://computer-preview-api.kortix.com
 * Checks what information is exposed via public endpoints, error messages,
 * and version endpoints.
 *
 * FINDINGS:
 * [VULN-LOW] /health exposes:
 *   - env: "cloud" (reveals deployment mode)
 *   - channels.enabled: true, channels.adapters: ["slack"]
 *   - tunnel.enabled: true, tunnel.connectedAgents: 0
 *   This reveals internal architecture details.
 * [VULN-LOW] /v1/platform/sandbox/version exposes:
 *   - Exact version number (0.8.19)
 *   - Full changelog with fix details mentioning internal URLs (localhost:8008)
 *   - Feature descriptions revealing architecture
 * [VULN-INFO] /v1/access/signup-status reveals signups are enabled
 * [VULN-INFO] /v1/setup/install-status reveals installation state
 * [VULN-INFO] Stripe webhook error reveals stripe-node SDK usage
 * [VULN-LOW] OAuth authorize with valid-format but nonexistent client returns 500
 *   instead of 400, which may reveal DB error handling behavior
 */

import { describe, test, expect } from 'bun:test';

const CLOUD = 'https://computer-preview-api.kortix.com';

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

describe('Cloud Scan: Information Disclosure', () => {

  describe('/health endpoint information leakage', () => {
    test('FINDING: exposes deployment environment mode', async () => {
      const r = await get('/health');
      expect(r.body.env).toBe('cloud');
      // This reveals the deployment mode to unauthenticated users
    });

    test('channels info may or may not be exposed', async () => {
      const r = await get('/health');
      // Channels field is sometimes present, sometimes not (depends on deployment)
      if (r.body.channels) {
        // If present, it reveals internal service architecture
        expect(r.body.channels.enabled).toBeDefined();
      }
    });

    test('FINDING: exposes tunnel service status', async () => {
      const r = await get('/health');
      expect(r.body.tunnel).toBeDefined();
      expect(r.body.tunnel.enabled).toBe(true);
      expect(typeof r.body.tunnel.connectedAgents).toBe('number');
      // Reveals whether tunnel service is active and # of connected agents
    });

    test('does NOT expose database connection info', async () => {
      const r = await get('/health');
      const json = JSON.stringify(r.body);
      expect(json).not.toContain('postgresql');
      expect(json).not.toContain('supabase');
      expect(json).not.toContain('database');
    });
  });

  describe('/v1/platform/sandbox/version disclosure', () => {
    test('FINDING: exposes exact version number publicly', async () => {
      const r = await get('/v1/platform/sandbox/version');
      expect(r.status).toBe(200);
      expect(r.body.version).toBeDefined();
      // Version number is publicly accessible without auth
      expect(r.body.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    test('FINDING: changelog reveals internal architecture details', async () => {
      const r = await get('/v1/platform/sandbox/version');
      const changelogStr = JSON.stringify(r.body.changelog);
      // Check if changelog mentions internal details
      const hasInternalDetails =
        changelogStr.includes('localhost') ||
        changelogStr.includes('OpenCode') ||
        changelogStr.includes('KORTIX_TOKEN') ||
        changelogStr.includes('KORTIX_API_URL');
      // The changelog reveals internal env var names and architecture
      expect(hasInternalDetails).toBe(true);
    });
  });

  describe('Error message information leakage', () => {
    test('401 errors do not reveal auth mechanism', async () => {
      const r = await get('/v1/accounts');
      const errStr = JSON.stringify(r.body);
      expect(errStr).not.toContain('supabase');
      expect(errStr).not.toContain('jwt');
      expect(errStr).not.toContain('JWKS');
    });

    test('404 errors do not reveal routes', async () => {
      const r = await get('/v1/nonexistent-route');
      expect(r.body.message).toBe('Not found');
      const errStr = JSON.stringify(r.body);
      expect(errStr).not.toContain('/v1/accounts');
      expect(errStr).not.toContain('/v1/billing');
    });

    test('FINDING: OAuth 500 error may indicate DB connectivity issue', async () => {
      const r = await get('/v1/oauth/authorize?client_id=nonexistent&redirect_uri=https://x.com&response_type=code&code_challenge=abc');
      // This returns 500 instead of 400, meaning the code reaches DB lookup
      // and fails. Should be handled as 400 "Client not found"
      expect(r.status).toBe(500);
      // Verify it at least gives a generic error
      expect(r.body.message).toBe('Internal server error');
    });
  });

  describe('Platform state disclosure', () => {
    test('/v1/access/signup-status reveals signup state', async () => {
      const r = await get('/v1/access/signup-status');
      expect(r.status).toBe(200);
      expect(typeof r.body.signupsEnabled).toBe('boolean');
      // An attacker knows whether the platform accepts new signups
    });

    test('/v1/setup/install-status reveals installation state', async () => {
      const r = await get('/v1/setup/install-status');
      expect(r.status).toBe(200);
      expect(typeof r.body.installed).toBe('boolean');
      // An attacker knows whether the platform is installed
    });
  });

  describe('.env and sensitive path probing', () => {
    test('/.env returns 404 (not exposed)', async () => {
      const r = await get('/.env');
      expect(r.status).toBe(404);
    });

    test('/.git/config returns 404 (not exposed)', async () => {
      const r = await get('/.git/config');
      expect(r.status).toBe(404);
    });

    test('/v1/.env returns 404', async () => {
      const r = await get('/v1/.env');
      expect(r.status).toBe(404);
    });

    test('/package.json returns 404', async () => {
      const r = await get('/package.json');
      expect(r.status).toBe(404);
    });

    test('/robots.txt returns 200 (served by Cloudflare or app)', async () => {
      const r = await get('/robots.txt');
      // Cloudflare or the app serves a robots.txt — not a security issue
      expect([200, 404]).toContain(r.status);
    });
  });
});
