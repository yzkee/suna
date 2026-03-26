import { parseRuntimeEnv, type RuntimeEnv } from '@/lib/env-schema'

declare global {
  interface Window {
    __KORTIX_RUNTIME_CONFIG?: Partial<RuntimeEnv>
    __RUNTIME_ENV?: Partial<RuntimeEnv>
    __ENV_LOGGED__?: boolean
  }
}

// ─── Dev domain overrides ─────────────────────────────────────────────────
// Both new.kortix.com (prod) and dev-new.kortix.com (dev) serve the same
// Vercel production build. NEXT_PUBLIC_* vars bake at build time with prod
// values. On dev domains we override ALL environment-specific values at
// runtime so the dev frontend talks to the dev API AND the dev Supabase.

interface DevEnvOverride {
  backendUrl: string
  supabaseUrl: string
  supabaseAnonKey: string
}

const DEV_OVERRIDES: Record<string, DevEnvOverride> = {
  'dev-new.kortix.com': {
    backendUrl:      'https://dev-new-api.kortix.com/v1',
    supabaseUrl:     'https://heprlhlltebrxydgtsjs.supabase.co',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhlcHJsaGxsdGVicnh5ZGd0c2pzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDUxODcxNjQsImV4cCI6MjA2MDc2MzE2NH0.YRo1iZw06YSxqBhotBnD1d5jZxw7hHwswe1wKp8VpfA',
  },
  // after cutover:
  'dev.kortix.com': {
    backendUrl:      'https://dev-api.kortix.com/v1',
    supabaseUrl:     'https://heprlhlltebrxydgtsjs.supabase.co',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhlcHJsaGxsdGVicnh5ZGd0c2pzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDUxODcxNjQsImV4cCI6MjA2MDc2MzE2NH0.YRo1iZw06YSxqBhotBnD1d5jZxw7hHwswe1wKp8VpfA',
  },
}

function getDevOverride(): DevEnvOverride | null {
  if (typeof window === 'undefined') return null
  return DEV_OVERRIDES[window.location.hostname] ?? null
}

function readRawEnv(): Partial<RuntimeEnv> {
  if (typeof window !== 'undefined') {
    if (window.__KORTIX_RUNTIME_CONFIG) {
      return window.__KORTIX_RUNTIME_CONFIG
    }
    if (window.__RUNTIME_ENV) {
      return window.__RUNTIME_ENV
    }
  }

  const devOverride = getDevOverride()

  return {
    SUPABASE_URL: devOverride?.supabaseUrl
      || process.env.KORTIX_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_PUBLIC_URL || process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: devOverride?.supabaseAnonKey
      || process.env.KORTIX_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
    BACKEND_URL: devOverride?.backendUrl
      || process.env.KORTIX_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL,
    ENV_MODE: (process.env.KORTIX_PUBLIC_ENV_MODE || process.env.NEXT_PUBLIC_ENV_MODE) as 'local' | 'cloud' | undefined,
    APP_URL: process.env.KORTIX_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_URL || process.env.PUBLIC_URL,
  }
}

function logRuntimeEnv(env: RuntimeEnv) {
  if (typeof window === 'undefined' || window.__ENV_LOGGED__) return
  window.__ENV_LOGGED__ = true
  console.info('[runtime-env]', {
    source: window.__KORTIX_RUNTIME_CONFIG || window.__RUNTIME_ENV ? 'runtime-script' : 'fallback',
    supabaseUrl: env.SUPABASE_URL,
    backendUrl: env.BACKEND_URL,
    envMode: env.ENV_MODE,
    appUrl: env.APP_URL,
    anonKeyLength: env.SUPABASE_ANON_KEY.length,
  })
}

export function getEnv(): RuntimeEnv {
  const runtimeEnv = parseRuntimeEnv(readRawEnv())
  logRuntimeEnv(runtimeEnv)
  return runtimeEnv
}

export const env = getEnv()
