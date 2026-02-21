# Architecture Refactor Plan

## Overview

This plan replaces the custom PostgreSQL Docker image with Supabase (local CLI + hosted), unifies auth so local and cloud modes share the same JWT + API Key flow, makes the frontend API-URL-agnostic with cross-instance connectivity, generalizes sandbox providers to support multiple concurrent local Docker containers plus future providers (e2b, modal), and introduces internal env controls for dev/staging/prod deployments. The result: one code path for local and cloud, zero `if (isLocal())` branches, and real multi-tenant auth everywhere.

---

## Principles

1. **One code path.** No `config.isLocal()` branching in business logic. The only variance is which sandbox provider was selected and which Supabase instance (local CLI vs hosted) is backing the DB.
2. **Auth is never skipped.** Every request — local or cloud — authenticates via Supabase JWT or `sk_`/`sbt_` API key. Mock users do not exist.
3. **Resources are account-owned.** Sandboxes, triggers, API keys, server entries — all scoped to `account_id`. Users access resources through basejump `account_user` membership.
4. **Provider is a runtime detail.** The platform layer manages sandboxes through the `SandboxProvider` interface. Routes never know or care which provider backs a sandbox.
5. **Frontend is a client.** It connects to any Kortix API via URL + credential. It never assumes which API it talks to.
6. **Drizzle stays.** The ORM layer (`@kortix/db`) works with any PostgreSQL. No ORM migration.
7. **Backward compatible data.** Existing Docker volumes, sandbox workspaces, and DB records survive the upgrade. No data loss.

---

## Phase 1: Supabase Everywhere

### Goal

Replace `services/postgres/` custom Docker image with Supabase CLI for local dev, unify the scheduler to `pg_cron` only, and delete all in-process scheduler code.

### Steps

#### 1.1 Create `supabase/config.toml`

The `supabase/` directory currently only has `.branches/`. Create the full Supabase project config.

```toml
[api]
enabled = true
port = 54321

[db]
port = 54322

[db.pooler]
enabled = false

[auth]
enabled = true
site_url = "http://localhost:3000"

[auth.email]
enable_signup = true
enable_confirmations = false

[storage]
enabled = false

[studio]
enabled = true
port = 54323
```

Key: `pg_cron` and `pg_net` are built into Supabase's local postgres image — no custom compilation needed.

**File**: `supabase/config.toml` (CREATE)

#### 1.2 Create Supabase migration for non-Drizzle objects

Drizzle handles `kortix.*` and `public.*` tables. But schema creation, extensions, and scheduler SQL functions must be managed via Supabase migrations.

Create `supabase/migrations/00000000000000_bootstrap.sql`:

```sql
-- Extensions (Supabase local image has these pre-installed)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schemas
CREATE SCHEMA IF NOT EXISTS kortix;
CREATE SCHEMA IF NOT EXISTS basejump;

-- Scheduler helper function (used by pg_cron mode)
CREATE OR REPLACE FUNCTION kortix.configure_scheduler(api_url TEXT, tick_secret TEXT)
RETURNS void AS $$
BEGIN
  -- Remove existing global tick job if any
  PERFORM cron.unschedule('kortix_global_tick')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'kortix_global_tick');

  -- Schedule global safety-net tick every minute
  PERFORM cron.schedule(
    'kortix_global_tick',
    '* * * * *',
    format(
      'SELECT net.http_post(url := %L, headers := ''{"Content-Type": "application/json", "x-cron-secret": "%s"}''::jsonb, body := ''{"source": "pg_cron"}''::jsonb, timeout_milliseconds := 30000)',
      api_url || '/v1/cron/tick',
      tick_secret
    )
  );
END;
$$ LANGUAGE plpgsql;
```

**File**: `supabase/migrations/00000000000000_bootstrap.sql` (CREATE)

#### 1.3 Update `ensureSchema()` to run after Supabase is ready

Remove the `if (!config.isLocal()) return;` guard. `drizzle-kit push` should always run in local/self-hosted mode. The Supabase migration handles prerequisites (extensions, schemas), then Drizzle pushes table definitions.

```typescript
// services/kortix-api/src/ensure-schema.ts
export async function ensureSchema(): Promise<void> {
  if (!config.DATABASE_URL) return;
  // Cloud: Drizzle migrations managed externally (Supabase dashboard or CI)
  if (config.isCloud()) return;
  // Local/self-hosted: push schema declaratively
  // Extensions + schemas already exist from Supabase migration
  // ...existing drizzle-kit push logic...
}
```

No functional change here — the guard already does this. Keep as-is.

**File**: `services/kortix-api/src/ensure-schema.ts` (NO CHANGE — already correct)

#### 1.4 Unify scheduler to `pg_cron` only

Remove `in_process` mode entirely. Both local and cloud use `pg_cron` because Supabase local provides it.

**Changes in `services/kortix-api/src/cron/services/scheduler.ts`**:

1. Delete the `inProcessTick()` function (lines 69–97)
2. Delete the `tickInterval` variable (line 25)
3. Remove the `'in_process'` option from the `schedulerMode` type — it becomes `'pg_cron' | 'disabled'`
4. In `startScheduler()`, delete the `if (config.isLocal())` block (lines 207–219) that starts the 60s `setInterval`
5. The remaining logic: if `CRON_API_URL` and `CRON_TICK_SECRET` are set → `pg_cron` mode. Otherwise → `disabled`.
6. In `stopScheduler()`, remove the `clearInterval` logic

Before:
```typescript
let schedulerMode: 'pg_cron' | 'in_process' | 'disabled' = 'disabled';
```

After:
```typescript
let schedulerMode: 'pg_cron' | 'disabled' = 'disabled';
```

