/**
 * Shared auth token helpers.
 *
 * Provides Supabase JWT authentication for all requests.
 *
 * `getAuthToken()` is the unified getter: returns the Supabase JWT.
 * Use it anywhere you need to authenticate against the sandbox proxy.
 *
 * `getSupabaseAccessToken()` is kept for callers that specifically need the
 * Supabase JWT (e.g. platform API calls that go through Supabase auth).
 *
 * **Deduplication**: Multiple callers (SSE, health check, session fetch, etc.)
 * all call getSupabaseAccessToken() on page load simultaneously. Without
 * deduplication, each triggers its own getSession() → refreshSession() chain,
 * causing 5+ parallel Supabase auth roundtrips that take seconds. The inflight
 * promise ensures only ONE auth call runs at a time; all others piggyback.
 *
 * **Caching**: The resolved token is cached for TOKEN_CACHE_TTL (30s). Within
 * that window, subsequent calls return instantly. After TTL, the next call
 * refreshes from Supabase.
 */

import { createClient } from "@/lib/supabase/client";


/** Max retries for token acquisition (getSession + refreshSession fallback) */
const TOKEN_MAX_RETRIES = 2;
/** Base delay between retries (ms) — doubles each attempt */
const TOKEN_RETRY_BASE_DELAY = 300;
/** How long to cache a resolved token (ms) */
const TOKEN_CACHE_TTL = 30_000;

// ── Token cache ──
let cachedToken: string | null = null;
let cachedAt = 0;
let bootstrapToken: string | null = null;

// ── Inflight deduplication ──
let inflight: Promise<string | null> | null = null;

/**
 * Get the current Supabase access token with caching + deduplication.
 *
 * Fast path: returns cached token if within TTL.
 * Slow path: deduplicates concurrent calls into a single auth roundtrip.
 */
export async function getSupabaseAccessToken(): Promise<string | null> {
	// Installer/bootstrap flow: server actions may set auth cookies without a
	// client-side Supabase session yet. Use an injected token until the client
	// session hydrates.
	if (bootstrapToken) {
		return bootstrapToken;
	}

	// Fast path: return cached token if still fresh
	if (cachedToken && Date.now() - cachedAt < TOKEN_CACHE_TTL) {
		return cachedToken;
	}

	// Deduplicate: if another call is already fetching, piggyback on it
	if (inflight) return inflight;

	inflight = fetchToken();
	try {
		const token = await inflight;
		cachedToken = token;
		cachedAt = Date.now();
		return token;
	} finally {
		inflight = null;
	}
}

/**
 * Invalidate the cached token (e.g. after a 401 response).
 * The next getSupabaseAccessToken() call will fetch fresh.
 */
export function invalidateTokenCache(): void {
	cachedToken = null;
	cachedAt = 0;
}

/**
 * Seed auth for setup/install flows that receive a JWT from server actions
 * before the browser Supabase client has established local session state.
 */
export function setBootstrapAuthToken(token: string | null): void {
	bootstrapToken = token;
	if (token) {
		cachedToken = token;
		cachedAt = Date.now();
	}
}

/** Internal: actually fetch the token from Supabase with retries. */
async function fetchToken(): Promise<string | null> {
	const supabase = createClient();

	for (let attempt = 0; attempt <= TOKEN_MAX_RETRIES; attempt++) {
		try {
			const {
				data: { session },
			} = await supabase.auth.getSession();
			if (session?.access_token) return session.access_token;

			// Session is null — token may have expired. Try an explicit refresh.
			if (attempt === 0) {
				const {
					data: { session: refreshed },
				} = await supabase.auth.refreshSession();
				if (refreshed?.access_token) return refreshed.access_token;
			}
		} catch {
			// Network error or Supabase internal failure — retry after delay
		}

		// Don't delay after the last attempt
		if (attempt < TOKEN_MAX_RETRIES) {
			await new Promise((r) =>
				setTimeout(r, TOKEN_RETRY_BASE_DELAY * 2 ** attempt),
			);
		}
	}

	return null;
}

/**
 * Unified auth token getter.
 *
 * Returns the Supabase JWT. All requests go through kortix-api which
 * authenticates via Supabase JWT — no additional sandbox lock/key needed.
 */
export async function getAuthToken(): Promise<string | null> {
  return getSupabaseAccessToken();
}

// ── Shared auth-injecting fetch ──

/**
 * Execute fetch with auth headers, properly handling Request objects.
 *
 * When `input` is a Request (e.g. from the OpenCode SDK), we construct a new
 * Request with the auth headers merged in, rather than passing headers via the
 * second `init` argument. This avoids a production-only issue where
 * `fetch(Request, { headers })` silently drops the init headers.
 */
function fetchWithAuth(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  headers: Headers,
): Promise<Response> {
  if (input instanceof Request) {
    // Clone the Request with our auth headers baked in.
    // This guarantees Authorization is part of the Request itself,
    // not relying on fetch's init-merge behavior.
    const authedRequest = new Request(input, {
      headers,
    });
    return fetch(authedRequest);
  }
  return fetch(input, { ...init, headers });
}

/**
 * Build a Headers object from request input + init, injecting the auth token.
 */
function buildAuthHeaders(
  input: RequestInfo | URL,
  init?: RequestInit,
  token?: string | null,
): Headers {
  const headers = new Headers(
    input instanceof Request ? input.headers : undefined,
  );
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => {
      headers.set(key, value);
    });
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}

/**
 * Shared authenticated fetch — injects auth tokens and handles 401 responses.
 *
 * Centralizes the pattern duplicated across opencode-sdk, use-sandbox-connection,
 * and server-selector. All three auth injection points now go through this.
 *
 * Behavior:
 *   1. Gets the current auth token (Supabase JWT)
 *   2. Injects it as Bearer token on the request
 *   3. On 401: invalidates the token cache, gets fresh, retries once
 *
 * Options:
 *   - `retryOnAuthError`: if false, skips stale-token retry (default: true)
 */
export async function authenticatedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: {
    retryOnAuthError?: boolean;
  },
): Promise<Response> {
  const { retryOnAuthError = true } = options ?? {};

  let token = await getAuthToken();

  // If no token yet (Supabase session still hydrating), wait briefly and retry
  // once before giving up. This handles the race where authenticatedFetch is
  // called immediately on mount before the auth cookie has been parsed.
  if (!token) {
    await new Promise((r) => setTimeout(r, 500));
    invalidateTokenCache();
    token = await getAuthToken();
  }

  // Still no token — return a synthetic 401 response instead of sending a
  // naked request. Safe for all callers including the OpenCode SDK which
  // expects fetch() semantics (returns Response, never throws).
  if (!token) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const headers = buildAuthHeaders(input, init, token);

  // When the OpenCode SDK passes a Request object (single arg, no init),
  // we must construct a new Request with the auth headers baked in.
  // Relying on fetch(Request, { headers }) to override headers is unreliable
  // in production builds — Next.js's patched fetch and certain browser
  // implementations don't properly merge init.headers onto an existing
  // Request, causing the Authorization header to be silently dropped.
  const response = await fetchWithAuth(input, init, headers);

  if (response.status === 401) {
    // The cached token is stale. Retry once with fresh token.
    if (retryOnAuthError && token) {
      invalidateTokenCache();
      const newToken = await getAuthToken();
      if (newToken && newToken !== token) {
        const retryHeaders = buildAuthHeaders(input, init, newToken);
        return fetchWithAuth(input, init, retryHeaders);
      }
    }
  }

  return response;
}
