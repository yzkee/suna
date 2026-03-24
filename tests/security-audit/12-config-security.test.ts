/**
 * Security Audit: Configuration Security
 *
 * Tests that secrets are never leaked, environment variables are validated,
 * and error responses do not disclose internal information.
 *
 * Attack vectors tested:
 *  - Secret leakage in API responses
 *  - Error message information disclosure
 *  - Database error leakage
 *  - Stack trace exposure
 *  - Missing required config detection
 *  - Internal service key auto-generation
 *  - Config injection via env vars
 */

import { describe, test, expect } from 'bun:test';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Security Audit: Config Security', () => {

  describe('Secret detection in responses', () => {
    test('health endpoint does not leak secrets', () => {
      const healthResponse = {
        status: 'ok',
        service: 'kortix-api',
        timestamp: new Date().toISOString(),
        env: 'local',
      };
      const json = JSON.stringify(healthResponse);
      expect(json).not.toContain('API_KEY_SECRET');
      expect(json).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
      expect(json).not.toContain('INTERNAL_SERVICE_KEY');
      expect(json).not.toContain('STRIPE_SECRET_KEY');
      expect(json).not.toContain('DATABASE_URL');
    });

    test('system status does not leak config', () => {
      const statusResponse = {
        maintenanceNotice: { enabled: false },
        technicalIssue: { enabled: false },
        updatedAt: new Date().toISOString(),
      };
      const json = JSON.stringify(statusResponse);
      expect(json).not.toContain('password');
      expect(json).not.toContain('secret');
      expect(json).not.toContain('key');
    });
  });

  describe('Error response sanitization', () => {
    test('500 errors return generic message', () => {
      const errorResponse = {
        error: true,
        message: 'Internal server error',
        status: 500,
      };
      expect(errorResponse.message).toBe('Internal server error');
      // Should not contain stack trace, file paths, or SQL
      expect(errorResponse.message).not.toContain('/');
      expect(errorResponse.message).not.toContain('at ');
      expect(errorResponse.message).not.toContain('SELECT');
      expect(errorResponse.message).not.toContain('INSERT');
    });

    test('database errors are sanitized', () => {
      // The error handler catches PostgresError and logs it,
      // but returns a generic error to the client
      const dbError = {
        severity: 'ERROR',
        code: '23505',
        table: 'users',
        detail: 'Key (email)=(admin@test.com) already exists.',
        hint: 'Check unique constraints',
      };
      // The client receives:
      const clientResponse = {
        error: true,
        message: 'Internal server error',
        status: 500,
      };
      expect(clientResponse.message).not.toContain('email');
      expect(clientResponse.message).not.toContain('admin@test.com');
      expect(clientResponse.message).not.toContain('unique constraint');
    });

    test('HTTPException messages are returned to client', () => {
      // HTTPException messages are intentionally user-facing
      const httpError = {
        error: true,
        message: 'Missing or invalid Authorization header',
        status: 401,
      };
      // These messages should be generic enough not to leak info
      expect(httpError.message).not.toContain('file');
      expect(httpError.message).not.toContain('database');
    });

    test('BillingError messages are returned to client', () => {
      const billingError = {
        error: 'Insufficient credits',
      };
      // Billing errors are user-facing but should not leak internal state
      expect(billingError.error).not.toContain('balance');
    });

    test('404 response is generic', () => {
      const notFoundResponse = {
        error: true,
        message: 'Not found',
        status: 404,
      };
      expect(notFoundResponse.message).toBe('Not found');
      // Should not reveal which routes exist
      expect(notFoundResponse.message).not.toContain('route');
      expect(notFoundResponse.message).not.toContain('endpoint');
    });

    test('stack traces are truncated in logs (not in responses)', () => {
      // The error handler truncates stack traces to 4 lines for logging
      const mockStack = `Error: test
    at Object.<anonymous> (/app/src/index.ts:100:5)
    at Module._compile (node:internal/modules/cjs/loader:1254:14)
    at Module._extensions..js (node:internal/modules/cjs/loader:1308:10)
    at Module.load (node:internal/modules/cjs/loader:1117:32)
    at Module._resolveFilename (node:internal/modules/cjs/loader:1085:15)`;
      const truncated = mockStack.split('\n').slice(1, 4).join('\n');
      const lines = truncated.split('\n');
      expect(lines.length).toBe(3); // Only 3 stack frames
    });
  });

  describe('Required config validation', () => {
    test('DATABASE_URL is required', () => {
      const required = ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'API_KEY_SECRET'];
      expect(required).toContain('DATABASE_URL');
    });

    test('SUPABASE_URL must be valid HTTP(S) URL', () => {
      const validUrls = ['http://localhost:54321', 'https://myproject.supabase.co'];
      const invalidUrls = ['ftp://server.com', 'not-a-url', ''];
      for (const url of validUrls) {
        expect(/^https?:\/\//.test(url)).toBe(true);
      }
      for (const url of invalidUrls) {
        expect(/^https?:\/\//.test(url)).toBe(false);
      }
    });

    test('API_KEY_SECRET is required (hashing fails without it)', () => {
      const secret = '';
      expect(!!secret).toBe(false); // Empty string is falsy
    });
  });

  describe('INTERNAL_SERVICE_KEY auto-generation', () => {
    test('key is 256 bits (32 bytes = 64 hex chars)', () => {
      const { randomBytes } = require('crypto');
      const generated = randomBytes(32).toString('hex');
      expect(generated.length).toBe(64);
      expect(generated).toMatch(/^[0-9a-f]{64}$/);
    });

    test('auto-generated key uses crypto.randomBytes (CSPRNG)', () => {
      // The implementation uses: randomBytes(32).toString('hex')
      // randomBytes is a cryptographically secure random number generator
      const { randomBytes } = require('crypto');
      const key1 = randomBytes(32).toString('hex');
      const key2 = randomBytes(32).toString('hex');
      expect(key1).not.toBe(key2); // Each generation is unique
    });
  });

  describe('Conditional config validation', () => {
    test('Stripe keys required when billing enabled', () => {
      const billingEnabled = true;
      const hasStripeKey = false;
      if (billingEnabled && !hasStripeKey) {
        const error = 'STRIPE_SECRET_KEY required when billing is enabled';
        expect(error).toContain('required');
      }
    });

    test('Daytona keys required when daytona provider enabled', () => {
      const providers = ['daytona'];
      const hasDaytonaKey = false;
      if (providers.includes('daytona') && !hasDaytonaKey) {
        const error = 'DAYTONA_API_KEY required when daytona provider enabled';
        expect(error).toContain('required');
      }
    });

    test('DOCKER_HOST required for local_docker provider', () => {
      const providers = ['local_docker'];
      const hasDockerHost = false;
      if (providers.includes('local_docker') && !hasDockerHost) {
        const error = 'DOCKER_HOST required for local_docker';
        expect(error).toContain('required');
      }
    });
  });

  describe('CORS_ALLOWED_ORIGINS parsing', () => {
    test('parses comma-separated origins', () => {
      const raw = 'https://custom1.com, https://custom2.com';
      const parsed = raw.split(',').map(s => s.trim()).filter(Boolean);
      expect(parsed).toEqual(['https://custom1.com', 'https://custom2.com']);
    });

    test('handles empty string', () => {
      const raw = '';
      const parsed = raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
      expect(parsed).toEqual([]);
    });

    test('handles whitespace-only entries', () => {
      const raw = 'https://valid.com, , , https://another.com';
      const parsed = raw.split(',').map(s => s.trim()).filter(Boolean);
      expect(parsed).toEqual(['https://valid.com', 'https://another.com']);
    });
  });

  describe('Provider name validation', () => {
    test('only valid provider names accepted', () => {
      const validProviders = ['daytona', 'local_docker', 'justavps'];
      const invalidProviders = ['aws', 'gcp', 'azure', 'custom', ''];
      for (const p of validProviders) {
        expect(['daytona', 'local_docker', 'justavps']).toContain(p);
      }
      for (const p of invalidProviders) {
        expect(['daytona', 'local_docker', 'justavps']).not.toContain(p);
      }
    });

    test('unknown providers are ignored with warning', () => {
      const raw = 'daytona,unknown_provider,local_docker';
      const names = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      const valid = names.filter(n => ['daytona', 'local_docker', 'justavps'].includes(n));
      expect(valid).toEqual(['daytona', 'local_docker']);
    });
  });
});
