---
name: agent-harness
description: "Agent Harness Engineering — build, configure, and wire up OpenCode/Kortix agents. Covers the complete harness: agent identity (system prompt), control surface (permissions, tools, mode), activation layer (cron/webhook triggers), and composition (skills, commands, plugins). Load this skill when: creating a new agent, adding triggers to an existing agent, designing multi-agent systems, or wiring automation into an agent's lifecycle."
---

# Agent Harness Engineering

## What is a Harness?

**Agent = Model + Harness.**

If you're not the model, you're the harness.

A **harness** is every piece of code, configuration, and execution logic that isn't the model itself. A raw model is not an agent. It becomes one when a harness gives it identity, tools, state, feedback loops, and enforceable constraints.

The term comes from test engineering — a *test harness* is the infrastructure that surrounds, drives, and constrains the system under test (stubs, drivers, fixtures, controlled environments). For AI agents, the harness wraps the model to make its intelligence useful, safe, and directed.

### Framework vs Runtime vs Harness

The industry has converged on a clear taxonomy:

| Layer | What it provides | Examples |
|---|---|---|
| **Framework** | Abstractions + integrations (tool calling, prompting, model connectors) | LangChain, Vercel AI SDK, OpenAI Agents SDK |
| **Runtime** | Durable execution, streaming, persistence, human-in-the-loop | LangGraph, Temporal, Inngest |
| **Harness** | Complete opinionated wrapper — identity + tools + constraints + activation + knowledge | OpenCode, Deep Agents SDK, Claude Agent SDK |

A harness sits at the top of this stack. It's the most opinionated layer — it ships with default prompts, built-in tools, filesystem access, planning capabilities, and orchestration logic. It turns a model into a functioning agent.

> *"The model contains the intelligence. The harness is the system that makes that intelligence useful."* — Vivek Trivedy, LangChain

---

## The Five Layers of a Harness

```
┌──────────────────────────────────────────────────┐
│  5. ACTIVATION                                    │
│     What wakes the agent up                       │
│     user prompt · cron · webhook · pipedream      │
├──────────────────────────────────────────────────┤
│  4. IDENTITY                                      │
│     Who the agent is                              │
│     system prompt · name · description · mode     │
├──────────────────────────────────────────────────┤
│  3. CAPABILITY                                    │
│     What the agent can do                         │
│     tools · MCP servers · custom tools · plugins  │
├──────────────────────────────────────────────────┤
│  2. PERMISSION                                    │
│     What the agent is allowed to do               │
│     tool grants · bash globs · guardrails · steps │
├──────────────────────────────────────────────────┤
│  1. KNOWLEDGE                                     │
│     What the agent knows how to do                │
│     skills · commands · AGENTS.md · rules files   │
└──────────────────────────────────────────────────┘
```

Every agent you build touches all five layers. Miss one and the harness is incomplete.

---

## Layer 1: Knowledge

Knowledge is the foundation — what the agent knows how to do before it starts thinking.

### AGENTS.md — project rules

`AGENTS.md` in the project root gives all agents project-specific rules (coding conventions, architecture decisions, forbidden patterns). Injected into context on every session start.

### Skills — on-demand expertise

Skills are `SKILL.md` files the agent loads when it needs domain knowledge. They solve the **progressive disclosure** problem — loading all knowledge upfront causes context rot, so skills inject knowledge only when needed.

```markdown
# In your agent's system prompt:
When building presentations, load the `presentations` skill.
When deploying, load the `kortix-system` skill.
```

Skill locations: `.opencode/skills/<name>/SKILL.md` or `~/.config/opencode/skills/<name>/SKILL.md`

### Commands — user-initiated workflows

Commands are `/slash`-triggered prompt templates routed to a specific agent:

```markdown
<!-- commands/deploy.md -->
---
description: "Deploy the application"
agent: deploy-agent
---

Deploy with these parameters: $ARGUMENTS
```

User types `/deploy staging` → routed to `deploy-agent` with "staging" injected.

---

## Layer 2: Permission

Permission is the trust boundary. Every `allow` is a surface for mistakes.

### Tool permissions

Set per-tool in agent frontmatter or `opencode.jsonc`:

