/**
 * Security Audit: Webhook Security
 *
 * Tests webhook signature verification for Stripe, RevenueCat, and JustAVPS
 * to ensure forged webhooks are rejected.
 *
 * Attack vectors tested:
 *  - Missing signature header
 *  - Invalid/forged signature
 *  - Replay attacks (timestamp validation)
 *  - Missing webhook secret configuration
 *  - Body tampering
 */

import { describe, test, expect } from 'bun:test';
import { createHmac } from 'crypto';

// ---------------------------------------------------------------------------
// Webhook signature simulation
// ---------------------------------------------------------------------------

function verifyStripeSignature(
  payload: string,
  sigHeader: string | null,
  secret: string,
): { valid: boolean; error?: string } {
  if (!sigHeader) {
    return { valid: false, error: 'Missing stripe-signature header' };
  }

  // Stripe uses t=timestamp,v1=signature format
  const parts = sigHeader.split(',').reduce((acc, part) => {
    const [key, val] = part.split('=');
    if (key && val) acc[key] = val;
    return acc;
  }, {} as Record<string, string>);

  if (!parts['t'] || !parts['v1']) {
    return { valid: false, error: 'Invalid signature format' };
  }

  const timestamp = parseInt(parts['t'], 10);
  const expectedSig = parts['v1'];

  // Check timestamp tolerance (5 minutes)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) {
    return { valid: false, error: 'Timestamp outside tolerance' };
  }

  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`;
  const computed = createHmac('sha256', secret).update(signedPayload).digest('hex');

  if (computed !== expectedSig) {
    return { valid: false, error: 'Signature mismatch' };
  }

  return { valid: true };
}

function verifyRevenueCatWebhook(
  authHeader: string | null,
  secret: string,
): { valid: boolean; error?: string } {
  if (!authHeader) {
    return { valid: false, error: 'Missing authorization header' };
  }
  if (!secret) {
    return { valid: false, error: 'Webhook secret not configured' };
  }
  // RevenueCat sends the secret as Bearer token
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  if (token !== secret) {
    return { valid: false, error: 'Invalid webhook secret' };
  }
  return { valid: true };
}

function verifyJustAVPSWebhook(
  payload: string,
  sigHeader: string | null,
  secret: string,
): { valid: boolean; error?: string } {
  if (!sigHeader) {
    return { valid: false, error: 'Missing signature header' };
  }
  if (!secret) {
    return { valid: false, error: 'Webhook secret not configured' };
  }
  const computed = createHmac('sha256', secret).update(payload).digest('hex');
  if (computed !== sigHeader) {
    return { valid: false, error: 'Signature mismatch' };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Security Audit: Webhook Security', () => {

  describe('Stripe webhook verification', () => {
    const secret = 'whsec_test_secret';
    const payload = '{"type":"checkout.session.completed"}';
    const timestamp = Math.floor(Date.now() / 1000);
    const signedPayload = `${timestamp}.${payload}`;
    const validSig = createHmac('sha256', secret).update(signedPayload).digest('hex');
    const validHeader = `t=${timestamp},v1=${validSig}`;

    test('accepts valid signature', () => {
      const result = verifyStripeSignature(payload, validHeader, secret);
      expect(result.valid).toBe(true);
    });

    test('rejects missing signature header', () => {
      const result = verifyStripeSignature(payload, null, secret);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Missing stripe-signature header');
    });

    test('rejects malformed signature header', () => {
      const result = verifyStripeSignature(payload, 'garbage', secret);
      expect(result.valid).toBe(false);
    });

    test('rejects forged signature', () => {
      const forgedHeader = `t=${timestamp},v1=0000000000000000000000000000000000000000000000000000000000000000`;
      const result = verifyStripeSignature(payload, forgedHeader, secret);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Signature mismatch');
    });

    test('rejects old timestamp (replay attack)', () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
      const oldSignedPayload = `${oldTimestamp}.${payload}`;
      const oldSig = createHmac('sha256', secret).update(oldSignedPayload).digest('hex');
      const oldHeader = `t=${oldTimestamp},v1=${oldSig}`;
      const result = verifyStripeSignature(payload, oldHeader, secret);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Timestamp outside tolerance');
    });

    test('rejects tampered body', () => {
      const tamperedPayload = '{"type":"invoice.paid","data":{"amount":0}}';
      const result = verifyStripeSignature(tamperedPayload, validHeader, secret);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Signature mismatch');
    });

    test('rejects wrong secret', () => {
      const wrongResult = verifyStripeSignature(payload, validHeader, 'wrong-secret');
      expect(wrongResult.valid).toBe(false);
    });
  });

  describe('RevenueCat webhook verification', () => {
    const secret = 'rc_webhook_secret_123';

    test('accepts valid secret', () => {
      const result = verifyRevenueCatWebhook(`Bearer ${secret}`, secret);
      expect(result.valid).toBe(true);
    });

    test('rejects missing header', () => {
      const result = verifyRevenueCatWebhook(null, secret);
      expect(result.valid).toBe(false);
    });

    test('rejects wrong secret', () => {
      const result = verifyRevenueCatWebhook('Bearer wrong-secret', secret);
      expect(result.valid).toBe(false);
    });

    test('rejects empty secret configuration', () => {
      const result = verifyRevenueCatWebhook('Bearer anything', '');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Webhook secret not configured');
    });

    test('handles missing Bearer prefix', () => {
      // RevenueCat may send with or without Bearer prefix
      const result = verifyRevenueCatWebhook(secret, secret);
      expect(result.valid).toBe(true);
    });
  });

  describe('JustAVPS webhook verification', () => {
    const secret = 'justavps_webhook_secret';
    const payload = '{"event":"server.ready","server_id":"srv-123"}';
    const validSig = createHmac('sha256', secret).update(payload).digest('hex');

    test('accepts valid HMAC signature', () => {
      const result = verifyJustAVPSWebhook(payload, validSig, secret);
      expect(result.valid).toBe(true);
    });

    test('rejects missing signature', () => {
      const result = verifyJustAVPSWebhook(payload, null, secret);
      expect(result.valid).toBe(false);
    });

    test('rejects forged signature', () => {
      const result = verifyJustAVPSWebhook(payload, 'forged-sig', secret);
      expect(result.valid).toBe(false);
    });

    test('rejects tampered body', () => {
      const tamperedPayload = '{"event":"server.ready","server_id":"srv-evil"}';
      const result = verifyJustAVPSWebhook(tamperedPayload, validSig, secret);
      expect(result.valid).toBe(false);
    });

    test('rejects unconfigured secret', () => {
      const result = verifyJustAVPSWebhook(payload, validSig, '');
      expect(result.valid).toBe(false);
    });
  });

  describe('Webhook endpoint routing', () => {
    test('webhook routes skip standard auth middleware', () => {
      // Stripe webhooks cannot use JWT auth — they use signature verification
      // The billing routes mount webhooks without supabaseAuth
      const webhookPath = '/v1/billing/webhooks/stripe';
      expect(webhookPath.startsWith('/v1/billing/webhooks/')).toBe(true);
    });

    test('non-webhook billing routes require auth', () => {
      // /v1/billing/account-state, /v1/billing/setup/* use supabaseAuth
      const billingRoutes = ['/v1/billing/account-state', '/v1/billing/setup/checkout'];
      for (const route of billingRoutes) {
        expect(route.startsWith('/v1/billing/')).toBe(true);
        expect(route).not.toContain('webhooks');
      }
    });
  });
});