Before (`startScheduler`):
```typescript
if (config.isLocal()) {
  schedulerMode = 'in_process';
  // ...setInterval...
  return;
}
```

After: Delete this entire block.

**File**: `services/kortix-api/src/cron/services/scheduler.ts` (MODIFY)

#### 1.5 Update `docker-compose.local.yml`

1. Remove the `postgres` service entirely (lines 29–51)
2. Remove `postgres-data` from the `volumes:` section at the bottom
3. Remove `depends_on: postgres: condition: service_healthy` from `kortix-api`
4. Change `kortix-api` environment:
   - `DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:54322/postgres` (Supabase local DB)
   - Add `SUPABASE_URL=http://host.docker.internal:54321`
   - Add `SUPABASE_SERVICE_ROLE_KEY=<from supabase status>`
   - Add `SUPABASE_JWT_SECRET=<from supabase status>`
5. Add `CRON_API_URL=http://kortix-api:8008` and `CRON_TICK_SECRET=local-dev-cron-secret` (already present)
6. Update the file header comment to reference `supabase start` as prerequisite

**File**: `docker-compose.local.yml` (MODIFY)

#### 1.6 Delete `services/postgres/`

The entire directory. Only contains `Dockerfile`.

**File**: `services/postgres/Dockerfile` (DELETE)
**Directory**: `services/postgres/` (DELETE)

#### 1.7 Delete `services/kortix-cron/`

Currently empty (only `node_modules/.bin/tsc` and `tsserver` from a stale install). All cron logic lives in `services/kortix-api/src/cron/`.

**Directory**: `services/kortix-cron/` (DELETE)

#### 1.8 Update `scripts/get-kortix.sh`

1. Remove `POSTGRES_IMAGE="kortix/postgres:latest"` reference (line 35)
2. Add Supabase CLI detection + setup flow:
   - Check if `supabase` CLI is installed
   - If not: install via `brew install supabase/tap/supabase` (macOS) or npm
   - Run `supabase start` and capture output
   - Parse `supabase status` to extract `DB URL`, `API URL`, `anon key`, `service_role key`, `JWT secret`
   - Write these to `.env`
3. Add prompt: "Use local Supabase (Docker) or provide hosted Supabase URL?"
   - Local: auto-populate from `supabase status`
   - Hosted: prompt for `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`
4. Remove Docker pull for `POSTGRES_IMAGE`

**File**: `scripts/get-kortix.sh` (MODIFY)

#### 1.9 Update `.env.example`

Add Supabase-specific env vars with comments:

```env
# ─── Supabase ───────────────────────────────────────────────────────────────
# Local: auto-populated by `supabase status` after `supabase start`
# Cloud: from your Supabase project settings
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=

DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres
```

**File**: `.env.example` (MODIFY)

### Files Summary

| Action | File |
|--------|------|
| CREATE | `supabase/config.toml` |
| CREATE | `supabase/migrations/00000000000000_bootstrap.sql` |
| MODIFY | `services/kortix-api/src/cron/services/scheduler.ts` |
| MODIFY | `docker-compose.local.yml` |
| DELETE | `services/postgres/Dockerfile` |
| DELETE | `services/postgres/` (directory) |
| DELETE | `services/kortix-cron/` (directory) |
| MODIFY | `scripts/get-kortix.sh` |
| MODIFY | `.env.example` |

### Acceptance Criteria

1. `supabase start` succeeds and creates a local PostgreSQL with `pg_cron` + `pg_net` extensions enabled
2. `supabase db reset` applies the bootstrap migration and creates `kortix` + `basejump` schemas
3. `docker compose -f docker-compose.local.yml up` starts with NO `postgres` service — connects to Supabase's DB
4. `drizzle-kit push` succeeds against the Supabase-managed DB
5. Scheduler starts in `pg_cron` mode in local dev (no more `in_process` log line)
6. Cron triggers create `cron.schedule()` jobs visible via `SELECT * FROM cron.job`
7. `services/postgres/` directory does not exist
8. `services/kortix-cron/` directory does not exist

### Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| `supabase start` requires Docker — same as before, but now Supabase manages ~10 containers instead of 1 | Document minimum Docker resources (4GB RAM). Offer "hosted Supabase" path in installer for low-resource machines. |
| `host.docker.internal` may not resolve on Linux | Use `extra_hosts: ["host.docker.internal:host-gateway"]` in compose, or detect host IP. |
| Existing `postgres-data` Docker volume has data | Migration guide: export data with `pg_dump`, import into Supabase. Or: `docker volume rm` for fresh start (local dev data is disposable). |

---

## Phase 2: Auth Unification

### Goal

Remove all local-mode auth bypasses so that local and cloud share the exact same auth flow: Supabase JWT for frontend sessions, `sk_`/`sbt_` API keys for programmatic access, resources owned by `account_id`.

### Steps

#### 2.1 Remove local-mode bypass from `apiKeyAuth` middleware

In `services/kortix-api/src/middleware/auth.ts`:

Delete the `if (config.isLocal())` block at lines 21–38. The remaining code already handles `sk_` and `sbt_` tokens correctly. Remove the fallback `c.set('accountId', token)` at line 99 — all tokens must be validated.

Before:
```typescript
export async function apiKeyAuth(c: Context, next: Next) {
  if (config.isLocal()) {
    // ... mock user ...
    c.set('accountId', '00000000-0000-0000-0000-000000000000');
    await next();
    return;
  }
  // ...
}
```

After:
```typescript
export async function apiKeyAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new HTTPException(401, { message: 'Missing or invalid Authorization header' });
  }
  const token = authHeader.slice(7);
  if (!token) {
    throw new HTTPException(401, { message: 'Missing token' });
  }
  // sk_ and sbt_ validation (already exists)...
  // Remove the bare-token-as-accountId fallback
}
```

