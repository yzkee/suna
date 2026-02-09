import { config } from '../config';

// === Key Injection Methods ===

export type KeyInjectionMethod =
  | { type: 'json_body_field'; field: string }
  | { type: 'header'; headerName: string; prefix?: string };

// === Included Route Definition ===

export interface IncludedRoute {
  /** Path prefix to match (e.g. "/search" matches "/search" and "/search?q=foo") */
  path: string;
  /** Allowed HTTP methods */
  methods: string[];
}

// === Proxy Service Configuration ===

export interface ProxyServiceConfig {
  /** Service name / route prefix (e.g. "tavily") */
  name: string;
  /** Real upstream base URL (e.g. "https://api.tavily.com") */
  targetBaseUrl: string;
  /** Kortix-owned API key for this upstream service */
  getKortixApiKey: () => string;
  /** How to inject the API key into upstream requests */
  keyInjection: KeyInjectionMethod;
  /** Only these routes are allowed when using Kortix's key (prevents cost abuse) */
  allowedRoutes: IncludedRoute[];
  /** Tool name for billing attribution */
  billingToolName: string;
}

// === Service Registry ===

export function getProxyServices(): Record<string, ProxyServiceConfig> {
  return {
    tavily: {
      name: 'tavily',
      targetBaseUrl: config.TAVILY_API_URL,
      getKortixApiKey: () => config.TAVILY_API_KEY,
      keyInjection: { type: 'json_body_field', field: 'api_key' },
      allowedRoutes: [
        { path: '/search', methods: ['POST'] },
      ],
      billingToolName: 'proxy_tavily',
    },

    serper: {
      name: 'serper',
      targetBaseUrl: config.SERPER_API_URL,
      getKortixApiKey: () => config.SERPER_API_KEY,
      keyInjection: { type: 'header', headerName: 'X-API-KEY' },
      allowedRoutes: [
        { path: '/search', methods: ['POST'] },
        { path: '/images', methods: ['POST'] },
        { path: '/news', methods: ['POST'] },
        { path: '/videos', methods: ['POST'] },
        { path: '/scholar', methods: ['POST'] },
      ],
      billingToolName: 'proxy_serper',
    },

    firecrawl: {
      name: 'firecrawl',
      targetBaseUrl: config.FIRECRAWL_API_URL,
      getKortixApiKey: () => config.FIRECRAWL_API_KEY,
      keyInjection: { type: 'header', headerName: 'Authorization', prefix: 'Bearer ' },
      allowedRoutes: [
        { path: '/v1/scrape', methods: ['POST'] },
        { path: '/v1/crawl', methods: ['POST', 'GET'] },
        { path: '/v1/map', methods: ['POST'] },
        { path: '/v1/search', methods: ['POST'] },
      ],
      billingToolName: 'proxy_firecrawl',
    },

    replicate: {
      name: 'replicate',
      targetBaseUrl: config.REPLICATE_API_URL,
      getKortixApiKey: () => config.REPLICATE_API_TOKEN,
      keyInjection: { type: 'header', headerName: 'Authorization', prefix: 'Token ' },
      allowedRoutes: [
        // SDK flow: POST /v1/models/{owner}/{name}/predictions → GET /v1/predictions/{id}
        { path: '/v1/predictions', methods: ['POST', 'GET'] },
        { path: '/v1/models', methods: ['POST', 'GET'] },
      ],
      billingToolName: 'proxy_replicate',
    },

    context7: {
      name: 'context7',
      targetBaseUrl: config.CONTEXT7_API_URL,
      getKortixApiKey: () => config.CONTEXT7_API_KEY,
      keyInjection: { type: 'header', headerName: 'Authorization', prefix: 'Bearer ' },
      allowedRoutes: [
        { path: '/api/v2/libs/search', methods: ['GET', 'POST'] },
        { path: '/api/v2/context', methods: ['GET', 'POST'] },
      ],
      billingToolName: 'proxy_context7',
    },
  };
}

// === Route Matching ===

/**
 * Check if a request method+path is allowed in the service's included routes.
 * Uses prefix matching: "/v1/predictions/abc123" matches included route "/v1/predictions".
 */
export function isRouteAllowed(
  method: string,
  path: string,
  allowedRoutes: IncludedRoute[]
): boolean {
  const upperMethod = method.toUpperCase();
  const normalizedPath = path.split('?')[0]; // strip query string

  for (const route of allowedRoutes) {
    if (!route.methods.includes(upperMethod)) continue;

    // Exact match or prefix match (path starts with route.path followed by / or end)
    if (
      normalizedPath === route.path ||
      normalizedPath.startsWith(route.path + '/')
    ) {
      return true;
    }
  }

  return false;
}