```yaml
permission:
  bash: allow        # allow | deny | ask
  edit: allow
  write: allow
  read: allow
  task: allow        # Can spawn subagents
  skill: allow       # Can load skills
  web-search: allow
  todowrite: allow   # Denied in subagent sessions by default
```

### Granular bash control

Use glob patterns — last matching rule wins:

```yaml
permission:
  bash:
    "*": ask               # Ask for everything by default
    "git status*": allow   # Allow git status
    "git push*": deny      # Never allow push
    "rm -rf*": deny        # Never allow recursive delete
    "grep *": allow
```

### Permission archetypes

```yaml
# Read-only analyst — safest
permission:
  bash: deny
  edit: deny
  write: deny
  read: allow
  web-search: allow

# Code generator — writes but can't execute
permission:
  bash: deny
  read: allow
  edit: allow
  write: allow

# Full autonomy — maximum trust
permission:
  bash: allow
  read: allow
  edit: allow
  write: allow
  task: allow
  skill: allow
```

### Steps limit — cost and safety guardrail

```yaml
steps: 10   # Force agent to summarize and stop after N tool calls
```

Prevents runaway loops. When hit, the agent receives a system message to wrap up.

### Built-in safety

OpenCode enforces protections automatically:
- `.env` file reads denied by default
- External directory writes trigger warnings
- Doom-loop detection stops infinite tool-call cycles

---

## Layer 3: Capability

Capability defines what the agent *can* do — the tools, servers, and extensions available.

### The Agent-Computer Interface (ACI)

Anthropic introduced the concept of the **Agent-Computer Interface** — the idea that you should invest as much effort designing how agents interact with tools as you would designing a human-computer interface. Tool descriptions, parameter names, and output formats are the UX of your agent's world.

> *"Think about how much effort goes into HCI, and plan to invest just as much effort into creating good agent-computer interfaces."* — Anthropic

### Built-in tools

| Tool | What it does |
|---|---|
| `bash` | Execute shell commands — the general-purpose problem-solving tool |
| `read` | Read files |
| `edit` | Edit files (string replacement) |
| `write` | Create/overwrite files |
| `glob` | File pattern matching |
| `grep` | Content search |
| `task` | Spawn subagent sessions |
| `skill` | Load skills on demand |
| `todowrite` | Track tasks and progress |
| `question` | Ask user questions |

### Custom tools

TypeScript files in `tools/*.ts`:

```typescript
import { Tool } from "opencode/tool"
import z from "zod"

export default Tool.define("my-tool", async (ctx) => {
  return {
    description: "What this tool does",
    parameters: z.object({
      input: z.string().describe("Input parameter"),
    }),
    async execute(params, ctx) {
      return { title: "Result", output: "Output text" }
    },
  }
})
```

### MCP servers — external capabilities

```jsonc
// opencode.jsonc
{
  "mcp": {
    "context7": {
      "type": "remote",
      "url": "https://mcp.context7.com/mcp",
      "enabled": true
    }
  }
}
```

### Tool name priority

When names collide: **Plugin > Custom > MCP > Built-in**

### Controlling tools per agent

```yaml
tools:
  bash: false       # Disable bash for this agent
  skill: false      # Disable skill loading
  mymcp_*: false    # Wildcard: disable all tools from an MCP server
```

---

## Layer 4: Identity

Identity is who the agent is — the system prompt, name, role, and behavioral constraints.

### Agent file format

An agent is a `.md` file with YAML frontmatter. Filename = agent name.

**Locations:**
- Project: `.opencode/agents/<name>.md`
- Global: `~/.config/opencode/agents/<name>.md`

### Minimal agent

```markdown
---
description: "Reviews code for security and performance issues"
mode: subagent
---

# Code Reviewer

You are a senior code reviewer. You analyze code for:
- Security vulnerabilities
- Performance bottlenecks
- Maintainability issues

Given code to review:
1. Read the files thoroughly
2. Identify issues by severity
3. Suggest specific fixes

Output: A structured review with severity ratings and fix suggestions.
```

### Full frontmatter reference

```yaml
---
description: "Required. Shown in UI and Task tool."
mode: primary          # primary | subagent | all
model: anthropic/claude-sonnet-4-6  # optional override
temperature: 0.3       # 0.0–1.0
steps: 20              # max tool iterations
hidden: false          # hide from @ autocomplete (subagents only)
color: "#ff6b6b"       # UI color
permission:
  bash: allow
  edit: allow
  # ...
triggers:              # see Layer 5
  - name: "My Trigger"
    ...
---

# Agent Name

System prompt body — this entire markdown becomes the system prompt.
```

