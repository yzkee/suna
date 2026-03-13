import type { PipedreamClientOptions } from "./types.js"

const BASE_URL = "https://api.pipedream.com"

interface TokenCache {
  accessToken: string
  expiresAt: number
}

export interface PipedreamTriggerComponent {
  key: string
  name: string
  version: string
  description?: string
  configurable_props?: Array<{
    name: string
    type: string
    label?: string
    description?: string
    optional?: boolean
    remoteOptions?: boolean
  }>
}

export interface PipedreamDeployResult {
  type: "DeployedComponent" | "HttpInterface" | "TimerInterface"
  id: string
  component_key?: string
  active?: boolean
  name?: string
  endpoint_url?: string
  configured_props?: Record<string, unknown>
}

export interface PipedreamDeployedTrigger {
  type: string
  id: string
  component_key?: string
  active?: boolean
  name?: string
  created_at?: number
  updated_at?: number
  configured_props?: Record<string, unknown>
}

/**
 * Thin client for the Pipedream Connect REST API.
 * Handles triggers: discover, deploy, list, pause, resume, delete.
 * Uses client_credentials OAuth2 — same pattern as PipedreamProvider in kortix-api.
 */
export class PipedreamConnectClient {
  private readonly clientId: string
  private readonly clientSecret: string
  private readonly projectId: string
  private readonly environment: string
  private tokenCache: TokenCache | null = null

  constructor(options: PipedreamClientOptions) {
    this.clientId = options.clientId
    this.clientSecret = options.clientSecret
    this.projectId = options.projectId
    this.environment = options.environment ?? "development"
  }

  private async getToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt - 60_000) {
      return this.tokenCache.accessToken
    }

    const res = await fetch(`${BASE_URL}/v1/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Pipedream auth failed (${res.status}): ${text}`)
    }

    const data = (await res.json()) as { access_token: string; expires_in: number }
    this.tokenCache = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    }
    return this.tokenCache.accessToken
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.getToken()
    const url = `${BASE_URL}${path}`
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-pd-environment": this.environment,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    })

    if (res.status === 204) return undefined as T

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Pipedream API ${method} ${path} failed (${res.status}): ${text}`)
    }

    return res.json() as Promise<T>
  }

  /**
   * List available trigger components for an app.
   * E.g. app="github" → returns triggers like "github-new-pull-request", "github-new-issue", etc.
   */
  async listAvailableTriggers(app: string, query?: string, limit = 50): Promise<PipedreamTriggerComponent[]> {
    const params = new URLSearchParams({ app, limit: String(limit) })
    if (query) params.set("q", query)
    const data = await this.request<{ data: PipedreamTriggerComponent[] }>(
      "GET",
      `/v1/connect/${this.projectId}/triggers?${params.toString()}`,
    )
    return data.data ?? []
  }

  /**
   * Get details of a specific trigger component (props, etc.)
   */
  async getTriggerComponent(componentKey: string): Promise<PipedreamTriggerComponent | null> {
    try {
      return await this.request<PipedreamTriggerComponent>(
        "GET",
        `/v1/connect/${this.projectId}/triggers/${encodeURIComponent(componentKey)}`,
      )
    } catch {
      return null
    }
  }

  /**
   * Deploy a trigger for a user. Returns the deployed trigger metadata.
   * Pipedream will POST events to `webhookUrl` when the trigger fires.
   */
  async deployTrigger(options: {
    externalUserId: string
    componentKey: string
    configuredProps?: Record<string, unknown>
    webhookUrl: string
    emitOnDeploy?: boolean
  }): Promise<PipedreamDeployResult> {
    const body: Record<string, unknown> = {
      id: options.componentKey,
      external_user_id: options.externalUserId,
      webhook_url: options.webhookUrl,
      emit_on_deploy: options.emitOnDeploy ?? false,
    }
    if (options.configuredProps) {
      body.configured_props = options.configuredProps
    }
    const data = await this.request<{ data: PipedreamDeployResult }>(
      "POST",
      `/v1/connect/${this.projectId}/triggers/deploy`,
      body,
    )
    return data.data
  }

  /**
   * List deployed triggers for a user.
   */
  async listDeployedTriggers(externalUserId: string): Promise<PipedreamDeployedTrigger[]> {
    const params = new URLSearchParams({ external_user_id: externalUserId })
    const data = await this.request<{ data: PipedreamDeployedTrigger[] }>(
      "GET",
      `/v1/connect/${this.projectId}/deployed-triggers?${params.toString()}`,
    )
    return data.data ?? []
  }

  /**
   * Update a deployed trigger (e.g. pause/resume by setting active=true/false).
   */
  async updateDeployedTrigger(deployedTriggerId: string, externalUserId: string, update: { active?: boolean }): Promise<PipedreamDeployedTrigger> {
    return this.request<PipedreamDeployedTrigger>(
      "PUT",
      `/v1/connect/${this.projectId}/deployed-triggers/${deployedTriggerId}?external_user_id=${encodeURIComponent(externalUserId)}`,
      update,
    )
  }

  /**
   * Delete a deployed trigger.
   */
  async deleteDeployedTrigger(deployedTriggerId: string, externalUserId: string): Promise<void> {
    await this.request<void>(
      "DELETE",
      `/v1/connect/${this.projectId}/deployed-triggers/${deployedTriggerId}?external_user_id=${encodeURIComponent(externalUserId)}&ignore_hook_errors=true`,
    )
  }

  /**
   * Update webhook URLs for a deployed trigger.
   */
  async updateWebhooks(deployedTriggerId: string, externalUserId: string, webhookUrls: string[]): Promise<void> {
    await this.request<unknown>(
      "PUT",
      `/v1/connect/${this.projectId}/deployed-triggers/${deployedTriggerId}/webhooks?external_user_id=${encodeURIComponent(externalUserId)}`,
      { webhook_urls: webhookUrls },
    )
  }

  /**
   * List connected accounts for a user (needed to get authProvisionId).
   */
  async listAccounts(externalUserId: string): Promise<Array<{ id: string; app: { name_slug: string; name: string }; healthy: boolean }>> {
    const params = new URLSearchParams({ external_user_id: externalUserId, include_credentials: "0" })
    const data = await this.request<{ data: Array<{ id: string; app: { name_slug: string; name: string }; healthy: boolean }> }>(
      "GET",
      `/v1/connect/${this.projectId}/accounts?${params.toString()}`,
    )
    return data.data ?? []
  }

  /**
   * Configure trigger prop — load remote options (e.g. list repos for GitHub).
   */
  async configureTriggerProp(options: {
    externalUserId: string
    componentKey: string
    propName: string
    configuredProps?: Record<string, unknown>
  }): Promise<{ options?: Array<{ label: string; value: unknown }> }> {
    return this.request<{ options?: Array<{ label: string; value: unknown }> }>(
      "POST",
      `/v1/connect/${this.projectId}/triggers/configure-prop`,
      {
        external_user_id: options.externalUserId,
        id: options.componentKey,
        prop_name: options.propName,
        configured_props: options.configuredProps ?? {},
      },
    )
  }
}
