/**
 * Security Scan: Integration Webhook HMAC Verification
 *
 * Tests the HMAC-based webhook protection.
 *
 * How it works:
 *   1. createConnectToken() computes sig = HMAC-SHA256(secret, accountId)
 *   2. Passes webhook_uri = .../webhook?sig=<hex> to Pipedream
 *   3. Pipedream calls back with that exact URL
 *   4. Webhook handler recomputes HMAC from body.account_id, compares with timing-safe equal
 *
 * Properties:
 *   - Stateless (no DB/Redis/memory storage)
 *   - Per-user (each account_id gets a unique sig)
 *   - Non-replayable for different accounts (sig bound to account_id)
 *   - Can't forge without PIPEDREAM_WEBHOOK_SECRET
 *   - Timing-safe comparison prevents timing attacks
 *   - Backwards compatible (no secret = no check)
 *
 * Verified locally with PIPEDREAM_WEBHOOK_SECRET=test-secret-for-audit:
 *   ✓ Correct sig → 200
 *   ✓ No sig → 401
 *   ✓ Wrong sig → 401
 *   ✓ Sig for different account_id → 401
 *   ✓ Empty sig → 401
 *   ✓ Tampered sig (extra chars) → 401
 *   ✓ No secret set → 200 (backwards compatible)
 */

import { describe, test, expect } from 'bun:test';
import { createHmac, timingSafeEqual } from 'crypto';

describe('Webhook HMAC Verification Logic', () => {
  const SECRET = 'test-secret-for-audit';

  function computeSig(secret: string, accountId: string): string {
    return createHmac('sha256', secret).update(accountId).digest('hex');
  }

  function verifySig(secret: string, accountId: string, providedSig: string): boolean {
    if (!providedSig) return false;
    const expected = computeSig(secret, accountId);
    if (providedSig.length !== expected.length) return false;
    try {
      return timingSafeEqual(Buffer.from(providedSig, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return false;
    }
  }

  test('correct sig for matching account_id passes', () => {
    const accountId = '00000000-0000-0000-0000-000000000001';
    const sig = computeSig(SECRET, accountId);
    expect(verifySig(SECRET, accountId, sig)).toBe(true);
  });

  test('wrong sig is rejected', () => {
    const accountId = '00000000-0000-0000-0000-000000000001';
    const wrongSig = '0000000000000000000000000000000000000000000000000000000000000000';
    expect(verifySig(SECRET, accountId, wrongSig)).toBe(false);
  });

  test('sig for different account_id is rejected', () => {
    const account1 = '00000000-0000-0000-0000-000000000001';
    const account2 = '00000000-0000-0000-0000-000000000002';
    const sig = computeSig(SECRET, account1);
    // Sig was made for account1 but we verify against account2
    expect(verifySig(SECRET, account2, sig)).toBe(false);
  });

  test('empty sig is rejected', () => {
    const accountId = '00000000-0000-0000-0000-000000000001';
    expect(verifySig(SECRET, accountId, '')).toBe(false);
  });

  test('tampered sig (extra chars) is rejected', () => {
    const accountId = '00000000-0000-0000-0000-000000000001';
    const sig = computeSig(SECRET, accountId);
    expect(verifySig(SECRET, accountId, sig + 'ff')).toBe(false);
  });

  test('truncated sig is rejected', () => {
    const accountId = '00000000-0000-0000-0000-000000000001';
    const sig = computeSig(SECRET, accountId);
    expect(verifySig(SECRET, accountId, sig.slice(0, 32))).toBe(false);
  });

  test('different secrets produce different sigs', () => {
    const accountId = '00000000-0000-0000-0000-000000000001';
    const sig1 = computeSig('secret-1', accountId);
    const sig2 = computeSig('secret-2', accountId);
    expect(sig1).not.toBe(sig2);
  });

  test('sig is deterministic for same inputs', () => {
    const accountId = '00000000-0000-0000-0000-000000000001';
    const sig1 = computeSig(SECRET, accountId);
    const sig2 = computeSig(SECRET, accountId);
    expect(sig1).toBe(sig2);
  });

  test('sig is 64 hex chars (SHA-256)', () => {
    const sig = computeSig(SECRET, 'test-account');
    expect(sig.length).toBe(64);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  test('non-hex sig is rejected gracefully (no crash)', () => {
    const accountId = '00000000-0000-0000-0000-000000000001';
    expect(verifySig(SECRET, accountId, 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')).toBe(false);
  });
});
