/**
 * Channel Engine.
 *
 * The core message processing pipeline. Receives NormalizedMessages
 * from adapters and proxies them through to sandbox OpenCode agents.
 *
 * Pipeline:
 * 1. Resolve config
 * 2. Rate limit
 * 3. Access control
 * 4. Resolve sandbox
 * 5. Log inbound
 * 6. Typing indicator
 * 7. Health check (queue if offline)
 * 8. Resolve session
 * 9. Build prompt
 * 10. Proxy to sandbox
 * 11. Chunk response
 * 12. Log outbound
 */

import { eq, and } from 'drizzle-orm';
import { db } from '../../shared/db';
import {
  channelConfigs,
  channelMessages,
  channelIdentityMap,
  sandboxes,
} from '@kortix/db';
import type { ChannelConfig } from '@kortix/db';

import type { ChannelAdapter } from '../adapters/base';
import type { ChannelType, NormalizedMessage, AgentResponse, SandboxTarget } from '../types';
import { SandboxConnector } from './sandbox-connector';
import { SessionManager } from './session-manager';
import { MessageQueue } from './queue';
import { RateLimiter } from './rate-limiter';
import { splitMessage } from '../lib/message-splitter';
import { ChannelError } from '../../errors';

export class ChannelEngineImpl {
  private adapters: Map<ChannelType, ChannelAdapter>;
  private sessionManager: SessionManager;
  private queue: MessageQueue;
  private rateLimiter: RateLimiter;

  constructor(adapters: Map<ChannelType, ChannelAdapter>) {
    this.adapters = adapters;
    this.sessionManager = new SessionManager();
    this.queue = new MessageQueue();
    this.rateLimiter = new RateLimiter();

    // Wire up queue drain callback
    this.queue.onProcess((msg, config) => this.processInner(msg, config));
  }

  getAdapter(type: ChannelType): ChannelAdapter | undefined {
    return this.adapters.get(type);
  }

  /**
   * Main entry point: process an inbound message from any platform.
   */
  async processMessage(message: NormalizedMessage): Promise<void> {
    // 1. Resolve config
    const [config] = await db
      .select()
      .from(channelConfigs)
      .where(
        and(
          eq(channelConfigs.channelConfigId, message.channelConfigId),
          eq(channelConfigs.enabled, true),
        ),
      );

    if (!config) {
      console.warn(`[CHANNELS] No enabled config found for ${message.channelConfigId}`);
      return;
    }

    // 2. Rate limit
    const rateResult = this.rateLimiter.check(config.channelConfigId, message.platformUser.id);
    if (!rateResult.allowed) {
      console.warn(`[CHANNELS] Rate limited: config=${config.channelConfigId} user=${message.platformUser.id}`);
      return;
    }

    // 3. Access control
    const allowed = await this.checkAccess(config, message);
    if (!allowed) {
      console.warn(`[CHANNELS] Access denied: config=${config.channelConfigId} user=${message.platformUser.id}`);
      return;
    }

    await this.processInner(message, config);
  }

