'use client';

/**
 * Global catch-all that intercepts clicks on ANY <a> tag whose href points to
 * localhost:PORT (or 127.0.0.1:PORT) and opens it in the preview tab instead
 * of navigating the browser to an unreachable address.
 *
 * Also intercepts clicks on already-proxied URLs (e.g. links whose href was
 * rewritten by the markdown renderer to go through the backend preview proxy)
 * so that they open as preview tabs instead of navigating the top-level page.
 *
 * Mount once at the app root — it uses a single delegated listener on
 * `document` so every link in the tree is covered automatically, including
 * links rendered by tool views, JSON viewers, markdown, etc.
 */

import { useEffect } from 'react';
import { useServerStore, getActiveOpenCodeUrl } from '@/stores/server-store';
import {
  isProxiableLocalhostUrl,
  parseLocalhostUrl,
  proxyUrlToInternal,
  rewriteLocalhostUrl,
  toInternalUrl,
} from '@/lib/utils/sandbox-url';
import { openTabAndNavigate } from '@/stores/tab-store';

/**
 * Try to extract port + path from an already-proxied URL.
 * Matches patterns like:
 *   - http://localhost:8008/v1/preview/{id}/8000/proxy/{port}{path}
 *   - http://localhost:8008/v1/preview/{id}/{port}{path}
 *   - http://host/proxy/{port}{path}
 *
 * Returns { port, path } or null if not a proxied URL.
 */
function extractFromProxiedUrl(href: string): { port: number; path: string } | null {
  try {
    const url = new URL(href);
    const pathname = url.pathname;

    // Pattern 1: .../proxy/{port}{path} — Kortix Master proxy
    const proxyMatch = pathname.match(/\/proxy\/(\d+)(\/.*)?$/);
    if (proxyMatch) {
      return {
        port: parseInt(proxyMatch[1], 10),
        path: (proxyMatch[2] || '/') + url.search + url.hash,
      };
    }

    // Pattern 2: /v1/preview/{id}/{port}{path} — direct port access
    const previewMatch = pathname.match(/\/(?:v1\/)?preview\/[^/]+\/(\d+)(\/.*)?$/);
    if (previewMatch) {
      const port = parseInt(previewMatch[1], 10);
      // Don't treat port 8000 (Kortix Master) as a user-facing service
      if (port === 8000) return null;
      return {
        port,
        path: (previewMatch[2] || '/') + url.search + url.hash,
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function LocalhostLinkInterceptor() {
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      // Only intercept plain left-clicks (no modifier keys)
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      // Walk up from the click target to find the nearest <a>
      const anchor = (e.target as HTMLElement)?.closest?.('a');
      if (!anchor) return;

      const href = anchor.href; // resolved absolute URL
      if (!href) return;

      // Never intercept links pointing at the app itself (same origin)
      try {
        if (new URL(href).origin === window.location.origin) return;
      } catch { /* not a valid URL, skip */ }

      // Resolve the proxy URL using the active server
      const state = useServerStore.getState();
      const activeServer =
        state.servers.find((s) => s.id === state.activeServerId) ?? null;
      const serverUrl = activeServer?.url || getActiveOpenCodeUrl();

      // ── Case 1: Fresh localhost:PORT URL (not yet proxied) ──
      if (isProxiableLocalhostUrl(href)) {
        const parsed = parseLocalhostUrl(href);
        if (!parsed) return;

        const { port, path } = parsed;
        const proxyUrl = rewriteLocalhostUrl(port, path, serverUrl);
        const internalUrl = toInternalUrl(port, path);

        e.preventDefault();
        e.stopPropagation();

        openTabAndNavigate({
          id: `preview:${port}`,
          title: `localhost:${port}`,
          type: 'preview',
          href: `/preview/${port}`,
          metadata: { url: proxyUrl, port, originalUrl: internalUrl, path },
        });
        return;
      }

      // ── Case 2: Already-proxied URL (e.g. markdown renderer rewrote href) ──
      // The href is something like http://localhost:8008/v1/preview/.../proxy/3210/
      // which would navigate the browser away from the app. Instead, open as tab.
      const extracted = extractFromProxiedUrl(href);
      if (extracted) {
        const { port, path } = extracted;
        const proxyUrl = rewriteLocalhostUrl(port, path, serverUrl);
        const internalUrl = toInternalUrl(port, path);

        e.preventDefault();
        e.stopPropagation();

        openTabAndNavigate({
          id: `preview:${port}`,
          title: `localhost:${port}`,
          type: 'preview',
          href: `/preview/${port}`,
          metadata: { url: proxyUrl, port, originalUrl: internalUrl, path },
        });
        return;
      }
    }

    document.addEventListener('click', handleClick, { capture: true });
    return () => document.removeEventListener('click', handleClick, { capture: true });
  }, []);

  return null;
}
