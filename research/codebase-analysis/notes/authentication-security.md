# Authentication & Security Findings

## Authentication System Overview
The system uses a multi-layered authentication approach supporting different token types and use cases.

## Authentication Methods

### 1. Supabase JWT Authentication
- **Primary User Auth**: Frontend users authenticate via Supabase
- **Token Format**: Standard JWT from Supabase Auth
- **Usage**: Platform endpoints (`/v1/billing`, `/v1/platform`, `/v1/cron`)
- **Context**: Sets `userId` and `userEmail` in request context

### 2. API Key Authentication (`sk_` prefix)
- **Purpose**: Programmatic API access
- **Format**: `sk_xxx` tokens
- **Validation**: Against `kortix.api_keys` table via Drizzle ORM
- **Scope**: Sandbox-scoped keys
- **Usage**: Search, LLM routes, external integrations

### 3. Sandbox Token Authentication (`sbt_` prefix)
- **Purpose**: Sandbox-to-API authentication
- **Format**: `sbt_xxx` tokens
- **Validation**: Against `kortix.sandboxes` table
- **Usage**: Agents inside sandboxes making API calls
- **Scope**: Tied to specific sandbox instance

## Security Middleware Stack

### Authentication Middleware (`/services/kortix-api/src/middleware/auth.ts`)

1. **`apiKeyAuth`**: Validates `sk_` and `sbt_` tokens
2. **`supabaseAuth`**: Validates Supabase JWT tokens
3. **`previewProxyAuth`**: Combined auth for preview proxy (JWT or `sbt_`)
4. **`combinedAuth`**: Dual mode for cron/deployment routes
5. **`supabaseAuthWithQueryParam`**: SSE-compatible auth with query params

### CORS Configuration
- **Origins**: Production domains, localhost for dev, configurable extras
- **Methods**: GET, POST, PUT, PATCH, DELETE, OPTIONS
- **Headers**: Content-Type, Authorization
- **Credentials**: Enabled for auth cookies

## Token Management

### API Key Storage & Validation
```typescript
// Keys stored as:
{
  publicKey: string;      // sk_xxx prefix
  secretKeyHash: string;  // HMAC hash of full key
  sandboxId: UUID;        // Scope to specific sandbox
  status: 'active' | 'revoked' | 'expired';
}
```

### Sandbox Token Management
- Tokens stored as `authToken` field in `sandboxes` table
- Used for service-to-service authentication
- Automatically validated against account ownership

## Authorization Patterns

### Account-Based Access Control
- All resources scoped to `accountId` (UUID)
- Database queries filtered by account ownership
- Multi-tenant isolation at data layer

### Sandbox-Scoped Resources
- API keys tied to specific sandboxes
- Execution permissions based on sandbox ownership
- Preview proxy access controlled by sandbox authentication

### Role-Based Access (Limited)
- Basic admin role checking (currently returns `isAdmin: false`)
- User role system stubbed for future expansion
- Account roles via Basejump integration (`account_user` table)

## Security Features

### Token Security
- HMAC-based secret key hashing
- Configurable expiration for API keys
- Last used timestamp tracking
- Token revocation support

### Network Security
- CORS protection
- Request rate limiting (via HTTP proxy if configured)
- Secure headers (via Hono middleware)
- HTTPS enforcement in production

### Database Security
- Parameterized queries via Drizzle ORM
- Row-level security via account scoping
- Connection pooling and timeout management
- Migration-based schema management

## Authentication Flow Examples

### Frontend User Login
```
User → Supabase Auth → JWT Token → Frontend → API (supabaseAuth middleware)
```

### API Key Usage
```
External App → API Key (sk_xxx) → API (apiKeyAuth middleware) → Sandbox Access
```

### Sandbox Agent API Call
```
Agent → Sandbox Token (sbt_xxx) → API (combinedAuth middleware) → Platform Service
```

### Preview Proxy Access
```
Browser → JWT/sbt_ Token → API (previewProxyAuth) → WebSocket → Sandbox
```

## Security Considerations
- Environment-based configuration (`SUPABASE_JWT_SECRET`, `API_KEY_SECRET`)
- Service-to-service authentication via `INTERNAL_SERVICE_KEY`
- Optional sandbox protection via `SANDBOX_AUTH_TOKEN`
- Webhook signature validation for external services (Stripe)
