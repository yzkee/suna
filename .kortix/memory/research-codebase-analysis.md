# Kortix Codebase Architecture Analysis

## Executive Summary

Kortix is a comprehensive AI agent platform built as a monorepo using Next.js for the frontend and a unified Hono-based API service for the backend. The system supports both self-hosted and cloud deployment modes, with configurable sandbox providers (local Docker or cloud Daytona), multi-platform messaging channels, and extensive third-party integrations.

**Key Architecture Highlights:**
- **Monorepo Structure**: Nx-managed workspace with clear separation of apps, services, and packages
- **Unified API**: Single monolith combining router, billing, platform, cron, and proxy services
- **Flexible Deployment**: Supports local Docker sandboxes and cloud Daytona providers
- **Multi-Modal Auth**: JWT, API keys, and sandbox tokens for different use cases
- **PostgreSQL + Supabase**: Database and authentication infrastructure

## 1. Overall Architecture

### Application Structure
Kortix is a **monorepo** managed by Nx containing:

- **Frontend** (`apps/frontend/`): Next.js 15 React dashboard with TypeScript
- **Unified API** (`services/kortix-api/`): Hono-based Bun/Node.js service combining multiple sub-services
- **Shared Packages**: Database schema (`packages/db/`) and utilities (`packages/shared/`)
- **Additional Services**: Specialized services for auth, billing, cloud, etc.

### Technology Stack
- **Frontend**: Next.js 15, React 18, TypeScript, Tailwind CSS, Radix UI
- **Backend**: Hono (Web framework), Bun runtime, TypeScript
- **Database**: PostgreSQL with Drizzle ORM, Supabase for auth
- **Containerization**: Docker & Docker Compose
- **Package Management**: PNPM workspaces
- **Monorepo**: Nx for task orchestration and caching

### External Integrations
- **Authentication**: Supabase Auth with JWT tokens
- **Payments**: Stripe (cloud mode only)
- **Sandbox Providers**: Daytona (cloud) and local Docker
- **OAuth Integrations**: Pipedream Connect (3,000+ apps)
- **LLM APIs**: OpenRouter, Anthropic, OpenAI, XAI, Gemini
- **Tools**: Tavily, Serper, Firecrawl, Replicate, Context7

### Database Schema
The system uses PostgreSQL with multiple schemas:
- **`kortix.*`**: Application tables (sandboxes, triggers, executions, deployments, channels, api_keys, integrations)
- **`public.*`**: User management via Supabase Auth
- **`basejump.*`**: Optional multi-tenant framework

## 2. Services & Components

### Kortix API Service (Port 8008)
The main backend is a **unified monolith** that combines multiple sub-services under a single Hono application:

#### Core Sub-Services
1. **Router** (`/v1/router/*`)
   - LLM request proxy with API key injection
   - Web search and tool routing
   - Upstream API management

2. **Platform** (`/v1/platform/*`)
   - Sandbox lifecycle management (provision, active, archive)
   - Multi-provider support (Daytona, local Docker)
   - Resource allocation and monitoring

3. **Cron** (`/v1/cron/*`)
   - Scheduled trigger management
   - Background task execution
   - Retry and timeout handling

4. **Billing** (`/v1/billing/*`)
   - Stripe subscription management
   - Usage tracking and limits
   - Account state management

5. **Deployments** (`/v1/deployments/*`)
   - Static site and application deployment
   - Framework detection and build configuration
   - Domain management

6. **Integrations** (`/v1/integrations/*`)
   - OAuth app connections via Pipedream
   - Token management and refresh
   - Sandbox-scoped permissions

7. **Channels** (`/v1/channels/*`)
   - Multi-platform messaging (Telegram, Slack, Discord, etc.)
   - Session management strategies
   - Message queue processing

8. **Preview Proxy** (`/v1/preview/*`)
   - Unified sandbox access proxy
   - WebSocket support for PTY sessions
   - Authentication token validation

### Background Services
- **Scheduler**: Cron trigger execution (auto-started)
- **Channel Service**: Message processing (auto-started)  
- **Queue Drainer**: Filesystem-based message queue (auto-started)

### Frontend Service (Port 3000)
- **Next.js Application**: Server-side rendered React dashboard
- **Authentication**: Supabase Auth integration
- **Real-time Features**: WebSocket connections for PTY sessions
- **Rich Editor**: Tiptap-based collaborative editing

## 3. Authentication & Security

### Multi-Layer Authentication System

