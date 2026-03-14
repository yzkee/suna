/**
 * Runtime environment config accessor.
 *
 * Centralises access to NEXT_PUBLIC_* env vars so server-side code can fall
 * back to them when the server-only equivalents (e.g. BACKEND_URL) are absent.
 */

export interface EnvConfig {
  BACKEND_URL: string;
}

export function getEnv(): EnvConfig {
  return {
    BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL || '',
  };
}
