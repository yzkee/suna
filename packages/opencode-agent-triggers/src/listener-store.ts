import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { EventListenerRecord } from "./types.js"

interface PersistedListenerState {
  listeners: EventListenerRecord[]
}

/**
 * JSON file-based persistence for active Pipedream event listeners.
 * Same pattern as CronStore — simple, self-contained, no external dependencies.
 */
export class ListenerStore {
  private state: PersistedListenerState

  constructor(private readonly filePath: string) {
    mkdirSync(path.dirname(filePath), { recursive: true })
    try {
      chmodSync(path.dirname(filePath), 0o777)
    } catch {
      // best-effort
    }
    this.state = existsSync(filePath) ? this.readFromDisk() : { listeners: [] }
    this.write()
  }

  private readFromDisk(): PersistedListenerState {
    try {
      const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as PersistedListenerState
      return {
        listeners: Array.isArray(raw.listeners) ? raw.listeners : [],
      }
    } catch {
      return { listeners: [] }
    }
  }

  private write(): void {
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf8")
    try {
      chmodSync(this.filePath, 0o666)
    } catch {
      // best-effort
    }
  }

  private refresh(): void {
    this.state = this.readFromDisk()
  }

  list(filter?: { agentName?: string; app?: string; isActive?: boolean }): EventListenerRecord[] {
    this.refresh()
    let items = this.state.listeners
    if (filter?.agentName) items = items.filter((l) => l.agentName === filter.agentName)
    if (filter?.app) items = items.filter((l) => l.app === filter.app)
    if (filter?.isActive !== undefined) items = items.filter((l) => l.isActive === filter.isActive)
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  get(id: string): EventListenerRecord | null {
    this.refresh()
    return this.state.listeners.find((l) => l.id === id) ?? null
  }

  getByDeployedTriggerId(deployedTriggerId: string): EventListenerRecord | null {
    this.refresh()
    return this.state.listeners.find((l) => l.deployedTriggerId === deployedTriggerId) ?? null
  }

  getByName(name: string, agentName?: string): EventListenerRecord | null {
    this.refresh()
    return this.state.listeners.find((l) =>
      l.name === name && (agentName === undefined || l.agentName === agentName),
    ) ?? null
  }

  create(input: Omit<EventListenerRecord, "id" | "createdAt" | "updatedAt" | "eventCount">): EventListenerRecord {
    this.refresh()
    const now = new Date().toISOString()
    const record: EventListenerRecord = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      eventCount: 0,
    }
    this.state.listeners.push(record)
    this.write()
    return record
  }

  update(id: string, patch: Partial<Omit<EventListenerRecord, "id" | "createdAt">>): EventListenerRecord | null {
    this.refresh()
    const index = this.state.listeners.findIndex((l) => l.id === id)
    if (index < 0) return null
    const current = this.state.listeners[index]
    this.state.listeners[index] = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    }
    this.write()
    return this.state.listeners[index]
  }

  recordEvent(id: string): EventListenerRecord | null {
    this.refresh()
    const index = this.state.listeners.findIndex((l) => l.id === id)
    if (index < 0) return null
    const current = this.state.listeners[index]
    this.state.listeners[index] = {
      ...current,
      lastEventAt: new Date().toISOString(),
      eventCount: current.eventCount + 1,
      updatedAt: new Date().toISOString(),
    }
    this.write()
    return this.state.listeners[index]
  }

  delete(id: string): boolean {
    this.refresh()
    const next = this.state.listeners.filter((l) => l.id !== id)
    if (next.length === this.state.listeners.length) return false
    this.state.listeners = next
    this.write()
    return true
  }
}