### Modes

| Mode | User-selectable | Task tool | Use case |
|---|---|---|---|
| `primary` | Yes (Tab) | Hidden, but self-spawnable by name | Main agent |
| `subagent` | No (@ mention) | Listed and spawnable | Specialist |
| `all` | Yes | Yes | Available everywhere |

**Self-spawning:** A `primary` agent can spawn itself via `subagent_type: "agent-name"` — `Agent.get()` has no mode guard.

### Model selection

```yaml
model: anthropic/claude-sonnet-4-6   # Balanced
model: anthropic/claude-opus-4-6     # Max capability
model: anthropic/claude-haiku-4-6    # Fast, cheap
```

If omitted: primary agents use the global model; subagents inherit from the invoking primary.

### The description field is load-bearing

For subagents, `description` is the API contract — it's what the orchestrator reads to decide whether to invoke this agent.

Bad: `"Helper agent"`
Good: `"Reviews code for security vulnerabilities. Use for PR reviews and audits. Do NOT use for writing new code."`

### System prompt design

```markdown
You are [role] specializing in [domain].

Your responsibilities:
1. [Primary]
2. [Secondary]

Process:
1. [Step]
2. [Step]

Output format:
- [What to include]

Edge cases:
- [Case]: [How to handle]
```

**Do:** Second person, specific responsibilities, defined output format, edge case handling.
**Don't:** First person, vague instructions, undefined output format.

---

## Layer 5: Activation

Activation is what wakes the agent up. By default: user prompts and Task tool invocations. Triggers add automated activation.

Powered by the `@kortix/opencode-agent-triggers` plugin.

### Plugin setup

```jsonc
// opencode.jsonc
{
  "plugin": ["@kortix/opencode-agent-triggers"]
}
```

### Cron triggers — time-based

```yaml
triggers:
  - name: "Daily Standup"
    enabled: true
    source:
      type: "cron"
      expr: "0 0 9 * * 1-5"     # 9am Mon-Fri
      timezone: "America/New_York"
    execution:
      prompt: "Generate a daily standup summary from recent git commits."
      session_mode: "new"
```

**6-field cron:** `seconds minutes hours day month weekday`

```
"0 0 9 * * 1-5"    — Weekdays 9am
"0 0 10 * * 6"     — Saturday 10am
"0 */15 * * * *"   — Every 15 minutes
"0 0 0 * * *"      — Midnight daily
```

### Webhook triggers — HTTP events

```yaml
triggers:
  - name: "GitHub PR"
    enabled: true
    source:
      type: "webhook"
      path: "/hooks/github-pr"
      method: "POST"
      secret: "your-secret"
    context:
      extract:
        pr_title: "data.body.pull_request.title"
        action: "data.body.action"
      include_raw: true
    execution:
      prompt: |
        GitHub PR event: {{ action }}
        Title: {{ pr_title }}
        Review this PR.
      session_mode: "new"
```

- URL: `<publicBaseUrl>/<agent-name><path>`
- Secret header: `X-Kortix-OpenCode-Trigger-Secret`
- Template variables: `{{ var_name }}` — extracted via dot-path from event payload

### Pipedream triggers — third-party events

```yaml
triggers:
  - name: "New GitHub Issue"
    enabled: true
    source:
      type: "pipedream"
      componentKey: "github-new-issue"
      app: "github"
      configuredProps:
        repoFullName: "owner/repo"
    execution:
      prompt: "Triage this new GitHub issue."
      session_mode: "new"
```

Requires: `PIPEDREAM_CLIENT_ID`, `PIPEDREAM_CLIENT_SECRET`, `PIPEDREAM_PROJECT_ID`

### Session modes

| Mode | Behavior |
|---|---|
| `new` | Fresh session — stateless, clean, predictable |
| `reuse` | Same session — stateful, but risks context accumulation |

### Trigger management tools

