/**
 * Shell Capability — handles shell.exec for running commands on the local machine.
 *
 * Security:
 *   - Commands are executed as array args (no shell interpolation)
 *   - First arg (executable) is validated against allowedCommands / blockedCommands
 *   - Working directory is validated against allowedPaths / blockedPaths
 *   - Timeout enforcement
 */

import { spawn } from 'child_process';
import type { Capability, RpcHandler } from './index';
import { validateCommand } from '../security/command-validator';
import { validatePath } from '../security/path-validator';
import type { TunnelConfig } from '../config';

export function createShellCapability(config: TunnelConfig): Capability {
  const methods = new Map<string, RpcHandler>();

  methods.set('shell.exec', async (params) => {
    const command = params.command as string;
    const args = (params.args as string[]) || [];
    const cwd = (params.cwd as string) || config.workingDir;
    const timeout = Math.min(
      (params.timeout as number) || config.shellTimeout,
      config.shellMaxTimeout,
    );

    validateCommand(command, config.allowedCommands, config.blockedCommands);

    if (cwd) {
      validatePath(cwd, config.allowedPaths, config.blockedPaths);
    }

    const safeEnv: Record<string, string> = { TERM: 'dumb' };
    for (const key of config.shellEnvPassthrough) {
      if (process.env[key]) {
        safeEnv[key] = process.env[key]!;
      }
    }

    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        cwd,
        shell: false,
        timeout,
        env: safeEnv,
      });

      let stdout = '';
      let stderr = '';
      let stdoutTruncated = false;
      let stderrTruncated = false;

      proc.stdout?.on('data', (data: Buffer) => {
        if (stdout.length < config.shellMaxOutputSize) {
          stdout += data.toString();
        } else {
          stdoutTruncated = true;
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        if (stderr.length < config.shellMaxOutputSize) {
          stderr += data.toString();
        } else {
          stderrTruncated = true;
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Command failed to start: ${err.message}`));
      });

      proc.on('close', (code, signal) => {
        resolve({
          exitCode: code,
          signal,
          stdout: stdout.slice(0, config.shellMaxOutputSize),
          stderr: stderr.slice(0, config.shellMaxOutputSize),
          stdoutTruncated,
          stderrTruncated,
        });
      });
    });
  });

  return {
    name: 'shell',
    methods,
  };
}
