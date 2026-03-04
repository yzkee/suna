---
name: web-service-deployments
description: "Unified web-service deployment playbook for Vercel, Cloudflare, Fly.io, Railway, and Render using their CLIs. Use when the user asks to deploy an app/API/static site/container, set up production hosting, configure domains/SSL, set env vars/secrets, stream logs, rollback, or automate deploys from terminal workflows. Focuses on one-time CLI auth, repeatable deploy commands, and a low-friction developer experience."
---

# Web-Service Deployments

Use this skill for real production hosting and preview deploys through provider CLIs.

## Goal

- Authenticate once with a provider CLI.
- Keep deployment commands short and repeatable.
- Prefer provider-native workflows over custom wrappers.
- Leave users with clear `deploy`, `logs`, and `rollback` commands.

## Provider Selection

Pick the smallest platform that fits the runtime:

- **Vercel**: Next.js, React/Vite frontends, Node APIs, edge/serverless routes.
- **Cloudflare**: Workers, Pages, static + edge logic, very fast global edge deploys.
- **Fly.io**: Docker/container workloads, long-running services, background workers.
- **Railway**: Full-stack apps and databases with fast DX and easy service linking.
- **Render**: Simple web services, static sites, and cron jobs with predictable setup.

If user does not care, default to:

1. Vercel for frontend + Node web apps.
2. Fly.io for containers and custom runtime control.
3. Cloudflare for edge-first apps.

## Core Workflow (Always)

1. Detect app type (`package.json`, framework, Dockerfile, output dir).
2. Check/install provider CLI.
3. Run one-time login.
4. Link/init project metadata.
5. Set env vars and secrets before production deploy.
6. Deploy preview first when possible.
7. Promote to production.
8. Capture logs and health-check URL.
9. Document exact rerun commands.

## CLI Playbooks

### Vercel CLI

```bash
pnpm dlx vercel@latest login
pnpm dlx vercel@latest link
pnpm dlx vercel@latest env add
pnpm dlx vercel@latest
pnpm dlx vercel@latest --prod
pnpm dlx vercel@latest logs
```

Use for frontend/serverless projects. Prefer `pnpm dlx`/`npx` over global install for reproducibility.

### Cloudflare CLI (Wrangler)

```bash
pnpm dlx wrangler@latest login
pnpm dlx wrangler@latest deploy
pnpm dlx wrangler@latest pages deploy dist --project-name <project-name>
pnpm dlx wrangler@latest secret put <KEY>
pnpm dlx wrangler@latest tail
```

Use Workers for runtime logic and Pages for static/SSR workflows.

### Fly.io CLI

```bash
fly auth login
fly launch --no-deploy
fly secrets set KEY=value
fly deploy
fly status
fly logs
fly releases
```

Primary choice for Docker/container services and stateful networking.

### Railway CLI

```bash
railway login
railway link
railway variables set KEY=value
railway up
railway logs
```

Use for fast app + service composition with minimal infra setup.

### Render Blueprint CLI/API Flow

Render is commonly driven by dashboard + `render.yaml` and API calls. If CLI is required in-session:

- authenticate once with Render API key (`RENDER_API_KEY`),
- keep infra as code in `render.yaml`,
- trigger deploys via API or linked Git pushes,
- verify with service logs + health endpoint.

## Secrets and Env Rules

- Never hardcode secrets in repo files.
- Set secrets through provider env/secret commands.
- Split build-time vs runtime variables where platform requires it.
- After setting secrets, redeploy and validate with logs.

## Verification Checklist

After every deploy:

1. Open deployment URL and confirm 200/expected response.
2. Verify logs show clean startup.
3. Confirm required env vars exist in provider config.
4. Run a smoke test route (`/health`, `/api/health`, or homepage).
5. Record rollback command path.

## Rollback Patterns

- **Vercel**: promote previous deployment from dashboard/CLI workflow.
- **Cloudflare**: redeploy last known-good Worker/Pages artifact.
- **Fly.io**: rollback to previous release from `fly releases`.
- **Railway/Render**: redeploy prior successful build.

## Agent Behavior

When user asks to deploy:

- infer best provider from runtime and repo structure,
- run provider CLI flow end-to-end,
- keep commands copy-pasteable,
- return deployed URL, logs command, and rollback command,
- if credentials are missing, request only the minimal auth input once.

## Output Contract

At the end of deployment work, always provide:

- Provider used and why.
- Exact deploy command used.
- Production URL.
- Logs command.
- Rollback command.
