import { config, SANDBOX_VERSION } from '../config';
import type { PoolSandbox } from './types';

function buildKortixMasterUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  return `${parsed.protocol}//8000--${parsed.hostname}/env`;
}

function buildHeaders(metadata: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  const proxyToken = metadata.justavpsProxyToken as string | undefined;
  if (proxyToken) headers['X-Proxy-Token'] = proxyToken;

  const placeholderToken = metadata.poolPlaceholderToken as string | undefined;
  if (placeholderToken) headers['Authorization'] = `Bearer ${placeholderToken}`;

  return headers;
}

function buildEnvPayload(serviceKey: string): Record<string, string> {
  const sandboxApiBase = config.KORTIX_URL.replace(/\/v1\/router\/?$/, '');
  const routerBase = `${sandboxApiBase}/v1/router`;
  return {
    KORTIX_API_URL: sandboxApiBase,
    ENV_MODE: 'cloud',
    INTERNAL_SERVICE_KEY: serviceKey,
    KORTIX_TOKEN: serviceKey,
    KORTIX_SANDBOX_VERSION: SANDBOX_VERSION,
    TAVILY_API_URL: `${routerBase}/tavily`,
    REPLICATE_API_URL: `${routerBase}/replicate`,
    SERPER_API_URL: `${routerBase}/serper`,
  };
}

export async function inject(poolSandbox: PoolSandbox, serviceKey: string): Promise<void> {
  const meta = (poolSandbox.metadata as Record<string, unknown>) ?? {};
  const url = buildKortixMasterUrl(poolSandbox.baseUrl);
  const headers = buildHeaders(meta);
  const keys = buildEnvPayload(serviceKey);

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ keys }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Env injection failed (${res.status}) for ${poolSandbox.externalId}: ${text.slice(0, 300)}`);
  }

  console.log(`[POOL] Env injected into ${poolSandbox.externalId}`);
}