**File**: `services/kortix-api/src/middleware/auth.ts` (MODIFY)

#### 2.2 Remove local-mode bypass from `supabaseAuth` middleware

Same file. Delete lines 112–117:

```typescript
if (config.isLocal()) {
  c.set('userId', '00000000-0000-0000-0000-000000000000');
  c.set('userEmail', 'local@localhost');
  await next();
  return;
}
```

The Supabase JWT validation path (lines 119–149) now runs for ALL modes. Since Phase 1 gives us GoTrue locally, JWTs are real.

**File**: `services/kortix-api/src/middleware/auth.ts` (MODIFY)

#### 2.3 Remove local-mode bypass from `supabaseAuthWithQueryParam`

Same file. Delete lines 211–216 (same pattern as 2.2).

**File**: `services/kortix-api/src/middleware/auth.ts` (MODIFY)

#### 2.4 Remove `LOCAL_USER` from `AuthProvider.tsx`

In `apps/frontend/src/components/AuthProvider.tsx`:

1. Delete `IS_LOCAL` const (line 18)
2. Delete `LOCAL_USER` object (lines 22–32)
3. Delete `LOCAL_SESSION` object (lines 34–41)
4. Delete the early-return `if (IS_LOCAL)` block in `AuthProvider` (lines 57–66)
5. The component now always renders `<CloudAuthProvider>` (rename to just the inline body — no need for a separate component anymore, or keep the structure and just remove the conditional)

Before:
```tsx
export const AuthProvider = ({ children }) => {
  const supabase = createClient();
  if (IS_LOCAL) {
    // mock user
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
  }
  return <CloudAuthProvider supabase={supabase}>{children}</CloudAuthProvider>;
};
```

After:
```tsx
export const AuthProvider = ({ children }) => {
  const supabase = createClient();
  return <CloudAuthProvider supabase={supabase}>{children}</CloudAuthProvider>;
};
```

