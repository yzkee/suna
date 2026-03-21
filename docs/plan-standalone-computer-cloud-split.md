# Standalone Computer vs Cloud Control Plane

## Goal

Make `computer` fully usable as a standalone product with no required central `kortix-api` dependency, while keeping an optional cloud control plane for fleet management, billing, hosted provider keys, tunnels, and other platform services.

The desired model is:

- any `Computer` instance can run fully on its own
- any frontend can connect directly to any `Computer` instance
- cloud services are optional overlays, not required runtime dependencies
- the current `kortix-api` shrinks into a cloud-only management/API layer instead of being the required path for all self-hosted usage

## The Most Important Clarification

"No `kortix-api` in between" should mean:

- no central/shared cloud backend must sit between the frontend and a standalone `Computer`

It should **not** mean:

- no local API at all

A standalone `Computer` still needs a local trusted control plane for:

- auth/session handling
- preview/proxy routing
- sandbox lifecycle operations
- PTY/WebSocket/SSE auth
- local state and secrets management

So the real end state is:

`Frontend -> Computer Instance API -> local runtime/services`

And optionally:

`Frontend -> Cloud API -> fleet metadata / billing / hosted services`

or:

`Computer Instance -> Cloud Control Plane` (outbound management link)

## Current `kortix-api` Concern Map

Today `kortix-api` is doing too many jobs at once.

### 1. App shell and service orchestration

Current ownership:

- mounts almost every sub-system in `computer/kortix-api/src/index.ts:241`
- starts schema/setup/background services in `computer/kortix-api/src/index.ts:524`
- owns preview WS proxy handling in `computer/kortix-api/src/index.ts:574`

This is mostly instance-local and belongs with the runtime, not with a cloud control plane.

### 2. Auth, sessions, account lookup, API keys

Current ownership:

- `computer/kortix-api/src/middleware/auth.ts:13`
- `computer/kortix-api/src/shared/resolve-account.ts:17`
- `computer/kortix-api/src/repositories/api-keys.ts:54`

Current problem:

- browser/backend auth is centered on Supabase JWTs, not instance-native auth

This must move into the standalone instance runtime.

### 3. Platform/sandbox lifecycle

Current ownership:

- `computer/kortix-api/src/platform/index.ts:12`
- `computer/kortix-api/src/platform/routes/account.ts:83`
- `computer/kortix-api/src/platform/routes/sandbox-cloud.ts:88`
- `computer/kortix-api/src/platform/services/ensure-sandbox.ts:18`
- `computer/kortix-api/src/platform/providers/index.ts:52`

This is the heart of "Computer as a product" and should live on the instance.

### 4. Preview proxy / ingress / sandbox routing

Current ownership:

- `computer/kortix-api/src/daytona-proxy/index.ts:13`
- `computer/kortix-api/src/daytona-proxy/routes/preview.ts:94`
- `computer/kortix-api/src/daytona-proxy/routes/auth.ts:1`

This is absolutely instance-local. A frontend connecting directly to a Computer still needs this behavior, but hosted on the Computer itself.

### 5. Setup, local env management, provider config, secrets

Current ownership:

- `computer/kortix-api/src/setup/index.ts:275`
- `computer/kortix-api/src/providers/routes.ts:1`
- `computer/kortix-api/src/secrets/routes.ts:68`

These are also instance-local concerns.

### 6. Server registry and custom instance persistence

Current ownership:

- `computer/kortix-api/src/servers/index.ts:1`

This should not require a cloud backend for standalone mode. It can become local-only state in the frontend and/or instance runtime.

### 7. Queue, local services, local health monitors

Current ownership:

- `computer/kortix-api/src/queue/routes.ts:28`
- `computer/kortix-api/src/queue/drainer.ts:23`
- `computer/kortix-api/src/platform/services/sandbox-health.ts:1`

These are instance runtime concerns.

### 8. Billing, subscriptions, Stripe/RevenueCat, credit logic

Current ownership:

- `computer/kortix-api/src/billing/index.ts:15`
- `computer/kortix-api/src/billing/routes/subscriptions.ts:21`
- `computer/kortix-api/src/billing/routes/webhooks.ts:7`
- `computer/kortix-api/src/billing/services/credits.ts:65`

This is cloud-control-plane logic, not required for standalone.

### 9. Channels, Slack/Telegram/Discord bridge, file uploads

Current ownership:

- `computer/kortix-api/src/channels/index.ts:16`
- `computer/kortix-api/src/channels/routes/channels.ts:51`
- `computer/kortix-api/src/channels/routes/files.ts:10`

