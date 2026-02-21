# Overall Architecture Findings

## Application Type
- **Monorepo Structure**: Uses Nx for workspace management with separate apps and services
- **Next.js Frontend** (`apps/frontend/`): React/TypeScript frontend application
- **Unified API Service** (`services/kortix-api/`): Hono-based Node.js/Bun API monolith
- **Microservices Architecture**: Multiple specialized services under `services/` directory

## Main Directories & Purposes

### `/apps/`
- `frontend/` - Next.js React dashboard/UI

### `/services/`
- `kortix-api/` - Main unified API service (combines router, billing, platform, etc.)
- `kortix-auth/` - Authentication service
- `kortix-billing/` - Billing and subscription management
- `kortix-cloud/` - Cloud-specific functionality
- `kortix-platform/` - Sandbox lifecycle management
- `kortix-router/` - API routing and proxy
- `kortix-daytona-proxy/` - Daytona cloud sandbox proxy
- `lss/` - Local Semantic Search service
- `opencode/` - OpenCode integration
- `voice/` - Voice functionality

### `/packages/`
- `db/` - Shared database schema and client (Drizzle ORM)
- `shared/` - Shared utilities and types

### Root Configuration
- `nx.json` - Nx workspace configuration
- `docker-compose.yml` - Container orchestration
- `pnpm-workspace.yaml` - PNPM workspace configuration

## Key Configuration Files
- **package.json**: Workspace root with Nx scripts for development
- **docker-compose.yml**: Defines frontend and kortix-api services
- **.env.example**: Comprehensive environment configuration template
- **supabase/**: Supabase configuration and migrations

## Database & External Integrations

### Database (PostgreSQL via Supabase)
- **Kortix Schema**: Custom tables for sandboxes, triggers, executions, deployments, channels
- **Public Schema**: Likely user management and auth
- **Drizzle ORM**: Type-safe database access
- **Schema Tables**: sandboxes, triggers, executions, deployments, channel_configs, api_keys, integrations

### External Services
- **Supabase**: Authentication, database, real-time subscriptions
- **Stripe**: Payment processing (cloud mode)
- **Daytona**: Cloud sandbox provider
- **Docker**: Local sandbox provider
- **Pipedream Connect**: OAuth integrations (3,000+ third-party apps)
- **Various LLM APIs**: OpenRouter, Anthropic, OpenAI, etc.
- **Tool APIs**: Tavily, Serper, Firecrawl, Replicate, Context7

## Deployment Modes
- **Local/Self-hosted**: Uses local Docker containers for sandboxes
- **Cloud**: Uses Daytona for managed sandboxes + Kortix Cloud services
- **Hybrid**: Configurable provider system allows mixing approaches
