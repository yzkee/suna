<div align="center">

# Kortix

**The complete platform for creating autonomous AI agents that work for you**

Build, manage, and train sophisticated AI agents for any use case. Create powerful agents that act autonomously on your behalf.

[![Discord Follow](https://dcbadge.limes.pink/api/server/RvFhXUdZ9H?style=flat)](https://discord.com/invite/RvFhXUdZ9H)
[![Twitter Follow](https://img.shields.io/twitter/follow/kortix)](https://x.com/kortix)
[![GitHub Repo stars](https://img.shields.io/github/stars/kortix-ai/suna)](https://github.com/kortix-ai/suna)
[![Issues](https://img.shields.io/github/issues/kortix-ai/suna)](https://github.com/kortix-ai/suna/labels/bug)

[Deutsch](https://www.readme-i18n.com/kortix-ai/suna?lang=de) |
[Español](https://www.readme-i18n.com/kortix-ai/suna?lang=es) |
[français](https://www.readme-i18n.com/kortix-ai/suna?lang=fr) |
[日本語](https://www.readme-i18n.com/kortix-ai/suna?lang=ja) |
[한국어](https://www.readme-i18n.com/kortix-ai/suna?lang=ko) |
[Português](https://www.readme-i18n.com/kortix-ai/suna?lang=pt) |
[Русский](https://www.readme-i18n.com/kortix-ai/suna?lang=ru) |
[中文](https://www.readme-i18n.com/kortix-ai/suna?lang=zh)

![Kortix Screenshot](apps/frontend/public/banner.png)
</div>

## What Makes Kortix Special

### Kortix Super Worker — Flagship Generalist AI Worker
Meet Kortix Super Worker, our showcase agent that demonstrates the full power of the Kortix platform. Through natural conversation, Kortix Super Worker handles research, data analysis, browser automation, file management, and complex workflows — showing you what's possible when you build with Kortix.

### Build Custom Agents
Create your own specialized agents tailored to specific domains, workflows, or business needs. Whether you need agents for customer service, data processing, content creation, or industry-specific tasks, Kortix provides the infrastructure and tools to build, deploy, and scale them.

### Platform Capabilities
- **Browser Automation** — Navigate websites, extract data, fill forms, automate web workflows
- **File Management** — Create, edit, and organize documents, spreadsheets, presentations, code
- **Web Intelligence** — Crawling, search, data extraction and synthesis
- **System Operations** — Command-line execution, system administration, DevOps tasks
- **API Integrations** — Connect with external services and automate cross-platform workflows via Composio (100+ integrations)
- **Agent Builder** — Configure, customize, and deploy agents with custom tools, knowledge bases, and triggers

## Table of Contents

- [What Makes Kortix Special](#what-makes-kortix-special)
- [Agent Examples & Use Cases](#agent-examples--use-cases)
- [Architecture](#architecture)
- [Monorepo Structure](#monorepo-structure)
- [Quick Start](#quick-start)
- [Contributing](#contributing)
- [License](LICENSE)

## Agent Examples & Use Cases

### Kortix Super Worker

**Research & Analysis** — Web research across multiple sources, document analysis, market intelligence, synthesized summaries

**Browser Automation** — Navigate complex sites, extract data from multiple pages, fill forms, automate repetitive web workflows

**File & Document Management** — Create and edit documents, spreadsheets, and presentations; organize file systems; generate reports

**Data Processing** — Clean and transform datasets, statistical analysis, visualizations, KPI monitoring, multi-API data integration

**System Administration** — Command-line operations, system configuration, DevOps automation, health monitoring

### Build Your Own Agents

**Customer Service** — Support tickets, FAQ responses, user onboarding, satisfaction tracking

**Content Creation** — Marketing copy, technical documentation, educational content, publishing schedules

**Sales & Marketing** — Lead qualification, CRM management, personalized outreach, sales forecasting

**Research & Development** — Academic research, trend monitoring, patent analysis, research reports

**Industry-Specific** — Healthcare (patient data, scheduling), Finance (risk, compliance), Legal (document review, case research), Education (curriculum, assessment)

Each agent can be configured with custom tools, workflows, knowledge bases, and integrations.

## Architecture

![Architecture Diagram](docs/images/diagram.png)

Kortix is a monorepo powered by **pnpm workspaces** and **Nx** for task orchestration. It spans four main layers:

| Layer | Tech | Purpose |
|-------|------|---------|
| **Backend API** | Python, FastAPI, LiteLLM | Agent orchestration, REST API, thread management, LLM integration (Anthropic, OpenAI, Google, xAI) |
| **Frontend Apps** | Next.js, React Native, Electron | Web dashboard, iOS/Android mobile app, desktop client |
| **Services** | Bun, Hono, TypeScript | Auth/billing microservice (Stripe), AI search/LLM routing gateway |
| **Database & Storage** | Supabase (PostgreSQL), Redis | Auth, user management, agent configs, conversation history, file storage, real-time subscriptions |

## Monorepo Structure

```
kortix/
├── apps/
│   ├── frontend/          # Next.js 15 web dashboard
│   ├── mobile/            # React Native + Expo 54 (iOS/Android)
│   └── desktop/           # Electron 33 desktop client
├── backend/               # FastAPI backend (Python)
├── services/
│   ├── kortix-auth/       # Bun/Hono — accounts, API keys, Stripe webhooks
│   └── kortix-router/     # Bun/Hono — web/image search, LLM routing
├── packages/
│   └── shared/            # @agentpress/shared — types, streaming, tools, utils
├── infra/                 # Pulumi IaC (AWS)
├── sandbox/               # Containerized code execution environments
├── docker-compose.yaml
├── setup.py               # Interactive setup wizard
├── start.py               # Service manager (start/stop/status)
├── nx.json                # Nx task orchestration config
└── pnpm-workspace.yaml    # Workspace definition
```

### Apps

| App | Stack | Description |
|-----|-------|-------------|
| **frontend** | Next.js 15, React 18, Tailwind 4, Radix UI, TipTap, CodeMirror | Full-featured agent dashboard with chat, file browser, admin analytics, billing, agent config UI |
| **mobile** | Expo 54, React Native 0.81, NativeWind | Native iOS/Android app with chat, agent management, quick actions, voice, triggers |
| **desktop** | Electron 33 | Native macOS/Windows/Linux wrapper with deep linking (`kortix://`) and OAuth handling |

### Services

| Service | Stack | Description |
|---------|-------|-------------|
| **kortix-auth** | Bun, Hono, Stripe, Supabase | API key management, account operations, Stripe webhook handling |
| **kortix-router** | Bun, Hono, Vercel AI SDK | Web/image search (Tavily, Serper), multi-provider LLM routing (Anthropic, OpenAI, Google, xAI, Groq) |

### Packages

| Package | Description |
|---------|-------------|
| **@agentpress/shared** | Shared TypeScript library — message types, streaming utilities, tool helpers, animations, constants |

## Quick Start

### 1. Clone the Repository
```bash
git clone https://github.com/kortix-ai/suna.git
cd suna
```

### 2. Run the Setup Wizard
```bash
python setup.py
```
The wizard guides you through configuring all required services with progress saving — resume if interrupted.

### 3. Manage the Platform
```bash
python start.py          # Interactive start/stop
python start.py start    # Start all services
python start.py stop     # Stop all services
python start.py status   # Show service status
python start.py restart  # Restart all services
```

### 4. Development (Nx commands)
```bash
pnpm install             # Install all workspace dependencies
pnpm dev                 # Start frontend + router in parallel
pnpm dev:frontend        # Start frontend only
pnpm dev:mobile          # Start mobile dev server
pnpm dev:router          # Start router service
pnpm dev:auth            # Start auth service
pnpm build               # Build all projects
pnpm typecheck           # Typecheck all projects
pnpm graph               # Visualize project dependency graph
```

### Viewing Logs

**Manual setup:**
```bash
tail -f backend.log frontend.log
```

**Docker setup:**
```bash
docker compose logs -f
docker compose logs -f backend
docker compose logs -f frontend
```

### 5. Add More API Keys (Optional)
Run `python setup.py` again to add/update LLM provider keys, search API keys, or other integrations.

## Tech Stack

| Area | Technologies |
|------|-------------|
| **Frontend** | Next.js 15, React 18, TypeScript, Tailwind 4, Radix UI, TipTap, CodeMirror, Recharts |
| **Mobile** | React Native 0.81, Expo 54, NativeWind, RevenueCat |
| **Desktop** | Electron 33 |
| **Services** | Bun, Hono, Vercel AI SDK, Stripe |
| **Backend** | FastAPI, Python, SQLAlchemy, LiteLLM, MCP |
| **Database** | Supabase (PostgreSQL), Redis |
| **AI/LLM** | Anthropic, OpenAI, Google, xAI, Groq (via LiteLLM) |
| **Infra** | Docker, Pulumi, AWS, GitHub Actions |
| **Observability** | Prometheus, Langfuse, Structlog |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide. The short version:

1. Fork the repo
2. Create a feature branch
3. `python setup.py` to configure your environment
4. Make your changes
5. Open a Pull Request

## License

[Kortix Public Source License (KPSL) v1.0](LICENSE)

---

<div align="center">

**Ready to build your first AI agent?**

[Get Started](#quick-start) | [Join Discord](https://discord.com/invite/RvFhXUdZ9H) | [Follow on Twitter](https://x.com/kortix)

</div>