This is optional product functionality. It should not block standalone core.

### 10. Integrations / Pipedream / app connections

Current ownership:

- `computer/kortix-api/src/integrations/index.ts:7`
- `computer/kortix-api/src/integrations/routes.ts:84`

This is optional and can stay cloud-first or become a plugin later.

### 11. Tunnel / remote machine access / permission grants

Current ownership:

- `computer/kortix-api/src/tunnel/index.ts:33`
- `computer/kortix-api/src/tunnel/routes/connections.ts:23`

This is cloud-management functionality. It should be attachable to standalone instances, not required for them.

### 12. Access control, signup gating, admin, cloud org workflows

Current ownership:

- `computer/kortix-api/src/access-control/index.ts:30`
- `computer/kortix-api/src/admin/index.ts:267`

These are cloud/SaaS concerns.

### 13. OAuth provider surface and claimable-machine flows

Current ownership:

- `computer/kortix-api/src/oauth/index.ts:57`
- `computer/kortix-api/src/oauth/index.ts:221`

This is optional platform/cloud functionality, not part of the minimum standalone runtime.

### 14. Router / LLM proxy / search / model billing

Current ownership:

- `computer/kortix-api/src/router/index.ts:23`
- `computer/kortix-api/src/router/routes/llm.ts:17`
- `computer/kortix-api/src/router/routes/proxy.ts:24`

This should become adapter-based:

- local instance can use local provider keys
- cloud mode can proxy through hosted/org-wide keys

### 15. Deployments and legacy migration

Current ownership:

- `computer/kortix-api/src/deployments/routes/deployments.ts:16`
- `computer/kortix-api/src/legacy/routes.ts:18`

These are optional concerns and should not sit in the critical path for standalone core.

## What Is Actually Blocking "Fully Standalone"

It is not just channels.

### Hard external/runtime coupling today

#### Supabase auth is a core dependency

- frontend auth provider uses Supabase sessions in `computer/apps/frontend/src/components/AuthProvider.tsx:29`
- token injection is Supabase-based in `computer/apps/frontend/src/lib/auth-token.ts:47`
- Next middleware depends on Supabase SSR cookies in `computer/apps/frontend/src/middleware.ts:210`
- backend auth verification depends on Supabase JWT checks in `computer/kortix-api/src/middleware/auth.ts:72`
- owner bootstrap uses Supabase admin APIs in `computer/kortix-api/src/setup/index.ts:380`

#### DB-backed state is required for much more than channels

- sandbox/account lifecycle in `computer/kortix-api/src/platform/routes/account.ts:96`
- sandbox ensure/reactivation in `computer/kortix-api/src/platform/services/ensure-sandbox.ts:18`
- account resolution in `computer/kortix-api/src/shared/resolve-account.ts:17`
- server registry in `computer/kortix-api/src/servers/index.ts:32`
- tunnels in `computer/kortix-api/src/tunnel/index.ts:71`
- many routes assume DB availability through `computer/kortix-api/src/shared/db.ts:20`

#### Frontend still assumes backend-owned sandbox lifecycle

- platform client goes through `/platform/*` in `computer/apps/frontend/src/lib/platform-client.ts:1`
- sandbox URLs are derived through backend `/p/*` proxy in `computer/apps/frontend/src/lib/platform-client.ts:47`
- preview auth assumes `POST /v1/p/auth` in `computer/apps/frontend/src/hooks/use-authenticated-preview-url.ts:13`
- setup/onboarding uses `/setup/*` and `/billing/*` routes in `computer/apps/frontend/src/app/setting-up/page.tsx:96`

So the blockers are broader than channels:

- auth
- session model
- sandbox lifecycle
- preview proxy
- persistent state
- billing/setup flows in the frontend

## Target Product Split

## A. `Computer Instance` (standalone runtime)

This is the thing a user installs locally, on a VPS, or on-prem.

It should own:

- local auth and sessions
- local users/accounts for the instance
- sandbox/provider lifecycle
- preview proxy and port ingress
- local secrets/provider config
- local queue/background jobs
- local env/config management
- file/LSP/PTY/OpenCode access
- local API keys
- local server metadata if needed
- optional direct LLM/provider usage with local secrets

This is the runtime the frontend should connect to directly.

## B. `Cloud Control Plane`

This is optional.

It should own:

- fleet registry of attached Computers
- billing/licensing/subscriptions
- hosted provider-key proxying ("overarching API keys")
- remote tunnels and fleet-level access policies
- org/team management
- hosted integrations/channels if you want them centralized
- monitoring, telemetry, update coordination, backups, support tooling

