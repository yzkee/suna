# Optimal CI/CD for Kortix Computer

## Your Product Has Two Completely Different Release Cadences

**Artifact 1 — Your infrastructure (API + Frontend)**
- Runs on YOUR servers (VPS + Vercel)
- You can deploy/rollback instantly, 10x/day
- Users never see version numbers for this
- Version doesn't matter, uptime does

**Artifact 2 — The Sandbox (Docker image + OTA + JustAVPS snapshot)**
- Runs on USER machines and user-provisioned cloud instances
- Users see the version, choose when to update
- Can't roll back easily once users have it
- Every `pnpm ship` version is a public release to all users

**These should NOT share a release pipeline.** Coupling them (as today) means you can't hotfix your API without building sandbox images, and you can't iterate on sandbox changes without deploying your API.

---

## Recommended Flow: Single Branch, Two Tracks

```
main (only branch)
  │
  │  every push
  ├─────────────────────────► dev-new-api.kortix.com  (auto, CI)
  │                           dev-new.kortix.com       (auto, Vercel)
  │
  │  manual: deploy-prod
  ├─────────────────────────► new-api.kortix.com       (on-demand, CI)
  │                           new.kortix.com            (Vercel prod)
  │
  │  manual: pnpm ship 0.9.0
  └─────────────────────────► kortix/computer:0.9.0    (Docker Hub)
                              kortix/computer:latest
                              GitHub Release v0.9.0
                              JustAVPS snapshot
                              OTA available to users
```

> **Domain cutover (planned):** Once stable, we switch to the final domains:
> - `new-api.kortix.com` → `api.kortix.com`
> - `new.kortix.com` → `kortix.com`
> - `dev-new-api.kortix.com` → `dev-api.kortix.com`
> - `dev-new.kortix.com` → `dev.kortix.com`
>
> This is a DNS-only change — no infra or CI/CD changes needed.

### Track 1: API + Frontend (Continuous Deployment)

```
push to main
  └─► deploy-api.yml (auto)
        └─► SSH → dev VPS → docker compose build+up
            dev-new-api.kortix.com ✓

ready for prod?
  └─► gh workflow run deploy-prod (manual button)
        └─► SSH → prod VPS → docker compose build+up
            new-api.kortix.com ✓
```

- Deploy API to prod whenever you want — daily, hourly, doesn't matter
- No version numbers, no changelog needed
- Rollback = re-run the workflow on a previous commit
- Frontend is Vercel, already auto-deploys from main

### Track 2: Sandbox Release (Versioned, Gated)

```
developer decides it's release-worthy
  └─► pnpm ship 0.9.0
        ├─► Validates CHANGELOG.json entry (existing gate)
        ├─► Bumps version in 4 files
        ├─► Builds 3 Docker images (amd64+arm64)
        │     kortix/computer:0.9.0 + :latest
        │     kortix/kortix-api:0.9.0 (for self-hosters)
        │     kortix/kortix-frontend:0.9.0 (for self-hosters)
        ├─► Creates GitHub Release v0.9.0
        ├─► Seeds JustAVPS snapshot
        ├─► Commits version bump
        └─► You push, done

Users see update:
  - Self-hosted: sidebar shows "Update available" → pulls new image
  - Cloud (JustAVPS): new sandboxes auto-use latest snapshot
  - curl | bash: installs latest version
```

---

## Why This Is Optimal For Your Product

1. **API deploys are decoupled from releases.** You can push 30 API fixes between sandbox releases. Users don't care, their sandbox version stays stable.

2. **`pnpm ship` remains the single release gate.** No accidental public releases. Changelog is enforced. One command does everything.

3. **No branches to manage.** No staging branch, no promotion workflow, no merge conflicts. `main` is truth.

4. **Dev environment is always current.** Every push lands on `dev-new-api.kortix.com` — test there before deploying to prod or shipping.

5. **Prod API deploy is independent.** API hotfix at 2am? `gh workflow run deploy-prod`. No need to ship a new sandbox version.

6. **Backward compatibility is natural.** API must work with current sandbox version anyway (users on old versions). This is already true.

---

## What Changes From Today

| What | Before | After |
|---|---|---|
| Branches | main + staging + PRODUCTION | **main only** |
| API deploy (dev) | manual SSH or staging push | **auto on every push** |
| API deploy (prod) | deploy-eks.yml (EKS) | **manual workflow dispatch** |
| Sandbox release | `pnpm ship` (unchanged) | `pnpm ship` **(unchanged)** |
| Promote workflow | main→staging→production | **deleted** |
| EKS | Pulumi + deploy-eks + sync-secrets | **deleted** |
| Environments | 3 (dev/staging/prod) | **2 (dev/prod)** |
| Monthly cost | ~$1,000+ | **$24** |

---

## Concrete Deliverables

**2 workflows:**
- `deploy-api.yml` — push to main → auto-deploy dev; workflow_dispatch → deploy prod
- *(no second workflow needed — `ship.cjs` handles sandbox releases directly)*

**2 VPS instances:**
- `kortix-dev` → `dev-new-api.kortix.com` (later: `dev-api.kortix.com`)
- `kortix-prod` → `new-api.kortix.com` (later: `api.kortix.com`)

**Delete:** `kortix-staging` instance, `promote.yml`, staging GH environment

**Update:** `docs/development-release-guide.md` Release Flow section (minor edit)

`ship.cjs` stays almost untouched — it already does everything right for sandbox releases.

---

## Current Infrastructure

### Lightsail Instances (us-west-2)

| Instance | Static IP | Size | Cost/mo | Purpose |
|---|---|---|---|---|
| `kortix-dev` | `52.43.117.187` | small (2 vCPU / 2GB) | $12 | Dev API |
| `kortix-prod` | `44.247.194.29` | small (2 vCPU / 2GB) | $12 | Prod API |
| `kortix-staging` | `52.42.64.222` | small (2 vCPU / 2GB) | $12 | **To be deleted** |

### DNS Records Needed (Cloudflare → kortix.com)

**Now (transitional):**

| Type | Name | Content | Proxy |
|---|---|---|---|
| A | `dev-new-api` | `52.43.117.187` | Proxied |
| A | `new-api` | `44.247.194.29` | Proxied |

**After cutover (update DNS, same IPs):**

| Type | Name | Content | Proxy |
|---|---|---|---|
| A | `dev-api` | `52.43.117.187` | Proxied |
| A | `api` | `44.247.194.29` | Proxied |

### GitHub Environments

| Environment | Secrets | Purpose |
|---|---|---|
| `dev` | `VPS_HOST`, `VPS_USERNAME`, `VPS_SSH_KEY` | Auto-deploy on push to main |
| `prod` | `VPS_HOST`, `VPS_USERNAME`, `VPS_SSH_KEY` | Manual deploy via workflow dispatch |
