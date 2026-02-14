/**
 * Sandbox Connector.
 *
 * Communicates with OpenCode API inside a sandbox, extending the pattern
 * from cron/services/opencode.ts with streaming support ported from
 * services/voice/server.py.
 */

import type { SandboxTarget } from '../types';
import { getProvider } from '../../platform/providers';
import type { ProviderName } from '../../platform/providers';

interface CreateSessionResponse {
  id: string;
  [key: string]: unknown;
}

export interface StreamEvent {
  type: 'text' | 'busy' | 'done' | 'error';
  data?: string;
}

export class SandboxConnector {
  private baseUrl: string;
  private headers: Record<string, string>;
  private target: SandboxTarget;

  constructor(target: SandboxTarget) {
    this.target = target;
    this.baseUrl = target.baseUrl.replace(/\/$/, '');
    this.headers = { 'Content-Type': 'application/json' };

    if (target.authToken) {
      this.headers['Authorization'] = `Basic ${btoa(target.authToken)}`;
    }
  }

  /**
   * Check if the sandbox's OpenCode API is reachable.
   */
  async isReady(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/kortix/health`, {
        method: 'GET',
        headers: this.headers,
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Wake up a stopped sandbox by calling the provider's start() directly.
   */
  async wakeUp(): Promise<void> {
    if (!this.target.externalId) {
      throw new Error('Cannot wake sandbox: no external ID');
    }
    const provider = getProvider(this.target.provider as ProviderName);
    await provider.start(this.target.externalId);
  }

  /**
   * Create a new session in the sandbox.
   */
  async createSession(agentName?: string): Promise<string> {
    const body: Record<string, unknown> = {};
    if (agentName) {
      body.agent = agentName;
    }

    const res = await fetch(`${this.baseUrl}/session`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to create session: ${res.status} ${errText}`);
    }

    const session = (await res.json()) as CreateSessionResponse;
    return session.id;
  }

  /**
   * Send a prompt and collect the full response (non-streaming).
   * Internally uses promptStreaming and concatenates all text chunks.
   */
  async prompt(sessionId: string, content: string, agentName?: string): Promise<string> {
    let fullText = '';

    for await (const event of this.promptStreaming(sessionId, content, agentName)) {
      if (event.type === 'text' && event.data) {
        fullText += event.data;
      }
      if (event.type === 'error') {
        throw new Error(`Agent error: ${event.data}`);
      }
    }

    return fullText;
  }

  /**
   * Send a prompt and stream back events via SSE.
   *
   * Ported from services/voice/server.py's persistent SSE pattern:
   * - Connect to GET /event
   * - Filter by sessionId
   * - Yield text deltas
   * - Complete on session.idle
   */
  async *promptStreaming(
    sessionId: string,
    content: string,
    agentName?: string,
  ): AsyncGenerator<StreamEvent> {
    // Start SSE listener before sending the prompt
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300000); // 5 min timeout

    try {
      // Connect to the event stream
      const sseRes = await fetch(`${this.baseUrl}/event`, {
        method: 'GET',
        headers: { ...this.headers, Accept: 'text/event-stream' },
        signal: controller.signal,
      });

      if (!sseRes.ok || !sseRes.body) {
        throw new Error(`Failed to connect to SSE: ${sseRes.status}`);
      }

      // Send the prompt asynchronously
      const promptBody: Record<string, unknown> = {
        parts: [{ type: 'text', text: content }],
      };
      if (agentName) {
        promptBody.agent = agentName;
      }

      const promptPromise = fetch(`${this.baseUrl}/session/${sessionId}/prompt_async`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(promptBody),
        signal: controller.signal,
      });

      // Track assistant message IDs for filtering
      const assistantMsgIds = new Set<string>();
      let sawBusy = false;
      let gotText = false;

      const reader = sseRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // Wait for prompt to be sent
      const promptRes = await promptPromise;
      if (!promptRes.ok) {
        const errText = await promptRes.text();
        throw new Error(`Failed to send prompt: ${promptRes.status} ${errText}`);
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        while (buffer.includes('\n')) {
          const newlineIdx = buffer.indexOf('\n');
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);

          if (!line.startsWith('data:')) continue;

          const dataStr = line.slice(5).trim();
          if (!dataStr) continue;

          let data: Record<string, unknown>;
          try {
            data = JSON.parse(dataStr);
          } catch {
            continue;
          }

          const evt = data.type as string;
          const props = (data.properties || {}) as Record<string, unknown>;

          // Filter to our session
          const sid =
            (props.sessionID as string) ||
            ((props.part as Record<string, unknown>)?.sessionID as string) ||
            ((props.info as Record<string, unknown>)?.sessionID as string);

          if (sid && sid !== sessionId) continue;

          // Track assistant message IDs
          if (evt === 'message.updated') {
            const info = (props.info || {}) as Record<string, unknown>;
            if (info.role === 'assistant') {
              assistantMsgIds.add(info.id as string);
            }
          }

          // Forward text deltas
          if (evt === 'message.part.updated') {
            const part = (props.part || {}) as Record<string, unknown>;
            const delta = props.delta as string;
            const msgId = part.messageID as string;

            if (msgId && !assistantMsgIds.has(msgId)) continue;

            if (part.type === 'text' && delta) {
              gotText = true;
              sawBusy = true;
              yield { type: 'text', data: delta };
            }
          }

          // Session went busy
          if (evt === 'session.status') {
            const status = (props.status as Record<string, unknown>)?.type as string;
            if (status === 'busy') {
              sawBusy = true;
              yield { type: 'busy' };
            }
          }

          // Session went idle — completion
          if (evt === 'session.idle') {
            if (sawBusy || gotText) {
              yield { type: 'done' };
              return;
            }
          }

          // Session error
          if (evt === 'session.error') {
            const err = ((props.error as Record<string, unknown>)?.data as Record<string, unknown>)?.message as string;
            yield { type: 'error', data: err || 'unknown error' };
            return;
          }
        }
      }
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  }

  /**
   * Abort the current prompt in a session.
   */
  async abort(sessionId: string): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/session/${sessionId}/abort`, {
        method: 'POST',
        headers: this.headers,
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Best effort
    }
  }
}
