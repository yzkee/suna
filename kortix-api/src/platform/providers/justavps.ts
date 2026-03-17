import { eq } from 'drizzle-orm';
import { sandboxes } from '@kortix/db';
import { db } from '../../shared/db';
import { config, SANDBOX_VERSION } from '../../config';
import type {
  SandboxProvider,
  ProviderName,
  CreateSandboxOpts,
  ProvisionResult,
  SandboxStatus,
  ResolvedEndpoint,
} from './index';

const KORTIX_MASTER_PORT = 8000;
const API_TIMEOUT_MS = 300_000;
const PROVISION_TIMEOUT_MS = 600_000;
const POLL_INTERVAL_MS = 3_000;

interface JustAVPSMachine {
  id: string;
  slug: string;
  name: string;
  status: string;
  provisioning_stage: string | null;
  provider: string;
  snapshot_id: string | null;
  server_type: string;
  region: string;
  ip: string | null;
  price_monthly: number | null;
  created_at: string;
  ready_at: string | null;
  urls: { vscode: string; pty: string } | null;
  ssh: string | null;
  ssh_key: {
    private_key: string | null;
    public_key: string | null;
    setup_command: string | null;
    key_path: string;
  } | null;
  connect: {
    ssh_command: string | null;
    setup_command: string | null;
    vscode_url: string;
    vscode_password: string;
    cursor_ssh: string | null;
  } | null;
  health: Record<string, unknown> | null;
}

interface JustAVPSServerType {
  name: string;
  description: string;
  vcpu: number;
  ram_gb: number;
  disk_gb: number;
  cpu_type: string;
  architecture: string;
  price_monthly: number;
  provider_price_monthly: number;
  available: boolean;
}

async function justavpsFetch<T = any>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const baseUrl = config.JUSTAVPS_API_URL.replace(/\/$/, '');
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Authorization': `Bearer ${config.JUSTAVPS_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`JustAVPS API ${options.method || 'GET'} ${path} returned ${res.status}: ${text.slice(0, 300)}`);
  }

  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

export interface ServerTypeWithPricing {
  name: string;
  description: string;
  cores: number;
  memory: number;
  disk: number;
  cpuType: string;
  architecture: string;
  priceMonthly: number;
  priceMonthlyMarkup: number;
  location: string;
}

export async function listServerTypes(
  location?: string,
): Promise<ServerTypeWithPricing[]> {
  const loc = location || config.JUSTAVPS_DEFAULT_LOCATION;
  const provider = config.JUSTAVPS_PROVIDER || 'hetzner';
  const data = await justavpsFetch<{ server_types: JustAVPSServerType[] }>(
    `/server-types?provider=${provider}&region=${loc}`,
  );

  return data.server_types
    .filter((st) => st.available)
    .map((st) => ({
      name: st.name,
      description: st.description,
      cores: st.vcpu,
      memory: st.ram_gb,
      disk: st.disk_gb,
      cpuType: st.cpu_type,
      architecture: st.architecture,
      priceMonthly: st.price_monthly,
      priceMonthlyMarkup: st.price_monthly,
      location: loc,
    }))
    .sort((a, b) => a.priceMonthly - b.priceMonthly);
}

export class JustAVPSProvider implements SandboxProvider {
  readonly name: ProviderName = 'justavps';
  async create(opts: CreateSandboxOpts): Promise<ProvisionResult> {
    const serverType = opts.hetznerServerType || config.JUSTAVPS_DEFAULT_SERVER_TYPE;
    const location = opts.hetznerLocation || config.JUSTAVPS_DEFAULT_LOCATION;
    const snapshotId = config.JUSTAVPS_SNAPSHOT_ID;

    if (!snapshotId) {
      throw new Error('JUSTAVPS_SNAPSHOT_ID is required — create a snapshot in JustAVPS first');
    }

    const serviceKey = opts.envVars?.KORTIX_TOKEN || '';
    const envVars: Record<string, string> = {
      KORTIX_API_URL: config.KORTIX_URL.replace(/\/v1\/router\/?$/, ''),
      ENV_MODE: 'cloud',
      INTERNAL_SERVICE_KEY: serviceKey,
      KORTIX_TOKEN: serviceKey,
      KORTIX_SANDBOX_VERSION: SANDBOX_VERSION,
      PUID: '1000',
      PGID: '1000',
      ...opts.envVars,
    };

    const machine = await justavpsFetch<JustAVPSMachine>('/machines', {
      method: 'POST',
      body: {
        snapshot_id: snapshotId,
        provider: config.JUSTAVPS_PROVIDER || 'hetzner',
        server_type: serverType,
        region: location,
        name: `kortix-sandbox-${opts.accountId.slice(0, 8)}-${Date.now().toString(36)}`,
        env_vars: envVars,
        docker_image: config.SANDBOX_IMAGE,
      },
    });

    console.log(`[JUSTAVPS] Machine creation started: ${machine.id} (slug: ${machine.slug})`);

    return {
      externalId: machine.id,
      baseUrl: '',
      metadata: {
        justavpsMachineId: machine.id,
        justavpsSlug: machine.slug,
        provisioningStage: 'server_creating',
        serverType,
        location,
        version: SANDBOX_VERSION,
      },
    };
  }

