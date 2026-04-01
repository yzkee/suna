# Skill: service-manager

Kortix Master centralized service manager. Use when the agent needs to: list running services, start/stop/restart a service, register a new project app, check service health, read service logs, reconcile the service graph, or trigger a full runtime reload.

Triggers on: 'start service', 'stop service', 'restart service', 'list services', 'register service', 'service status', 'service logs', 'reload instance', 'reconcile services', 'what services are running', 'start my app', 'deploy my app'.

## Architecture

Kortix Master owns ALL service lifecycle — both s6-backed system services and spawned project apps. There is one control plane, one registry, one API.

- **Spawn services**: processes started directly by Kortix Master (OpenCode API, project apps)
- **s6 services**: system daemons supervised by s6, orchestrated by Kortix Master via gate files + s6-rc

## API Reference

Base URL: `http://localhost:8000` (inside sandbox)

### List all services

```bash
curl -s http://localhost:8000/kortix/services?all=true | jq
```

Returns `{ services: [...] }` — each service has: `id`, `name`, `adapter` (spawn/s6), `scope` (bootstrap/core/project/session), `status` (running/stopped/starting/failed/backoff), `desiredState`, `port`, `pid`, `managed`, `builtin`, `autoStart`.

### Get single service

```bash
curl -s http://localhost:8000/kortix/services/{id} | jq
```

### Start / Stop / Restart

```bash
curl -X POST http://localhost:8000/kortix/services/{id}/start
curl -X POST http://localhost:8000/kortix/services/{id}/stop
curl -X POST http://localhost:8000/kortix/services/{id}/restart
```

### Register a new project service

```bash
curl -X POST http://localhost:8000/kortix/services/register \
  -H "Content-Type: application/json" \
  -d '{
    "id": "my-app",
    "name": "My App",
    "adapter": "spawn",
    "scope": "project",
    "sourcePath": "/workspace/my-app",
    "startCommand": "bun server.js",
    "port": 3000,
    "desiredState": "running",
    "autoStart": true,
    "userVisible": true,
    "startNow": true
  }'
```

Required fields: `id`, `startCommand` (for spawn), `sourcePath`.
Optional: `port` (auto-assigned if omitted), `name`, `autoStart`, `desiredState`.

### Remove a project service

```bash
curl -X DELETE http://localhost:8000/kortix/services/{id}
```

Cannot remove built-in services.

### Service logs

```bash
curl -s http://localhost:8000/kortix/services/{id}/logs | jq '.logs[]'
```

### Reconcile (re-sync desired state)

```bash
curl -X POST http://localhost:8000/kortix/services/reconcile
```

### Reload from disk (re-read registry file)

```bash
curl -X POST http://localhost:8000/kortix/services/reconcile?reload=true
```

### Full runtime reload (restart Kortix Master + all services)

```bash
curl -X POST http://localhost:8000/kortix/services/system/reload \
  -H "Content-Type: application/json" \
  -d '{"mode": "full"}'
```

Modes: `full` (restart everything), `dispose-only` (rescan config only).

### List available templates

```bash
curl -s http://localhost:8000/kortix/services/templates | jq
```

Templates: `custom-command`, `nextjs`, `vite`, `node`, `python`, `static`.

## Default managed services

These are built-in and always present:

| ID | Port | Adapter | Scope |
|---|---|---|---|
| `opencode-serve` | 4096 | spawn | core |
| `opencode-web` | 3111 | s6 | core |
| `opencode-channels` | 3456 | s6 | core |
| `chromium-persistent` | 9222 | s6 | core |
| `agent-browser-session` | — | s6 | core |
| `agent-browser-viewer` | 9224 | s6 | core |
| `static-web` | 3211 | s6 | core |
| `lss-sync` | — | s6 | core |
| `sshd` | 22 | s6 | bootstrap |
| `docker` | — | s6 | bootstrap |

## Persistence

- Registry persisted at `/workspace/.kortix/services/registry.json`
- Logs at `/workspace/.kortix/services/logs/{id}.log`
- Gate files at `/workspace/.kortix/services/enabled/{id}.enabled`
- Survives container restarts and Kortix Master reloads

## Common patterns

### Register and start a Next.js app

```bash
curl -X POST http://localhost:8000/kortix/services/register \
  -H "Content-Type: application/json" \
  -d '{"id":"my-nextjs","sourcePath":"/workspace/my-app","startCommand":"npm start","port":3000,"desiredState":"running","autoStart":true,"userVisible":true,"startNow":true}'
```

### Check if all services are healthy

```bash
curl -s http://localhost:8000/kortix/services?all=true | jq '[.services[] | select(.managed==true and .status!="running")] | length'
# Returns 0 if everything is running
```

### Restart a crashed service

```bash
curl -X POST http://localhost:8000/kortix/services/opencode-serve/restart
```
