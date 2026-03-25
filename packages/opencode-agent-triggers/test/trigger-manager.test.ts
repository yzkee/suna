import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TriggerManager } from "../src/trigger-manager.ts"

function createTempAgentDir(): string {
  const root = mkdtempSync(join(tmpdir(), "agent-triggers-test-"))
  mkdirSync(join(root, ".opencode", "agents"), { recursive: true })
  return root
}

describe("TriggerManager", () => {
  const roots: string[] = []

  afterEach(() => {
    while (roots.length) {
      const root = roots.pop()
      if (root) rmSync(root, { recursive: true, force: true })
    }
  })

  it("dispatches webhook triggers with SDK-compatible session payloads", async () => {
    const root = createTempAgentDir()
    roots.push(root)

    writeFileSync(
      join(root, ".opencode", "agents", "qa-test.md"),
      `---
description: "test"
mode: all
triggers:
  - name: "Webhook Test"
    enabled: true
    source:
      type: "webhook"
      path: "/hooks/test"
      method: "POST"
      secret: "secret"
    context:
      extract:
        commit_sha: "data.body.commit_sha"
    execution:
      prompt: "hello from {{ commit_sha }}"
      model_id: "kortix/claude-sonnet"
      session_mode: "new"
---

# test
`,
    )

    const calls: Array<Record<string, unknown>> = []
    const manager = new TriggerManager({
      session: {
        create: async (parameters?: { body?: { directory?: string; title?: string } }) => {
          calls.push({ type: "create", parameters })
          return { data: { id: "session-123" } }
        },
        promptAsync: async (parameters: { path?: { id: string }; body?: { agent?: string; model?: { providerID: string; modelID: string }; parts: Array<{ type: "text"; text: string }> } }) => {
          calls.push({ type: "promptAsync", parameters })
          return { ok: true }
        },
      },
      app: {
        log: async () => undefined,
      },
    }, {
      directory: root,
      webhookHost: "127.0.0.1",
      webhookPort: 18099,
    })

    try {
      const startResult = await manager.start()
      expect(startResult.webhookRegistered).toBe(1)

      const response = await fetch("http://127.0.0.1:18099/qa-test/hooks/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-kortix-trigger-secret": "secret",
        },
        body: JSON.stringify({ commit_sha: "abc123" }),
      })

      expect(response.status).toBe(202)
      expect(await response.json()).toEqual({ ok: true, sessionId: "session-123" })

      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({
        type: "create",
        parameters: {
          body: {
            directory: root,
            title: "qa-test:Webhook Test",
          },
        },
      })

      const promptCall = calls[1] as { type: string; parameters: { path?: { id: string }; body?: { agent?: string; model?: { providerID: string; modelID: string }; parts: Array<{ type: string; text: string }> } } }
      expect(promptCall.type).toBe("promptAsync")
      expect(promptCall.parameters.path).toEqual({ id: "session-123" })
      expect(promptCall.parameters.body?.agent).toBe("qa-test")
      expect(promptCall.parameters.body?.model).toEqual({ providerID: "kortix", modelID: "claude-sonnet" })
      expect(promptCall.parameters.body?.parts[0]?.type).toBe("text")
      expect(promptCall.parameters.body?.parts[0]?.text).toContain("hello from abc123")
      expect(promptCall.parameters.body?.parts[0]?.text).toContain('"trigger": "Webhook Test"')
    } finally {
      await manager.stop()
    }
  })

  it("dispatches cron triggers with SDK-compatible session payloads", async () => {
    const root = createTempAgentDir()
    roots.push(root)

    const calls: Array<Record<string, unknown>> = []
    const manager = new TriggerManager({
      session: {
        create: async (parameters?: { body?: { directory?: string; title?: string } }) => {
          calls.push({ type: "create", parameters })
          return { data: { id: "cron-session-123" } }
        },
        promptAsync: async (parameters: { path?: { id: string }; body?: { agent?: string; model?: { providerID: string; modelID: string }; parts: Array<{ type: "text"; text: string }> } }) => {
          calls.push({ type: "promptAsync", parameters })
          return { ok: true }
        },
      },
      app: {
        log: async () => undefined,
      },
    }, {
      directory: root,
      webhookHost: "127.0.0.1",
      webhookPort: 18100,
    })

    const trigger = {
      name: "Daily Report",
      cron_expr: "0 0 * * * *",
      prompt: "Generate the report",
      timezone: "UTC",
      agent_name: "kortix",
      model_id: "kortix/claude-sonnet",
      session_mode: "new",
    }

    try {
      await manager.start()
      const result = await (manager as any).dispatchCron(trigger, {
        type: "cron.tick",
        manual: true,
        timestamp: "2026-03-25T12:00:00.000Z",
      })

      expect(result).toEqual({ sessionId: "cron-session-123", response: { accepted: true } })
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({
        type: "create",
        parameters: {
          body: {
            directory: root,
            title: "Daily Report",
          },
        },
      })

      const promptCall = calls[1] as { type: string; parameters: { path?: { id: string }; body?: { agent?: string; model?: { providerID: string; modelID: string }; parts: Array<{ type: string; text: string }> } } }
      expect(promptCall.parameters.path).toEqual({ id: "cron-session-123" })
      expect(promptCall.parameters.body?.agent).toBe("kortix")
      expect(promptCall.parameters.body?.model).toEqual({ providerID: "kortix", modelID: "claude-sonnet" })
      expect(promptCall.parameters.body?.parts[0]?.text).toContain("Generate the report")
      expect(promptCall.parameters.body?.parts[0]?.text).toContain('"type": "cron.tick"')
    } finally {
      await manager.stop()
    }
  })

  it("dispatches Pipedream events with SDK-compatible session payloads", async () => {
    const root = createTempAgentDir()
    roots.push(root)

    const calls: Array<Record<string, unknown>> = []
    const manager = new TriggerManager({
      session: {
        create: async (parameters?: { body?: { directory?: string; title?: string } }) => {
          calls.push({ type: "create", parameters })
          return { data: { id: "pd-session-123" } }
        },
        promptAsync: async (parameters: { path?: { id: string }; body?: { agent?: string; model?: { providerID: string; modelID: string }; parts: Array<{ type: "text"; text: string }> } }) => {
          calls.push({ type: "promptAsync", parameters })
          return { ok: true }
        },
      },
      app: {
        log: async () => undefined,
      },
    }, {
      directory: root,
      webhookHost: "127.0.0.1",
      webhookPort: 18101,
    })

    try {
      await manager.start()

      const listener = manager.getListenerStore().create({
        name: "GitHub PR Event",
        agentName: "qa-test",
        app: "github",
        componentKey: "github-new-pull-request",
        deployedTriggerId: "dc_test_123",
        prompt: "Review PR {{ title }}",
        context: { extract: { title: "data.title" } },
        sessionMode: "new",
        executionAgentName: "qa-test",
        modelId: "kortix/claude-sonnet",
        isActive: true,
        source: "manual",
        externalUserId: "user_test",
        webhookUrl: "https://example.com/events/pipedream/test",
      })

      const result = await (manager as any).dispatchPipedreamEvent(listener.id, {
        body: JSON.stringify({ title: "Fix billing bug", number: 42 }),
        headers: { "content-type": "application/json" },
      })

      expect(result).toEqual({ sessionId: "pd-session-123" })
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({
        type: "create",
        parameters: {
          body: {
            directory: root,
            title: "qa-test:GitHub PR Event",
          },
        },
      })

      const promptCall = calls[1] as { type: string; parameters: { path?: { id: string }; body?: { agent?: string; model?: { providerID: string; modelID: string }; parts: Array<{ type: string; text: string }> } } }
      expect(promptCall.parameters.path).toEqual({ id: "pd-session-123" })
      expect(promptCall.parameters.body?.agent).toBe("qa-test")
      expect(promptCall.parameters.body?.model).toEqual({ providerID: "kortix", modelID: "claude-sonnet" })
      expect(promptCall.parameters.body?.parts[0]?.text).toContain("Review PR Fix billing bug")
      expect(promptCall.parameters.body?.parts[0]?.text).toContain('"type": "pipedream.event"')
    } finally {
      await manager.stop()
    }
  })
})
