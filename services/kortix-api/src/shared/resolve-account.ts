/**
 * Shared account resolution: userId → accountId.
 *
 * Queries `basejump.account_user` to find the account that owns the given user.
 * If the basejump schema doesn't exist (fresh self-hosted DB without Supabase's
 * basejump extension), gracefully falls back to treating userId as accountId.
 */

import { eq } from 'drizzle-orm';
import { accountUser } from '@kortix/db';
import { db } from './db';

/**
 * Resolve the account ID for a given user.
 *
 * Queries `basejump.account_user`; falls back to `userId` if no membership
 * row is found or if the basejump schema doesn't exist.
 */
export async function resolveAccountId(userId: string): Promise<string> {
  try {
    const [membership] = await db
      .select({ accountId: accountUser.accountId })
      .from(accountUser)
      .where(eq(accountUser.userId, userId))
      .limit(1);

    return membership?.accountId ?? userId;
  } catch {
    // If basejump.account_user doesn't exist (e.g. fresh self-hosted DB), fall back.
    return userId;
  }
}