(Or inline `CloudAuthProvider` directly into `AuthProvider` since there's no longer a branching reason.)

**File**: `apps/frontend/src/components/AuthProvider.tsx` (MODIFY)

#### 2.5 Clean up `supabase/client.ts`

Remove the local-mode dummy URL/key fallbacks. Supabase is always available now.

Before:
```typescript
const isLocal = process.env.NEXT_PUBLIC_ENV_MODE?.toLowerCase() === 'local';
const url = isLocal
  ? (process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321')
  : process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = isLocal
  ? (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'local-mode-no-key')
  : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
```

After:
```typescript
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
```

**File**: `apps/frontend/src/lib/supabase/client.ts` (MODIFY)

#### 2.6 Delete `local-identity.ts`

The `LOCAL_ACCOUNT_ID`, `LOCAL_SANDBOX_ID`, `LOCAL_SANDBOX_NAME` constants and `bootstrapLocalIdentity()` function exist only to fake identity in local mode. With real auth, accounts and sandboxes are created through the normal flow.

1. Delete the file
2. Remove all imports of `LOCAL_ACCOUNT_ID`, `LOCAL_SANDBOX_ID`, `LOCAL_SANDBOX_NAME` across the codebase
3. Find and replace usages:
   - `services/kortix-api/src/middleware/auth.ts` — uses `LOCAL_SANDBOX_ID` (line 9, 35)
   - `services/kortix-api/src/platform/routes/sandbox-local.ts` — uses `LOCAL_SANDBOX_ID` (line 19, 32)
   - `services/kortix-api/src/platform/routes/account-local.ts` — uses `LOCAL_SANDBOX_ID` (line 21, 40)

These files are being deleted or rewritten in this phase and Phase 4, so the imports naturally go away.

**File**: `services/kortix-api/src/platform/local-identity.ts` (DELETE)

#### 2.7 Remove `bootstrapLocalIdentity()` call from startup

Search for where `bootstrapLocalIdentity` is called (likely in the main entry point / server startup) and remove the call.

**File**: Wherever `bootstrapLocalIdentity` is imported (MODIFY — remove import + call)

#### 2.8 Update frontend build args in `docker-compose.local.yml`

Add Supabase env vars to the frontend service:

```yaml
frontend:
  build:
    args:
      NEXT_PUBLIC_SUPABASE_URL: http://localhost:54321
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ${SUPABASE_ANON_KEY}
```

The anon key comes from `supabase status` and must be set in `.env` before build.

**File**: `docker-compose.local.yml` (MODIFY)

### Files Summary

| Action | File |
|--------|------|
| MODIFY | `services/kortix-api/src/middleware/auth.ts` |
| MODIFY | `apps/frontend/src/components/AuthProvider.tsx` |
| MODIFY | `apps/frontend/src/lib/supabase/client.ts` |
| DELETE | `services/kortix-api/src/platform/local-identity.ts` |
| MODIFY | `docker-compose.local.yml` |
| MODIFY | `.env.example` |
| MODIFY | Server startup file (remove `bootstrapLocalIdentity` call) |

### Acceptance Criteria

1. Starting the app in local mode shows a real Supabase login screen (email/password)
2. Creating an account via GoTrue succeeds and returns a real JWT
3. API requests without a valid JWT or API key return 401 (no mock user fallback)
4. `sk_` API keys created in local mode work identically to cloud
5. No file in the codebase contains `LOCAL_USER`, `LOCAL_ACCOUNT_ID`, `00000000-0000-0000-0000-000000000000` as a hardcoded user/account ID
6. `grep -r "config.isLocal()" services/kortix-api/src/middleware/` returns 0 results

### Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Existing local users have no Supabase account | First-run experience: show signup form. Installer could auto-create a default user via `supabase auth create-user`. |
| Sandbox containers reference the mock `KORTIX_TOKEN` | Phase 4 handles container provisioning with real tokens. Existing containers need restart with new env vars. |
| Breaking change for users who run local without `.env` Supabase vars | Installer (Phase 1.8) ensures Supabase vars are always populated. Fail-fast with clear error if `SUPABASE_URL` is missing. |

---

## Phase 3: Frontend Agnostic + Configurable API URL

### Goal

Make the frontend connect to any Kortix API via a configurable URL, support cross-API instance connectivity via API keys, and persist server entries in the database.

### Steps

#### 3.1 Add API URL configuration to login screen

Create a small settings gear icon in the corner of the login page. Clicking it opens a modal/popover where the user can set the Kortix API URL. Default: `NEXT_PUBLIC_BACKEND_URL`.

Store the user-configured URL in `localStorage` under `kortix-api-url`. The `authenticatedFetch()` and `createClient()` functions read from this instead of the hardcoded env var.

**Files**:
- `apps/frontend/src/app/(auth)/login/page.tsx` (MODIFY — add settings icon)
- `apps/frontend/src/components/api-url-settings.tsx` (CREATE — settings modal component)
- `apps/frontend/src/lib/config.ts` (MODIFY — add `getApiUrl()` that checks localStorage first, falls back to env var)

#### 3.2 Make `BACKEND_URL` dynamic

Currently `NEXT_PUBLIC_BACKEND_URL` is baked at build time. Change all references to use a runtime-resolved function:

```typescript
// apps/frontend/src/lib/config.ts
export function getApiUrl(): string {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('kortix-api-url');
    if (stored) return stored;
  }
  return process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8008/v1';
}
```

Update all files that reference `process.env.NEXT_PUBLIC_BACKEND_URL` to use `getApiUrl()`:

- `apps/frontend/src/stores/server-store.ts` — line 141 (`BACKEND_URL` const)
- `apps/frontend/src/lib/platform-client.ts` (if it exists, references `NEXT_PUBLIC_BACKEND_URL`)
- `apps/frontend/src/lib/auth-token.ts` (if it references the backend URL)
- Any other file importing or referencing `NEXT_PUBLIC_BACKEND_URL`

Search: `grep -r "NEXT_PUBLIC_BACKEND_URL" apps/frontend/src/`

**Files**:
- `apps/frontend/src/lib/config.ts` (MODIFY)
- `apps/frontend/src/stores/server-store.ts` (MODIFY — use `getApiUrl()`)
- All files referencing `NEXT_PUBLIC_BACKEND_URL` (MODIFY)

#### 3.3 Cross-API instance connectivity

Extend `ServerEntry` to support connecting to external Kortix APIs:

```typescript
// apps/frontend/src/stores/server-store.ts
export interface ServerEntry {
  id: string;
  label: string;
  url: string;
  isDefault?: boolean;
  provider?: SandboxProvider;
  sandboxId?: string;
  mappedPorts?: Record<string, string>;
  authToken?: string;
  /** When set, this instance lives on a different Kortix API. Requests go through this URL. */
  externalApiUrl?: string;
  /** API key for authenticating to external Kortix APIs */
  apiKey?: string;
}
```

Add UI in the "Add Instance" dialog:
- "Add External Instance" option
- Fields: API URL, API Key
- On submit: verify connectivity via `GET <apiUrl>/platform/sandbox` with the API key
- Store as a `ServerEntry` with `externalApiUrl` + `apiKey` set

When routing requests for a server with `externalApiUrl`:
- Use `externalApiUrl` as the base URL instead of the current API
- Attach `apiKey` as `Authorization: Bearer sk_...` instead of the Supabase JWT

**Files**:
- `apps/frontend/src/stores/server-store.ts` (MODIFY — extend `ServerEntry`)
- `apps/frontend/src/components/sidebar/server-selector.tsx` (MODIFY — add "External" option)
- `apps/frontend/src/lib/auth-token.ts` (MODIFY — route auth based on server type)

#### 3.4 Post-login sandbox list

After login, the user sees all sandboxes owned by their account. This is already partially implemented via `useSandbox` which calls `GET /platform/sandbox`. Extend to show a list:

- Change `useSandbox` to call `GET /platform/sandbox/list` (already exists in `sandbox-cloud.ts`)
- Render sandbox list in a selection screen before redirecting to dashboard
- Each sandbox shows: name, provider, status, last active time
- "Create New" button for provisioning

**Files**:
- `apps/frontend/src/hooks/platform/use-sandbox.ts` (MODIFY)
- `apps/frontend/src/app/(app)/instances/page.tsx` (CREATE — instance selection page)

#### 3.5 Persist server entries via DB

`server-store.ts` already syncs custom entries to `POST /v1/servers`. Ensure:
- The `servers` API routes exist in `kortix-api`
- Server entries are stored in `kortix.server_entries` table (add to Drizzle schema if missing)
- On login, load entries from API and merge with localStorage

Search for existing server routes: `grep -r "servers" services/kortix-api/src/` to verify current state.

**Files**:
- `packages/db/src/schema/kortix.ts` (MODIFY — ensure `server_entries` table exists)
- `services/kortix-api/src/platform/routes/` (verify server routes exist)

### Files Summary

| Action | File |
|--------|------|
| MODIFY | `apps/frontend/src/app/(auth)/login/page.tsx` |
| CREATE | `apps/frontend/src/components/api-url-settings.tsx` |
| MODIFY | `apps/frontend/src/lib/config.ts` |
| MODIFY | `apps/frontend/src/stores/server-store.ts` |
| MODIFY | `apps/frontend/src/components/sidebar/server-selector.tsx` |
| MODIFY | `apps/frontend/src/hooks/platform/use-sandbox.ts` |
| CREATE | `apps/frontend/src/app/(app)/instances/page.tsx` |
| MODIFY | `apps/frontend/src/lib/auth-token.ts` |
| MODIFY | `packages/db/src/schema/kortix.ts` (if `server_entries` missing) |

### Acceptance Criteria

1. Login page has a settings icon that opens API URL configuration
2. Changing the API URL persists across page reloads (localStorage)
3. Frontend authenticates against the configured API URL's Supabase instance
4. User can add an external Kortix instance via URL + API key
5. Requests to external instances use the API key, not the JWT
6. After login, user sees a list of their sandboxes (not auto-redirect to single sandbox)
7. Server entries sync to the database and survive across devices

### Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Changing API URL breaks Supabase auth (different GoTrue instance) | When API URL changes, clear Supabase session and force re-login. The new Supabase URL must be discoverable from the API (add `GET /v1/config` endpoint returning `supabaseUrl` and `supabaseAnonKey`). |
| CORS issues with cross-API requests | External API must set `Access-Control-Allow-Origin`. Document this requirement. |
| Build-time `NEXT_PUBLIC_` vars conflict with runtime override | Runtime override takes precedence. Build-time values are fallback defaults only. |

---

## Phase 4: Agnostic Sandbox Types

### Goal

Unify platform routes (delete local-only routes), support multiple concurrent local Docker containers with dynamic port allocation, and future-proof the provider enum.

### Steps

#### 4.1 Delete local-only platform routes

These files implement Docker-direct sandbox management that bypasses the DB. After Phase 2 (real auth) and Phase 1 (Supabase DB), all sandboxes are DB-backed. Use the cloud routes for everything.

**Delete**:
- `services/kortix-api/src/platform/routes/sandbox-local.ts`
- `services/kortix-api/src/platform/routes/account-local.ts`

#### 4.2 Remove `if (config.isLocal())` branching from `platform/index.ts`

Before:
```typescript
if (config.isLocal()) {
  platformApp.route('/', localAccountRouter);
  platformApp.route('/sandbox', localSandboxRouter);
} else {
  platformApp.route('/', accountRouter);
  platformApp.route('/sandbox', cloudSandboxRouter);
}
```

After:
```typescript
platformApp.route('/', accountRouter);
platformApp.route('/sandbox', cloudSandboxRouter);
```

Remove imports of `localAccountRouter` and `localSandboxRouter`.

**File**: `services/kortix-api/src/platform/index.ts` (MODIFY)

#### 4.3 Extend provider types enum

In `services/kortix-api/src/platform/providers/index.ts`:

```typescript
export type ProviderName = 'daytona' | 'local_docker' | 'e2b' | 'modal' | 'custom';
```

In `packages/db/src/schema/kortix.ts`, update the `sandbox_provider` enum:

```typescript
sandboxProviderEnum: pgEnum('sandbox_provider', ['daytona', 'local_docker', 'e2b', 'modal', 'custom'])
```

Add stub provider implementations for future use:

```typescript
// services/kortix-api/src/platform/providers/index.ts
case 'e2b':
case 'modal':
case 'custom':
  throw new Error(`Provider '${name}' is not yet implemented`);
```

**Files**:
- `services/kortix-api/src/platform/providers/index.ts` (MODIFY)
- `packages/db/src/schema/kortix.ts` (MODIFY)
- `apps/frontend/src/stores/server-store.ts` (MODIFY — extend `SandboxProvider` type)

#### 4.4 Add `/p` alias for `/preview`

Currently the preview proxy is at `/v1/preview/{sandboxId}/{port}/*`. Add a shorter alias `/v1/p/{sandboxId}/{port}/*` that routes to the same handler.

Find the route registration for `/preview` (likely in the main Hono app or `services/kortix-api/src/daytona-proxy/routes/preview.ts`) and add a duplicate mount at `/p`.

**Files**:
- `services/kortix-api/src/daytona-proxy/routes/preview.ts` (NO CHANGE — handler stays same)
- Main app file where `/preview` is mounted (MODIFY — add `/p` alias)

#### 4.5 Multi-instance LocalDockerProvider

This is the biggest change. Rewrite `services/kortix-api/src/platform/providers/local-docker.ts`:

1. **Remove `CONTAINER_NAME = 'kortix-sandbox'` constant** — container names are now dynamic
2. **Remove `PORT_BASE` / `PORT_MAP` fixed port mapping** — ports are dynamically allocated
3. **Dynamic container naming**: `kortix-sandbox-{uuid-prefix-8}` (e.g. `kortix-sandbox-a1b2c3d4`)
4. **Dynamic port allocation**: Find 7 free ports starting from a base range. Use a port-finding utility.
5. **`create()` actually creates a new container** — no more `ensure()` pattern that returns the single container
6. **`start(externalId)`** — `externalId` is the container name. `docker.getContainer(externalId).start()`
7. **`stop(externalId)`** — same pattern
8. **`remove(externalId)`** — same pattern
9. **`getStatus(externalId)`** — inspect by container name
10. **`resolveEndpoint(externalId)`** — resolve via Docker DNS (`http://{externalId}:8000`) when on Docker network, or via mapped ports when on host

Key changes:

```typescript
// Before
const CONTAINER_NAME = 'kortix-sandbox';

// After
function containerName(sandboxId: string): string {
  return `kortix-sandbox-${sandboxId.slice(0, 8)}`;
}
```

Port allocation:

```typescript
import { createServer } from 'net';

async function findFreePorts(count: number, startFrom = 14000): Promise<number[]> {
  const ports: number[] = [];
  let candidate = startFrom;
  while (ports.length < count) {
    const free = await isPortFree(candidate);
    if (free) ports.push(candidate);
    candidate++;
  }
  return ports;
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => { srv.close(); resolve(true); });
    srv.listen(port, '127.0.0.1');
  });
}
```

Create container with dynamic ports:

```typescript
async create(opts: CreateSandboxOpts): Promise<ProvisionResult> {
  const name = containerName(opts.name || crypto.randomUUID());
  const ports = await findFreePorts(7);
  const portMap = {
    '8000': String(ports[0]),
    '3111': String(ports[1]),
    '6080': String(ports[2]),
    '6081': String(ports[3]),
    '3210': String(ports[4]),
    '9223': String(ports[5]),
    '9224': String(ports[6]),
  };
  // ... create container with dynamic port bindings ...
  return {
    externalId: name,
    baseUrl: `http://localhost:${ports[0]}`,
    metadata: { containerName: name, mappedPorts: portMap },
  };
}
```

**File**: `services/kortix-api/src/platform/providers/local-docker.ts` (REWRITE)

#### 4.6 Remove `ensure()`, `find()`, `getSandboxInfo()` from LocalDockerProvider

These methods assume a single container. Replace with the standard `SandboxProvider` interface methods:
- `create()` — creates a new container
- `start(externalId)` — starts by container name
- `stop(externalId)` — stops by container name
- `remove(externalId)` — removes by container name
- `getStatus(externalId)` — inspects by container name
- `resolveEndpoint(externalId)` — resolves by container name
- `ensureRunning(externalId)` — starts if stopped

Remove `recreateWithToken()` — auth tokens are set during `create()` and updating requires stop/start with new env vars (handled by the platform service, not the provider).

Remove `getContainerEnv()` — no longer needed since auth tokens are managed via DB, not container inspection.

**File**: `services/kortix-api/src/platform/providers/local-docker.ts` (REWRITE — same file as 4.5)

#### 4.7 Update `docker-compose.local.yml` sandbox service

The compose file still defines a static `sandbox` service with `container_name: kortix-sandbox`. This is now only a default/seed sandbox. Options:

**Option A** (recommended): Remove the `sandbox` service from compose entirely. Sandboxes are created on-demand via the API after login. The user creates their first sandbox through the UI.

**Option B**: Keep it as an optional profile for quick-start:
```yaml
sandbox:
  profiles: ["with-sandbox"]
  image: kortix/computer:${SANDBOX_VERSION:-latest}
  # Remove container_name — let Docker assign a name
  # Remove fixed ports — the API manages port allocation
