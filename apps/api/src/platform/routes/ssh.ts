/**
 * SSH key setup route.
 *
 * Supports multiple providers:
 *   - local_docker: generates ed25519 keypair via ssh-keygen, injects pubkey via docker exec
 *   - justavps: generates ed25519 keypair, injects pubkey into the sandbox container
 *               via host toolbox + docker exec, then routes SSH on port 22 into
 *               the container instead of returning VPS host root access.
 *
 * Mounted at /v1/platform/sandbox/ssh
 *
 * Routes:
 *   POST /setup  → Generate keypair, inject into sandbox container, return private key + ssh command
 */

import { Hono } from 'hono';
import { execSync } from 'child_process';
import { readFileSync, unlinkSync, mkdirSync, rmdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Docker from 'dockerode';
import { config } from '../../config';
import { execOnHost } from '../../update/exec';
import type { AuthVariables } from '../../types';

const sshRouter = new Hono<{ Variables: AuthVariables }>();

// ─── Shared: keypair generation ──────────────────────────────────────────────

function generateKeypair(): { privateKey: string; publicKey: string } {
  const tmpPath = join(tmpdir(), `kortix-ssh-${Date.now()}`);
  mkdirSync(tmpPath, { recursive: true });
  const keyPath = join(tmpPath, 'key');

  try {
    execSync(`ssh-keygen -t ed25519 -f "${keyPath}" -N "" -C "kortix-sandbox" -q`, { stdio: 'pipe' });
  } catch {
    throw new Error('Failed to generate SSH keypair via ssh-keygen');
  }

  const privateKey = readFileSync(keyPath, 'utf-8');
  const publicKey = readFileSync(`${keyPath}.pub`, 'utf-8').trim();

  try { unlinkSync(keyPath); } catch {}
  try { unlinkSync(`${keyPath}.pub`); } catch {}
  try { rmdirSync(tmpPath); } catch {}

  return { privateKey, publicKey };
}

// ─── Shared: authorized_keys injection via remote host toolbox exec ──────────
// JustAVPS resolveEndpoint() points at the VPS host toolbox endpoint, not the
// sandbox's kortix-master API. To inject a key into the Dockerized sandbox we
// must exec on the host, then docker exec into the workload container.

async function injectPublicKeyViaHostExec(
  endpoint: { url: string; headers: Record<string, string> },
  publicKey: string,
  containerName = 'justavps-workload',
): Promise<void> {
  const publicKeyB64 = Buffer.from(`${publicKey}\n`).toString('base64');
  const innerCmd = [
    `mkdir -p /config/.ssh`,
    `printf '%s' '${publicKeyB64}' | base64 -d >> /config/.ssh/authorized_keys`,
    `sort -u -o /config/.ssh/authorized_keys /config/.ssh/authorized_keys`,
    `chmod 700 /config/.ssh`,
    `chmod 600 /config/.ssh/authorized_keys`,
    `chown -R abc:abc /config/.ssh`,
  ].join(' && ');
  const escapedInnerCmd = innerCmd.replace(/(["`$\\])/g, '\\$1');
  const hostCmd = `docker exec ${containerName} sh -lc "${escapedInnerCmd}"`;

  const result = await execOnHost(endpoint, hostCmd, 30);
  if (!result.success) {
    throw new Error(`Failed to inject SSH key into sandbox: ${result.stderr || result.stdout || 'unknown host exec error'}`);
  }
}

async function injectPublicKeyViaHostExecWithRetry(
  endpoint: { url: string; headers: Record<string, string> },
  publicKey: string,
  timeoutMs = 120_000,
): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await injectPublicKeyViaHostExec(endpoint, publicKey);
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Timed out waiting for sandbox exec endpoint to become ready');
}

// ─── Local Docker: inject via docker exec ────────────────────────────────────

function getDockerClient(): Docker {
  if (!config.DOCKER_HOST) return new Docker();

  if (config.DOCKER_HOST.startsWith('tcp://') || config.DOCKER_HOST.startsWith('http://')) {
    const url = new URL(config.DOCKER_HOST);
    return new Docker({ host: url.hostname, port: parseInt(url.port || '2375', 10) });
  }

  const socketPath = config.DOCKER_HOST.replace(/^unix:\/\//, '');
  return new Docker({ socketPath });
}

async function runContainerCommand(container: Docker.Container, cmd: string): Promise<void> {
  const exec = await container.exec({
    Cmd: ['sh', '-c', cmd],
    AttachStdout: true,
    AttachStderr: true,
  });

  await new Promise<void>((resolve, reject) => {
    exec.start({}, (err) => {
      if (err) return reject(err);
      return resolve();
    });
  });

  const startedAt = Date.now();
  let result = await exec.inspect();
  while (result.Running) {
    if (Date.now() - startedAt > 15_000) {
      throw new Error('Timed out waiting for container command to finish');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    result = await exec.inspect();
  }

  if (result.ExitCode && result.ExitCode !== 0) {
    throw new Error(`Container command failed with exit code ${result.ExitCode}`);
  }
}

async function setupLocalDockerSSH(containerName: string, c: any) {
  const docker = getDockerClient();
  const container = docker.getContainer(containerName);
  try {
    const containerInfo = await container.inspect();
    if (!containerInfo.State?.Running) {
      throw new Error('Sandbox is not running.');
    }
  } catch (e: any) {
    if (e?.statusCode === 404 || String(e?.message || '').includes('No such container')) {
      throw new Error('No sandbox container found. Start your Local Docker sandbox first.');
    }
    throw e;
  }

  const { privateKey, publicKey } = generateKeypair();

  const escapedPubKey = publicKey.replace(/'/g, "'\\''");
  // Inject into both /config/.ssh (sshd config) and /workspace/.ssh (fallback)
  await runContainerCommand(
    container,
    `mkdir -p /config/.ssh && echo '${escapedPubKey}' >> /config/.ssh/authorized_keys && sort -u -o /config/.ssh/authorized_keys /config/.ssh/authorized_keys && chmod 700 /config/.ssh && chmod 600 /config/.ssh/authorized_keys && chown -R abc:abc /config/.ssh`,
  );
  console.log(`[SSH] Public key injected into container ${containerName}`);

  const port = config.SANDBOX_PORT_BASE + 7;
  let host = 'localhost';
  const fwdHost = c.req.header('x-forwarded-host') || c.req.header('host') || '';
  const fwdHostOnly = fwdHost.split(':')[0];
  if (fwdHostOnly && fwdHostOnly !== 'localhost' && !fwdHostOnly.includes('kortix-api')) {
    host = fwdHostOnly;
  }

  const sshCmd = `ssh -i ~/.ssh/kortix_sandbox -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -p ${port} abc@${host}`;

  return {
    private_key: privateKey,
    public_key: publicKey,
    ssh_command: sshCmd,
    host,
    port,
    username: 'abc',
  };
}

// ─── JustAVPS: inject into sandbox container (NOT the VPS host) ──────────────
// Previously this returned VPS host root SSH keys — giving access to the bare
// machine instead of the sandboxed container. This is now fixed:
//   1. Generate a fresh ed25519 keypair (same as local_docker)
//   2. Resolve the JustAVPS host toolbox endpoint (via CF proxy)
//   3. Inject the public key into /config/.ssh/authorized_keys inside the container
//   4. Return connection to host port 22 as user abc, where host sshd is
//      configured to auth against container keys and force every abc session
//      into the workload container.

async function setupJustavpsSSH(externalId: string) {
  const { justavpsFetch } = await import('../providers/justavps');
  const { JustAVPSProvider } = await import('../providers/justavps');

  const provider = new JustAVPSProvider();

  // The DB row can become "active" before the underlying JustAVPS machine has
  // finished provisioning. Wait until the provider reports the VM itself is
  // actually ready before attempting SSH setup.
  await provider.ensureRunning(externalId);

  // Get machine IP and verify it's ready
  const machine = await justavpsFetch<{
    id: string;
    ip: string | null;
    status: string;
  }>(`/machines/${externalId}`);

  if (machine.status !== 'ready') {
    throw new Error('Sandbox is not ready yet. Wait for provisioning to complete.');
  }

  if (!machine.ip) {
    throw new Error('Sandbox does not have an IP address yet.');
  }

  // Generate a fresh keypair for this session
  const { privateKey, publicKey } = generateKeypair();

  // Resolve sandbox endpoint via the CF proxy (same path used by all other API calls)
  const endpoint = await provider.resolveEndpoint(externalId);

  // Inject public key into the Dockerized sandbox via the JustAVPS host toolbox.
  // resolveEndpoint() targets the host, so we exec on the VPS and then docker
  // exec into the workload container.
  await injectPublicKeyViaHostExecWithRetry(endpoint, publicKey);
  console.log(`[SSH] Public key injected into JustAVPS container ${externalId}`);

  // JustAVPS only guarantees external SSH reachability on host port 22.
  // start-sandbox.sh configures host sshd so `ssh abc@host` authenticates using
  // the container's authorized_keys and force-commands the session into the
  // workload container as user abc.
  const port = 22;
  const host = machine.ip;
  const sshCmd = `ssh -i ~/.ssh/kortix_sandbox -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -p ${port} abc@${host}`;

  return {
    private_key: privateKey,
    public_key: publicKey,
    ssh_command: sshCmd,
    host,
    port,
    username: 'abc',
  };
}

// ─── Route ───────────────────────────────────────────────────────────────────

sshRouter.post('/setup', async (c) => {
  try {
    let containerName = 'kortix-sandbox';
    let provider: string | null = null;
    let externalId: string | null = null;

    const body = await c.req.json().catch(() => ({}));
    const requestedSandboxId = body?.sandboxId as string | undefined;

    try {
      const authHeader = c.req.header('Authorization');
      if (authHeader && config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY) {
        const { createClient } = await import('@supabase/supabase-js');
        const { resolveAccountId } = await import('../../shared/resolve-account');
        const { db } = await import('../../shared/db');
        const { sandboxes } = await import('@kortix/db');
        const { eq, and } = await import('drizzle-orm');

        const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
        const token = authHeader.replace('Bearer ', '');
        const { data: { user } } = await supabase.auth.getUser(token);

        if (user) {
          const accountId = await resolveAccountId(user.id);

          let sandbox;
          if (requestedSandboxId) {
            [sandbox] = await db.select().from(sandboxes)
              .where(and(
                eq(sandboxes.accountId, accountId),
                eq(sandboxes.sandboxId, requestedSandboxId),
              ))
              .limit(1);
          } else {
            [sandbox] = await db.select().from(sandboxes)
              .where(and(eq(sandboxes.accountId, accountId), eq(sandboxes.status, 'active')))
              .limit(1);
          }

          provider = sandbox?.provider ?? null;
          externalId = sandbox?.externalId ?? null;
          if (sandbox?.externalId && provider === 'local_docker') {
            containerName = sandbox.externalId;
          }
        }
      }
    } catch {
      // DB unavailable — use default container name
    }

    let data;

    if (provider === 'justavps') {
      if (!externalId) {
        return c.json({ success: false, error: 'No JustAVPS machine found for this sandbox.' }, 400);
      }
      data = await setupJustavpsSSH(externalId);
    } else {
      data = await setupLocalDockerSSH(containerName, c);
    }

    return c.json({ success: true, data });
  } catch (err) {
    console.error('[SSH] setup error:', err);
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed to setup SSH' }, 500);
  }
});

export { sshRouter };
