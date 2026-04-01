import { Hono } from 'hono'
import { describeRoute, resolver } from 'hono-openapi'
import { z } from 'zod'
import {
  ErrorResponse,
  DeployResponse,
  DeploymentStatus,
  DeploymentListResponse,
  DeploymentLogsResponse,
  DeployBody,
} from '../schemas/common'
import { serviceManager } from '../services/service-manager'

const deployRouter = new Hono()

function toLegacyDeploymentStatus(status: 'running' | 'stopped' | 'starting' | 'failed' | 'backoff'): 'running' | 'stopped' {
  return status === 'running' || status === 'starting' ? 'running' : 'stopped'
}

deployRouter.post('/',
  describeRoute({
    tags: ['Deployments'],
    summary: 'Register and start a managed app service',
    description: 'Creates or updates a persistent project service managed by Kortix Master, then starts it.',
    responses: {
      200: { description: 'Deployment result', content: { 'application/json': { schema: resolver(DeployResponse) } } },
      400: { description: 'Missing deploymentId', content: { 'application/json': { schema: resolver(ErrorResponse) } } },
      500: { description: 'Deployment failed', content: { 'application/json': { schema: resolver(ErrorResponse) } } },
    },
  }),
  async (c) => {
    try {
      const body = await c.req.json() as z.infer<typeof DeployBody>
      if (!body.deploymentId) return c.json({ error: 'deploymentId is required' }, 400)

      const result = await serviceManager.deployLegacyService({
        deploymentId: body.deploymentId,
        sourceType: body.sourceType || 'files',
        sourceRef: body.sourceRef,
        sourcePath: body.sourcePath || '/workspace',
        framework: body.framework,
        envVarKeys: body.envVarKeys,
        buildConfig: body.buildConfig,
        entrypoint: body.entrypoint,
      })

      return c.json({
        success: result.success,
        port: result.port,
        pid: result.pid,
        framework: result.framework,
        error: result.error,
        logs: result.logs,
        buildDuration: result.buildDuration,
        startDuration: result.startDuration,
      }, result.success ? 200 : 500)
    } catch (error) {
      console.error('[Deploy API] Unexpected error:', error)
      return c.json({ error: 'Failed to process deployment request', details: String(error) }, 500)
    }
  },
)

deployRouter.post('/:id/stop',
  describeRoute({
    tags: ['Deployments'],
    summary: 'Stop a deployment',
    description: 'Stops a managed deployment and preserves its registration.',
    responses: {
      200: { description: 'Deployment stopped', content: { 'application/json': { schema: resolver(z.object({ success: z.boolean(), output: z.string().optional() })) } } },
      404: { description: 'Deployment not found', content: { 'application/json': { schema: resolver(ErrorResponse) } } },
    },
  }),
  async (c) => {
    const result = await serviceManager.stopService(c.req.param('id'))
    if (!result.ok && result.output.includes('Unknown service')) return c.json({ success: false, error: result.output }, 404)
    return c.json({ success: result.ok, output: result.output }, result.ok ? 200 : 500)
  },
)

deployRouter.get('/:id/logs',
  describeRoute({
    tags: ['Deployments'],
    summary: 'Get deployment logs',
    description: 'Returns the captured logs for a managed deployment.',
    responses: {
      200: { description: 'Deployment logs', content: { 'application/json': { schema: resolver(DeploymentLogsResponse) } } },
      404: { description: 'Deployment not found', content: { 'application/json': { schema: resolver(DeploymentLogsResponse) } } },
    },
  }),
  async (c) => {
    const result = await serviceManager.getLogs(c.req.param('id'))
    if (result.error) return c.json({ logs: [], error: result.error }, 404)
    return c.json({ logs: result.logs })
  },
)

deployRouter.get('/:id/status',
  describeRoute({
    tags: ['Deployments'],
    summary: 'Get deployment status',
    description: 'Returns the current status of a managed deployment.',
    responses: {
      200: { description: 'Deployment status', content: { 'application/json': { schema: resolver(DeploymentStatus) } } },
      404: { description: 'Deployment not found', content: { 'application/json': { schema: resolver(DeploymentStatus) } } },
    },
  }),
  async (c) => {
    const service = await serviceManager.getService(c.req.param('id'))
    if (!service || service.scope !== 'project') {
      return c.json({ status: 'not_found', error: `Deployment not found: ${c.req.param('id')}` }, 404)
    }
    return c.json({
      status: toLegacyDeploymentStatus(service.status),
      port: service.port || undefined,
      pid: service.pid || undefined,
      framework: service.framework || undefined,
      startedAt: service.startedAt || undefined,
      error: service.lastError || undefined,
    })
  },
)

deployRouter.get('/',
  describeRoute({
    tags: ['Deployments'],
    summary: 'List deployments',
    description: 'Returns all managed project services.',
    responses: {
      200: { description: 'Deployment list', content: { 'application/json': { schema: resolver(DeploymentListResponse) } } },
      500: { description: 'Server error', content: { 'application/json': { schema: resolver(ErrorResponse) } } },
    },
  }),
  async (c) => {
    try {
      const services = await serviceManager.listServices({ includeSystem: true, includeStopped: true })
      const deployments = services
        .filter((service) => service.scope === 'project')
        .map((service) => ({
          id: service.id,
          status: toLegacyDeploymentStatus(service.status),
          port: service.port || undefined,
          pid: service.pid || undefined,
          framework: service.framework || undefined,
          startedAt: service.startedAt || undefined,
        }))
      return c.json({ deployments })
    } catch (error) {
      return c.json({ error: 'Failed to list deployments', details: String(error) }, 500)
    }
  },
)

export default deployRouter