  async start(externalId: string): Promise<void> {
    await justavpsFetch(`/machines/${externalId}/reboot`, { method: 'POST' });
    console.log(`[JUSTAVPS] Started machine ${externalId}`);
  }

  async stop(externalId: string): Promise<void> {
    console.log(`[JUSTAVPS] Stop requested for machine ${externalId} (not directly supported — use delete)`);
  }

  async remove(externalId: string): Promise<void> {
    await justavpsFetch(`/machines/${externalId}`, { method: 'DELETE' });
    console.log(`[JUSTAVPS] Deleted machine ${externalId}`);
  }

  async getStatus(externalId: string): Promise<SandboxStatus> {
    try {
      const machine = await justavpsFetch<JustAVPSMachine>(`/machines/${externalId}`);
      const status = machine.status;
      if (status === 'ready') return 'running';
      if (status === 'stopped') return 'stopped';
      if (status === 'deleted') return 'removed';
      if (status === 'provisioning') return 'running';
      return 'unknown';
    } catch (err: any) {
      if (err.message?.includes('404')) return 'removed';
      return 'unknown';
    }
  }

  async resolveEndpoint(externalId: string): Promise<ResolvedEndpoint> {
    const machine = await justavpsFetch<JustAVPSMachine>(`/machines/${externalId}`);
    const publicIp = machine.ip;

    if (!publicIp) {
      throw new Error(`[JUSTAVPS] Machine ${externalId} has no IP`);
    }

    const url = `http://${publicIp}:${KORTIX_MASTER_PORT}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    try {
      const [row] = await db
        .select({ config: sandboxes.config })
        .from(sandboxes)
        .where(eq(sandboxes.externalId, externalId))
        .limit(1);
      const serviceKey = (row?.config as Record<string, unknown>)?.serviceKey as string | undefined;
      if (serviceKey) {
        headers['Authorization'] = `Bearer ${serviceKey}`;
      }
    } catch (err) {
      console.warn(`[JUSTAVPS] Failed to look up service key for ${externalId}:`, err);
      if (config.INTERNAL_SERVICE_KEY) {
        headers['Authorization'] = `Bearer ${config.INTERNAL_SERVICE_KEY}`;
      }
    }

    return { url, headers };
  }

  async ensureRunning(externalId: string): Promise<void> {
    const status = await this.getStatus(externalId);
    if (status === 'running') return;
    console.log(`[JUSTAVPS] Machine ${externalId} is ${status}, starting...`);
    await this.start(externalId);
    await this.waitForStatus(externalId, 'ready');
  }

  private async waitForIp(
    machineId: string,
    timeoutMs = PROVISION_TIMEOUT_MS,
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const machine = await justavpsFetch<JustAVPSMachine>(`/machines/${machineId}`);
      if (machine.ip) return;
      if (machine.status === 'error' || machine.status === 'deleted') {
        throw new Error(`[JUSTAVPS] Machine ${machineId} entered '${machine.status}' while waiting for IP`);
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error(`[JUSTAVPS] Machine ${machineId} did not get an IP within ${timeoutMs / 1000}s`);
  }

  private async waitForStatus(
    machineId: string,
    target: string,
    timeoutMs = PROVISION_TIMEOUT_MS,
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const machine = await justavpsFetch<JustAVPSMachine>(`/machines/${machineId}`);
      if (machine.status === target) return;
      if (machine.status === 'error' || machine.status === 'deleted') {
        throw new Error(`[JUSTAVPS] Machine ${machineId} entered '${machine.status}' state while waiting for '${target}'`);
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error(`[JUSTAVPS] Machine ${machineId} did not reach '${target}' within ${timeoutMs / 1000}s`);
  }
}
