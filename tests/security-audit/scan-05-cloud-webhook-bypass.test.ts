/**
 * Security Scan: Cloud API - Webhook Signature Bypass
 *
 * LIVE scan against https://computer-preview-api.kortix.com
 * Tests whether webhook endpoints can be triggered without valid signatures.
 *
 * FINDINGS:
 * [PASS] Stripe webhook rejects missing signature with 400
 * [VULN-INFO] Stripe webhook error message leaks implementation detail:
 *   "No signatures found matching the expected signature for payload"
 *   + link to stripe-node GitHub repo. This reveals the tech stack.
 * [PASS] RevenueCat webhook rejects missing/fake secret with 401
 * [PASS] Webhooks are POST-only
 */

import { describe, test, expect } from 'bun:test';

const CLOUD = 'https://computer-preview-api.kortix.com';

async function probeWebhook(
  path: string,
  body: any,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extraHeaders };
  try {
    const res = await fetch(`${CLOUD}${path}`, {
      method: 'POST',
      headers,
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

describe('Cloud Scan: Webhook Signature Bypass', () => {

  describe('Stripe webhook (/v1/billing/webhooks/stripe)', () => {
    const STRIPE_PATH = '/v1/billing/webhooks/stripe';
    const fakeEvent = { type: 'checkout.session.completed', data: { object: { id: 'cs_test' } } };

    test('rejects request with no stripe-signature header', async () => {
      const r = await probeWebhook(STRIPE_PATH, fakeEvent);
      expect(r.status).toBe(400);
    });

    test('rejects request with fake stripe-signature', async () => {
      const r = await probeWebhook(STRIPE_PATH, fakeEvent, {
        'stripe-signature': 't=1234567890,v1=0000000000000000000000000000000000000000000000000000000000000000',
      });
      expect(r.status).toBe(400);
    });

    test('rejects request with malformed stripe-signature', async () => {
      const r = await probeWebhook(STRIPE_PATH, fakeEvent, {
        'stripe-signature': 'garbage',
      });
      expect(r.status).toBe(400);
    });

    test('FINDING: error message reveals Stripe SDK usage', async () => {
      const r = await probeWebhook(STRIPE_PATH, fakeEvent, {
        'stripe-signature': 't=1234567890,v1=fakesig',
      });
      expect(r.status).toBe(400);
      // The error message contains Stripe SDK details and a GitHub link
      const errStr = JSON.stringify(r.body);
      const leaksInfo = errStr.includes('stripe-node') || errStr.includes('stripe');
      // Documenting this as an informational finding
      expect(leaksInfo).toBe(true);
    });

    test('GET method on Stripe webhook returns 404', async () => {
      const res = await fetch(`${CLOUD}${STRIPE_PATH}`);
      expect(res.status).toBe(404);
    });
  });

  describe('RevenueCat webhook (/v1/billing/webhooks/revenuecat)', () => {
    const RC_PATH = '/v1/billing/webhooks/revenuecat';
    const fakeEvent = { event: { type: 'INITIAL_PURCHASE' } };

    test('rejects request with no authorization', async () => {
      const r = await probeWebhook(RC_PATH, fakeEvent);
      expect(r.status).toBe(401);
    });

    test('rejects request with fake Bearer secret', async () => {
      const r = await probeWebhook(RC_PATH, fakeEvent, {
        'Authorization': 'Bearer fake-revenuecat-secret',
      });
      expect(r.status).toBe(401);
    });

    test('rejects request with random string secret', async () => {
      const r = await probeWebhook(RC_PATH, fakeEvent, {
        'Authorization': 'random-string',
      });
      expect(r.status).toBe(401);
    });

    test('error message is generic "Unauthorized"', async () => {
      const r = await probeWebhook(RC_PATH, fakeEvent);
      expect(r.body.error).toBe('Unauthorized');
      // Should not reveal what the expected secret looks like
      const errStr = JSON.stringify(r.body);
      expect(errStr).not.toContain('expected');
      expect(errStr).not.toContain('secret');
      expect(errStr).not.toContain('REVENUECAT');
    });
  });

  describe('Webhook replay attacks', () => {
    test('Stripe: old timestamp in signature is rejected', async () => {
      // Timestamp from 2020 - well outside the 300s tolerance
      const r = await probeWebhook('/v1/billing/webhooks/stripe', { type: 'test' }, {
        'stripe-signature': 't=1577836800,v1=fakesig',
      });
      expect(r.status).toBe(400);
    });
  });
});
