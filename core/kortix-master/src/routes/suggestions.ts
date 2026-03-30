import { Hono } from 'hono'
import { describeRoute, resolver } from 'hono-openapi'
import { existsSync, readFileSync } from 'fs'
import defaultSuggestions from '../data/default-suggestions.json'
import { z } from 'zod'

const suggestionsRouter = new Hono()
const WORKSPACE_ROOT = process.env.KORTIX_WORKSPACE_ROOT || '/workspace'
const GLOBAL_MEMORY_PATH = `${WORKSPACE_ROOT}/.kortix/MEMORY.md`

interface Suggestion {
  text: string
  category: string
  icon: string
}

const SuggestionsResponse = z.object({
  suggestions: z.array(z.object({
    text: z.string(),
    category: z.string(),
    icon: z.string(),
  })),
  personalized: z.boolean(),
  cached: z.boolean(),
})

function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = [...arr]
  const result: T[] = []
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length)
    result.push(copy.splice(idx, 1)[0])
  }
  return result
}

function readMemoryLines(): string[] {
  try {
    if (!existsSync(GLOBAL_MEMORY_PATH)) return []
    return readFileSync(GLOBAL_MEMORY_PATH, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .slice(0, 20)
  } catch {
    return []
  }
}

function memoryLineToSuggestion(line: string): Suggestion | null {
  const text = line.replace(/^[-*]\s*/, '').trim()
  if (!text) return null
  const short = text.length > 72 ? `${text.slice(0, 69).trim()}...` : text
  return {
    text: `Use this context: ${short}`,
    category: 'continue',
    icon: 'brain',
  }
}

suggestionsRouter.get('/suggestions',
  describeRoute({
    tags: ['Sessions'],
    summary: 'Get prompt suggestions',
    description: 'Returns dashboard prompt suggestions using global MEMORY.md when available, with fallback defaults otherwise.',
    responses: {
      200: { description: 'Prompt suggestions', content: { 'application/json': { schema: resolver(SuggestionsResponse) } } },
    },
  }),
  async (c) => {
    const memorySuggestions = readMemoryLines()
      .map(memoryLineToSuggestion)
      .filter(Boolean) as Suggestion[]

    if (memorySuggestions.length > 0) {
      return c.json({
        suggestions: memorySuggestions.slice(0, 4),
        personalized: true,
        cached: false,
      })
    }

    return c.json({
      suggestions: pickRandom(defaultSuggestions.suggestions, 4),
      personalized: false,
      cached: false,
    })
  },
)

export default suggestionsRouter
