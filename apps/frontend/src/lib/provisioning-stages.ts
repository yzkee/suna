/**
 * Provisioning stage constants — single source of truth.
 *
 * Used by:
 *   - ProvisioningProgress component (instances/[id] page)
 *   - SelfHostedForm (self-hosted auth onboarding)
 *   - useSandboxPoller hook
 */

export interface ProvisioningStageInfo {
  id: string;
  progress: number;
  message: string;
}

/** Stage ID → { progress %, human-readable message } */
export const STAGE_PROGRESS: Record<string, { progress: number; message: string }> = {
  server_creating:   { progress: 10,  message: 'Creating server...' },
  server_created:    { progress: 20,  message: 'Server created, running cloud-init...' },
  cloud_init_running:{ progress: 35,  message: 'Configuring machine...' },
  cloud_init_done:   { progress: 50,  message: 'Configuration complete, starting services...' },
  docker_pulling:    { progress: 60,  message: 'Starting sandbox container...' },
  docker_running:    { progress: 75,  message: 'Sandbox container started, booting services...' },
  services_starting: { progress: 85,  message: 'Services booting...' },
  services_ready:    { progress: 100, message: 'Ready!' },
} as const;

/** Shorter labels for the circular progress UI (instances/[id] page) */
export const STAGE_LABELS: Record<string, string> = {
  server_creating:    'Spinning up your machine',
  server_created:     'Machine ready, configuring',
  cloud_init_running: 'Installing dependencies',
  cloud_init_done:    'Environment configured',
  docker_pulling:     'Preparing your workspace image',
  docker_running:     'Starting services',
  services_starting:  'Almost there',
  services_ready:     'Finishing up',
} as const;
