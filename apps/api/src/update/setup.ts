import type { ResolvedEndpoint } from '../platform/providers';
import { execOnHost } from './exec';
import { writeContainerConfig, buildDockerRunCommand, DEFAULT_PORTS, sanitizePorts, type ContainerConfig } from './container-config';

export interface SetupOpts {
  image: string;
  envFile?: string;
  ports?: string[];
  containerName?: string;
  volumeName?: string;
}

export function buildContainerConfig(opts: SetupOpts): ContainerConfig {
  const volumeName = opts.volumeName || 'kortix-data';
  const ports = sanitizePorts(opts.ports || DEFAULT_PORTS);
  return {
    image: opts.image,
    name: opts.containerName || 'kortix-sandbox',
    volumes: [`${volumeName}:/workspace`, `${volumeName}:/config`],
    ports,
    caps: ['SYS_ADMIN'],
    shmSize: '2g',
    envFile: opts.envFile || '/etc/justavps/env',
    securityOpt: ['seccomp=unconfined'],
  };
}

export async function deploySandbox(
  endpoint: ResolvedEndpoint,
  opts: SetupOpts,
): Promise<ContainerConfig> {
  const config = buildContainerConfig(opts);

  // Pull image if not cached
  const exists = await execOnHost(
    endpoint,
    `docker image inspect ${config.image} >/dev/null 2>&1 && echo cached`,
    10,
  );

  if (exists.stdout?.trim() !== 'cached') {
    console.log(`[SETUP] Pulling ${config.image}...`);
    await execOnHost(
      endpoint,
      `systemd-run --unit=kortix-image-pull docker pull ${config.image}`,
      15,
    );

    // Poll until image is available (up to 10 minutes for first pull)
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const check = await execOnHost(
        endpoint,
        `docker image inspect ${config.image} >/dev/null 2>&1 && echo ready`,
        10,
      );
      if (check.stdout?.trim() === 'ready') break;
      if (i === 119) throw new Error(`Image pull timed out: ${config.image}`);
    }
  }

  // Start container
  const runCmd = buildDockerRunCommand(config);
  const result = await execOnHost(endpoint, runCmd, 30);
  if (!result.success) {
    throw new Error(`Failed to start container: ${result.stderr}`);
  }

  // Write config to persistent volume
  await writeContainerConfig(endpoint, config);

  console.log(`[SETUP] Sandbox deployed: ${config.name} running ${config.image}`);
  return config;
}
