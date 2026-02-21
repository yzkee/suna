import { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { validateSecretKey } from '../repositories/api-keys';
import { validateSandboxToken } from '../repositories/sandboxes';
import { getSupabase } from '../shared/supabase';

/**
 * API key auth (sk_/sbt_ for search, LLM routes).
 *
 * Auth Flow:
 * - Token "sk_xxx"  = validate against api_keys table via Drizzle, get account_id
 * - Token "sbt_xxx" = validate against kortix.sandboxes table, get account_id
 * - No valid prefix = 401
 */
export async function apiKeyAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new HTTPException(401, {
      message: 'Missing or invalid Authorization header',
    });
  }

  const token = authHeader.slice(7);

  if (!token) {
    throw new HTTPException(401, {
      message: 'Missing token in Authorization header',
    });
  }

  // API key validation (sk_xxx format)
  if (token.startsWith('sk_')) {
    const result = await validateSecretKey(token);

    if (!result.isValid) {
      throw new HTTPException(401, {
        message: result.error || 'Invalid API key',
      });
    }

    c.set('accountId', result.accountId);
    c.set('keyId', result.keyId);
    if (result.sandboxId) {
      c.set('sandboxId', result.sandboxId);
    }
    await next();
    return;
  }

  // Sandbox token validation (sbt_xxx format)
  if (token.startsWith('sbt_')) {
    const result = await validateSandboxToken(token);

    if (!result.isValid) {
      throw new HTTPException(401, {
        message: result.error || 'Invalid sandbox token',
      });
    }

    c.set('accountId', result.accountId);
    c.set('sandboxId', result.sandboxId);
    await next();
    return;
  }

  // No valid token format matched — reject
  throw new HTTPException(401, {
    message: 'Invalid token format. Use sk_ (API key) or sbt_ (sandbox token)',
  });
}

/**
 * Supabase JWT auth (for billing, platform, cron routes).
 * Sets userId and userEmail in context on success.
 */
export async function supabaseAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    throw new HTTPException(401, { message: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7);
  if (!token) {
    throw new HTTPException(401, { message: 'Missing token' });
  }

  try {
    const supabase = getSupabase();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      throw new HTTPException(401, { message: 'Invalid or expired token' });
    }

    c.set('userId', user.id);
    c.set('userEmail', user.email || '');
    await next();
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    console.error('Auth error:', err);
    throw new HTTPException(401, { message: 'Authentication failed' });
  }
}

/**
 * Dual mode auth (for proxy routes — try API key, else passthrough).
 * This is handled inline in the proxy route handler, not as middleware.
 * Exported for reference but the proxy route has its own tryAuthenticate.
 */
export async function dualAuth(c: Context, next: Next) {
  // Proxy routes handle auth internally (tryAuthenticate pattern)
  await next();
}

/**
 * Supabase JWT from header OR query param (for daytona-proxy SSE).
 * EventSource/SSE can't set headers, so we also check ?token=<token>.
 */
export async function supabaseAuthWithQueryParam(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  let token: string | undefined;

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }

  if (!token) {
    token = c.req.query('token') || undefined;
  }

  if (!token) {
    throw new HTTPException(401, {
      message: 'Missing authentication token',
    });
  }

  try {
    const supabase = getSupabase();
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      throw new HTTPException(401, {
        message: 'Invalid or expired token',
      });
    }

    c.set('userId', user.id);
    c.set('userEmail', user.email);

    await next();
  } catch (err) {
    if (err instanceof HTTPException) {
      throw err;
    }
    console.error('[AUTH] Error:', err);
    throw new HTTPException(401, {
      message: 'Authentication failed',
    });
  }
}

/**
 * Combined auth for preview proxy routes.
 *
 * Accepts EITHER:
 *   1. Supabase JWT (from header or ?token= query param) — sets userId
 *   2. Sandbox token (sbt_xxx) from header or ?token= — sets userId from account lookup
 *
 * All requests go through kortix-api which authenticates via Supabase JWT
 * or sbt_ token. No additional sak_ sandbox lock needed.
 */
export async function previewProxyAuth(c: Context, next: Next) {
  // Skip auth for CORS preflight — OPTIONS never carries auth tokens.
  if (c.req.method === 'OPTIONS') {
    await next();
    return;
  }

  // Extract token from header or query param
  const authHeader = c.req.header('Authorization');
  let token: string | undefined;

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }

  if (!token) {
    token = c.req.query('token') || undefined;
  }

  if (!token) {
    throw new HTTPException(401, { message: 'Missing authentication token' });
  }

  // 1. Try sandbox token (sbt_xxx) — used by agents inside the sandbox
  if (token.startsWith('sbt_')) {
    const result = await validateSandboxToken(token);
    if (result.isValid) {
      c.set('userId', result.accountId);
      c.set('userEmail', '');
      await next();
      return;
    }
    throw new HTTPException(401, { message: result.error || 'Invalid sandbox token' });
  }

  // 2. Try Supabase JWT — used by the frontend
  try {
    const supabase = getSupabase();
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      throw new HTTPException(401, { message: 'Invalid or expired token' });
    }

    c.set('userId', user.id);
    c.set('userEmail', user.email || '');
    await next();
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    console.error('[PREVIEW-AUTH] Error:', err);
    throw new HTTPException(401, { message: 'Authentication failed' });
  }
}

/**
 * Combined auth for cron/deployment routes.
 *
 * Accepts EITHER:
 *   1. Supabase JWT (from frontend) — sets userId, userEmail
 *   2. Sandbox token (sbt_xxx from agents) — sets userId from accountId lookup
 */
export async function combinedAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new HTTPException(401, { message: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7);
  if (!token) {
    throw new HTTPException(401, { message: 'Missing token' });
  }

  // Sandbox token (sbt_) — used by agents inside the sandbox
  if (token.startsWith('sbt_')) {
    const result = await validateSandboxToken(token);
    if (!result.isValid) {
      throw new HTTPException(401, { message: result.error || 'Invalid sandbox token' });
    }
    // Map accountId → userId so route handlers work unchanged
    c.set('userId', result.accountId);
    c.set('userEmail', '');
    await next();
    return;
  }

  // Otherwise, fall through to Supabase JWT auth
  await supabaseAuth(c, next);
}
