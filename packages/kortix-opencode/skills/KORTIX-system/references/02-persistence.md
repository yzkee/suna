# Persistence Model

What survives restarts, where to store files, and how to install packages safely.

---

## Core Rule

Only `/workspace` persists across container restarts and image updates. Everything else is ephemeral.

---

## What Persists

| What | Path |
|------|------|
| User files, repos, data | `/workspace/*` |
| Installed skills | `/workspace/.opencode/skills/` |
| Secrets | `/workspace/.secrets/` |
| Agent memory & sessions | `/workspace/.local/share/opencode/` |
| Browser profile | `/workspace/.browser-profile/` |
| Semantic search index | `/workspace/.lss/` |
| Sandbox state | `/workspace/.kortix/` |
| pip packages | `/workspace/.local/lib/python3.*/` |
| npm global packages | `/workspace/.npm-global/` |
| Project packages | `/workspace/<project>/node_modules/` |
| apk package manifest | `/workspace/.kortix/packages/apk-packages.txt` |

## What Does NOT Persist

| What | Path |
|------|------|
| Raw `apk add` installs | `/usr/bin/`, `/usr/lib/` |
| System config changes | `/etc/` |
| Files in `/opt/`, `/tmp/`, `/root/` | Various |

---

## Safe Installation Patterns

```bash
pip install requests pandas flask           # Auto-persists to /workspace/.local/
npm install -g typescript ts-node prettier   # Auto-persists to /workspace/.npm-global/
apk-persist ffmpeg imagemagick sqlite        # Persists manifest, restored on boot
apk-persist --list                           # Show installed persistent packages
```

---

## Boot Flow

1. `/workspace` is reattached
2. pip packages already exist in `/workspace/.local/`
3. npm globals already exist in `/workspace/.npm-global/`
4. Saved apk packages reinstalled from manifest
5. PATH includes persistent bin directories automatically

---

## Persistence Environment Variables

| Variable | Value | Effect |
|---|---|---|
| `PYTHONUSERBASE` | `/workspace/.local` | pip writes to persistent storage |
| `PIP_USER` | `1` | Forces user-mode pip installs |
| `NPM_CONFIG_PREFIX` | `/workspace/.npm-global` | npm globals persist |
| `PATH` | Includes persistent bin dirs | Commands remain available |

---

## Rule of Thumb

If a file should survive restarts → put it under `/workspace`. Plans, notes, scripts, generated outputs, and long-lived config all belong there.