It should **not** be required for a standalone Computer to function.

## C. Shared frontend

The frontend should work against either:

- a direct standalone instance URL
- a cloud-managed instance URL/tunnel

The frontend should not care whether the active target is local, self-hosted, or cloud-managed once it has:

- a base URL
- an auth strategy
- a capability manifest

## What This Should Look Like

## Standalone mode

```text
Browser Frontend
    |
    v
Computer Instance (`computerd` / instance API)
    |- local auth/session service
    |- local DB/state
    |- preview proxy / ingress
    |- OpenCode / runtime bridge
    |- provider orchestration
    |- local secrets/config
    |- optional local LLM/provider adapters
```

No cloud dependency required.

## Managed mode

```text
Browser Frontend ---------------------------> Computer Instance
         |                                         ^
         |                                         |
         +---- Cloud Control Plane <---------------+
                |- billing/licensing
                |- fleet registry
                |- tunnels / remote ops
                |- hosted API key proxy
                |- org management
```

The cloud augments the instance, but the instance still works if the cloud is temporarily unavailable.

## Cloud-hosted mode

Same instance runtime, but deployed by you and registered to your cloud stack by default.

## What the Frontend Needs to Change

Today the frontend is only partly "connect to any server" aware.

### What already helps

- OpenCode SDK client is base-URL driven in `computer/apps/frontend/src/lib/opencode-sdk.ts:32`
- server switching/custom URLs already exist in `computer/apps/frontend/src/stores/server-store.ts:258`

This is the strongest existing seam for direct instance connections.

### What has to be split

#### 1. Auth layer

Current problem:

- auth is globally Supabase-specific in `computer/apps/frontend/src/components/AuthProvider.tsx:29`
- `authenticatedFetch` always expects a Supabase token in `computer/apps/frontend/src/lib/auth-token.ts:47`

Target:

- `CloudAuthProvider`
- `InstanceAuthProvider`

The frontend must stop assuming one universal auth backend.

#### 2. Platform lifecycle UI

Current problem:

- `computer/apps/frontend/src/lib/platform-client.ts:1` assumes a central backend owns sandbox lifecycle

Target:

- cloud mode keeps a cloud lifecycle client
- standalone mode talks directly to the instance lifecycle API
- many screens should not care which one is active once a capability manifest is loaded

#### 3. Preview/port routing

Current problem:

- preview URLs are derived from backend `/p/*` routes in `computer/apps/frontend/src/lib/platform-client.ts:47`
- preview auth assumes `POST /v1/p/auth` in `computer/apps/frontend/src/hooks/use-authenticated-preview-url.ts:13`

Target:

- preview proxy remains, but it lives on the instance
- frontend derives preview URLs from the active instance base URL

#### 4. Setup/onboarding

Current problem:

- setup and setting-up flows mix local setup with billing/cloud provisioning in `computer/apps/frontend/src/app/setting-up/page.tsx:96` and `computer/apps/frontend/src/components/auth/self-hosted-auth.tsx:138`

Target:

- standalone onboarding = direct instance bootstrap only
- cloud onboarding = billing + fleet + managed provisioning only

#### 5. Custom server registry

Current problem:

- server entries sync through `/servers` in `computer/apps/frontend/src/stores/server-store.ts:128`

Target:

- standalone: keep server list entirely local in browser storage
- cloud: optionally sync server registry to cloud account

## The API Shape Needed For Direct Frontend -> Computer

Every standalone instance should expose a small stable instance API.

Recommended top-level split:

- `/instance/meta` - version, mode, capabilities, auth methods
- `/instance/auth/*` - login/logout/session/device auth
- `/instance/runtime/*` - health, services, env, ports, local status
- `/instance/sandbox/*` - lifecycle, provider state, SSH, secrets, API keys
- `/instance/preview/*` or `/p/*` - preview proxy and preview auth
- `/instance/files/*` / `/file/*` - file APIs
- `/instance/lsp/*` - diagnostics
- `/instance/triggers/*` - cron/webhook/triggers if local
- OpenCode SDK endpoints remain on the same instance URL

The frontend should first call `GET /instance/meta` and use that to decide:

- auth method
- whether billing exists
- whether cloud is attached
- whether previews are proxied or direct
- whether channels/integrations exist

## Recommended Capability Manifest

Example:

