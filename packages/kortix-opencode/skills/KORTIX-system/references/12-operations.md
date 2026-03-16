# Operations and Debugging

Init scripts, health checks, service management, common issues, and Docker development.

---

## Slash Commands

| Command | File | Purpose |
|---|---|---|
| `/onboarding` | `onboarding.md` | First-run onboarding flow |

---

## Init Scripts

| Order | File | Purpose |
|---|---|---|
| 95 | `95-setup-sshd` | SSH daemon, remote-editor wrapper, shell config |
| 96 | `96-fix-bun-pty` | Patches bun-pty shared libraries |
| 97 | `97-secrets-to-s6-env` | Syncs encrypted secrets into s6 env |
| 98 | `98-kortix-env` | Applies crash-protection env guards |
| 99 | `99-restore-packages` | Restores apk packages and persistent PATH entries |

---

## Health and Service Checks

```bash
# Check running services
ps aux | grep -E "(opencode|kortix-master|lss-sync|bun)"
ls /run/service/

# Health endpoints
curl http://localhost:8000/kortix/health
curl http://localhost:8000/lss/status
curl http://localhost:3456/health           # Channels service
```

### Restart OpenCode

Kill the process and let `s6` bring it back:

```bash
kill $(pgrep -f "opencode serve")
```

---

## Common Issues

| Problem | Fix |
|---|---|
| `opencode` not found | Ensure PATH includes `/opt/bun/bin:/usr/local/bin:/usr/bin:/bin` |
| bun-pty segfaults | Verify `BUN_PTY_LIB` and rerun `96-fix-bun-pty` logic |
| Secrets not visible | Set through `localhost:8000/env` with `restart: true` |
| Cloud SDK calls fail | Verify `KORTIX_API_URL` |
| Integration tools fail | Verify `KORTIX_TOKEN` and app connection state |
| Channels not responding | `curl http://localhost:3456/health`, check adapter credentials |
| Tunnel offline | Ask user to reconnect their local tunnel client |
| lss not indexing | Check `lss status`, verify `LSS_DIR=/workspace/.lss` |

---

## Docker Development

```bash
docker compose -f sandbox/docker/docker-compose.yml up --build -d
docker compose -f sandbox/docker/docker-compose.yml logs -f
docker exec -it kortix-sandbox bash
docker exec -it -u abc kortix-sandbox bash
```

### Volume Model

| Volume | Mount | Purpose |
|---|---|---|
| `sandbox_data` | `/workspace` + `/config` | Persistent user and runtime data |

### Resource Notes

- `shm_size: 2gb` for Chromium
- `cap_add: SYS_ADMIN` for PID namespace behavior
- `security_opt: seccomp=unconfined` for Chromium sandbox compatibility
