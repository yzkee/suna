import { config } from '../../config';
import { DaytonaProvider } from './daytona';
import { LocalDockerProvider } from './local-docker';
import { HetznerProvider } from './hetzner';
import { JustAVPSProvider } from './justavps';

export type ProviderName = 'daytona' | 'local_docker' | 'hetzner' | 'justavps';
export type { SandboxProviderName } from '../../config';

export interface CreateSandboxOpts {
  accountId: string;
  userId: string;
  name: string;
  envVars?: Record<string, string>;
  hetznerServerType?: string;
  hetznerLocation?: string;
}

export interface ProvisionResult {
  externalId: string;
  baseUrl: string;
  metadata: Record<string, unknown>;
}

export type SandboxStatus = 'running' | 'stopped' | 'removed' | 'unknown';

export interface ResolvedEndpoint {
  url: string;
  headers: Record<string, string>;
}

export interface ProvisioningStage {
  id: string;
  progress: number;
  message: string;
}

export interface ProvisioningTraits {
  async: boolean;
  stages: ProvisioningStage[];
}

export interface ProvisioningStatus {
  stage: string;
  progress: number;
  message: string;
  complete: boolean;
  error: boolean;
  errorMessage?: string;
}

export interface SandboxProvider {
  readonly name: ProviderName;
  readonly provisioning: ProvisioningTraits;

  create(opts: CreateSandboxOpts): Promise<ProvisionResult>;
  start(externalId: string): Promise<void>;
  stop(externalId: string): Promise<void>;
  remove(externalId: string): Promise<void>;
  getStatus(externalId: string): Promise<SandboxStatus>;
  resolveEndpoint(externalId: string): Promise<ResolvedEndpoint>;
  ensureRunning(externalId: string): Promise<void>;
  getProvisioningStatus(sandboxId: string): Promise<ProvisioningStatus | null>;
}

const providers = new Map<ProviderName, SandboxProvider>();

export function getProvider(name: ProviderName): SandboxProvider {
  const existing = providers.get(name);
  if (existing) return existing;

  if (!config.ALLOWED_SANDBOX_PROVIDERS.includes(name)) {
    throw new Error(
      `Sandbox provider '${name}' is not allowed. ` +
      `Allowed: ${config.ALLOWED_SANDBOX_PROVIDERS.join(', ')}. ` +
      `Set ALLOWED_SANDBOX_PROVIDERS in your .env.`
    );
  }

  let provider: SandboxProvider;

  switch (name) {
    case 'daytona':
      if (!config.DAYTONA_API_KEY) {
        throw new Error('Daytona provider is allowed but not configured. Set DAYTONA_API_KEY.');
      }
      provider = new DaytonaProvider();
      break;
    case 'local_docker':
      provider = new LocalDockerProvider();
      break;
    case 'hetzner':
      if (!config.HETZNER_API_KEY) {
        throw new Error('Hetzner provider is allowed but not configured. Set HETZNER_API_KEY.');
      }
      provider = new HetznerProvider();
      break;
    case 'justavps':
      if (!config.JUSTAVPS_API_KEY) {
        throw new Error('JustAVPS provider is allowed but not configured. Set JUSTAVPS_API_KEY.');
      }
      provider = new JustAVPSProvider();
      break;
    default:
      throw new Error(`Unknown sandbox provider: ${name}`);
  }

  providers.set(name, provider);
  return provider;
}

export function getDefaultProviderName(): ProviderName {
  return config.getDefaultProvider();
}

export function getAvailableProviders(): ProviderName[] {
  const available: ProviderName[] = [];
  if (config.isDaytonaEnabled()) available.push('daytona');
  if (config.isLocalDockerEnabled()) available.push('local_docker');
  if (config.isHetznerEnabled()) available.push('hetzner');
  if (config.isJustAVPSEnabled()) available.push('justavps');
  return available;
}
