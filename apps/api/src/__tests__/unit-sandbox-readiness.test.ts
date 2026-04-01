import { afterEach, describe, expect, mock, test } from 'bun:test';
import { probeJustAvpsSandboxReadiness } from '../platform/services/sandbox-readiness';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('probeJustAvpsSandboxReadiness', () => {
  test('returns not ready when slug is missing', async () => {
    const result = await probeJustAvpsSandboxReadiness({});
    expect(result.ready).toBe(false);
    expect(result.message).toContain('slug missing');
  });

  test('treats 200 as ready', async () => {
    globalThis.fetch = mock(async () => new Response('{}', { status: 200 })) as typeof fetch;
    const result = await probeJustAvpsSandboxReadiness({ slug: 'abc', proxyToken: 'pt_test', serviceKey: 'sk_test' });
    expect(result.ready).toBe(true);
    expect(result.httpStatus).toBe(200);
  });

  test('treats 503 as still starting', async () => {
    globalThis.fetch = mock(async () => new Response('{}', { status: 503 })) as typeof fetch;
    const result = await probeJustAvpsSandboxReadiness({ slug: 'abc' });
    expect(result.ready).toBe(false);
    expect(result.httpStatus).toBe(503);
  });
});
