# SSH Security Boundary Violation — Analysis & Refactoring Plan

## The Bug

When a user clicks "SSH" on a **JustAVPS sandbox**, they get SSH access to the **VPS host machine as root** — not the Docker container (sandbox) running inside it. This is a critical security boundary violation.

## Root Cause

**File:** `apps/api/src/platform/routes/ssh.ts`

There are two completely separate SSH setup paths:

### Path 1: `local_docker` (CORRECT)
```
setupLocalDockerSSH() → ssh-keygen → docker exec (inject pubkey) → ssh -p 14007 abc@localhost
```
- Generates a fresh ed25519 keypair on the API server
- Injects the public key **into the Docker container** via `docker exec`
- Returns connection: `ssh -p 14007 abc@localhost` (port 14007 maps to container:22)
- User lands **inside the sandbox container** as user `abc` ✅

### Path 2: `justavps` (BROKEN)
```
setupJustavpsSSH() → GET /machines/{id} → returns VPS host SSH keys → ssh root@machine-ip:22
```
- Calls JustAVPS API: `GET /machines/${externalId}`
- JustAVPS returns the **VPS host machine's root SSH keys** (`machine.ssh_key`)
- Returns connection: `ssh -i key root@<machine-ip>` (port 22 = host sshd)
- User lands **on the VPS host** as `root` ❌

### The Irony

The Docker container already has a fully working sshd inside it:
- `core/init-scripts/95-setup-sshd.sh` — configures sshd with key-only auth, user `abc`
- `core/s6-services/svc-sshd/run` — runs sshd as a supervised service
- Container port 22 is mapped to **host port 22222** (`-p 22222:22` in `start-sandbox.sh`)
- The `authorized_keys` injection mechanism is fully set up at `/config/.ssh/authorized_keys`

**The container-level SSH infrastructure is all there — the JustAVPS route just never uses it.**

## Architecture Diagram

```
┌─────────────────────────────────────────────────┐
│  JustAVPS VPS Host                              │
│                                                 │
│  Port 22    → host sshd (root access) ← BUG!   │
│  Port 22222 → container:22 (abc user) ← CORRECT │
│  Port 8000  → container:8000 (kortix-master)    │
│  ...                                            │
│                                                 │
│  ┌───────────────────────────────────────┐      │
│  │  Docker: justavps-workload            │      │
│  │                                       │      │
│  │  sshd (port 22) → user abc            │      │
│  │  kortix-master (port 8000)            │      │
│  │  opencode, desktop, etc.              │      │
│  │                                       │      │
│  │  /config/.ssh/authorized_keys         │      │
│  │  (ready for key injection)            │      │
│  └───────────────────────────────────────┘      │
└─────────────────────────────────────────────────┘
```

**Current JustAVPS SSH flow:** API → JustAVPS API → returns host root keys → `ssh root@ip:22` → lands on HOST  
**Correct flow:** API → generate keypair → inject into container via kortix-master → `ssh abc@ip:22222` → lands in CONTAINER

## Refactoring Plan

### Goal
Unify both providers into a single SSH setup pattern: **generate keypair → inject into container → return container connection details**.

### Step 1: Refactor `setupJustavpsSSH()` to inject into the container

Instead of fetching host SSH keys from JustAVPS API, do the same thing `setupLocalDockerSSH` does but via the sandbox's own API:

```typescript
async function setupJustavpsSSH(externalId: string) {
  // 1. Generate ed25519 keypair (same as local_docker)
  const { privateKey, publicKey } = generateKeypair();

  // 2. Get the sandbox's resolved endpoint (CF proxy URL + auth headers)
  const endpoint = await justavpsProvider.resolveEndpoint(externalId);

  // 3. Inject pubkey into container via kortix-master's /kortix/core/exec endpoint
  await fetch(`${endpoint.url}/kortix/core/exec`, {
    method: 'POST',
    headers: endpoint.headers,
    body: JSON.stringify({
      cmd: `mkdir -p /config/.ssh && echo '${publicKey}' >> /config/.ssh/authorized_keys && sort -u -o /config/.ssh/authorized_keys /config/.ssh/authorized_keys && chmod 700 /config/.ssh && chmod 600 /config/.ssh/authorized_keys && chown -R abc:abc /config/.ssh`
    }),
  });

  // 4. Get machine IP for direct SSH connection
  const machine = await justavpsFetch(`/machines/${externalId}`);

  // 5. Return container SSH details (port 22222 = container's sshd)
  return {
    private_key: privateKey,
    public_key: publicKey,
    ssh_command: `ssh -i ~/.ssh/kortix_sandbox -o StrictHostKeyChecking=no -p 22222 abc@${machine.ip}`,
    host: machine.ip,
    port: 22222,
    username: 'abc',
  };
}
```

### Step 2: Extract shared keypair generation

Both paths generate ed25519 keypairs. Extract into a shared helper:

