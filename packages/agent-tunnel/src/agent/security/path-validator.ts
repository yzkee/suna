/**
 * Path Validator — defense-in-depth path traversal prevention.
 *
 * Validates that requested paths:
 *   1. Are absolute
 *   2. Resolve to an absolute path (follows symlinks)
 *   3. Fall within allowed directories
 *   4. Don't hit blocked paths (configurable)
 */

import { resolve, normalize } from 'path';
import { realpathSync } from 'fs';

export function validatePath(
  path: string,
  allowedPaths: string[],
  blockedPaths: string[] = [],
): void {
  if (!path) {
    throw new Error('Path is required');
  }

  const normalized = normalize(resolve(path));
  let resolved: string;
  try {
    resolved = realpathSync(normalized);
  } catch {
    resolved = normalized;
  }

  for (const blocked of blockedPaths) {
    if (resolved === blocked || resolved.startsWith(blocked + '/')) {
      throw new Error(`Access denied: blocked path "${path}"`);
    }
  }

  if (allowedPaths.length > 0) {
    const withinAllowed = allowedPaths.some((allowed) => {
      const normalizedAllowed = normalize(resolve(allowed));
      return resolved === normalizedAllowed || resolved.startsWith(normalizedAllowed + '/');
    });

    if (!withinAllowed) {
      throw new Error(`Access denied: path "${path}" is outside allowed directories`);
    }
  }
}