| Tool | Purpose |
|---|---|
| `agent_triggers` | List all discovered triggers and state |
| `sync_agent_triggers` | Re-read agent markdown, refresh triggers |
| `cron_triggers` | CRUD + pause/resume/run cron triggers |
| `event_triggers` | Manage Pipedream event listeners |

---

## Composition Patterns

### Pattern 1: Single autonomous agent

One agent, full permissions, handles everything. The simplest harness.

```markdown
---
description: "General-purpose project assistant"
mode: primary
permission:
  bash: allow
  edit: allow
  write: allow
  read: allow
  task: allow
  skill: allow
---

# Project Assistant

You handle all tasks for this project...
```

### Pattern 2: Orchestrator + specialists

A primary agent delegates to focused subagents with least-privilege permissions.

```
Primary (user-facing, full access)
    ├── @code-reviewer (read-only)
    ├── @test-runner (bash + read, no writes)
    └── @docs-writer (write + read, no bash)
```

### Pattern 3: Scheduled worker

An agent that runs on a timer without human interaction:

```yaml
---
description: "Weekly maintenance"
mode: subagent
hidden: true
permission:
  bash: allow
  read: allow
  write: allow
triggers:
  - name: "Weekly Cleanup"
    enabled: true
    source:
      type: "cron"
      expr: "0 0 2 * * 0"
      timezone: "UTC"
    execution:
      prompt: "Prune stale branches, archive old logs, update deps."
      session_mode: "new"
---
```

### Pattern 4: Event-driven pipeline

Multiple triggers, different events, different prompts:

```yaml
triggers:
  - name: "PR Opened"
    source:
      type: "webhook"
      path: "/hooks/pr"
    execution:
      prompt: "Review this PR, run tests, post a comment."

  - name: "Deploy Request"
    source:
      type: "webhook"
      path: "/hooks/deploy"
      secret: "{env:DEPLOY_SECRET}"
    execution:
      prompt: "Deploy the application."
      session_mode: "new"
```

### Pattern 5: Self-spawning primary

A primary that clones itself for parallel work:

```markdown
---
mode: primary
permission:
  task: allow
---

# Orchestrator

Spawn copies of yourself via Task tool with
`subagent_type: "orchestrator"` for parallel work.
```

---

## Design Principles

**1. Start minimal, add capability.** Tightest permissions that work. Open up only when you hit a wall.

**2. Name for role, not mechanism.** `code-reviewer` not `file-reader`. The name communicates intent.

**3. Permission = trust boundary.** Every `allow` is a surface for mistakes. If an agent doesn't need bash, deny it.

**4. Triggers are contracts.** A cron fires whether you're watching or not. Write the prompt as if no human will review the output.

**5. Session mode is a design choice.** `new` = stateless, predictable. `reuse` = contextual, but risks context rot.

**6. Test before you trust.** Run `cron_triggers action=run trigger_id=<id>` manually before enabling automation.

**7. Description is the API.** For subagents, treat it like a function signature — precise about when to call and when NOT to.

**8. The model is the least important choice.** Get the harness right first. Identity, permissions, and tools matter more than model selection.

**9. Separate concerns.** Focused specialists with tight permissions, orchestrated by a primary. Don't build one god-agent.

**10. Observe before you automate.** Run an agent manually several times. Understand its failure modes. Only then wire it to a trigger.

---

## Quick Reference

### Minimum viable agent

```markdown
---
description: "What it does and when to use it"
mode: subagent
permission:
  read: allow
  write: allow
---

# Agent Name

You are [role]. [Core behavior in 2-3 sentences.]

Given a task:
1. [Step]
2. [Step]

Output: [what to produce]
```

### Minimum viable cron trigger

```yaml
triggers:
  - name: "My Trigger"
    enabled: true
    source:
      type: "cron"
      expr: "0 0 9 * * 1-5"
    execution:
      prompt: "Do this thing every weekday morning."
      session_mode: "new"
```

### Minimum viable webhook trigger

```yaml
triggers:
  - name: "My Webhook"
    enabled: true
    source:
      type: "webhook"
      path: "/hooks/my-event"
      secret: "{env:WEBHOOK_SECRET}"
    execution:
      prompt: "Handle the incoming event."
      session_mode: "new"
```

### Install triggers plugin

```jsonc
// opencode.jsonc
{
  "plugin": ["@kortix/opencode-agent-triggers"]
}
```
