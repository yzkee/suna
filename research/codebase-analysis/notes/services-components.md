# Services & Components Findings

## Main Services Overview
The system uses a unified monolith approach with `kortix-api` as the main service that combines multiple sub-services.

## Kortix API Service (Port 8008)
The main `services/kortix-api/` runs on port 8008 and includes multiple sub-applications:

### Sub-Services in Kortix API
1. **Router** (`/v1/router/*`)
   - LLM proxy (`/chat/completions`, `/models`)
   - Web search proxy (`/web-search`, `/tavily/*`)
   - Tool routing and API key injection

2. **Billing** (`/v1/billing/*`)
   - Account state management
   - Stripe webhooks
   - Subscription handling

3. **Platform** (`/v1/platform/*`)
   - Sandbox lifecycle (provision, manage, archive)
   - Provider management (Daytona, local_docker)
   - Version tracking

4. **Cron** (`/v1/cron/*`)
   - Scheduled trigger management
   - Execution tracking
   - Background task scheduling

5. **Deployments** (`/v1/deployments/*`)
   - Deploy lifecycle management
   - Static site/app deployment

6. **Integrations** (`/v1/integrations/*`)
   - OAuth third-party app connections
   - Pipedream Connect integration

7. **Channels** (`/v1/channels/*`, `/webhooks/*`)
   - Multi-platform messaging (Telegram, Slack, Discord, etc.)
   - Session management per platform

8. **Preview Proxy** (`/v1/preview/*`)
   - Unified proxy for sandbox access
   - WebSocket support for PTY sessions
   - Handles both local Docker and cloud Daytona

### Additional Endpoints
- **Setup** (`/v1/setup/*`) - Environment setup and health checks
- **Providers** (`/v1/providers/*`) - Provider configuration
- **Secrets** (`/v1/secrets/*`) - Secret management
- **Servers** (`/v1/servers/*`) - Server entry persistence
- **Queue** (`/v1/queue/*`) - Message queue management

## Frontend Service (Port 3000)
- **Next.js Application**: React/TypeScript dashboard
- **Authentication**: Supabase Auth integration
- **API Communication**: Connects to kortix-api via `/v1` endpoints

## Communication Patterns

### HTTP APIs
- Frontend ↔ Kortix API: REST APIs over HTTP
- Kortix API ↔ Sandbox: HTTP proxy + WebSocket for PTY
- External Integrations: OAuth + REST APIs

### WebSocket Support
- PTY/Terminal sessions via WebSocket proxy
- Handles authentication via query params (EventSource/SSE limitation)
- Connection pooling and idle timeout management

### Background Processes

1. **Scheduler** (Cron Service)
   - Manages scheduled trigger execution
   - Runs background tasks
   - Auto-starts with API service

2. **Channel Service**
   - Handles multi-platform messaging
   - Background message processing
   - Auto-starts with API service

3. **Message Queue Drainer**
   - Processes queued messages
   - Filesystem-based persistence
   - Auto-starts with API service

## Service Dependencies
```
Frontend → Kortix API → [Database, Supabase Auth, External APIs]
                    → Sandbox (Docker/Daytona)
                    → Background Services (Scheduler, Channels, Queue)
```

## Load Balancing & Scalability
- Single monolith design for simplicity
- Individual services can be extracted for scaling
- Docker-based deployment supports horizontal scaling
- Database connection pooling via Drizzle ORM
