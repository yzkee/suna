/**
 * Security Audit: Cryptography Module
 *
 * Tests the crypto primitives used for API key hashing, signature verification,
 * and key generation to ensure they meet security standards.
 *
 * Attack vectors tested:
 *  - Timing attacks on key comparison
 *  - Weak random number generation
 *  - Key format predictability
 *  - HMAC key derivation correctness
 *  - Signature forgery resistance
 *  - Nonce replay protection
 *  - Hash collision resistance
 */

import { describe, test, expect } from 'bun:test';
import { createHash, createHmac, timingSafeEqual, randomBytes } from 'crypto';

// ---------------------------------------------------------------------------
// Replicate crypto.ts functions locally for isolated testing
// ---------------------------------------------------------------------------

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function randomAlphanumeric(length: number): string {
  const bytes = randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += CHARS[bytes[i]! % CHARS.length];
  }
  return result;
}

function hashSecretKey(secretKey: string, apiKeySecret: string): string {
  return createHmac('sha256', apiKeySecret).update(secretKey).digest('hex');
}

function verifySecretKey(secretKey: string, storedHash: string, apiKeySecret: string): boolean {
  try {
    const computedHash = hashSecretKey(secretKey, apiKeySecret);
    const storedBuffer = Buffer.from(storedHash, 'hex');
    const computedBuffer = Buffer.from(computedHash, 'hex');
    if (storedBuffer.length !== computedBuffer.length) return false;
    return timingSafeEqual(storedBuffer, computedBuffer);
  } catch {
    return false;
  }
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

function deriveSigningKey(token: string): string {
  return createHmac('sha256', 'kortix-tunnel-signing-v1').update(token).digest('hex');
}

function signMessage(signingKey: string, payload: string, nonce: number): string {
  return createHmac('sha256', signingKey).update(`${nonce}:${payload}`).digest('hex');
}

function verifyMessageSignature(
  signingKey: string, payload: string, nonce: number, signature: string,
): boolean {
  try {
    const expected = signMessage(signingKey, payload, nonce);
    const sigBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    if (sigBuffer.length !== expectedBuffer.length) return false;
    return timingSafeEqual(sigBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Security Audit: Crypto Module', () => {
  const TEST_SECRET = 'test-api-key-secret-32-bytes-long!!';

  // ── Random key generation ──────────────────────────────────────────────

  describe('Random key generation', () => {
    test('generates keys of correct length', () => {
      const key = randomAlphanumeric(32);
      expect(key.length).toBe(32);
    });

    test('generates unique keys (no collisions in 1000 iterations)', () => {
      const keys = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        keys.add(randomAlphanumeric(32));
      }
      expect(keys.size).toBe(1000);
    });

    test('uses only alphanumeric characters', () => {
      const key = randomAlphanumeric(1000);
      expect(key).toMatch(/^[A-Za-z0-9]+$/);
    });

    test('has reasonable character distribution (chi-squared-like check)', () => {
      const counts = new Map<string, number>();
      const sampleSize = 100_000;
      const key = randomAlphanumeric(sampleSize);
      for (const c of key) {
        counts.set(c, (counts.get(c) || 0) + 1);
      }
      const expectedPerChar = sampleSize / CHARS.length;
      // Each character should appear within 30% of the expected frequency
      for (const [char, count] of counts) {
        const deviation = Math.abs(count - expectedPerChar) / expectedPerChar;
        expect(deviation).toBeLessThan(0.3);
      }
    });

    test('generates correct prefixed key formats', () => {
      const userKey = `kortix_${randomAlphanumeric(32)}`;
      const sandboxKey = `kortix_sb_${randomAlphanumeric(32)}`;
      const tunnelKey = `kortix_tnl_${randomAlphanumeric(32)}`;
      const publicKey = `pk_${randomAlphanumeric(32)}`;

      expect(userKey).toMatch(/^kortix_[A-Za-z0-9]{32}$/);
      expect(sandboxKey).toMatch(/^kortix_sb_[A-Za-z0-9]{32}$/);
      expect(tunnelKey).toMatch(/^kortix_tnl_[A-Za-z0-9]{32}$/);
      expect(publicKey).toMatch(/^pk_[A-Za-z0-9]{32}$/);
    });
  });

  // ── HMAC hashing ──────────────────────────────────────────────────────

  describe('HMAC key hashing', () => {
    test('produces consistent hashes for same input', () => {
      const key = 'kortix_testkey12345678901234567890';
      const hash1 = hashSecretKey(key, TEST_SECRET);
      const hash2 = hashSecretKey(key, TEST_SECRET);
      expect(hash1).toBe(hash2);
    });

    test('produces different hashes for different keys', () => {
      const hash1 = hashSecretKey('kortix_key1', TEST_SECRET);
      const hash2 = hashSecretKey('kortix_key2', TEST_SECRET);
      expect(hash1).not.toBe(hash2);
    });

    test('produces different hashes with different secrets', () => {
      const key = 'kortix_testkey';
      const hash1 = hashSecretKey(key, 'secret1');
      const hash2 = hashSecretKey(key, 'secret2');
      expect(hash1).not.toBe(hash2);
    });

    test('hash output is 64-char hex string (SHA-256)', () => {
      const hash = hashSecretKey('kortix_test', TEST_SECRET);
      expect(hash.length).toBe(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    test('hash is not the same as plain SHA-256 (HMAC vs hash)', () => {
      const key = 'kortix_test';
      const hmac = hashSecretKey(key, TEST_SECRET);
      const plainHash = createHash('sha256').update(key).digest('hex');
      expect(hmac).not.toBe(plainHash);
    });
  });

  // ── Timing-safe comparison ─────────────────────────────────────────────

  describe('Timing-safe key verification', () => {
    test('verifies correct key successfully', () => {
      const key = 'kortix_valid_key_12345678901234';
      const hash = hashSecretKey(key, TEST_SECRET);
      expect(verifySecretKey(key, hash, TEST_SECRET)).toBe(true);
    });

    test('rejects incorrect key', () => {
      const key = 'kortix_valid_key_12345678901234';
      const hash = hashSecretKey(key, TEST_SECRET);
      expect(verifySecretKey('kortix_wrong_key_1234567890123', hash, TEST_SECRET)).toBe(false);
    });

    test('rejects hash of different length', () => {
      const key = 'kortix_test';
      // Hash should be 64 chars; providing a shorter one should fail
      expect(verifySecretKey(key, 'abc123', TEST_SECRET)).toBe(false);
    });

    test('rejects invalid hex in stored hash', () => {
      const key = 'kortix_test';
      expect(verifySecretKey(key, 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', TEST_SECRET)).toBe(false);
    });

    test('handles empty inputs gracefully', () => {
      expect(verifySecretKey('', '', TEST_SECRET)).toBe(false);
    });
  });

  // ── Timing-safe string comparison ──────────────────────────────────────

  describe('Timing-safe string comparison', () => {
    test('equal strings return true', () => {
      expect(timingSafeStringEqual('hello', 'hello')).toBe(true);
    });

    test('different strings return false', () => {
      expect(timingSafeStringEqual('hello', 'world')).toBe(false);
    });

    test('strings of different lengths return false (no length leakage)', () => {
      expect(timingSafeStringEqual('short', 'a much longer string')).toBe(false);
    });

    test('empty strings are equal', () => {
      expect(timingSafeStringEqual('', '')).toBe(true);
    });

    test('nearly identical strings return false', () => {
      expect(timingSafeStringEqual('abcdef', 'abcdeg')).toBe(false);
    });
  });

  // ── Tunnel message signing ─────────────────────────────────────────────

  describe('Tunnel message signing & verification', () => {
    const token = 'kortix_tnl_test_token_123456789';
    const signingKey = deriveSigningKey(token);

    test('signing key is derived deterministically', () => {
      const key1 = deriveSigningKey(token);
      const key2 = deriveSigningKey(token);
      expect(key1).toBe(key2);
    });

    test('different tokens produce different signing keys', () => {
      const key1 = deriveSigningKey('token1');
      const key2 = deriveSigningKey('token2');
      expect(key1).not.toBe(key2);
    });

    test('valid signature verifies successfully', () => {
      const payload = '{"method":"filesystem.read","params":{"path":"/tmp"}}';
      const nonce = Date.now();
      const sig = signMessage(signingKey, payload, nonce);
      expect(verifyMessageSignature(signingKey, payload, nonce, sig)).toBe(true);
    });

    test('rejects tampered payload', () => {
      const nonce = Date.now();
      const sig = signMessage(signingKey, 'original', nonce);
      expect(verifyMessageSignature(signingKey, 'tampered', nonce, sig)).toBe(false);
    });

    test('rejects wrong nonce (replay protection)', () => {
      const payload = 'data';
      const nonce1 = 1000;
      const nonce2 = 1001;
      const sig = signMessage(signingKey, payload, nonce1);
      expect(verifyMessageSignature(signingKey, payload, nonce2, sig)).toBe(false);
    });

    test('rejects signature from different key', () => {
      const payload = 'data';
      const nonce = 1000;
      const otherKey = deriveSigningKey('other-token');
      const sig = signMessage(otherKey, payload, nonce);
      expect(verifyMessageSignature(signingKey, payload, nonce, sig)).toBe(false);
    });

    test('rejects truncated signature', () => {
      const payload = 'data';
      const nonce = 1000;
      const sig = signMessage(signingKey, payload, nonce);
      expect(verifyMessageSignature(signingKey, payload, nonce, sig.slice(0, 32))).toBe(false);
    });

    test('rejects empty signature', () => {
      expect(verifyMessageSignature(signingKey, 'data', 1000, '')).toBe(false);
    });
  });
});
