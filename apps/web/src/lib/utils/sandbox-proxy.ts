import {
  getActiveOpenCodeUrl,
  type ServerEntry,
  deriveSubdomainOpts,
} from '@/stores/server-store';
import { getDirectPortUrl } from '@/lib/platform-client';
import { getProxyBaseUrl } from '@/lib/utils/sandbox-url';

import {
  proxyLocalhostUrl,
  rewriteLocalhostUrl,
  type SubdomainUrlOptions,
} from '@/lib/utils/sandbox-url';

export interface SandboxProxyContext {
  serverUrl: string;
  mappedPorts?: Record<string, string>;
  subdomainOpts?: SubdomainUrlOptions;
}

export function createSandboxProxyContext({
  activeServer,
  fallbackServerUrl = getActiveOpenCodeUrl(),
}: {
  activeServer: ServerEntry | null | undefined;
  fallbackServerUrl?: string;
}): SandboxProxyContext {
  return {
    serverUrl: activeServer?.url || fallbackServerUrl,
    mappedPorts: activeServer?.mappedPorts,
    subdomainOpts: deriveSubdomainOpts(activeServer),
  };
}

export function proxySandboxUrl(
  url: string | undefined,
  context: SandboxProxyContext,
): string | undefined {
  return proxyLocalhostUrl(
    url,
    context.serverUrl,
    context.mappedPorts,
    context.subdomainOpts,
  );
}

export function rewriteSandboxPath(
  port: number,
  path: string,
  context: SandboxProxyContext,
): string {
  return rewriteLocalhostUrl(port, path, context.serverUrl, context.subdomainOpts);
}

export function getSandboxServiceUrl(
  port: number,
  context: SandboxProxyContext & { activeServer: ServerEntry | null | undefined },
): string {
  return context.subdomainOpts
    ? getProxyBaseUrl(port, context.serverUrl, context.subdomainOpts)
    : (context.activeServer ? getDirectPortUrl(context.activeServer, String(port)) : null)
        || getProxyBaseUrl(port, context.serverUrl, context.subdomainOpts)
        || '';
}
