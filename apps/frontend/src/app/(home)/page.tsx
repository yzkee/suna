'use client';

import { useState, useCallback } from 'react';
import { BackgroundAALChecker } from '@/components/auth/background-aal-checker';
import { WallpaperBackground } from '@/components/ui/wallpaper-background';
import { ArrowRight, Check, Copy, Globe, Smartphone, Bot, Sparkles, Terminal, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { trackCtaSignup } from '@/lib/analytics/gtm';
import { motion, useScroll, useTransform } from 'framer-motion';
import { PlanSelectionModal } from '@/components/billing/pricing/plan-selection-modal';
import { GithubButton } from '@/components/home/github-button';
import Image from 'next/image';

const INSTALL_CMD = 'curl -fsSL https://kortix.com/install | bash';

/* ─── Inline brand SVGs (official Simple Icons paths) ─── */

function SlackIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A"/>
      <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0"/>
      <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D"/>
      <path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#ECB22E"/>
    </svg>
  );
}

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
    </svg>
  );
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/>
    </svg>
  );
}

function GmailIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/>
    </svg>
  );
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
    </svg>
  );
}

function StripeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z"/>
    </svg>
  );
}

function NotionIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z"/>
    </svg>
  );
}

function HubSpotIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M18.164 7.93V5.084a2.198 2.198 0 001.267-1.978v-.067A2.2 2.2 0 0017.238.845h-.067a2.2 2.2 0 00-2.193 2.193v.067a2.196 2.196 0 001.252 1.973l.013.006v2.852a6.22 6.22 0 00-2.969 1.31l.012-.01-7.828-6.095A2.497 2.497 0 104.3 4.656l-.012.006 7.697 5.991a6.176 6.176 0 00-1.038 3.446c0 1.343.425 2.588 1.147 3.607l-.013-.02-2.342 2.343a1.968 1.968 0 00-.58-.095h-.002a2.033 2.033 0 102.033 2.033 1.978 1.978 0 00-.1-.595l.005.014 2.317-2.317a6.247 6.247 0 104.782-11.134l-.036-.005zm-.964 9.378a3.206 3.206 0 113.215-3.207v.002a3.206 3.206 0 01-3.207 3.207z"/>
    </svg>
  );
}

function GoogleDriveIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12.01 1.485c-2.082 0-3.754.02-3.743.047.01.02 1.708 3.001 3.774 6.62l3.76 6.574h3.76c2.081 0 3.753-.02 3.742-.047-.005-.02-1.708-3.001-3.775-6.62l-3.76-6.574zm-4.76 1.73a789.828 789.861 0 0 0-3.63 6.319L0 15.868l1.89 3.298 1.885 3.297 3.62-6.335 3.618-6.33-1.88-3.287C8.1 4.704 7.255 3.22 7.25 3.214zm2.259 12.653-.203.348c-.114.198-.96 1.672-1.88 3.287a423.93 423.948 0 0 1-1.698 2.97c-.01.026 3.24.042 7.222.042h7.244l1.796-3.157c.992-1.734 1.85-3.23 1.906-3.323l.104-.167h-7.249z"/>
    </svg>
  );
}

function TeamsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M20.625 8.073h-5.17v7.704a1.97 1.97 0 0 1-1.97 1.97H9.202A5.627 5.627 0 0 0 14.83 22.5a5.627 5.627 0 0 0 5.796-5.452V8.073zM16.97 6.89a2.485 2.485 0 1 0 0-4.97 2.485 2.485 0 0 0 0 4.97zM10.28 7.5H2.456A1.455 1.455 0 0 0 1 8.955v6.136a5.418 5.418 0 0 0 4.64 5.362 5.418 5.418 0 0 0 6.195-5.362V8.955A1.455 1.455 0 0 0 10.28 7.5zM6.368 6.317a2.817 2.817 0 1 0 0-5.634 2.817 2.817 0 0 0 0 5.634z"/>
    </svg>
  );
}

/* ─── Feature check item ─── */
function FeatureItem({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-1 flex items-center justify-center size-5 rounded-full bg-foreground/[0.06] border border-foreground/[0.08] shrink-0">
        <Check className="size-3 text-foreground/50" />
      </div>
      <div>
        <span className="text-sm font-medium text-foreground/80">{title}</span>
        <span className="text-sm text-muted-foreground/60"> {desc}</span>
      </div>
    </div>
  );
}

