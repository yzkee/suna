import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { cleanupRuntimeFixture, createRuntimeFixture, startDummyOpenCode, startKortixMaster, type RuntimeFixture, type StartedServer } from './helpers'

describe('Session Suggestions', () => {
  const baseURL = 'http://localhost:8004'
  let fixture: RuntimeFixture
  let opencode: Awaited<ReturnType<typeof startDummyOpenCode>> | null = null
  let master: StartedServer | null = null

  beforeAll(async () => {
    fixture = createRuntimeFixture('kortix-suggestions-')
    mkdirSync(join(fixture.workspaceRoot, '.kortix'), { recursive: true })
    writeFileSync(join(fixture.workspaceRoot, '.kortix', 'MEMORY.md'), [
      '# Global Memory',
      '',
      '## Environment',
      '',
      '- user is comparing Hermes and Kortix memory designs',
      '- focus on session tools and merged prompt memory files',
      '',
    ].join('\n'))
    opencode = await startDummyOpenCode(9004)
    master = await startKortixMaster(8004, fixture, {
      KORTIX_TOKEN: 'suggestions-test-token',
      OPENCODE_PORT: '9004',
    })
  })

  afterAll(async () => {
    await master?.stop()
    await opencode?.stop()
    await cleanupRuntimeFixture(fixture)
  })

  test('uses global MEMORY.md to generate suggestions', async () => {
    const res = await fetch(`${baseURL}/sessions/suggestions`)
    expect(res.status).toBe(200)
    const data = await res.json() as { suggestions: Array<{ text: string }>; personalized: boolean }
    expect(data.personalized).toBe(true)
    expect(data.suggestions.length).toBeGreaterThan(0)
    expect(data.suggestions[0]?.text).toContain('Use this context:')
  })
})