```typescript
function generateKeypair(): { privateKey: string; publicKey: string } {
  const tmpPath = join(tmpdir(), `kortix-ssh-${Date.now()}`);
  mkdirSync(tmpPath, { recursive: true });
  const keyPath = join(tmpPath, 'key');
  try {
    execSync(`ssh-keygen -t ed25519 -f "${keyPath}" -N "" -C "kortix-sandbox" -q`, { stdio: 'pipe' });
  } catch {
    throw new Error('Failed to generate SSH keypair');
  }
  const privateKey = readFileSync(keyPath, 'utf-8');
  const publicKey = readFileSync(`${keyPath}.pub`, 'utf-8').trim();
  try { unlinkSync(keyPath); } catch {}
  try { unlinkSync(`${keyPath}.pub`); } catch {}
  try { rmdirSync(tmpPath); } catch {}
  return { privateKey, publicKey };
}
```

### Step 3: Extract shared key injection

Both paths inject a public key into a container's `authorized_keys`. Abstract this:

```typescript
// Inject via kortix-master API (works for both local and remote sandboxes)
async function injectPublicKey(sandboxUrl: string, headers: Record<string, string>, publicKey: string): Promise<void> {
  const escaped = publicKey.replace(/'/g, "'\\''");
  const cmd = `mkdir -p /config/.ssh && echo '${escaped}' >> /config/.ssh/authorized_keys && sort -u -o /config/.ssh/authorized_keys /config/.ssh/authorized_keys && chmod 700 /config/.ssh && chmod 600 /config/.ssh/authorized_keys && chown -R abc:abc /config/.ssh`;

  const res = await fetch(`${sandboxUrl}/kortix/core/exec`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd }),
  });
  if (!res.ok) throw new Error('Failed to inject SSH key into sandbox');
}
```

### Step 4: Ensure port 22222 is accessible on JustAVPS

Port 22222 is already mapped in `start-sandbox.sh` (`-p 22222:22`). However, the JustAVPS firewall may only allow ports 22, 80, 443 (from the installer test expectations).

**Action:** Verify with JustAVPS that port 22222 is open in the firewall for their managed machines, or add it to the cloud-init firewall rules. This is a JustAVPS-side config, not a sandbox code change.

If the firewall can't be changed, an alternative is to use SSH ProxyJump:
```
ssh -o ProxyCommand="ssh -W %h:%p -p 22 root@machine-ip" -p 22 abc@localhost
```
But this still requires the host's root key, which is worse. Better to open port 22222.

### Step 5: Clean up the route handler

The `/setup` POST handler should become simpler:

```typescript
sshRouter.post('/setup', async (c) => {
  // 1. Resolve which sandbox we're targeting (same DB lookup as today)
  const { provider, externalId, containerName, sandboxUrl, headers } = await resolveSandbox(c);

  // 2. Generate keypair (same for all providers)
  const { privateKey, publicKey } = generateKeypair();

  // 3. Inject public key into the container (same for all providers)
  await injectPublicKey(sandboxUrl, headers, publicKey);

  // 4. Resolve connection details (differs per provider)
  const connection = await resolveSSHConnection(provider, externalId, containerName, c);

  // 5. Return
  return c.json({
    success: true,
    data: { private_key: privateKey, public_key: publicKey, ...connection },
  });
});
```

Where `resolveSSHConnection` returns `{ ssh_command, host, port, username }`:
- **local_docker:** `{ host: resolvedHost, port: SANDBOX_PORT_BASE + 7, username: 'abc' }`
- **justavps:** `{ host: machine.ip, port: 22222, username: 'abc' }`

## What Gets Deleted

- `setupJustavpsSSH()` — the function that fetches host root keys from JustAVPS API
- The `justavpsFetch('/machines/{id}')` call for SSH key retrieval (the machine fetch for IP stays)
- The `root` username and port `22` in the JustAVPS SSH path

## What Stays The Same

- The container-side sshd setup (`95-setup-sshd.sh`, `svc-sshd/run`)
- The Docker port mapping (`22222:22` on JustAVPS, `14007:22` on local)
- The frontend SSH dialog (`ssh-key-dialog.tsx`, `server-selector.tsx`)
- The `SSHSetupResult` interface (same shape)
- The VS Code/Cursor wrapper fix in `95-setup-sshd.sh`

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Port 22222 blocked by JustAVPS firewall | Check with JustAVPS; add to allowed ports in cloud-init |
| `kortix-master /kortix/core/exec` not available during startup | Same race as today — SSH button shouldn't show until sandbox is healthy |
| Existing sandbox keys stop working | Expected — users re-generate keys each time anyway |
| Host-level SSH access completely removed | Intentional — operators can still SSH to VPS via JustAVPS dashboard if needed |

## Files to Modify

1. **`apps/api/src/platform/routes/ssh.ts`** — Main refactoring target
2. **JustAVPS cloud-init / firewall** — Ensure port 22222 is open (external to this repo)
3. **`tests/shell/vps/test-ssh-e2e.sh`** — Update expected port from 22 to 22222 for JustAVPS tests