#### 1. Supabase JWT Authentication
- **Primary User Auth**: Frontend users via Supabase Auth
- **Token Format**: Standard Supabase JWT
- **Usage**: Platform endpoints, billing, user management
- **Context Variables**: `userId`, `userEmail`

#### 2. API Key Authentication (`sk_` prefix)
- **Purpose**: Programmatic API access for external integrations
- **Validation**: HMAC-hashed keys in `kortix.api_keys` table
- **Scope**: Sandbox-scoped permissions
- **Features**: Expiration, revocation, usage tracking

#### 3. Sandbox Token Authentication (`sbt_` prefix)  
- **Purpose**: Service-to-service authentication from sandboxes
- **Validation**: Against `kortix.sandboxes.authToken` field
- **Usage**: Agent API calls from within sandbox environments
- **Scope**: Tied to specific sandbox instances

### Security Middleware
The authentication system uses multiple middleware patterns:
- **`apiKeyAuth`**: Validates `sk_` and `sbt_` tokens
- **`supabaseAuth`**: JWT validation for user requests
- **`previewProxyAuth`**: Combined auth for preview proxy (supports both JWT and `sbt_`)
- **`combinedAuth`**: Dual-mode for cron/deployment routes

### Authorization & Access Control
- **Account-Based Isolation**: All resources scoped to `accountId`
- **Sandbox-Scoped Resources**: API keys and executions tied to specific sandboxes
- **Row-Level Security**: Database queries filtered by ownership
- **CORS Protection**: Configurable origins with credential support

## 4. Deployment & Infrastructure

### Local Development Setup
```bash
# Environment setup
cp .env.example .env
./scripts/setup-env.sh

# Development modes
npm run dev                 # Full stack (frontend + API)
npm run dev:frontend       # Frontend only
npm run dev:services       # API only

# Docker development
npm run local:up           # Complete Docker stack
```

### Production Deployment Strategies

#### Self-Hosted Deployment (Recommended)
- **Sandbox Provider**: Local Docker containers
- **Database**: Local Supabase or managed PostgreSQL
- **Billing**: Disabled for self-hosted use
- **Scaling**: Docker Compose with configurable profiles

#### Cloud Deployment (Kortix Hosted)
- **Sandbox Provider**: Daytona managed containers
- **Database**: Supabase cloud with automatic scaling
- **Billing**: Full Stripe integration enabled
- **CDN**: Vercel/Netlify for frontend delivery

### Container Architecture
```yaml
# Docker Compose profiles:
services:
  frontend:     # Next.js app (port 3000)
  kortix-api:   # Unified API (port 8008)
  # External: PostgreSQL, Redis (if needed)
```

### Infrastructure Components

#### Sandbox Management
- **Local Docker**: Direct container API integration
- **Daytona Cloud**: SDK-based managed containers
- **Lifecycle**: Provision → Active → Pooled → Archived
- **Networking**: Custom Docker networks or cloud routing

#### Database Layer
- **Primary**: PostgreSQL with Drizzle ORM
- **Connection Pooling**: Built-in connection management
- **Migrations**: Version-controlled schema management
- **Backup**: Supabase automated backups (cloud) or custom (self-hosted)

#### Monitoring & Observability
- **Health Checks**: `/health` endpoints with service status
- **Logging**: Structured JSON logs with request tracing
- **Metrics**: Optional PostHog analytics and performance monitoring
- **Error Tracking**: Centralized error handling and reporting

## Conclusions

Kortix demonstrates a well-architected monorepo with clear separation of concerns, flexible deployment options, and comprehensive authentication. The unified API approach simplifies operations while maintaining modularity through internal service separation.

**Strengths:**
- Clean monorepo structure with shared dependencies
- Multi-modal authentication supporting different use cases
- Flexible sandbox providers (local Docker + cloud Daytona)
- Comprehensive integration ecosystem (3,000+ apps via Pipedream)
- Production-ready with both self-hosted and cloud deployment paths

**Key Design Decisions:**
- Unified API monolith for operational simplicity
- PostgreSQL with Supabase for authentication and real-time features
- Docker-first approach for consistent environments
- Environment-driven configuration for multi-mode deployment

The architecture successfully balances developer experience, operational simplicity, and production scalability while maintaining flexibility for different deployment scenarios.

---

**Analysis Date**: February 21, 2026  
**Source Files Analyzed**: 15+ configuration files, package definitions, and service implementations  
**Confidence Level**: High (based on direct codebase examination)
