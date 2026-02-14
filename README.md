# Kortix

Open-source autonomous computer use agent. Turn any computer into an AI computer.

## One-Click Install

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/kortix-ai/computer/main/scripts/get-kortix.sh)
```

That's it. The installer checks prerequisites, clones the repo, prompts for your API keys, and starts everything.

### What you need

- [Docker Desktop](https://docs.docker.com/get-docker/) (includes Docker Compose v2)
- [Git](https://git-scm.com/downloads)

### What it does

1. Clones Kortix to `~/kortix`
2. Prompts for API keys in your terminal (Anthropic, OpenAI, etc.)
3. Prompts for sandbox credentials (username/password)
4. Writes `.env` files
5. Starts all services via Docker Compose

### After install

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| API | http://localhost:8008 |
| Sandbox | http://localhost:14000 |

## CLI Reference

After installing, manage Kortix with the `kortix` CLI:

```bash
kortix start       # Start all services
kortix stop        # Stop all services
kortix restart     # Restart all services
kortix logs        # Tail logs (or: kortix logs sandbox)
kortix status      # Show service status + configured keys
kortix setup       # Re-configure API keys
kortix update      # Pull latest + rebuild
```

## Non-Interactive Install

For CI/scripted environments, pass a pre-configured `.env` file:

```bash
kortix install --env-file /path/to/.env
```

Or from a fresh clone:

```bash
bash scripts/install.sh --env-file /path/to/.env
```

## Managing API Keys

### Via CLI

```bash
kortix setup
```

Interactive terminal prompts for all keys.

### Via Frontend

Open the dashboard at http://localhost:3000, click your avatar in the sidebar, and select **Local .Env Manager**. This uses the same backend API (`/v1/setup/*`) and supports:

- LLM Providers (Anthropic, OpenAI, OpenRouter, Gemini, Groq, xAI)
- Tool Providers (Tavily, Serper, Firecrawl, Replicate, ElevenLabs, Context7)
- Sandbox Settings (username, password)

Changes are saved to `.env` and distributed to all services automatically.

## Architecture

```
apps/
  frontend/          Next.js dashboard UI                  :3000
services/
  kortix-api/        Unified Bun/Hono backend              :8008
  opencode/          Agent framework (inside sandbox)
  lss/               Local semantic search (inside sandbox)
packages/
  db/                Shared database layer (Drizzle ORM)
sandbox/             Docker sandbox config + .env
```

## Service Ports (Local Docker)

| Host Port | Container Port | Service |
|-----------|---------------|---------|
| 3000 | 3000 | Frontend |
| 8008 | 8008 | Kortix API |
| 14000 | 8000 | Sandbox (master proxy) |
| 14001 | 3111 | OpenCode Web UI |
| 14002 | 6080 | Desktop (noVNC) |
| 14003 | 6081 | Desktop (HTTPS) |
| 14004 | 3210 | Presentation Viewer |
| 14005 | 9223 | Agent Browser Stream |
| 14006 | 9224 | Agent Browser Viewer |

## License

See [LICENSE](LICENSE) for details.
