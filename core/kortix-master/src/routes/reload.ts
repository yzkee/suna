import { Hono } from 'hono'
import { describeRoute, resolver } from 'hono-openapi'
import { z } from 'zod'
import { initiateRuntimeReload, type ReloadMode } from '../services/runtime-reload'

const reloadRouter = new Hono()

const ReloadModeSchema = z.enum(['dispose-only', 'full'])
const ReloadResultSchema = z.object({
  success: z.boolean(),
  mode: ReloadModeSchema,
  steps: z.array(z.string()),
  errors: z.array(z.string()),
})

reloadRouter.post('/',
  describeRoute({
    tags: ['System'],
    summary: 'Reload the sandbox runtime',
    description: 'Compatibility reload endpoint. The service manager now owns the underlying runtime reload workflow.',
    responses: {
      200: { description: 'Reload initiated', content: { 'application/json': { schema: resolver(ReloadResultSchema) } } },
      500: { description: 'Reload failed' },
    },
  }),
  async (c) => {
    const body = await c.req.json<{ mode?: ReloadMode }>().catch(() => ({} as { mode?: ReloadMode }))
    const mode: ReloadMode = body.mode || 'full'
    return c.json(await initiateRuntimeReload(mode))
  },
)

reloadRouter.post('/full',
  describeRoute({
    tags: ['System'],
    summary: 'Full runtime reload',
    description: 'Compatibility alias for a service-manager owned full reload.',
    responses: {
      200: { description: 'Full reload initiated', content: { 'application/json': { schema: resolver(ReloadResultSchema) } } },
    },
  }),
  async (c) => {
    return c.json(await initiateRuntimeReload('full'))
  },
)

export default reloadRouter
