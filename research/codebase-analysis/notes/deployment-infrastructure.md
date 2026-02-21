# Deployment & Infrastructure Findings

## Local Development Setup

### Prerequisites & Stack
- **Runtime**: Node.js/Bun for backend, Node.js for frontend
- **Package Manager**: PNPM workspace with Nx for monorepo management
- **Database**: PostgreSQL via Supabase (local or cloud)
- **Containerization**: Docker & Docker Compose

### Development Commands
```bash
# Environment setup
./scripts/setup-env.sh

# Development (parallel)
npm run dev                    # Both frontend + API
npm run dev:frontend          # Frontend only (port 3000)
npm run dev:services          # API only (port 8008)

# Docker development
npm run local:up              # Full local stack
npm run local:down            # Stop local stack
npm run local:logs            # View logs
```

### Local Architecture
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Kortix API    │    │   Sandbox       │
│   (port 3000)   │◄──►│   (port 8008)   │◄──►│ (Docker/Daytona)│
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                       ┌─────────────────┐
                       │   PostgreSQL    │
                       │   (via Supabase)│
                       └─────────────────┘
```

## Production Deployment Strategy

### Container Architecture
- **Multi-stage Dockerfile**: Optimized builds for each service
- **Service Profiles**: Backend, frontend, or full stack deployments
- **Environment-based Configuration**: `.env` files per service

### Docker Compose Profiles
```yaml
# docker-compose.yml profiles:
- backend: kortix-api only
- frontend: Next.js app only  
- all: Complete stack
```

### Deployment Modes

#### 1. Self-Hosted (Recommended)
- **Sandbox Provider**: `local_docker` 
- **Database**: Local Supabase or cloud Postgres
- **Authentication**: Supabase Auth
- **Billing**: Disabled (`NEXT_PUBLIC_BILLING_ENABLED=false`)
- **Scaling**: Single instance or load-balanced

#### 2. Cloud (Kortix Hosted)
- **Sandbox Provider**: `daytona` (managed containers)
- **Database**: Supabase cloud
- **Authentication**: Supabase Auth
- **Billing**: Stripe integration enabled
- **CDN**: Vercel/Netlify for frontend

#### 3. Hybrid
- **Configurable Providers**: Mix of local_docker and daytona
- **Multi-region**: Different providers per region
- **Failover**: Automatic provider switching

## Infrastructure Components

### Database Layer
```sql
-- Core schemas:
kortix.*     -- Application tables (sandboxes, triggers, etc.)
public.*     -- User management (via Supabase Auth)
basejump.*   -- Optional multi-tenant framework
```

### Storage & Persistence
- **Database**: PostgreSQL with connection pooling
- **File Storage**: Local filesystem or cloud storage
- **Session Data**: Database-persisted sessions
- **Logs**: Container logs + optional external logging

### Networking
- **Load Balancing**: Via Docker Compose or external LB
- **SSL/TLS**: Automatic via reverse proxy (Traefik, nginx)
- **WebSocket**: Native support in Bun server
- **CORS**: Configurable origins for multi-domain setups

## Environment Configurations

### Development (.env)
```bash
ENV_MODE=local
SUPABASE_URL=http://127.0.0.1:54321
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
ALLOWED_SANDBOX_PROVIDERS=local_docker
INTERNAL_KORTIX_ENV=dev
```

### Production (.env)
```bash
ENV_MODE=production
SUPABASE_URL=https://your-project.supabase.co
DATABASE_URL=postgresql://postgres:password@your-db:5432/postgres
ALLOWED_SANDBOX_PROVIDERS=daytona,local_docker
INTERNAL_KORTIX_ENV=prod
```

## Sandbox Infrastructure

### Local Docker Provider
- **Container Management**: Docker API integration
- **Network**: Custom Docker network or bridge
- **Port Mapping**: Dynamic port allocation
- **Volume Mounts**: Persistent workspace storage
- **Image**: `kortix/sandbox:latest`

### Daytona Provider  
- **Cloud Sandboxes**: Managed container infrastructure
- **API Integration**: Daytona SDK for lifecycle management
- **Scaling**: Auto-scaling container pools
- **Networking**: Built-in proxy and networking

### Sandbox Lifecycle
```
Provision → Active → [Pooled] → Archived
    ↓         ↓         ↓         ↓
  Docker   Running   Stopped   Cleaned
```

## Deployment Scripts & Automation

### Setup Scripts
- `scripts/setup-env.sh` - Environment distribution
- `scripts/get-kortix.sh` - One-click installer
- `scripts/tests/run-all.sh` - Test runner

### Docker Management
```bash
# Build all services
docker compose --profile all build

# Production deployment
docker compose --profile all up -d

# Update deployment
docker compose --profile all up --build -d
```

## Monitoring & Observability

### Health Checks
- **API Health**: `/health` and `/v1/health` endpoints
- **Service Status**: Scheduler, channels, queue status
- **Database**: Connection and schema validation

### Logging
- **Structured Logs**: JSON format with timestamps
- **Request Logging**: Hono middleware for HTTP requests
- **Error Tracking**: Centralized error handling

### Metrics (Configurable)
- **PostHog Analytics**: User behavior tracking
- **Performance**: Next.js Speed Insights
- **Database**: Connection pool metrics
- **Container**: Docker stats and resource usage
