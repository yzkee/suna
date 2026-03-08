# @kortix/kortix-oc

Standalone source-of-truth package for the Kortix OpenCode runtime.

This package ships:
- a full `runtime/` tree mirroring the OpenCode config/runtime layout
- a materializer CLI to stage that runtime into an OpenCode config directory
- verification helpers for runtime parity
- plugin tests under `tests/plugin/kortix-sys/`
- plugin docs under `docs/kortix-sys/`
- plugin infra helpers under `infra/kortix-sys/`

## Commands

```bash
bun run bin/kortix-oc.ts verify
bun run bin/kortix-oc.ts link ../../sandbox/opencode
bun run test:plugin
```

## Notes

OpenCode plugins can directly provide hooks and tools, but markdown-backed commands, agents, and skills still need filesystem-backed config assets. This package centralizes those assets in one place and stages them into the target runtime directory.

`computer/packages/kortix-sys-oc-plugin` has been absorbed into this package. The canonical plugin runtime now lives at `computer/packages/kortix-oc/runtime/plugin/kortix-sys`.
