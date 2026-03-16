'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { BackgroundAALChecker } from '@/components/auth/background-aal-checker';
import { WallpaperBackground } from '@/components/ui/wallpaper-background';
import { ArrowRight, Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { trackCtaSignup } from '@/lib/analytics/gtm';
import { motion, useScroll, useTransform } from 'framer-motion';
import { PlanSelectionModal } from '@/components/billing/pricing/plan-selection-modal';
import { GithubButton } from '@/components/home/github-button';
import Image from 'next/image';

const INSTALL_CMD = 'curl -fsSL https://kortix.com/install | bash';

export default function Home() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const [copied, setCopied] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);

  const { scrollY } = useScroll();

  const drawerRadius = useTransform(scrollY, [200, 600], [24, 0]);
  const heroOpacity = useTransform(scrollY, [0, 400], [1, 0]);
  const heroScale = useTransform(scrollY, [0, 400], [1, 0.95]);

  useEffect(() => {
    if (!isLoading && user) {
      router.replace('/dashboard');
    }
  }, [user, isLoading, router]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(INSTALL_CMD);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  return (
    <BackgroundAALChecker>
      <div className="relative bg-background">
        {/* HERO */}
        <div className="sticky top-0 h-dvh overflow-hidden z-0">
          <WallpaperBackground />
          <motion.div
            className="relative z-[1] flex flex-col h-full"
            style={{ opacity: heroOpacity, scale: heroScale }}
          >
            <div className="flex-1 flex items-center justify-center pt-40 pointer-events-none">
              <h1 className="text-4xl sm:text-5xl md:text-6xl font-medium tracking-tight text-foreground">
                The AI Computer
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

        {/* CONTENT */}
        <motion.div
          className="relative z-10 bg-background border-t border-border/50"
          style={{ borderTopLeftRadius: drawerRadius, borderTopRightRadius: drawerRadius }}
        >
          <div className="flex justify-center pt-5 pb-3">
            <div className="w-8 h-[3px] rounded-full bg-muted-foreground/15" />
          </div>

          <div className="max-w-2xl mx-auto px-6 pt-16 sm:pt-24 pb-24 sm:pb-32">
            {/* What it is */}
            <p className="text-2xl sm:text-3xl font-medium text-foreground leading-snug tracking-tight">
              A persistent Linux machine for your AI agents.
            </p>
            <p className="mt-6 text-base text-muted-foreground leading-relaxed">
              You give it a goal. It plans, writes code, browses the web, calls APIs, reads and writes files,
              and delivers a finished result. Not a draft. Not a suggestion. A real output — dashboards, reports,
              presentations, deployed code — while you do something else.
            </p>
            <p className="mt-4 text-base text-muted-foreground leading-relaxed">
              Agents run 24/7 on cron triggers, webhooks, or events. They have persistent memory,
              a real filesystem, your connected accounts, and a browser. Everything is open source
              and lives on infrastructure you own.
            </p>

            {/* Screenshot */}
            <div className="mt-14 rounded-xl overflow-hidden border border-border/40">
              <Image
                src="/showcase/data/dashboard.png"
                alt="Agent-built dashboard"
                width={1386}
                height={836}
                className="w-full"
                priority
              />
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground/40 text-center">
              An agent analyzed sales data and built this dashboard autonomously.
            </p>

            {/* Powered by */}
            <div className="mt-16 flex items-center gap-2.5">
              <span className="text-[11px] text-muted-foreground/40">Powered by</span>
              <a
                href="https://opencode.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 opacity-50 hover:opacity-80 transition-opacity"
              >
                <Image
                  src="/provider-icons/opencode.svg"
                  alt="OpenCode"
                  width={14}
                  height={14}
                  className="size-3.5"
                />
                <span className="text-[11px] font-medium text-foreground tracking-tight">OpenCode</span>
              </a>
            </div>

            {/* CTA */}
            <div className="mt-20 pt-16 border-t border-border/30 flex flex-col items-center text-center">
              <h2 className="text-2xl sm:text-3xl font-medium tracking-tight text-foreground">
                Ready to launch your computer?
              </h2>
              <p className="mt-4 text-base text-muted-foreground/70 leading-relaxed max-w-md">
                Open source, self-hosted, free forever.
              </p>

              <div className="mt-8 flex flex-col sm:flex-row items-center gap-3">
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

              <div className="mt-8 w-full max-w-sm">
                <button
                  onClick={handleCopy}
                  className="group w-full flex items-center gap-3 rounded-xl border border-border/50 bg-card/30 px-4 py-3 text-left transition-colors hover:bg-muted/20 cursor-pointer"
                >
                  <span className="text-muted-foreground/40 text-sm select-none font-mono">$</span>
                  <code className="flex-1 text-sm font-mono text-foreground/80 truncate">{INSTALL_CMD}</code>
                  <span className="shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground/70 transition-colors">
                    {copied ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      <PlanSelectionModal open={launchOpen} onOpenChange={(open) => !open && setLaunchOpen(false)} />
    </BackgroundAALChecker>
  );
}
