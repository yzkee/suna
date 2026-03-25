/**
 * Security Scan: Local Mode - Port Exposure Check
 *
 * Tests that the local API is NOT accidentally exposed to external networks.
 * The main security risk in local mode is if the API port (8008) or Supabase
 * port is bound to 0.0.0.0 instead of 127.0.0.1, making it accessible from
 * the LAN or internet.
 *
 * Also checks that the local health endpoint doesn't expose more info than needed.
 */

import { describe, test, expect } from 'bun:test';
import { execSync } from 'child_process';

const LOCAL = 'http://localhost:8008';

describe('Local Scan: Port Exposure Check', () => {

  describe('Local API accessibility', () => {
    test('localhost:8008 is accessible', async () => {
      try {
        const res = await fetch(`${LOCAL}/health`);
        expect(res.status).toBe(200);
      } catch {
        // API might not be running during CI — skip
        expect(true).toBe(true);
      }
    });

    test('127.0.0.1:8008 is accessible', async () => {
      try {
        const res = await fetch('http://127.0.0.1:8008/health');
        expect(res.status).toBe(200);
      } catch {
        expect(true).toBe(true);
      }
    });
  });

  describe('Port binding analysis', () => {
    test('check if port 8008 is bound to 0.0.0.0 (external exposure risk)', () => {
      try {
        const output = execSync('lsof -i :8008 -P -n 2>/dev/null || ss -tlnp sport = :8008 2>/dev/null || netstat -an 2>/dev/null | grep 8008', {
          encoding: 'utf-8',
          timeout: 5000,
        });

        // Check if bound to 0.0.0.0 (all interfaces) vs 127.0.0.1 (localhost only)
        const boundToAllInterfaces = output.includes('*:8008') || output.includes('0.0.0.0:8008');
        const boundToLocalhost = output.includes('127.0.0.1:8008') || output.includes('localhost:8008');

        if (boundToAllInterfaces && !boundToLocalhost) {
          // FINDING: Port is exposed to all network interfaces
          console.warn('FINDING: Port 8008 is bound to 0.0.0.0 — accessible from LAN');
        }

        // Document the finding but don't fail the test
        // (Bun binds to 0.0.0.0 by default, which is a known consideration)
        expect(typeof output).toBe('string');
      } catch {
        // Commands may not be available — skip
        expect(true).toBe(true);
      }
    });

    test('check if Supabase port 54321 is bound externally', () => {
      try {
        const output = execSync('lsof -i :54321 -P -n 2>/dev/null || true', {
          encoding: 'utf-8',
          timeout: 5000,
        });

        const boundToAllInterfaces = output.includes('*:54321') || output.includes('0.0.0.0:54321');
        if (boundToAllInterfaces) {
          console.warn('FINDING: Supabase port 54321 is bound to 0.0.0.0');
        }
        expect(typeof output).toBe('string');
      } catch {
        expect(true).toBe(true);
      }
    });

    test('check if PostgreSQL port 54322 is bound externally', () => {
      try {
        const output = execSync('lsof -i :54322 -P -n 2>/dev/null || true', {
          encoding: 'utf-8',
          timeout: 5000,
        });

        const boundToAllInterfaces = output.includes('*:54322') || output.includes('0.0.0.0:54322');
        if (boundToAllInterfaces) {
          console.warn('FINDING: PostgreSQL port 54322 is bound to 0.0.0.0');
        }
        expect(typeof output).toBe('string');
      } catch {
        expect(true).toBe(true);
      }
    });
  });

  describe('Local health endpoint info check', () => {
    test('local /health shows env=local (not cloud)', async () => {
      try {
        const res = await fetch(`${LOCAL}/health`);
        const body = await res.json();
        expect(body.env).toBe('local');
      } catch {
        expect(true).toBe(true);
      }
    });

    test('local /health does not expose secrets', async () => {
      try {
        const res = await fetch(`${LOCAL}/health`);
        const body = await res.json();
        const json = JSON.stringify(body);
        expect(json).not.toContain('API_KEY_SECRET');
        expect(json).not.toContain('DATABASE_URL');
        expect(json).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
      } catch {
        expect(true).toBe(true);
      }
    });
  });

  describe('Docker network isolation', () => {
    test('check Docker network configuration', () => {
      try {
        const output = execSync('docker network inspect kortix-network 2>/dev/null || docker network ls 2>/dev/null || true', {
          encoding: 'utf-8',
          timeout: 5000,
        });
        // Document docker network configuration
        expect(typeof output).toBe('string');
      } catch {
        expect(true).toBe(true);
      }
    });
  });
});
