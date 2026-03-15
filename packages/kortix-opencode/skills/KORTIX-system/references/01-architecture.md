# Kortix Sandbox Architecture

Container image, filesystem layout, services, ports, authentication, and runtimes.

---

## Container Image

- **Base:** `lscr.io/linuxserver/webtop:latest` (Alpine Linux + XFCE + noVNC)
- **Process manager:** `s6-overlay` v3 with `s6-rc.d`
- **Entry point:** `/opt/startup.sh` → `exec unshare --pid --fork /init`
- **User:** `abc` (UID 1000); services run via `s6-setuidgid abc`

---

## Key Paths

| Path | Purpose | Persists? |
|------|---------|-----------|
| `/workspace/` | Persistent Docker volume — all user files | Yes |
| `/workspace/.opencode/` | User-installed OpenCode config & skills | Yes |
| `/workspace/.opencode/skills/` | Marketplace-installed skills | Yes |
| `/workspace/.secrets/` | AES-256-GCM encrypted secret storage | Yes |
| `/workspace/.kortix/` | Sandbox state, update status | Yes |
| `/workspace/.local/share/opencode/` | Agent memory, sessions, SQLite DB | Yes |
| `/workspace/.lss/` | Semantic search index | Yes (rebuilt if missing) |
| `/workspace/.browser-profile/` | Chrome data | Yes |
| `/opt/opencode/` | Built-in agents, tools, skills, plugins, commands | No (image-baked) |
| `/opt/kortix-master/` | Reverse proxy and secret store server | No |

---

## Projects

A project is a git repository detected automatically by OpenCode.

**Detection:** Walk upward from CWD looking for `.git` → read first root commit SHA (`git rev-list --max-parents=0 --all`) → use as stable project ID → cache in `.git/opencode`. Falls back to `id: "global"`.

**Properties:** Renaming/moving a repo keeps the same ID. Cloning same history elsewhere produces the same ID. Sessions are scoped to projects via `projectID`.

| Method | Route | Description |
|---|---|---|
| `GET` | `/project` | List projects, trigger workspace scan |
| `GET` | `/project/current` | Resolve project from current directory |
| `PATCH` | `/project/:projectID` | Update name, icon, commands |

---

## Services and Ports

All managed by `s6-rc.d`:

| Service | Internal Port | Host Port | Description |
|---|---|---|---|
| Kortix Master | 8000 | 14000 | Reverse proxy, secret store, public API entry |
| OpenCode Web | 3111 | 14001 | Web UI |
| OpenCode Serve | 4096 | proxied via 8000 | Backend API |
| Desktop (noVNC) | 6080 / 6081 | 14002 / 14003 | XFCE desktop |
| Presentation Viewer | 3210 | 14004 | Slide viewer |
| Static Web Server | 3211 | 14008 | Standalone HTML/assets |
| Agent Browser Stream | 9223 | 14005 | Browser automation WebSocket |
| Agent Browser Viewer | 9224 | 14006 | Browser session viewer UI |
| Channels | 3456 | — | Slack/Telegram/Discord bridge |
| lss-sync | — | — | Semantic search indexer |

### Portless Policy

Always use `portless` for manually started dev servers:

```bash
portless myapp pnpm dev
portless api npm run start
```

Share URLs as `http://<name>.localhost:1355`.

---

## Kortix Master Routes

Kortix Master (`localhost:8000`) handles:

| Route | Purpose |
|---|---|
| `/env/*` | Secret and env management |
| `/api/integrations/*` | OAuth integration proxy |
| `/kortix/health` | Sandbox health check |
| `/kortix/ports` | Port mapping info |
| `/kortix/update` | Self-update endpoint |
| `/kortix/cron/triggers/*` | Cron trigger management |
| `/lss/search`, `/lss/status` | Semantic search HTTP API |
| `/proxy/:port/*` | Dynamic local port proxy |
| `/*` | Catch-all proxy to OpenCode serve (4096) |

---

## Authentication Model

| Token | Direction | Purpose |
|---|---|---|
| `INTERNAL_SERVICE_KEY` | External → sandbox | Authenticate inbound requests |
| `KORTIX_TOKEN` | Sandbox → external | Authenticate outbound calls to Kortix API; also used for secret encryption |

Inside sandbox / localhost: no auth required for Kortix Master.

---

## Core Environment Variables

| Variable | Value / Purpose |
|---|---|
| `OPENCODE_CONFIG_DIR` | `/opt/opencode` |
| `KORTIX_WORKSPACE` | `/workspace` |
| `OPENCODE_FILE_ROOT` | `/` |
| `OPENCODE_PERMISSION` | `{"*":"allow"}` |
| `BUN_PTY_LIB` | `/opt/bun-pty-musl/librust_pty.so` |
| `LSS_DIR` | `/workspace/.lss` |
| `HOME` | `/workspace` |
| `DISPLAY` | `:1` |

### Agent Browser Variables

| Variable | Value |
|---|---|
| `AGENT_BROWSER_EXECUTABLE_PATH` | `/usr/bin/chromium-browser` |
| `AGENT_BROWSER_PRIMARY_SESSION` | `kortix` |
| `AGENT_BROWSER_STREAM_PORT` | `9223` |
| `AGENT_BROWSER_PROFILE` | `/workspace/.browser-profile` |
| `AGENT_BROWSER_SOCKET_DIR` | `/workspace/.agent-browser` |

---

## Runtimes and Tools

| Runtime / Tool | Location |
|---|---|
| Node.js + npm | `/usr/bin/node` |
| Bun | `/opt/bun/bin/bun`, `/usr/local/bin/bun` |
| Python 3 + pip | `/usr/bin/python3` |
| Bash | `/bin/bash` |
| `opencode` | CLI for `serve` and `web` |
| `agent-browser` | Browser automation CLI |
| `ocx` | Marketplace installer |
| `apk-persist` | Persistent Alpine package installer |
| `lss` / `lss-sync` | Semantic search CLI and watcher |
| `portless` | Port manager for dev servers |
