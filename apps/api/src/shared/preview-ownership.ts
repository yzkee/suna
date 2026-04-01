import { and, eq, ne, or, sql } from 'drizzle-orm';
import { sandboxes } from '@kortix/db';
import { db } from './db';
import { resolveAccountId } from './resolve-account';

const CACHE_TTL_MS = 5 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CacheEntry = {
  accountId: string | null;
  expiresAt: number;
};

const sandboxOwnerCache = new Map<string, CacheEntry>();

async function resolvePreviewSandboxAccountId(previewSandboxId: string): Promise<string | null> {
  const cached = sandboxOwnerCache.get(previewSandboxId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.accountId;
  }

  // Only compare against sandbox_id (UUID column) when the input is a valid UUID,
  // otherwise Postgres throws "invalid input syntax for type uuid".
  const idCondition = UUID_RE.test(previewSandboxId)
    ? or(
        eq(sandboxes.externalId, previewSandboxId),
        eq(sandboxes.sandboxId, previewSandboxId),
      )
    : eq(sandboxes.externalId, previewSandboxId);

  const [row] = await db
    .select({ accountId: sandboxes.accountId })
    .from(sandboxes)
    .where(
      and(
        idCondition,
        ne(sandboxes.status, 'pooled'),
      ),
    )
    .limit(1);

  const accountId = row?.accountId ?? null;
  sandboxOwnerCache.set(previewSandboxId, {
    accountId,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  return accountId;
}

export async function canAccessPreviewSandbox(input: {
  previewSandboxId: string;
  userId?: string;
  accountId?: string;
}): Promise<boolean> {
  const sandboxAccountId = await resolvePreviewSandboxAccountId(input.previewSandboxId);
  if (!sandboxAccountId) return false;

  const actorAccountId = input.accountId || (input.userId ? await resolveAccountId(input.userId) : null);
  return !!actorAccountId && actorAccountId === sandboxAccountId;
}

export function clearPreviewOwnershipCache(): void {
  sandboxOwnerCache.clear();
}
