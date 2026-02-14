/**
 * Message Queue.
 *
 * In-memory queue per sandbox. When a sandbox is offline, messages are
 * enqueued. The queue wakes the sandbox, polls health, and drains
 * once it's ready.
 */

import type { NormalizedMessage } from '../types';
import type { ChannelConfig } from '@kortix/db';
import { SandboxConnector } from './sandbox-connector';

interface QueuedMessage {
  message: NormalizedMessage;
  config: ChannelConfig;
  resolve: (value: void) => void;
  reject: (reason: unknown) => void;
}

interface SandboxQueue {
  messages: QueuedMessage[];
  draining: boolean;
}

export class MessageQueue {
  private queues = new Map<string, SandboxQueue>();
  private processCallback?: (message: NormalizedMessage, config: ChannelConfig) => Promise<void>;

  /**
   * Set the callback to process messages once the sandbox is ready.
   */
  onProcess(callback: (message: NormalizedMessage, config: ChannelConfig) => Promise<void>): void {
    this.processCallback = callback;
  }

  /**
   * Enqueue a message for a sandbox that's currently offline.
   * Returns a promise that resolves when the message has been processed.
   */
  enqueue(
    sandboxId: string,
    message: NormalizedMessage,
    config: ChannelConfig,
    connector: SandboxConnector,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let queue = this.queues.get(sandboxId);
      if (!queue) {
        queue = { messages: [], draining: false };
        this.queues.set(sandboxId, queue);
      }

      queue.messages.push({ message, config, resolve, reject });

      // Start wake + drain if not already running
      if (!queue.draining) {
        this.startWakeAndDrain(sandboxId, connector);
      }
    });
  }

  /**
   * Wake the sandbox, poll health, then drain all queued messages.
   */
  private async startWakeAndDrain(sandboxId: string, connector: SandboxConnector): Promise<void> {
    const queue = this.queues.get(sandboxId);
    if (!queue) return;

    queue.draining = true;

    try {
      // Wake up the sandbox
      await connector.wakeUp();

      // Poll health every 3s for up to 90s
      const maxWait = 90_000;
      const pollInterval = 3_000;
      const start = Date.now();
      let ready = false;

      while (Date.now() - start < maxWait) {
        if (await connector.isReady()) {
          ready = true;
          break;
        }
        await new Promise((r) => setTimeout(r, pollInterval));
      }

      if (!ready) {
        // Reject all queued messages
        for (const item of queue.messages) {
          item.reject(new Error('Sandbox did not become ready within 90s'));
        }
        queue.messages = [];
        return;
      }

      // Drain the queue
      while (queue.messages.length > 0) {
        const item = queue.messages.shift()!;
        try {
          if (this.processCallback) {
            await this.processCallback(item.message, item.config);
          }
          item.resolve();
        } catch (err) {
          item.reject(err);
        }
      }
    } catch (err) {
      // Reject remaining messages
      for (const item of queue.messages) {
        item.reject(err);
      }
      queue.messages = [];
    } finally {
      queue.draining = false;
      this.queues.delete(sandboxId);
    }
  }

  /**
   * Get the number of queued messages for a sandbox.
   */
  queueSize(sandboxId: string): number {
    return this.queues.get(sandboxId)?.messages.length ?? 0;
  }
}
