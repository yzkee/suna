import { rewriteLocalhostUrl, type SubdomainUrlOptions } from '@/lib/utils/sandbox-url';
import { SANDBOX_PORTS } from '@/lib/platform-client';

/**
 * Build a proxied URL for a file served by the static web server (port 3211).
 *
 * The static-web server (port 3211) serves workspace files via:
 *   http://localhost:3211/open?path=/workspace/{filePath}
 *
 * When subdomainOpts are provided (local/subdomain mode), this rewrites to:
 *   http://p3211-{sandboxId}.localhost:{backendPort}/open?path=/workspace/{filePath}
 *
 * This is the same pattern used for Desktop (port 6080) and Browser Viewer (port 9224).
 */
export function constructHtmlPreviewUrl(
  baseUrl: string | undefined,
  filePath: string | undefined,
  subdomainOpts?: SubdomainUrlOptions,
): string | undefined {
  if (!filePath) return undefined;

  // Normalize the file path: strip leading /workspace/ prefix if present
  const processedPath = filePath.replace(/^\/workspace\//, '');

  // Split the path into segments and encode each segment individually
  const pathSegments = processedPath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment));

  const encodedPath = pathSegments.join('/');

  // When subdomainOpts are provided, route through the static file server (port 3211)
  // via the subdomain proxy — same pattern as Desktop/VNC.
  if (subdomainOpts) {
    const port = parseInt(SANDBOX_PORTS.STATIC_FILE_SERVER ?? '3211', 10);
    const staticPath = `/open?path=/workspace/${encodedPath}`;
    return rewriteLocalhostUrl(port, staticPath, '', subdomainOpts);
  }

  // Legacy fallback: use the raw sandbox_url (Kortix Master at port 8000).
  // Browser cannot reach this directly — only works when served in the same origin
  // context or when blob URLs are used.
  if (!baseUrl) return undefined;
  return `${baseUrl}/${encodedPath}`;
}