```json
{
  "mode": "standalone",
  "instance_id": "cmp_123",
  "version": "0.9.0",
  "auth": {
    "methods": ["local_password", "api_key"],
    "provider": "instance"
  },
  "features": {
    "sandbox_lifecycle": true,
    "preview_proxy": true,
    "billing": false,
    "channels": false,
    "integrations": false,
    "tunnel": false,
    "cloud_attach": true,
    "hosted_model_proxy": true
  },
  "cloud": {
    "attached": false
  }
}
```

This removes a lot of environment-specific branching from the frontend.

## How Complexity Goes Down

### 1. Fewer mixed concerns in one backend

Right now `kortix-api` mixes:

- self-hosted bootstrap
- cloud billing
- local provider orchestration
- preview proxy
- tunnel service
- channels
- hosted integrations
- org/admin logic

Splitting instance runtime from cloud control plane gives each side one job.

### 2. Frontend becomes target-driven instead of deployment-driven

Instead of "if cloud use X, if self-hosted use Y, if local use Z", the frontend can do:

- connect to target
- read capabilities
- load the right auth strategy
- speak to the target directly

That is a much simpler mental model.

### 3. Supabase stops infecting the whole product

Once auth is split:

- standalone can use instance-native auth
- cloud can keep Supabase or any hosted auth provider behind the cloud layer

That dramatically reduces cross-cutting coupling.

### 4. Cloud features become add-ons, not blockers

Billing, channels, integrations, tunnels, and org logic can all exist without making standalone boot depend on them.

### 5. A single binary becomes realistic

If the standalone runtime owns its own API and state, you can package it as one appliance binary:

- embedded local control plane
- embedded frontend assets
- embedded migrations/config/bootstrap
- managed child services for sandbox/OpenCode/runtime pieces

That is much cleaner than "self-hosted app that still expects a hosted auth/control stack".

## Recommended Simplification Strategy

Do **not** try to solve all of this in one rewrite.

### Phase 1: Define the split clearly

Create two conceptual surfaces:

- `instance API`
- `cloud API`

Before moving code, classify every current `kortix-api` route into one of:

- must live on instance
- cloud only
- optional plugin/adapter

### Phase 2: Decouple frontend auth from Supabase

This is the highest-leverage simplification.

Introduce an auth abstraction in the frontend so the active target decides the auth mechanism.

### Phase 3: Move self-hosted lifecycle and preview to the instance surface

Anything needed to boot, manage, and use a standalone Computer should stop going through a central backend contract.

### Phase 4: Make server selection fully local-first

Custom servers and standalone instances should not require `/servers` cloud sync.

### Phase 5: Shrink cloud responsibilities

Keep in cloud only what is truly platform-level:

- billing
- fleet management
- tunnel/remote access
- hosted provider keys / usage proxy
- org/admin/platform operations

### Phase 6: Package the instance runtime as the product

This is where the single-binary story becomes clean.

## Proposed Final Ownership

## Instance runtime (`computerd`)

- auth/session
- instance metadata/capabilities
- preview proxy
- sandbox lifecycle
- local provider config/secrets
- local queue/background jobs
- local state DB
- local files/LSP/env/triggers
- direct OpenCode/runtime connectivity

## Cloud control plane (`kortix-cloud-api`)

- subscriptions/billing
- hosted provider-key proxy
- fleet registry
- tunnels and remote management
- hosted integrations/channels if desired
- org/team/admin/support tooling

## Frontend

- connects to whichever target the user chooses
- discovers auth + capabilities from the target
- uses instance URL directly for runtime operations
- optionally uses cloud for account/fleet/platform views

## What Should Probably Stay Optional Or Deferred

To reduce complexity, do not make these part of the first standalone-core rewrite:

- channels
- Pipedream/integrations
- cloud billing
- access gating
- claim/import OAuth flows
- complex admin tooling
- deployment APIs

Get the core loop right first:

- connect
- authenticate
- manage sandbox/runtime
- use the product directly

## Recommended End State

The clean architecture is:

- `Computer` is the product and runs standalone
- cloud is a management layer on top
- frontend talks directly to the active Computer instance
- cloud only exists when the user wants platform services

That is the architecture that best supports:

- simplification
- lower coupling
- binary distribution
- self-hosting credibility
- managed-fleet/cloud offerings later

## Practical Recommendation

If the goal is to reduce complexity fast, the first concrete move should be:

1. stop treating Supabase auth as the universal auth system
2. define an explicit `instance API` contract
3. move standalone lifecycle/preview/setup fully onto that instance API
4. make the frontend connect to active instance URL + capabilities
5. keep cloud billing/tunnel/provider-proxy as optional overlays

That gives you the biggest simplification without requiring an immediate total rewrite of everything else.
