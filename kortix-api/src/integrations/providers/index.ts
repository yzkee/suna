import type { Context } from 'hono';
import { config } from '../../config';
import { PipedreamProvider } from './pipedream';
import type { AuthProvider } from './types';

export type { AuthProvider, ConnectedAccount, AuthToken, ConnectTokenResult, AppInfo, AppListResult } from './types';

let _provider: AuthProvider | null = null;
let _providerUnavailable = false;

/**
 * Get or create the global (env-based) auth provider singleton.
 * Returns null if global creds are not configured.
 */
export function createAuthProvider(): AuthProvider | null {
  if (_provider) return _provider;
  if (_providerUnavailable) return null;

  const providerName = config.INTEGRATION_AUTH_PROVIDER;

  if (providerName === 'pipedream') {
    if (!config.PIPEDREAM_CLIENT_ID || !config.PIPEDREAM_CLIENT_SECRET || !config.PIPEDREAM_PROJECT_ID) {
      _providerUnavailable = true;
      console.warn('[integrations] Pipedream env creds not configured — integrations require X-Pipedream-* request headers');
      return null;
    }
    _provider = new PipedreamProvider({
      clientId: config.PIPEDREAM_CLIENT_ID,
      clientSecret: config.PIPEDREAM_CLIENT_SECRET,
      projectId: config.PIPEDREAM_PROJECT_ID,
      environment: config.PIPEDREAM_ENVIRONMENT,
    });
    return _provider;
  }

  _providerUnavailable = true;
  return null;
}

/**
 * Extract Pipedream credential overrides from request headers.
 * The sandbox can send its own Pipedream creds via these headers:
 *   X-Pipedream-Client-Id
 *   X-Pipedream-Client-Secret
 *   X-Pipedream-Project-Id
 *   X-Pipedream-Environment (optional, defaults to 'production')
 *
 * Returns an ephemeral PipedreamProvider if all required headers are present,
 * otherwise falls back to the global provider, or throws if neither is available.
 */
export function getProviderFromRequest(c: Context): AuthProvider {
  const clientId = c.req.header('x-pipedream-client-id');
  const clientSecret = c.req.header('x-pipedream-client-secret');
  const projectId = c.req.header('x-pipedream-project-id');

  if (clientId && clientSecret && projectId) {
    const environment = c.req.header('x-pipedream-environment') || 'production';
    return new PipedreamProvider({ clientId, clientSecret, projectId, environment });
  }

  const global = createAuthProvider();
  if (!global) {
    throw new Error(
      'No Pipedream credentials available. Either configure PIPEDREAM_* env vars on the API, ' +
      'or send X-Pipedream-Client-Id, X-Pipedream-Client-Secret, and X-Pipedream-Project-Id headers.',
    );
  }
  return global;
}
