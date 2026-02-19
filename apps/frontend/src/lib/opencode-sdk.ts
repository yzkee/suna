/**
 * OpenCode SDK client singleton.
 *
 * Provides a `getClient()` function that returns an `OpencodeClient` instance
 * pointed at the currently active server URL. Automatically recreates the
 * client when the server URL changes.
 *
 * Auth tokens are injected into every request via a custom fetch wrapper:
 *   - Cloud mode: Supabase JWT (from getSupabaseAccessToken)
 *   - Local/VPS mode: sandbox token (from sandbox-auth-store)
 *
 * If a 401 with `authType: 'sandbox_token'` is received, the store's
 * `needsAuth` flag is set, triggering the sandbox token dialog.
 */

import {
	createOpencodeClient,
	type OpencodeClient,
} from "@kortix/opencode-sdk/v2/client";
import { getAuthToken, invalidateTokenCache } from "@/lib/auth-token";
import { getActiveOpenCodeUrl } from "@/stores/server-store";
import { useSandboxAuthStore } from "@/stores/sandbox-auth-store";

let cachedClient: OpencodeClient | null = null;
let cachedUrl: string | null = null;

/**
 * Build a Headers object with the given token injected as Authorization.
 */
function buildHeaders(
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
	if (token && !headers.has("Authorization")) {
		headers.set("Authorization", `Bearer ${token}`);
	}
	return headers;
}

/**
 * Create a fetch wrapper that injects auth tokens into every request.
 *
 * Tries Supabase JWT first (cloud), then sandbox token (local/VPS).
 * Also detects 401 sandbox_token responses and triggers the auth dialog.
 *
 * On a 401 response (non-sandbox-token), forces a token refresh and retries
 * the request once. This handles the case where the connection was lost and
 * the token expired while the sandbox was still processing.
 */
function createAuthFetch(): typeof fetch {
	return async (input: RequestInfo | URL, init?: RequestInit) => {
		const token = await getAuthToken();
		const headers = buildHeaders(input, init, token);
		const mergedInit = { ...init, headers };

		// Disable Bun timeout on Request objects
		if (input instanceof Request) {
			(input as any).timeout = false;
		}

		const response = await fetch(input, mergedInit);

		// Detect sandbox auth requirement — trigger the token dialog
		if (response.status === 401) {
			try {
				const body = await response.clone().json();
				if (body?.authType === 'sandbox_token') {
					useSandboxAuthStore.getState().setNeedsAuth(true);
					return response;
				}
			} catch {
				// Response may not be JSON — fall through to retry logic
			}

			// Non-sandbox 401: the cached Supabase token is stale.
			// Invalidate and retry once.
			if (token) {
				invalidateTokenCache();
				const newToken = await getAuthToken();
				if (newToken && newToken !== token) {
					const retryHeaders = buildHeaders(input, init, newToken);
					return fetch(input, { ...init, headers: retryHeaders });
				}
			}
		}

		return response;
	};
}

/**
 * Get (or create) the SDK client for the current active server.
 * Safe to call from non-React contexts (API modules, etc.).
 */
export function getClient(): OpencodeClient {
	const url = getActiveOpenCodeUrl();
	if (cachedClient && cachedUrl === url) return cachedClient;

	cachedClient = createOpencodeClient({
		baseUrl: url,
		fetch: createAuthFetch(),
	});
	cachedUrl = url;
	return cachedClient;
}

/**
 * Force-recreate the client (e.g. after a server switch or token change).
 */
export function resetClient(): void {
	cachedClient = null;
	cachedUrl = null;
}
