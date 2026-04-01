import type { ResolvedEndpoint } from '../platform/providers';
import type { StepResult } from './types';

export async function execOnHost(
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
