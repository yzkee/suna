export interface ConnectedAccount {
  id: string;                     
  app: string;                 
  appName: string;               
  externalUserId: string;        
  createdAt: string;
}

export interface AuthToken {
  accessToken: string;
  tokenType?: string;            
  expiresAt?: number;            
  refreshToken?: string;         
  scopes?: string[];
}

export interface ConnectTokenResult {
  token: string;
  expiresAt: string;
  connectUrl?: string;           
}

export interface AppInfo {
  slug: string;
  name: string;
  description?: string;
  imgSrc?: string;
  authType?: string;
  categories: string[];
  featuredWeight?: number;
}

export interface AppListResult {
  apps: AppInfo[];
  pageInfo: {
    totalCount: number;
    count: number;
    endCursor?: string;
    hasMore: boolean;
  };
}

export interface ProxyRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface ActionParam {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

export interface ActionSummary {
  key: string;
  name: string;
  description?: string;
  params: ActionParam[];
}

export interface ActionListResult {
  actions: ActionSummary[];
  app: string;
}

export interface ActionRunResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

// ─── Trigger types (Pipedream Connect event sources) ────────────────────────

export interface TriggerComponentProp {
  name: string;
  type: string;
  label?: string;
  description?: string;
  optional?: boolean;
  remoteOptions?: boolean;
}

export interface TriggerComponentInfo {
  key: string;
  name: string;
  version: string;
  description?: string;
  configurableProps: TriggerComponentProp[];
}

export interface TriggerDeployResult {
  /** Pipedream deployed trigger ID (dc_xxx, hi_xxx, ti_xxx) */
  deployedTriggerId: string;
  /** Whether the trigger is active */
  active: boolean;
  /** Component key used */
  componentKey?: string;
  /** Configured props snapshot */
  configuredProps?: Record<string, unknown>;
}

export interface TriggerDeployedInfo {
  id: string;
  type: string;
  componentKey?: string;
  active: boolean;
  name?: string;
  createdAt?: number;
  updatedAt?: number;
  configuredProps?: Record<string, unknown>;
}

export interface TriggerListResult {
  triggers: TriggerDeployedInfo[];
}

export interface AuthProvider {
  readonly name: string;
  createConnectToken(accountId: string, app?: string): Promise<ConnectTokenResult>;
  listAccounts(accountId: string): Promise<ConnectedAccount[]>;
  getAccount(accountId: string, accountProviderId: string): Promise<ConnectedAccount | null>;
  getAuthToken(accountId: string, app: string, providerAccountId?: string): Promise<AuthToken>;
  deleteAccount(accountId: string, accountProviderId: string): Promise<void>;
  listApps(query?: string, limit?: number, cursor?: string): Promise<AppListResult>;
  proxyRequest(accountId: string, app: string, request: ProxyRequest, providerAccountId?: string): Promise<ProxyResponse>;
  listActions(app: string, query?: string, limit?: number): Promise<ActionListResult>;
  runAction(accountId: string, actionKey: string, props: Record<string, unknown>, app: string, providerAccountId?: string): Promise<ActionRunResult>;

  // ─── Trigger methods (optional — not all providers support triggers) ───────
  listAvailableTriggers?(app: string, query?: string, limit?: number): Promise<TriggerComponentInfo[]>;
  deployTrigger?(accountId: string, app: string, componentKey: string, configuredProps: Record<string, unknown>, webhookUrl: string): Promise<TriggerDeployResult>;
  listDeployedTriggers?(accountId: string): Promise<TriggerListResult>;
  deleteDeployedTrigger?(accountId: string, deployedTriggerId: string): Promise<void>;
  pauseDeployedTrigger?(accountId: string, deployedTriggerId: string): Promise<TriggerDeployedInfo>;
  resumeDeployedTrigger?(accountId: string, deployedTriggerId: string): Promise<TriggerDeployedInfo>;
}
