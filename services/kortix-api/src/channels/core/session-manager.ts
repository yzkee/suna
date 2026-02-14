/**
 * Session Manager.
 *
 * Resolves which OpenCode session to use for a given inbound message,
 * based on the channel config's session strategy.
 *
 * Uses an in-memory cache with 24h TTL backed by DB persistence
 * in the channelSessions table.
 */

import { eq, and } from 'drizzle-orm';
import { db } from '../../shared/db';
import { channelSessions } from '@kortix/db';
import { SandboxConnector } from './sandbox-connector';
import type { NormalizedMessage, SessionStrategy } from '../types';
import type { ChannelConfig } from '@kortix/db';

interface CachedSession {
  sessionId: string;
  lastUsedAt: number;
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class SessionManager {
  private cache = new Map<string, CachedSession>();

  /**
   * Build a deterministic cache key from the config, strategy, and message.
   */
  private buildKey(
    configId: string,
    channelType: string,
    strategy: SessionStrategy,
    message: NormalizedMessage,
  ): string {
    let discriminator: string;

    switch (strategy) {
      case 'single':
        discriminator = 'global';
        break;
      case 'per-thread':
        discriminator = message.threadId || message.groupId || message.platformUser.id;
        break;
      case 'per-user':
        discriminator = message.platformUser.id;
        break;
      case 'per-message':
        discriminator = message.externalId;
        break;
      default:
        discriminator = message.platformUser.id;
    }

    return `${configId}:${channelType}:${strategy}:${discriminator}`;
  }

  /**
   * Resolve or create a session for the given message.
   */
  async resolve(
    config: ChannelConfig,
    message: NormalizedMessage,
    connector: SandboxConnector,
  ): Promise<string> {
    const strategy = config.sessionStrategy as SessionStrategy;
    const key = this.buildKey(
      config.channelConfigId,
      config.channelType,
      strategy,
      message,
    );

    // per-message always creates a new session
    if (strategy === 'per-message') {
      const sessionId = await connector.createSession(config.agentName ?? undefined);
      return sessionId;
    }

    // Check in-memory cache
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.lastUsedAt < SESSION_TTL_MS) {
      cached.lastUsedAt = Date.now();
      // Update DB last_used_at in background
      this.touchDb(config.channelConfigId, key).catch(() => {});
      return cached.sessionId;
    }

    // Check DB
    const [dbSession] = await db
      .select()
      .from(channelSessions)
      .where(
        and(
          eq(channelSessions.channelConfigId, config.channelConfigId),
          eq(channelSessions.strategyKey, key),
        ),
      );

    if (dbSession) {
      const age = Date.now() - dbSession.lastUsedAt.getTime();
      if (age < SESSION_TTL_MS) {
        this.cache.set(key, {
          sessionId: dbSession.sessionId,
          lastUsedAt: Date.now(),
        });
        this.touchDb(config.channelConfigId, key).catch(() => {});
        return dbSession.sessionId;
      }
    }

    // Create new session
    const sessionId = await connector.createSession(config.agentName ?? undefined);

    // Cache it
    this.cache.set(key, { sessionId, lastUsedAt: Date.now() });

    // Persist to DB (upsert)
    if (dbSession) {
      await db
        .update(channelSessions)
        .set({
          sessionId,
          lastUsedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(channelSessions.channelSessionId, dbSession.channelSessionId));
    } else {
      await db.insert(channelSessions).values({
        channelConfigId: config.channelConfigId,
        strategyKey: key,
        sessionId,
      });
    }

    return sessionId;
  }

  /**
   * Update last_used_at in DB (fire-and-forget).
   */
  private async touchDb(configId: string, key: string): Promise<void> {
    await db
      .update(channelSessions)
      .set({ lastUsedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(channelSessions.channelConfigId, configId),
          eq(channelSessions.strategyKey, key),
        ),
      );
  }

  /**
   * Evict expired entries from the in-memory cache.
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.lastUsedAt > SESSION_TTL_MS) {
        this.cache.delete(key);
      }
    }
  }
}