```

Go with **Option A**: delete the `sandbox` service. Remove `sandbox-workspace` and `sandbox-secrets` from the `volumes:` section.

**File**: `docker-compose.local.yml` (MODIFY)

#### 4.8 Update `sandbox-auth-store.ts`

The backend `sandbox-auth-store.ts` manages a single token for the single sandbox. With multiple sandboxes, auth tokens are per-sandbox in the DB (already the case for `sbt_` tokens in `kortix.sandboxes`).

Simplify `sandbox-auth-store.ts`:
- Remove file-based token persistence (`.sandbox-auth-token.json`)
- Auth tokens live in `kortix.sandboxes.metadata` or a dedicated column
- The `sandboxTokenAuth` middleware looks up the token from DB by sandboxId (extracted from the URL path)

Alternatively, keep `sandbox-auth-store.ts` as a cache layer with per-sandboxId storage:

```typescript
class SandboxAuthTokenStore {
  private tokens = new Map<string, string>();
  // ...
}
```

**File**: `services/kortix-api/src/platform/sandbox-auth-store.ts` (MODIFY)

#### 4.9 Clean up `config.ts`

Remove `isLocal()` and `isCloud()` helpers. Replace all usages with provider-specific or feature-flag checks.

Actually — `isLocal()` still has legitimate uses for determining default behaviors (e.g., log verbosity, default ports). Keep `ENV_MODE` but ensure it's never used for auth branching or route selection. Audit all usages:

```bash
grep -rn "config.isLocal()\|config.isCloud()" services/kortix-api/src/
```

Remove usages in:
- `middleware/auth.ts` (done in Phase 2)
- `platform/index.ts` (done in 4.2)
- `cron/services/scheduler.ts` (done in Phase 1)

Keep usages in:
- `config.ts` itself (the helper definitions)
- Any logging/debug-level decisions
- Default port/URL resolution

**File**: `services/kortix-api/src/config.ts` (AUDIT — no change unless `isLocal` is used for auth/routing)

### Files Summary

| Action | File |
|--------|------|
| DELETE | `services/kortix-api/src/platform/routes/sandbox-local.ts` |
| DELETE | `services/kortix-api/src/platform/routes/account-local.ts` |
| MODIFY | `services/kortix-api/src/platform/index.ts` |
| MODIFY | `services/kortix-api/src/platform/providers/index.ts` |
| REWRITE | `services/kortix-api/src/platform/providers/local-docker.ts` |
| MODIFY | `packages/db/src/schema/kortix.ts` |
| MODIFY | `apps/frontend/src/stores/server-store.ts` |
| MODIFY | `docker-compose.local.yml` |
| MODIFY | `services/kortix-api/src/platform/sandbox-auth-store.ts` |
| MODIFY | Main app file (add `/p` alias for `/preview`) |

### Acceptance Criteria

1. `POST /v1/platform/sandbox` with `provider: 'local_docker'` creates a new Docker container with a unique name (e.g. `kortix-sandbox-a1b2c3d4`)
2. Creating a second sandbox creates a second container with different ports
3. `GET /v1/platform/sandbox/list` returns multiple sandboxes
4. Each sandbox has unique mapped ports (no port conflicts)
5. `DELETE /v1/platform/sandbox/:id` removes the correct container
6. No file in `services/kortix-api/src/platform/routes/` contains `sandbox-local` or `account-local`
7. `platform/index.ts` has zero `if (config.isLocal())` branches
8. Preview proxy `/v1/p/{sandboxId}/{port}/*` works as alias for `/v1/preview/{sandboxId}/{port}/*`
9. Provider enum includes `e2b`, `modal`, `custom` (stubs that throw "not implemented")

### Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Dynamic port allocation may conflict with host services | Start port scan from 14000. Check 7 contiguous ports. If unavailable, try next range. Log allocated ports clearly. |
| Orphaned containers if API crashes before recording in DB | Add a cleanup sweep on API startup: list all `kortix.sandbox=true` labeled containers, reconcile with DB records. |
| Multiple containers consume more Docker resources | Document minimum resources per sandbox (~2GB RAM, ~2GB disk). Show resource warnings in UI. |
| Removing the sandbox from compose breaks `docker compose up` quick-start | Document the new flow: `supabase start` → `docker compose up` → login → create sandbox from UI. Alternatively, add a `POST /v1/platform/sandbox` call to `get-kortix.sh` post-startup. |

---

## Phase 5: Internal Env Controls + CLI Improvements

### Goal

Add internal deployment env vars (`INTERNAL_KORTIX_ENV`, feature flags for router/billing), and extend the CLI with ngrok support for local tunnel access.

### Steps

#### 5.1 Add `INTERNAL_KORTIX_ENV`

Purpose: controls Kortix-internal deployment behavior separate from `ENV_MODE`.

```typescript
// services/kortix-api/src/config.ts
INTERNAL_KORTIX_ENV: (process.env.INTERNAL_KORTIX_ENV || 'dev') as 'dev' | 'staging' | 'prod',
```

Usage: select Stripe price IDs, enable/disable analytics, log levels, error reporting endpoints. Does NOT affect auth or routing logic.

**File**: `services/kortix-api/src/config.ts` (MODIFY)

#### 5.2 Add `KORTIX_ROUTER_INTERNAL_ENABLED`

```typescript
// services/kortix-api/src/config.ts
KORTIX_ROUTER_INTERNAL_ENABLED: process.env.KORTIX_ROUTER_INTERNAL_ENABLED === 'true',
```

When `true`, enables Kortix Cloud internal router features (model routing, usage tracking, cost allocation). When `false` (default), the router passes through — safe for self-hosted.

Guard router-internal code with:
```typescript
if (config.KORTIX_ROUTER_INTERNAL_ENABLED) {
  // internal router logic
}
```

**File**: `services/kortix-api/src/config.ts` (MODIFY)

#### 5.3 Add `KORTIX_BILLING_INTERNAL_ENABLED`

```typescript
// services/kortix-api/src/config.ts
KORTIX_BILLING_INTERNAL_ENABLED: process.env.KORTIX_BILLING_INTERNAL_ENABLED === 'true',
```

When `true`, enables billing features (Stripe integration, credit system, usage metering). When `false` (default), billing routes return 404 or pass-through — safe for self-hosted.

**File**: `services/kortix-api/src/config.ts` (MODIFY)

#### 5.4 Replace `STRIPE_ENV` with `INTERNAL_KORTIX_ENV`

Currently:
```typescript
STRIPE_ENV: (process.env.STRIPE_ENV || 'production') as 'staging' | 'production',
```

Replace: Use `INTERNAL_KORTIX_ENV` to select Stripe price IDs. Remove `STRIPE_ENV`.

```typescript
// Where STRIPE_ENV was used:
const priceIds = config.INTERNAL_KORTIX_ENV === 'staging' ? STAGING_PRICES : PROD_PRICES;
```

**Files**:
- `services/kortix-api/src/config.ts` (MODIFY — remove `STRIPE_ENV`)
- All files referencing `config.STRIPE_ENV` (MODIFY — use `config.INTERNAL_KORTIX_ENV`)

#### 5.5 Add ngrok option to `get-kortix.sh`

After the "Local or VPS?" prompt, add:

```
Would you like to expose your local instance to the internet?
  1. No (localhost only)
  2. Yes, via ngrok
```

If ngrok:
1. Check if `ngrok` is installed
2. If not, prompt to install
3. Ask for ngrok auth token (or detect from `ngrok config`)
4. Start ngrok tunnel: `ngrok http 8008 --log stdout`
5. Parse the public URL from ngrok output
6. Write `KORTIX_URL` and `FRONTEND_URL` to `.env` using the ngrok URL
7. Note: ngrok URLs change on restart (unless paid plan) — document this

**File**: `scripts/get-kortix.sh` (MODIFY)

#### 5.6 Update `.env.example` with new vars

```env
# ─── Internal Controls ──────────────────────────────────────────────────────
# INTERNAL_KORTIX_ENV: dev | staging | prod (default: dev)
# Controls: Stripe price IDs, analytics, log levels. Does NOT affect auth.
INTERNAL_KORTIX_ENV=dev

# KORTIX_ROUTER_INTERNAL_ENABLED: true | false (default: false)
# Enables Kortix Cloud internal router features (model routing, usage tracking)
KORTIX_ROUTER_INTERNAL_ENABLED=false

# KORTIX_BILLING_INTERNAL_ENABLED: true | false (default: false)
# Enables billing features (Stripe, credit system, usage metering)
KORTIX_BILLING_INTERNAL_ENABLED=false
```

**File**: `.env.example` (MODIFY)

### Files Summary

| Action | File |
|--------|------|
| MODIFY | `services/kortix-api/src/config.ts` |
| MODIFY | `scripts/get-kortix.sh` |
| MODIFY | `.env.example` |
| MODIFY | Files referencing `config.STRIPE_ENV` |

### Acceptance Criteria

1. `INTERNAL_KORTIX_ENV=staging` selects staging Stripe price IDs
2. `KORTIX_ROUTER_INTERNAL_ENABLED=false` (default) — router features are inert, no errors
3. `KORTIX_BILLING_INTERNAL_ENABLED=false` (default) — billing routes return 404 or are unmounted
4. `get-kortix.sh` offers ngrok option and correctly writes the tunnel URL to `.env`
5. `STRIPE_ENV` is removed from `config.ts` and `.env.example`

### Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| ngrok free tier has ephemeral URLs | Document that webhooks/callbacks break on restart. Recommend reserved domains (paid) for production-like setups. |
| `INTERNAL_KORTIX_ENV` could be confused with `ENV_MODE` | Clear naming: `ENV_MODE` = local vs cloud (user-facing). `INTERNAL_KORTIX_ENV` = dev vs staging vs prod (internal deployment). Document the distinction. |

---

## Migration Path

### Existing local users (Docker Compose with custom postgres)

1. **Backup**: `docker exec postgres pg_dump -U postgres postgres > backup.sql`
2. **Stop**: `docker compose -f docker-compose.local.yml down`
3. **Install Supabase CLI**: `brew install supabase/tap/supabase` (or npm)
4. **Pull new code**: `git pull`
5. **Start Supabase**: `supabase start` (from repo root)
6. **Update `.env`**: Copy values from `supabase status` output into `.env`
7. **Import data** (optional): `psql $DATABASE_URL < backup.sql`
8. **Create account**: Open `http://localhost:3000`, sign up with email/password
9. **Start services**: `docker compose -f docker-compose.local.yml up`
10. **Create sandbox**: From the UI, create a new sandbox (replaces the old hardcoded one)
11. **Cleanup**: `docker volume rm computer_postgres-data` (old volume)

### Existing cloud users (hosted Supabase)

No migration needed. Cloud already uses Supabase. The only changes:
1. Auth middleware no longer has local bypasses (irrelevant for cloud)
2. Scheduler code is simpler (no `in_process` fallback — irrelevant for cloud)
3. Provider enum has new values (backward compatible — existing values unchanged)

### Existing VPS users (get-kortix.sh)

1. Re-run `get-kortix.sh` — it detects existing install and offers upgrade
2. Script stops services, updates images, runs `supabase start`, updates `.env`, restarts
3. Existing sandbox data preserved (Docker volumes persist)
4. User creates a Supabase account on first login

---

## Anti-Patterns

1. **Do NOT add new `if (config.isLocal())` branches in business logic.** The local/cloud distinction is resolved at the infrastructure layer (which Supabase instance, which sandbox provider). Application code is identical.

2. **Do NOT create mock users or skip auth "for convenience".** If auth is inconvenient in local dev, fix the auth UX (auto-login, remember me, magic links). Do not bypass it.

3. **Do NOT hardcode container names or port numbers.** All sandbox identifiers and ports are dynamic. Even for a single sandbox, use the same dynamic allocation code path.

4. **Do NOT store secrets in localStorage.** API keys and sandbox tokens in `ServerEntry.authToken` are an exception (user explicitly chose to store them for convenience). Document the security trade-off. Never store Supabase JWTs — they're managed by `@supabase/ssr`.

5. **Do NOT duplicate route handlers for local vs cloud.** One set of routes, one set of middleware, one set of providers. The provider interface is the abstraction boundary.

6. **Do NOT import `local-identity.ts`, `sandbox-local.ts`, or `account-local.ts`.** These files are deleted. If you see a compile error referencing them, you missed a cleanup step.

7. **Do NOT use `ENV_MODE` to control feature flags.** Use `INTERNAL_KORTIX_ENV`, `KORTIX_ROUTER_INTERNAL_ENABLED`, and `KORTIX_BILLING_INTERNAL_ENABLED` instead. `ENV_MODE` only controls infrastructure defaults (which Supabase, default ports).

8. **Do NOT run `drizzle-kit push` in cloud/production.** Cloud uses managed migrations via Supabase dashboard or CI. `drizzle-kit push` is local-dev only.

---

## Dependency Graph

```
Phase 1: Supabase Everywhere
    │
    ├──► Phase 2: Auth Unification (depends on Phase 1 — needs GoTrue locally)
    │        │
    │        ├──► Phase 3: Frontend Agnostic (depends on Phase 2 — needs real auth)
    │        │
    │        └──► Phase 4: Agnostic Sandbox Types (depends on Phase 2 — needs real auth for sandbox provisioning)
    │
    └──► Phase 5: Internal Env Controls (independent — can run in parallel with Phase 2)
```

### Execution Order

| Order | Phase | Depends On | Parallelizable With |
|-------|-------|------------|---------------------|
| 1 | Phase 1: Supabase Everywhere | — | Phase 5 |
| 1 | Phase 5: Internal Env Controls | — | Phase 1 |
| 2 | Phase 2: Auth Unification | Phase 1 | — |
| 3 | Phase 3: Frontend Agnostic | Phase 2 | Phase 4 |
| 3 | Phase 4: Agnostic Sandbox Types | Phase 2 | Phase 3 |

**Critical path**: Phase 1 → Phase 2 → Phase 4 (longest chain, most risky)

**Recommended implementation cadence**:
1. Ship Phase 1 + Phase 5 together (one PR, low risk)
2. Ship Phase 2 alone (breaking change — needs migration guide)
3. Ship Phase 3 and Phase 4 as separate PRs (can be developed in parallel, merged independently)

### Estimated Scope

| Phase | Files Changed | Complexity | Risk |
|-------|--------------|------------|------|
| Phase 1 | ~9 | Medium | Low — infra swap, logic preserved |
| Phase 2 | ~7 | Medium | **High** — breaking auth change |
| Phase 3 | ~9 | Medium | Medium — new UI, new data flow |
| Phase 4 | ~10 | **High** | **High** — rewrite core provider |
| Phase 5 | ~4 | Low | Low — additive env vars |
