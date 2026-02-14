/**
 * Channel Adapter interface.
 *
 * Each platform (Telegram, Slack, Discord, etc.) implements this interface
 * to normalize inbound messages and deliver outbound responses.
 */

import type { Hono } from 'hono';
import type {
  ChannelType,
  ChannelCapabilities,
  NormalizedMessage,
  AgentResponse,
} from '../types';
import type { ChannelConfig } from '@kortix/db';

export interface ChannelAdapter {
  /** Platform identifier */
  readonly type: ChannelType;
  /** Human-readable name */
  readonly name: string;
  /** Platform capabilities */
  readonly capabilities: ChannelCapabilities;

  /**
   * Register webhook/API routes on the provided Hono router.
   * Called once at startup. Routes are mounted under /webhooks/<type>/*.
   */
  registerRoutes(router: Hono, engine: ChannelEngine): void;

  /**
   * Start persistent connections (WebSocket gateways, polling loops, etc.).
   * Optional — only needed for adapters that don't use webhooks.
   */
  start?(signal: AbortSignal): Promise<void>;

  /** Graceful shutdown of persistent connections. */
  shutdown?(): Promise<void>;

  /**
   * Parse a raw inbound platform payload into a NormalizedMessage.
   * Returns null if the payload should be ignored (e.g., non-message events).
   */
  parseInbound(payload: unknown, config: ChannelConfig): NormalizedMessage | null;

  /**
   * Send a response back to the platform.
   * Handles chunking based on capabilities.textChunkLimit.
   */
  sendResponse(
    config: ChannelConfig,
    message: NormalizedMessage,
    response: AgentResponse,
  ): Promise<void>;

  /** Send a typing indicator / chat action. */
  sendTypingIndicator?(config: ChannelConfig, message: NormalizedMessage): Promise<void>;

  /** Called when a new channel config is created (e.g., register webhook). */
  onChannelCreated?(config: ChannelConfig): Promise<void>;

  /** Called when a channel config is deleted (e.g., remove webhook). */
  onChannelRemoved?(config: ChannelConfig): Promise<void>;

  /** Validate that credentials are correct before saving. */
  validateCredentials?(credentials: Record<string, unknown>): Promise<{ valid: boolean; error?: string }>;
}

/**
 * Minimal engine interface that adapters can call to process messages.
 * This avoids circular imports between adapters and the engine.
 */
export interface ChannelEngine {
  processMessage(message: NormalizedMessage): Promise<void>;
}