/* ─── Integration pill ─── */
function IntegrationPill({ icon, name }: { icon: React.ReactNode; name: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/50 bg-card/40 hover:bg-muted/30 transition-colors">
      <div className="size-4 shrink-0">{icon}</div>
      <span className="text-[13px] font-medium text-foreground/70">{name}</span>
    </div>
  );
}

/* ─── Config card (for agents/skills/commands/triggers) ─── */
function ConfigCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl border border-border/40 bg-card/20">
      <div className="mt-0.5 flex items-center justify-center size-8 rounded-lg bg-foreground/[0.04] border border-foreground/[0.06] shrink-0">
        {icon}
      </div>
      <div>
        <span className="text-sm font-medium text-foreground/80">{title}</span>
        <p className="text-[13px] text-muted-foreground/60 mt-0.5 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════ */

export default function Home() {
  const [copied, setCopied] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);

  const { scrollY } = useScroll();
  const drawerRadius = useTransform(scrollY, [200, 600], [24, 0]);
  const heroOpacity = useTransform(scrollY, [0, 400], [1, 0]);
  const heroScale = useTransform(scrollY, [0, 400], [1, 0.95]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(INSTALL_CMD);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  return (
    <BackgroundAALChecker>
      <div className="relative bg-background">

        {/* ═══════════════ HERO ═══════════════ */}
        <div className="sticky top-0 h-dvh overflow-hidden z-0">
          <WallpaperBackground />
          <motion.div
            className="relative z-[1] flex flex-col h-full"
            style={{ opacity: heroOpacity, scale: heroScale }}
          >
            <div className="flex-1 flex items-center justify-center pt-40 pointer-events-none">
              <h1 className="text-4xl sm:text-5xl md:text-6xl font-medium tracking-tight text-foreground">
                The AGI OS
              </h1>
            </div>
            <div className="relative z-[1] pb-8 px-4 flex flex-col items-center gap-6">
              <Button
                size="lg"
                className="h-12 px-8 text-sm rounded-full transition-all"
                onClick={() => { trackCtaSignup(); setLaunchOpen(true); }}
              >
                Launch Your Kortix
                <ArrowRight className="ml-1.5 size-3.5" />
              </Button>
              <div className="flex flex-col items-center gap-2.5 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200 fill-mode-both">
                <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground/30 font-medium">
                  -- or install on your machine
                </span>
                <button
                  onClick={handleCopy}
                  className="group flex items-center gap-2.5 h-9 px-4 rounded-lg bg-foreground/[0.04] border border-foreground/[0.08] hover:bg-foreground/[0.07] hover:border-foreground/[0.13] transition-colors cursor-pointer"
                >
                  <span className="font-mono text-[11px] text-muted-foreground/35 select-none">$</span>
                  <code className="text-[11px] font-mono text-foreground/70 tracking-tight">{INSTALL_CMD}</code>
                  <div className="pl-2.5 border-l border-foreground/[0.08]">
                    {copied
                      ? <Check className="size-3 text-green-500" />
                      : <Copy className="size-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />
                    }
                  </div>
                </button>
              </div>
              <motion.div
                className="mt-3"
                animate={{ y: [0, 6, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              >
                <div className="w-5 h-8 rounded-full border-2 border-muted-foreground/20 flex items-start justify-center p-1">
                  <motion.div
                    className="w-1 h-1.5 rounded-full bg-muted-foreground/40"
                    animate={{ y: [0, 8, 0] }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  />
                </div>
              </motion.div>
            </div>
          </motion.div>
        </div>

        {/* ═══════════════ DRAWER ═══════════════ */}
        <motion.div
          className="relative z-10 bg-background"
          style={{ borderTopLeftRadius: drawerRadius, borderTopRightRadius: drawerRadius }}
        >
          {/* Handle */}
          <div className="flex justify-center pt-5 pb-3">
            <div className="w-8 h-[3px] rounded-full bg-muted-foreground/15" />
          </div>

          {/* ── Video / Demo ── */}
          <section className="max-w-5xl mx-auto px-6 pt-10 pb-20 sm:pb-28">
          <div className="rounded-xl overflow-hidden border border-border/50 bg-card/20 shadow-sm">
            <div className="bg-muted/10 border-b border-border/30 px-4 py-2.5 flex items-center gap-2">
              <div className="flex gap-1.5">
                <div className="size-2.5 rounded-full bg-muted-foreground/15" />
                <div className="size-2.5 rounded-full bg-muted-foreground/15" />
                <div className="size-2.5 rounded-full bg-muted-foreground/15" />
              </div>
              <span className="text-[10px] font-mono text-muted-foreground/30 ml-1">kortix.com</span>
            </div>
            <div className="relative aspect-video bg-muted/5">
              <Image
                src="/showcase/data/dashboard.png"
                alt="Kortix dashboard — an agent-built analytics dashboard"
                width={1386}
                height={836}
                className="w-full h-full object-cover"
                priority
              />
            </div>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground/40 text-center">
            An agent analyzed sales data and built this dashboard autonomously.
          </p>
        </section>

        {/* ═══════════════ WHAT IS KORTIX ═══════════════ */}
        <section className="max-w-3xl mx-auto px-6 py-20 sm:py-28">
          <p className="text-2xl sm:text-3xl md:text-4xl font-medium text-foreground leading-snug tracking-tight">
            Kortix is the AGI OS.<br />
            <span className="text-muted-foreground/50">The operating system for autonomous companies.</span>
          </p>
          <p className="mt-5 text-base sm:text-lg text-muted-foreground leading-relaxed max-w-2xl">
            A persistent, always-on operating system where AI agents connect every tool, run every workflow, and deliver real outputs — code, reports, dashboards, emails — with you in or out of the loop.
          </p>
        </section>

        {/* ═══════════════ THE KORTIX ═══════════════ */}
        <section className="max-w-3xl mx-auto px-6 py-20 sm:py-28">
          <h2 className="text-2xl sm:text-3xl font-semibold text-foreground tracking-tight mb-3">
            The Kortix
          </h2>
          <p className="text-base text-muted-foreground leading-relaxed max-w-2xl mb-4">
            A cognitive architecture for long-horizon autonomous work. The Kortix is an orchestrator and worker in one — it plans, delegates, executes, verifies, and only stops when the job is done.
          </p>
          <p className="text-sm text-muted-foreground/50 leading-relaxed max-w-2xl mb-12">
            Full long-term memory. Automatic short-term memory management. Built-in autowork loops with self-verification. Every agent ships with a battle-tested autonomous harness that makes it capable from day one.
          </p>

          <div className="flex flex-col gap-4">
            <FeatureItem
              title="Autowork"
              desc="Autonomous work loops that run until the task is done and verified. Self-correcting, self-recovering, persistent across sessions. Agents don't stop — they finish."
            />
            <FeatureItem
              title="Full LTM & STM"
              desc="Long-term memory with semantic search across all sessions. Automatic short-term memory management. Every decision, pattern, and context is retained and retrievable."
            />
            <FeatureItem
              title="Autonomous agent harness"
              desc="Every agent ships with a production-grade harness — identity, permissions, tools, triggers, skills, commands, and memory. Wired together. Autonomous by default."
            />
            <FeatureItem
              title="Prebuilt agents & skills"
              desc="Ships with prebuilt agents, coding skills, browser automation, research, integrations, document generation, and more. Powerful out of the box — extensible to anything."
            />
            <FeatureItem
              title="Agent builder"
              desc="Design custom agents with their own identity, tool access, triggers, and composed skill sets. Or let the harness builder skill create them for you."
            />
            <FeatureItem
              title="Open source"
              desc="Elastic 2.0 licensed. Self-host on your own infrastructure, inspect every line, or use the cloud. The full system — no feature gates."
            />
          </div>
        </section>

        {/* ═══════════════ HOW IT WORKS ═══════════════ */}
        <section className="max-w-3xl mx-auto px-6 py-20 sm:py-28">
          <h2 className="text-2xl sm:text-3xl font-semibold text-foreground tracking-tight mb-4">
            How it works
          </h2>
          <p className="text-base text-muted-foreground leading-relaxed max-w-2xl mb-14">
            Three steps. Connect your tools, configure your agents, talk to them from anywhere.
          </p>

          <div className="flex flex-col gap-16">
            {/* Step 1 — Connect Everything */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-[13px] font-mono text-muted-foreground/40">/01</span>
                <span className="text-sm font-medium text-foreground/80">Connect everything</span>
              </div>
              <p className="text-base text-muted-foreground leading-relaxed mb-6 max-w-xl">
                Every tool your company uses. MCP servers, REST APIs, OAuth apps, CLI tools, environment variables — if it has an interface, Kortix connects to it. 3,000+ integrations out of the box, and any custom integration is trivial to add.
              </p>
              <div className="flex flex-wrap gap-2">
                <IntegrationPill icon={<GmailIcon className="size-4 text-[#EA4335]" />} name="Gmail" />
                <IntegrationPill icon={<SlackIcon className="size-4" />} name="Slack" />
                <IntegrationPill icon={<GitHubIcon className="size-4 text-foreground/60" />} name="GitHub" />
                <IntegrationPill icon={<StripeIcon className="size-4 text-[#635BFF]" />} name="Stripe" />
                <IntegrationPill icon={<NotionIcon className="size-4 text-foreground/60" />} name="Notion" />
                <IntegrationPill icon={<HubSpotIcon className="size-4 text-[#FF7A59]" />} name="HubSpot" />
                <IntegrationPill icon={<GoogleDriveIcon className="size-4 text-[#4285F4]" />} name="Drive" />
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground/30">
                3,000+ integrations via MCP · OAuth · REST APIs · CLI · env vars — anything with an interface.
              </p>
            </div>

            {/* Step 2 — Configure Your System */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-[13px] font-mono text-muted-foreground/40">/02</span>
                <span className="text-sm font-medium text-foreground/80">Configure your system</span>
              </div>
              <p className="text-base text-muted-foreground leading-relaxed mb-6 max-w-xl">
                Define your agents, teach them skills, set up triggers, and create commands. Each agent is a specialist — with its own identity, memory, tools, and activation rules. Compose them into an autonomous workforce.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <ConfigCard
                  icon={<Bot className="size-4 text-foreground/50" />}
                  title="Agents"
                  desc="Specialist workers with custom identities, memory, tools, and permissions. A support agent, a bookkeeper, a recruiter."
                />
                <ConfigCard
                  icon={<Sparkles className="size-4 text-foreground/50" />}
                  title="Skills"
                  desc="Reusable knowledge packs that teach agents how to do real work — coding, research, browser automation, writing, and more."
                />
                <ConfigCard
                  icon={<Terminal className="size-4 text-foreground/50" />}
                  title="Commands"
                  desc="Slash commands that trigger structured multi-step workflows. /deploy, /report, /onboarding — your playbooks, automated."
                />
                <ConfigCard
                  icon={<Zap className="size-4 text-foreground/50" />}
                  title="Triggers"
                  desc="Cron schedules for time-based work. Webhooks for event-driven reactions. Pipedream for third-party event streams. Agents activate themselves."
                />
              </div>
            </div>

            {/* Step 3 — Talk From Anywhere */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-[13px] font-mono text-muted-foreground/40">/03</span>
                <span className="text-sm font-medium text-foreground/80">Talk from anywhere</span>
              </div>
              <p className="text-base text-muted-foreground leading-relaxed mb-6 max-w-xl">
                Message your agents from the web dashboard, your phone, or your team&apos;s messaging platform. They respond and execute immediately — wherever you are.
              </p>
              <div className="flex flex-wrap gap-2">
                <IntegrationPill icon={<Globe className="size-4 text-foreground/60" />} name="Web" />
                <IntegrationPill icon={<Smartphone className="size-4 text-foreground/60" />} name="iOS / Android" />
                <IntegrationPill icon={<SlackIcon className="size-4" />} name="Slack" />
                <IntegrationPill icon={<TeamsIcon className="size-4 text-[#6264A7]" />} name="MS Teams" />
                <IntegrationPill icon={<TelegramIcon className="size-4 text-[#229ED9]" />} name="Telegram" />
                <IntegrationPill icon={<DiscordIcon className="size-4 text-[#5865F2]" />} name="Discord" />
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground/30">
                More channels coming. If your team uses it, Kortix will be there.
              </p>
            </div>
          </div>
        </section>

        {/* ═══════════════ WHY AGI OS? ═══════════════ */}
        <section className="max-w-3xl mx-auto px-6 py-20 sm:py-28">
          <h2 className="text-2xl sm:text-3xl font-semibold text-foreground tracking-tight mb-3">
            Why &ldquo;AGI OS&rdquo;?
          </h2>
          <p className="text-base text-muted-foreground leading-relaxed max-w-2xl mb-12">
            Because it&apos;s a 24/7 always-on computer where AI does the work. A persistent substrate where agents run continuously, connect to anything, and share a single source of truth.
          </p>

          <div className="flex flex-col gap-4">
            <FeatureItem
              title="Always on, always running"
              desc="A persistent computer that never sleeps. Agents output tokens 24/7 — on schedules, on triggers, on events. Your autonomous workforce runs while you don't."
            />
            <FeatureItem
              title="Universal connectivity"
              desc="Connect and listen to any third-party system in real time. MCP servers, REST APIs, OAuth, webhooks, CLI tools. If it has an interface, Kortix talks to it."
            />
            <FeatureItem
              title="Single source of truth"
              desc="All knowledge, all context, all memory lives on one computer. No fragmentation across tools. Every agent shares the same persistent substrate — searchable, shareable, always available."
            />
            <FeatureItem
              title="Context orchestration"
              desc="One computer orchestrating all context. Agents carry forward decisions, learnings, and state across every interaction, every session, every project. Nothing is ever lost."
            />
          </div>
        </section>

        {/* ═══════════════ THE COMPANY OS ═══════════════ */}
        <section className="max-w-3xl mx-auto px-6 py-20 sm:py-28">
          <h2 className="text-2xl sm:text-3xl font-semibold text-foreground tracking-tight mb-3">
            The autonomous company OS
          </h2>
          <p className="text-base text-muted-foreground leading-relaxed max-w-2xl mb-12">
            Built to run companies with AI — today and tomorrow. Kortix is the foundation for autonomous operations. Deploy agents as specialists across every function of your business. Self-running. Self-evolving. With you in or out of the loop.
          </p>

          <div className="flex flex-col gap-4">
            <FeatureItem
              title="Agents as employees"
              desc="Deploy specialists that handle support, sales, engineering, finance, and ops. Each with their own tools, memory, and expertise. They learn, they improve, they deliver."
            />
            <FeatureItem
              title="Always improving"
              desc="Agents learn from every interaction. Long-term memory means the system gets smarter, faster, and more capable over time. Institutional knowledge that never walks out the door."
            />
            <FeatureItem
              title="Human in the loop — or not"
              desc="Stay involved when you want oversight. Step away when you don't. Kortix works either way. Approve critical decisions, or let agents handle everything autonomously."
            />
          </div>
        </section>

        {/* ═══════════════ CTA ═══════════════ */}
        <section className="max-w-3xl mx-auto px-6 py-20 sm:py-28">
          <div className="rounded-2xl border border-border/50 bg-card/30 p-8 sm:p-12 text-center">
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground mb-4">
              Ready to launch your AGI OS?
            </h2>
            <p className="text-base text-muted-foreground/70 leading-relaxed max-w-md mx-auto mb-8">
              Open source, self-hosted, free forever. Or use the cloud — $0 to start.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button
                size="lg"
                className="h-12 px-8 text-sm rounded-full"
                onClick={() => { trackCtaSignup(); setLaunchOpen(true); }}
              >
                Get Started
                <ArrowRight className="ml-1.5 size-3.5" />
              </Button>
              <GithubButton size="lg" className="h-12" />
            </div>

            <div className="mt-6">
              <button
                onClick={handleCopy}
                className="group inline-flex items-center gap-2.5 h-9 px-4 rounded-lg bg-foreground/[0.03] border border-foreground/[0.08] hover:bg-foreground/[0.06] hover:border-foreground/[0.12] transition-colors cursor-pointer"
              >
                <span className="font-mono text-[11px] text-muted-foreground/35 select-none">$</span>
                <code className="text-[11px] font-mono text-foreground/70 tracking-tight">{INSTALL_CMD}</code>
                <div className="pl-2.5 border-l border-foreground/[0.08]">
                  {copied
                    ? <Check className="size-3 text-green-500" />
                    : <Copy className="size-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />
                  }
                </div>
              </button>
            </div>
          </div>

          <p className="mt-10 text-sm text-muted-foreground/40 text-center">
            The operating system for autonomous companies. It grows with you.
          </p>
        </section>

        </motion.div>
      </div>

      <PlanSelectionModal open={launchOpen} onOpenChange={(open) => !open && setLaunchOpen(false)} />
    </BackgroundAALChecker>
  );
}
