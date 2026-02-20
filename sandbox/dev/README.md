# Local OpenCode Development

See [docs/opencode-local-dev.md](../../docs/opencode-local-dev.md) for full documentation.

## Quick Start

```bash
# From computer/ root:
docker compose -f docker-compose.local.yml -f docker-compose.dev.yml up

# Restart after changes:
docker compose -f docker-compose.local.yml -f docker-compose.dev.yml restart sandbox
```
