import { describe, expect, test } from 'bun:test';

import {
  createSandboxProxyContext,
  getSandboxServiceUrl,
  proxySandboxUrl,
  rewriteSandboxPath,
} from './sandbox-proxy';
import { isAppRouteUrl } from './sandbox-url';

describe('sandbox proxy utilities', () => {
  test('falls back to kortix-sandbox when local server is not hydrated yet', () => {
    const context = createSandboxProxyContext({
      activeServer: null,
      fallbackServerUrl: 'http://localhost:8008',
    });

    expect(context.subdomainOpts).toEqual({
      sandboxId: 'kortix-sandbox',
      backendPort: 8008,
    });
  });

  test('rewrites localhost sandbox services through the subdomain proxy', () => {
    const context = createSandboxProxyContext({
      activeServer: null,
      fallbackServerUrl: 'http://localhost:8008',
    });

    expect(proxySandboxUrl('http://localhost:3210/', context)).toBe(
      'http://p3210-kortix-sandbox.localhost:8008/',
    );
  });

  test('rewrites explicit port/path pairs with the same shared logic', () => {
    const context = createSandboxProxyContext({
      activeServer: null,
      fallbackServerUrl: 'http://localhost:8008',
    });

    expect(rewriteSandboxPath(3211, '/open?path=/workspace/demo/index.html', context)).toBe(
      'http://p3211-kortix-sandbox.localhost:8008/open?path=/workspace/demo/index.html',
    );
  });

  test('treats internal browser routes as app URLs instead of sandbox services', () => {
    expect(isAppRouteUrl('http://localhost:3000/p/browser')).toBe(true);
  });

  test('builds service base URLs from the same shared proxy context', () => {
    const activeServer = {
      id: 'default',
      label: 'Local Sandbox',
      url: 'http://localhost:8008',
      provider: 'local_docker' as const,
    };

    const context = createSandboxProxyContext({
      activeServer,
      fallbackServerUrl: 'http://localhost:8008',
    });

    expect(getSandboxServiceUrl(3210, { ...context, activeServer })).toBe(
      'http://p3210-kortix-sandbox.localhost:8008/',
    );
  });
});
