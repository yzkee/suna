# Kortix Computer — CI/CD Architecture

> **Status: Implemented and verified end-to-end.**

---

## Overview: Single Branch, Two Tracks

All development happens on `main`. The API/Frontend deploy continuously. Sandbox releases are versioned and gated via `pnpm ship`.

```
main (only branch)
  │
  │  every push (auto)
  ├─────────────────────────► dev-new-api.kortix.com    (GH Actions → Lightsail)
  │                           dev-new.kortix.com         (Vercel auto-deploy)
  │
  │  manual: gh workflow run deploy-api.yml -f target=prod
  ├─────────────────────────► new-api.kortix.com         (GH Actions → Lightsail)
  │                           new.kortix.com              (Vercel — same build)
  │
  │  manual: pnpm ship <version>
  └─────────────────────────► kortix/computer:<version>  (Docker Hub)
                              GitHub Release v<version>
                              JustAVPS snapshot
                              OTA available to all users
```

> **Domain cutover (planned):** When ready, just update DNS:
> - `new-api.kortix.com` → `api.kortix.com`
> - `new.kortix.com` → `kortix.com`
> - `dev-new-api.kortix.com` → `dev-api.kortix.com`
> - `dev-new.kortix.com` → `dev.kortix.com`
>
> No infra or code changes needed — DNS only.

---

## Track 1: API + Frontend (Continuous Deployment)

**Deploy to dev** — automatic on every push to `main` (when `kortix-api/`, `packages/`, or `scripts/compose/` change):
```bash
# Happens automatically via GH Actions
```

**Deploy to prod** — manual:
```bash
gh workflow run deploy-api.yml -f target=prod --repo kortix-ai/computer
```

**Rollback** — re-run the workflow targeting a previous commit.

**Frontend** — Vercel auto-deploys from `main`. Both `new.kortix.com` (prod) and `dev-new.kortix.com` (dev) serve the same production build. A runtime hostname check in `env-config.ts` routes the dev domain to the dev API.

---

## Track 2: Sandbox Release (Versioned, Gated)

```bash
# 1. Add changelog entry to sandbox/CHANGELOG.json
# 2. Ship:
pnpm ship 0.9.0
# 3. Push the version-bump commit:
git push
```

`pnpm ship` validates the changelog, bumps versions, builds 3 multi-arch Docker images, creates a GitHub Release, and seeds a JustAVPS snapshot. Users see the update in their sidebar.

---

## Infrastructure

### Lightsail Instances (us-west-2)

| Instance | Static IP | Size | Cost/mo | Purpose |
|---|---|---|---|---|
| `kortix-dev` | `52.43.117.187` | small (2 vCPU / 2GB) | $12 | Dev API |
| `kortix-prod` | `44.247.194.29` | small (2 vCPU / 2GB) | $12 | Prod API |

**Total: $24/mo** (down from ~$1,000+/mo with EKS + old suna instances)

Each instance runs:
- **nginx** with Cloudflare Origin CA cert (TLS termination, 15-year cert)
- **Docker Compose** with the `backend` profile (kortix-api on port 8008)
- **Deploy keys** for `kortix-ai/computer` repo access

### Cloudflare DNS

| Type | Name | Content | Mode |
|---|---|---|---|
| A | `dev-new-api` | `52.43.117.187` | Proxied (SSL strict) |
| A | `new-api` | `44.247.194.29` | Proxied (SSL strict) |
| CNAME | `dev-new` | `cname.vercel-dns.com` | DNS-only |
| CNAME | `new` | `cname.vercel-dns.com` | DNS-only |

### GitHub Actions

**Workflow:** `.github/workflows/deploy-api.yml`
- Push to `main` → auto-deploy to `dev` environment
- `workflow_dispatch` with `target: prod` → deploy to `prod` environment

**Environments** (`dev`, `prod`): each has `VPS_HOST`, `VPS_USERNAME`, `VPS_SSH_KEY` secrets.

### Vercel (`computer-frontend`)

**Domains:** `new.kortix.com` (prod), `dev-new.kortix.com` (dev)

**Per-environment env vars:**

| Variable | Production | Development/Preview |
|---|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | `https://new-api.kortix.com/v1` | `https://dev-new-api.kortix.com/v1` |
| `NEXT_PUBLIC_URL` | `https://new.kortix.com/` | `https://dev-new.kortix.com/` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://jbriwassebxdwoieikga.supabase.co` | `https://heprlhlltebrxydgtsjs.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | PROD BABY anon key | Kortix DEV anon key |
| `NEXT_PUBLIC_ENV_MODE` | `cloud` | `cloud` |

### Supabase Projects

| Project | Ref | Used By |
|---|---|---|
| **Kortix PROD** | `jbriwassebxdwoieikga` | Prod Lightsail, Prod Vercel |
| **Kortix DEV** | `heprlhlltebrxydgtsjs` | Dev Lightsail, Dev Vercel, local dev |

### Lightsail VPS Env Vars

**Prod** (`kortix-prod`): 76 env vars sourced from `suna-env-prod` (AWS Secrets Manager) + `kortix/prod/api-config`. Connects to PROD Supabase, live Stripe keys, production JustAVPS, Redis (Upstash), Sentry, etc.

**Dev** (`kortix-dev`): 52 env vars from `kortix/prod/api-config` with DEV Supabase overlay. Test Stripe keys, dev JustAVPS URL.

---

## What Was Deleted

| What | Why |
|---|---|
| `.github/workflows/deploy-eks.yml` | Replaced by Lightsail VPS deploy |
| `.github/workflows/sync-secrets.yml` | EKS-only (ExternalSecrets) |
| `.github/workflows/promote.yml` | No more branch promotion (single branch) |
| `infra/prod/` (entire Pulumi stack) | EKS cluster, VPC, ALB, IAM, etc. — all gone |
| `suna-prod` Lightsail (128GB, $884/mo) | Stopped, unused |
| `kortix-staging` Lightsail | Not needed (2-env model) |
| 3 static IPs released | Freed quota |

---

## Quick Reference

```bash
# Deploy API to dev (automatic on push, or manual):
gh workflow run deploy-api.yml -f target=dev --repo kortix-ai/computer

# Deploy API to prod:
gh workflow run deploy-api.yml -f target=prod --repo kortix-ai/computer

# Ship a new sandbox release to all users:
pnpm ship 0.9.0
git push

# Validate release state:
pnpm check

# Local dev (starts Supabase + API + frontend):
pnpm dev
```
