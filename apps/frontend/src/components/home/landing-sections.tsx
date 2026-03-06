'use client';

import Link from 'next/link';
import {
  ArrowRight,
  Cpu,
  Globe,
  Shield,
  Cloud,
  Terminal,
  Layers,
  Workflow,
  HardDrive,
  Lock,
  Server,
  MonitorSmartphone,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

/* ═══════════════════════════════════════════════════════════════
   1. WHAT IS KORTIX
   ═══════════════════════════════════════════════════════════════ */
function WhatIsSection() {
  return (
    <section className="w-full py-20 md:py-28">
      <div className="max-w-5xl mx-auto px-6">
        <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
          What is Kortix
        </p>
        <h2 className="text-3xl sm:text-4xl md:text-5xl font-medium tracking-tighter text-foreground leading-tight max-w-3xl">
          An AI Computer you install and own.
        </h2>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl leading-relaxed">
          Kortix is an operating system for AI. Install it on a server &mdash; your
          own machine, a VPS, or Kortix Cloud. Connect your data sources, deploy
          agents, and let it run 24/7.
        </p>
        <p className="mt-4 text-lg text-muted-foreground max-w-2xl leading-relaxed">
          Your entire business context lives in the filesystem. Every agent
          shares it. Nothing gets lost.
        </p>

        {/* Contrast block */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-border bg-card p-6 space-y-3">
            <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Traditional AI tools
            </p>
            <p className="text-foreground font-medium">Help humans work.</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Isolated chat windows. They forget everything. Can&apos;t access your
              systems. They help you work instead of working for you.
            </p>
          </div>
          <div className="rounded-2xl border border-foreground/20 bg-card p-6 space-y-3 ring-1 ring-foreground/5">
            <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Kortix
            </p>
            <p className="text-foreground font-medium">Works.</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              You don&apos;t chat with Kortix. You deploy it, configure it, and it
              runs &mdash; handling tasks, making decisions, executing workflows
              while you sleep.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   2. HOW IT WORKS
   ═══════════════════════════════════════════════════════════════ */
function HowItWorksSection() {
  const steps = [
    {
      step: '01',
      title: 'Install Kortix',
      description:
        'On your laptop, any VPS (Hetzner, DigitalOcean, AWS), or get a managed Kortix Cloud instance. Five minutes to a running system.',
    },
    {
      step: '02',
      title: 'Connect your data',
      description:
        'Google Workspace, Slack, databases, CRM, accounting software, file storage. Everything mounts into a unified filesystem.',
    },
    {
      step: '03',
      title: 'Deploy agents',
      description:
        'Each agent is an autonomous worker with a job — support tickets, invoice processing, candidate screening. They share context and coordinate.',
    },
    {
      step: '04',
      title: 'Let it run',
      description:
        'Kortix runs continuously. SSH in when you want. Check status, review outputs, adjust config. Full control, full visibility.',
    },
  ];

  return (
    <section className="w-full py-20 md:py-28 bg-muted/30">
      <div className="max-w-5xl mx-auto px-6">
        <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
          How it works
        </p>
        <h2 className="text-3xl sm:text-4xl md:text-5xl font-medium tracking-tighter text-foreground leading-tight max-w-3xl">
          Install. Connect. Deploy. Run.
        </h2>

        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map((s) => (
            <div key={s.step} className="space-y-4">
              <span className="text-sm font-mono text-muted-foreground/60">
                {s.step}
              </span>
              <h3 className="text-lg font-semibold text-foreground">{s.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {s.description}
              </p>
            </div>
          ))}
        </div>

        {/* Architecture diagram */}
        <div className="mt-16 rounded-2xl border border-border bg-card overflow-hidden">
          <div className="font-mono text-xs sm:text-sm leading-relaxed p-6 sm:p-8 text-muted-foreground overflow-x-auto">
            <div className="min-w-[400px]">
              <p className="text-foreground font-medium mb-4">The Stack</p>
              <div className="space-y-0">
                <div className="border border-border/60 rounded-t-lg px-4 py-2.5 bg-muted/30">
                  <span className="text-foreground">Your Agents</span>
                  <span className="text-muted-foreground/60 ml-2">custom &middot; community &middot; third-party</span>
                </div>
                <div className="border-x border-border/60 px-4 py-2.5">
                  <span className="text-foreground">Skills &middot; MCP &middot; Tools</span>
                  <span className="text-muted-foreground/60 ml-2">browser, shell, APIs, databases</span>
                </div>
                <div className="border border-border/60 px-4 py-2.5 bg-muted/20">
                  <span className="text-foreground">OpenCode Engine</span>
                  <span className="text-muted-foreground/60 ml-2">plan, act, recover, repeat</span>
                </div>
                <div className="border-x border-b border-border/60 rounded-b-lg px-4 py-2.5">
                  <span className="text-foreground">Business Context</span>
                  <span className="text-muted-foreground/60 ml-2">unified filesystem &mdash; all your data</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   3. FILESYSTEM
   ═══════════════════════════════════════════════════════════════ */
function FilesystemSection() {
  return (
    <section className="w-full py-20 md:py-28">
      <div className="max-w-5xl mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-start">
          {/* Left: copy */}
          <div>
            <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
              Everything is a file
            </p>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-medium tracking-tighter text-foreground leading-tight">
              Context in the filesystem.
            </h2>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
              Most AI systems scatter context across APIs, sessions, and
              proprietary formats. Fragmented, hard to inspect, hard to trust.
            </p>
            <p className="mt-4 text-lg text-muted-foreground leading-relaxed">
              Kortix puts everything in the filesystem. Agents read context.
              Agents write outputs. You can <code className="text-foreground font-mono text-sm bg-muted px-1.5 py-0.5 rounded">cat</code>,{' '}
              <code className="text-foreground font-mono text-sm bg-muted px-1.5 py-0.5 rounded">grep</code>,{' '}
              <code className="text-foreground font-mono text-sm bg-muted px-1.5 py-0.5 rounded">tail&nbsp;-f</code>{' '}
              anything. It&apos;s just Unix.
            </p>
          </div>

          {/* Right: filesystem tree */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border/60 flex items-center gap-2">
              <div className="flex gap-1.5">
                <div className="size-2.5 rounded-full bg-red-500/60" />
                <div className="size-2.5 rounded-full bg-yellow-500/60" />
                <div className="size-2.5 rounded-full bg-green-500/60" />
              </div>
              <span className="text-xs font-mono text-muted-foreground/60 ml-2">
                ~/kortix
              </span>
            </div>
            <div className="font-mono text-xs sm:text-sm leading-relaxed p-5 text-muted-foreground">
              <pre className="whitespace-pre">{`/kortix
├── /context
│   ├── /company        # org knowledge
│   ├── /customers      # customer data
│   ├── /finances       # books, invoices
│   └── /comms          # emails, slack
├── /agents
│   ├── /support        # agent + state
│   ├── /bookkeeper     # agent + state
│   └── /recruiter      # agent + state
├── /skills             # installed skills
├── /workflows          # multi-step flows
└── /logs
    └── /2026-03-06     # everything logged`}</pre>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   4. AGENTS TABLE
   ═══════════════════════════════════════════════════════════════ */
function AgentsSection() {
  const agents = [
    {
      name: 'Support',
      description:
        'Monitors inbox and tickets. Reads customer history from context. Responds, resolves, escalates when necessary.',
    },
    {
      name: 'Bookkeeper',
      description:
        'Watches for new transactions. Categorizes, reconciles, flags anomalies. Generates reports on schedule.',
    },
    {
      name: 'Recruiter',
      description:
        'Sources candidates from job boards. Screens against criteria. Schedules interviews. Follows up.',
    },
    {
      name: 'Lead Gen',
      description:
        'Researches target companies. Finds contacts. Sends personalized outreach. Qualifies responses.',
    },
    {
      name: 'Data Ops',
      description:
        'Moves data between systems. Cleans, transforms, validates. Generates scheduled reports.',
    },
    {
      name: 'Assistant',
      description:
        'Calendar management, email drafts, research, reminders. Your personal operations layer.',
    },
  ];

  return (
    <section className="w-full py-20 md:py-28 bg-muted/30">
      <div className="max-w-5xl mx-auto px-6">
        <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
          Agents
        </p>
        <h2 className="text-3xl sm:text-4xl md:text-5xl font-medium tracking-tighter text-foreground leading-tight max-w-3xl">
          If a human does it on a computer, Kortix can do it.
        </h2>
        <p className="mt-4 text-lg text-muted-foreground max-w-2xl">
          Agents run continuously. They pick up tasks, complete them, move to the
          next. When they hit exceptions, they handle them or escalate to you.
        </p>

        {/* Agent grid */}
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((a) => (
            <div
              key={a.name}
              className="rounded-2xl border border-border bg-card p-5 space-y-2 transition-colors hover:border-foreground/20"
            >
              <h3 className="text-base font-semibold text-foreground">
                {a.name}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {a.description}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-8 text-sm text-muted-foreground/60">
          Or build your own. An agent is code that runs on Kortix with access to
          the filesystem, skills, and tools.
        </p>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   5. OPENCODE ENGINE + ECOSYSTEM
   ═══════════════════════════════════════════════════════════════ */
function OpenCodeSection() {
  const features = [
    {
      icon: Workflow,
      title: 'Skills',
      description:
        'Modular capabilities agents invoke — file ops, browser automation, API calls, database queries, shell commands. Extensible and composable.',
      link: 'https://opencode.ai/docs/skills',
      linkLabel: 'Explore Skills',
    },
    {
      icon: Layers,
      title: 'MCP Protocol',
      description:
        'Model Context Protocol — standard interface for connecting AI to tools and data sources. Works with the growing MCP ecosystem.',
      link: null,
      linkLabel: null,
    },
    {
      icon: Cpu,
      title: 'Model Agnostic',
      description:
        'Use any LLM provider. OpenAI, Anthropic, local models, whatever. Swap models without rewriting agents.',
      link: null,
      linkLabel: null,
    },
    {
      icon: Globe,
      title: 'Agent Browser',
      description:
        'Built-in headless browser. Agents browse the web, fill forms, take screenshots, interact with any website autonomously.',
      link: null,
      linkLabel: null,
    },
    {
      icon: Terminal,
      title: 'Full Shell Access',
      description:
        'Every agent has a persistent Linux sandbox with filesystem, terminal, and installed tools. State persists across sessions.',
      link: null,
      linkLabel: null,
    },
    {
      icon: HardDrive,
      title: 'Persistent Memory',
      description:
        'Long-term memory, session history, and observations. Agents remember context across conversations and tasks.',
      link: null,
      linkLabel: null,
    },
  ];

  return (
    <section className="w-full py-20 md:py-28">
      <div className="max-w-5xl mx-auto px-6">
        <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
          Powered by OpenCode
        </p>
        <h2 className="text-3xl sm:text-4xl md:text-5xl font-medium tracking-tighter text-foreground leading-tight max-w-3xl">
          Built on the open agent ecosystem.
        </h2>
        <p className="mt-4 text-lg text-muted-foreground max-w-2xl">
          The execution layer runs on{' '}
          <Link
            href="https://opencode.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline underline-offset-4 decoration-border hover:decoration-foreground transition-colors"
          >
            OpenCode Engine
          </Link>{' '}
          &mdash; an open runtime for autonomous AI. Not a walled garden.
        </p>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f) => (
            <div
              key={f.title}
              className="group rounded-2xl border border-border bg-card p-6 space-y-3 transition-colors hover:border-foreground/20"
            >
              <div className="inline-flex items-center justify-center size-10 rounded-xl bg-muted group-hover:bg-foreground/5 transition-colors">
                <f.icon className="size-5 text-muted-foreground" />
              </div>
              <h3 className="text-base font-semibold text-foreground">
                {f.title}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {f.description}
              </p>
              {f.link && (
                <Link
                  href={f.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-foreground font-medium hover:underline underline-offset-4"
                >
                  {f.linkLabel}
                  <ArrowRight className="size-3" />
                </Link>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   6. YOUR CONTROL
   ═══════════════════════════════════════════════════════════════ */
function ControlSection() {
  const points = [
    {
      icon: Terminal,
      title: 'SSH Access',
      description: 'Full shell access to your instance. It\'s your server.',
    },
    {
      icon: Lock,
      title: 'Data Sovereignty',
      description:
        'Self-host and your data never leaves your infrastructure. No third-party processing.',
    },
    {
      icon: Shield,
      title: 'Root Control',
      description:
        'Install packages, modify configurations, customize anything.',
    },
    {
      icon: MonitorSmartphone,
      title: 'Portability',
      description:
        'Your entire instance is files on disk. Tar it up, move it, restore from backup. No lock-in.',
    },
  ];

  return (
    <section className="w-full py-20 md:py-28 bg-muted/30">
      <div className="max-w-5xl mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-start">
          {/* Left: copy */}
          <div>
            <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
              Your computer. Your control.
            </p>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-medium tracking-tighter text-foreground leading-tight">
              Not a SaaS dashboard.
              <br />A computer you SSH into.
            </h2>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
              Kortix gives you a machine you actually control. Not an abstraction
              layer. Not a walled garden. A real computer running your agents.
            </p>
          </div>

          {/* Right: points */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {points.map((p) => (
              <div key={p.title} className="space-y-2">
                <div className="inline-flex items-center justify-center size-9 rounded-lg bg-muted">
                  <p.icon className="size-4 text-muted-foreground" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">
                  {p.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {p.description}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Terminal mockup */}
        <div className="mt-12 rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border/60 flex items-center gap-2">
            <div className="flex gap-1.5">
              <div className="size-2.5 rounded-full bg-red-500/60" />
              <div className="size-2.5 rounded-full bg-yellow-500/60" />
              <div className="size-2.5 rounded-full bg-green-500/60" />
            </div>
            <span className="text-xs font-mono text-muted-foreground/60 ml-2">
              root@kortix
            </span>
          </div>
          <div className="font-mono text-xs sm:text-sm p-5 text-muted-foreground leading-relaxed">
            <p>
              <span className="text-green-500/80">root@kortix:~$</span>{' '}
              <span className="text-foreground">kortix status</span>
            </p>
            <p className="mt-3 text-muted-foreground/60">
              AGENT&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;STATUS&nbsp;&nbsp;&nbsp;&nbsp;UPTIME&nbsp;&nbsp;&nbsp;&nbsp;TASKS/24H
            </p>
            <p>
              support&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span className="text-green-500/80">running</span>&nbsp;&nbsp;&nbsp;14d&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;1,247
            </p>
            <p>
              bookkeeper&nbsp;&nbsp;&nbsp;&nbsp;<span className="text-green-500/80">running</span>&nbsp;&nbsp;&nbsp;14d&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;89
            </p>
            <p>
              recruiter&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span className="text-green-500/80">running</span>&nbsp;&nbsp;&nbsp;6d&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;34
            </p>
            <p className="mt-3">
              <span className="text-green-500/80">root@kortix:~$</span>{' '}
              <span className="text-foreground">tail -f /kortix/logs/support/latest.log</span>
            </p>
            <p className="text-muted-foreground/40 animate-pulse">_</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   7. INSTALL OPTIONS
   ═══════════════════════════════════════════════════════════════ */
function InstallSection() {
  return (
    <section className="w-full py-20 md:py-28">
      <div className="max-w-5xl mx-auto px-6">
        <div className="text-center mb-16">
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
            Deploy
          </p>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-medium tracking-tighter text-foreground">
            Self-host or Cloud.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground max-w-xl mx-auto">
            Same Kortix either way. The cloud offering is a convenience layer,
            not a paywall.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Self-host */}
          <div className="rounded-2xl border border-border bg-card p-8 space-y-6">
            <div className="inline-flex items-center justify-center size-10 rounded-xl bg-muted">
              <Server className="size-5 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-xl font-semibold text-foreground">
                Self-Hosted
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Free forever &middot; Full functionality
              </p>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Install on your laptop for local dev, any VPS (Hetzner,
              DigitalOcean, AWS), or bare metal. You manage the infrastructure.
              Kortix manages the agents.
            </p>
            <div className="rounded-xl bg-muted/50 px-4 py-3 font-mono text-sm text-foreground">
              $ curl -fsSL https://get.kortix.ai | bash
            </div>
          </div>

          {/* Cloud */}
          <div className="rounded-2xl border border-foreground/20 bg-card p-8 space-y-6 ring-1 ring-foreground/5">
            <div className="inline-flex items-center justify-center size-10 rounded-xl bg-muted">
              <Cloud className="size-5 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-xl font-semibold text-foreground">
                Kortix Cloud
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Managed &middot; One-click deploy
              </p>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Managed instances with everything configured. We handle servers,
              security, backups, updates, LLM routing. You get full SSH access to
              your isolated instance.
            </p>
            <Button asChild className="w-full">
              <Link href="/auth">
                Get Started
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          </div>
        </div>

        {/* Open source note */}
        <div className="mt-12 text-center space-y-2">
          <p className="text-sm text-muted-foreground">
            Apache 2.0 licensed &middot; Full source code on{' '}
            <Link
              href="https://github.com/kortix-ai/suna"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-4 decoration-border hover:decoration-foreground transition-colors"
            >
              GitHub
            </Link>{' '}
            &middot; No paid tier that unlocks features
          </p>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   8. BOTTOM CTA
   ═══════════════════════════════════════════════════════════════ */
function CtaSection() {
  return (
    <section className="w-full py-20 md:py-28 bg-muted/30">
      <div className="max-w-3xl mx-auto px-6 text-center">
        <h2 className="text-3xl sm:text-4xl md:text-5xl font-medium tracking-tighter text-foreground leading-tight">
          Install it. Connect your data.
          <br />
          Deploy agents. Let it work.
        </h2>
        <p className="mt-6 text-lg text-muted-foreground max-w-xl mx-auto">
          Computers used to just compute. Then they ran software. Now they can
          run agents. Kortix is the operating system for that transition.
        </p>
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Button asChild size="lg" className="h-12 px-8 text-base">
            <Link href="/auth">
              Get Started Free
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="h-12 px-8 text-base"
          >
            <Link href="/enterprise">Talk to Sales</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   COMBINED EXPORT
   ═══════════════════════════════════════════════════════════════ */
export function LandingSections() {
  return (
    <>
      <WhatIsSection />
      <HowItWorksSection />
      <FilesystemSection />
      <AgentsSection />
      <OpenCodeSection />
      <ControlSection />
      <InstallSection />
      <CtaSection />
    </>
  );
}