  private async processInner(message: NormalizedMessage, config: ChannelConfig): Promise<void> {
    const adapter = this.adapters.get(config.channelType as ChannelType);
    if (!adapter) {
      console.error(`[CHANNELS] No adapter for type: ${config.channelType}`);
      return;
    }

    // 4. Resolve sandbox
    const target = await this.resolveSandbox(config.sandboxId);
    if (!target) {
      console.error(`[CHANNELS] Sandbox not found: ${config.sandboxId}`);
      return;
    }

    const connector = new SandboxConnector(target);

    // 5. Log inbound message
    await this.logMessage(config, message, 'inbound');

    // 6. Typing indicator
    if (adapter.sendTypingIndicator) {
      adapter.sendTypingIndicator(config, message).catch((err) => {
        console.warn(`[CHANNELS] Typing indicator failed:`, err);
      });
    }

    // 7. Health check — queue if offline
    const ready = await connector.isReady();
    if (!ready) {
      console.log(`[CHANNELS] Sandbox ${config.sandboxId} offline, queuing message`);
      try {
        await this.queue.enqueue(config.sandboxId, message, config, connector);
      } catch (err) {
        console.error(`[CHANNELS] Queue processing failed:`, err);
      }
      return;
    }

    // 8. Resolve session
    const sessionId = await this.sessionManager.resolve(config, message, connector);

    // 9. Build prompt
    const prompt = this.buildPrompt(config, message);

    // 10. Proxy to sandbox
    let responseText: string;
    try {
      responseText = await connector.prompt(sessionId, prompt, config.agentName ?? undefined);
    } catch (err) {
      console.error(`[CHANNELS] Agent prompt failed:`, err);
      throw new ChannelError(`Failed to get response from agent: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 11. Chunk response
    const chunks = this.chunkResponse(responseText, adapter.capabilities.textChunkLimit);

    // Build AgentResponse
    const agentResponse: AgentResponse = {
      content: responseText,
      sessionId,
      truncated: chunks.length > 1,
    };

    // Send response back to platform
    await adapter.sendResponse(config, message, agentResponse);

    // 12. Log outbound
    await this.logMessage(config, message, 'outbound', responseText, sessionId);
  }

  /**
   * Build the prompt to send to the agent.
   * Prepends system prompt and channel context.
   */
  private buildPrompt(config: ChannelConfig, message: NormalizedMessage): string {
    const parts: string[] = [];

    if (config.systemPrompt) {
      parts.push(config.systemPrompt);
    }

    // Add channel context
    parts.push(
      `[Channel: ${config.channelType} | Chat: ${message.chatType} | User: ${message.platformUser.name}]`,
    );

    parts.push(message.content);

    return parts.join('\n\n');
  }

  /**
   * Split response text into chunks respecting platform limits.
   */
  private chunkResponse(text: string, limit: number): string[] {
    return splitMessage(text, limit);
  }

  /**
   * Check if the user is allowed to interact with this channel.
   */
  private async checkAccess(config: ChannelConfig, message: NormalizedMessage): Promise<boolean> {
    // Check identity map for explicit allow/deny
    const [identity] = await db
      .select()
      .from(channelIdentityMap)
      .where(
        and(
          eq(channelIdentityMap.channelConfigId, config.channelConfigId),
          eq(channelIdentityMap.platformUserId, message.platformUser.id),
        ),
      );

    if (identity) {
      return identity.allowed;
    }

    // No explicit rule — allow by default
    return true;
  }

  /**
   * Resolve sandbox details for connecting.
   */
  private async resolveSandbox(sandboxId: string): Promise<SandboxTarget | null> {
    const [sandbox] = await db
      .select()
      .from(sandboxes)
      .where(eq(sandboxes.sandboxId, sandboxId));

    if (!sandbox) return null;

    return {
      sandboxId: sandbox.sandboxId,
      baseUrl: sandbox.baseUrl,
      authToken: sandbox.authToken,
      provider: sandbox.provider,
      externalId: sandbox.externalId,
    };
  }

  /**
   * Log a message to the audit trail.
   */
  private async logMessage(
    config: ChannelConfig,
    message: NormalizedMessage,
    direction: 'inbound' | 'outbound',
    content?: string,
    sessionId?: string,
  ): Promise<void> {
    try {
      await db.insert(channelMessages).values({
        channelConfigId: config.channelConfigId,
        direction,
        externalId: message.externalId,
        sessionId: sessionId ?? null,
        chatType: message.chatType,
        content: direction === 'inbound' ? message.content : (content ?? null),
        attachments: message.attachments,
        platformUser: message.platformUser,
        metadata: {},
      });
    } catch (err) {
      console.error(`[CHANNELS] Failed to log ${direction} message:`, err);
    }
  }

  /**
   * Periodic cleanup of in-memory caches.
   */
  cleanup(): void {
    this.sessionManager.cleanup();
    this.rateLimiter.cleanup();
  }
}
