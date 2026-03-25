import type { ResolvedEndpoint } from '../platform/providers';

export type StepResult = {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
};

async function execOnHost(
  endpoint: ResolvedEndpoint,
  command: string,
  timeout = 60,
): Promise<StepResult> {
  const url = `${endpoint.url}/toolbox/process/execute`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { ...endpoint.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, timeout }),
    signal: AbortSignal.timeout((timeout + 15) * 1000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return {
      success: false,
      stdout: '',
      stderr: `Daemon error (${resp.status}): ${text.slice(0, 500)}`,
      exitCode: -1,
      durationMs: 0,
    };
  }

  const data = (await resp.json()) as {
    exit_code: number;
    stdout: string;
    stderr: string;
    duration_ms: number;
  };

  return {
    success: data.exit_code === 0,
    stdout: data.stdout,
    stderr: data.stderr,
    exitCode: data.exit_code,
    durationMs: data.duration_ms,
  };
}

export function pullImage(endpoint: ResolvedEndpoint, image: string): Promise<StepResult> {
  return execOnHost(endpoint, `docker pull ${image}`, 300);
}

export function patchStartScript(
  endpoint: ResolvedEndpoint,
  oldBase64: string,
  newBase64: string,
): Promise<StepResult> {
  return execOnHost(
    endpoint,
    `sed -i "s|${oldBase64}|${newBase64}|" /usr/local/bin/justavps-docker-start.sh`,
    10,
  );
}

export function stopContainer(endpoint: ResolvedEndpoint): Promise<StepResult> {
  return execOnHost(
    endpoint,
    'docker rm -f justavps-workload 2>/dev/null || true; fuser -k 3456/tcp 2>/dev/null || true',
    30,
  );
}

export function restartService(endpoint: ResolvedEndpoint): Promise<StepResult> {
  return execOnHost(endpoint, 'systemctl restart justavps-docker', 30);
}

export async function verifyContainer(
  endpoint: ResolvedEndpoint,
  expectedImage: string,
  retries = 10,
): Promise<StepResult> {
  for (let i = 0; i < retries; i++) {
    const result = await execOnHost(
      endpoint,
      "docker inspect --format='{{.Config.Image}}' justavps-workload",
      10,
    );
    const running = result.stdout.trim().replace(/'/g, '');
    if (result.success && running === expectedImage) return result;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return {
    success: false,
    stdout: '',
    stderr: `Container not running expected image ${expectedImage} after ${retries} retries`,
    exitCode: -1,
    durationMs: 0,
  };
}

export function getCurrentImage(endpoint: ResolvedEndpoint): Promise<StepResult> {
  return execOnHost(
    endpoint,
    "docker inspect --format='{{.Config.Image}}' justavps-workload",
    10,
  );
}
