# Pipedream Credentials Architecture — Spec

## Problem

Pipedream credentials (client_id, client_secret, project_id) are needed by the Kortix API to serve both:
1. **Frontend** (browser → API direct, supabase auth)
2. **Sandbox agent** (agent → kortix-master → API, api-key auth)

Currently the creds must be hardcoded in the API's `.env`. This breaks the model where the sandbox is the source of truth for credentials.

## Design

### Credential Resolution Chain

When the API needs a Pipedream provider, it resolves credentials in this order:

```
1. Request headers (x-pipedream-*)     → per-request override from sandbox proxy
2. Account credentials (DB)            → per-account, set by user via sandbox/frontend  
3. API defaults (env vars)             → global fallback, Kortix-managed
```

This means:
- **Kortix ships with default Pipedream creds** (in API env) → everything works out of the box
- **Users can bring their own** Pipedream project → stored per-account in DB, overrides defaults
- **Sandbox can override per-request** → existing header mechanism still works

### DB Schema

New table: `kortix.integration_credentials`

```sql
CREATE TABLE kortix.integration_credentials (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL REFERENCES kortix.accounts(account_id) ON DELETE CASCADE,
  provider       VARCHAR(50) NOT NULL DEFAULT 'pipedream',   -- extensible for future providers
  credentials    JSONB NOT NULL DEFAULT '{}',                -- encrypted at rest via PG
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, provider)
);
```

The `credentials` JSONB stores:
```json
{
  "client_id": "...",
  "client_secret": "...",
  "project_id": "proj_xxxxx",
  "environment": "production"
}
```

### Provider Resolution (updated `getProviderFromRequest`)

```
function getProviderFromRequest(c: Context): AuthProvider {
  // 1. Request headers (sandbox proxy override)
  if (has x-pipedream-* headers) → ephemeral PipedreamProvider

  // 2. Account credentials (DB) — if request has an accountId
  accountCreds = await getAccountCredentials(accountId, 'pipedream')
  if (accountCreds) → PipedreamProvider from DB creds

  // 3. API defaults (env vars)
  if (config.PIPEDREAM_CLIENT_ID) → global singleton PipedreamProvider

  // 4. Nothing → error with setup instructions
}
```

### API Endpoints

**Save credentials** (called by sandbox or frontend):
```
PUT /v1/pipedream/credentials
Auth: supabaseAuth OR apiKeyAuth
Body: { client_id, client_secret, project_id, environment? }
→ Upserts into integration_credentials for the authenticated account
```

**Get credential status** (no secrets returned):
```
GET /v1/pipedream/credentials
Auth: supabaseAuth OR apiKeyAuth  
→ { configured: true, provider: "pipedream", source: "account" | "default" }
```

**Delete custom credentials** (revert to defaults):
```
DELETE /v1/pipedream/credentials
Auth: supabaseAuth OR apiKeyAuth
→ Removes per-account creds, falls back to API defaults
```

### Sandbox Integration

When the user sets `PIPEDREAM_CLIENT_ID` etc. in the sandbox secrets manager:

1. Sandbox stores them in its own `.env` (for the header-injection path)
2. Sandbox ALSO pushes them to the API via `PUT /v1/pipedream/credentials`
3. API stores them per-account in DB
4. Frontend immediately works (API reads from DB for that account)

kortix-master gets a boot hook that auto-pushes Pipedream creds to the API if they exist in env.

### Frontend

The frontend setup card:
1. User enters Pipedream creds
2. Card saves to sandbox env (via secrets manager) — for agent path
3. Card ALSO saves to API (via `PUT /v1/pipedream/credentials`) — for frontend path
4. Both paths work immediately

### Flow Diagrams

**Default flow (no user config):**
```
Frontend → API → config.PIPEDREAM_CLIENT_ID (env) → Pipedream SDK
```

**User brings own creds (via sandbox):**
```
User sets creds in sandbox secrets manager
  → sandbox env updated (agent path works via headers)
  → sandbox pushes to API DB (frontend path works via DB lookup)

Frontend → API → DB lookup (account creds) → Pipedream SDK
Agent → kortix-master → API (headers override) → Pipedream SDK
```

**User brings own creds (via frontend setup card):**
```
User fills in creds on integrations page
  → saves to sandbox env (agent path)
  → saves to API DB (frontend path)
```

### Migration Path

1. Add `integration_credentials` table
2. Update `getProviderFromRequest` with 3-tier resolution
3. Add credential CRUD endpoints
4. Update kortix-master to auto-push creds on boot
5. Update frontend setup card to save to both places
6. API `.env` keeps default Kortix Pipedream creds (works out of the box)
