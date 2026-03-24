'use client';

import Image from 'next/image';
import { Reveal } from '@/components/home/reveal';

export default function CareersPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 pt-24 sm:pt-32 pb-24 sm:pb-32">

        {/* Hero */}
        <Reveal>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-medium tracking-tight text-foreground mb-5">
            Careers
          </h1>
        </Reveal>
        <Reveal delay={0.08}>
          <p className="text-base text-muted-foreground/60 leading-relaxed max-w-xl">
            Founders, builders, hackers, artists, designers, engineers, operators, dreamers, dropouts, autodidacts, obsessives, perfectionists, generalists, polymaths — we don{"'"}t care what you call yourself. We care that you{"'"}ve built something real, felt every edge of it, and couldn{"'"}t stop until it was right.
          </p>
        </Reveal>
        <Reveal delay={0.16}>
          <p className="text-base text-muted-foreground/60 leading-relaxed max-w-xl mt-4">
            An extremely small, tight-knit team building the operating system for autonomous companies. Everyone here shares the same trait — the innate drive to take chaos and turn it into systems that run themselves.
          </p>
        </Reveal>

        {/* Shackleton */}
        <Reveal delay={0.1}>
          <div className="mt-14 flex justify-center">
            <Image
              src="/images/careers/shackleton.png"
              alt="Men wanted for hazardous journey, small wages, bitter cold, long months of complete darkness, constant danger, safe return doubtful, honor and recognition in case of success. — Ernest Shackleton"
              width={380}
              height={253}
              className="rounded-md opacity-80"
              priority
            />
          </div>
        </Reveal>

        {/* Position */}
        <Reveal>
          <div className="mt-14">
            <h2 className="text-xs uppercase tracking-widest text-muted-foreground/40 mb-5">
              Open Position
            </h2>
            <div>
              <p className="text-base font-medium text-foreground/70">
                Craftsman
              </p>
              <p className="text-base text-muted-foreground/60 leading-relaxed mt-1.5">
                You are what you are. You drive what you must. Independent, founder-type person who falls under the above definition. 
              </p>
              <p className="text-xs text-muted-foreground/35 mt-2">San Francisco — or anywhere, but we{"'"}ll get you here.</p>
            </div>
          </div>
        </Reveal>

        {/* Contact */}
        <Reveal>
          <div className="mt-14 pt-8 border-t border-border/50">
            <p className="text-base text-muted-foreground/60 leading-relaxed">
              If this sounds like you, just reach out. I{"'"}m Marko.
            </p>
            <div className="flex flex-col gap-1.5 mt-3">
              <a href="mailto:marko@kortix.ai" className="text-base text-foreground/70 hover:text-foreground underline underline-offset-4 decoration-foreground/20 hover:decoration-foreground/50 transition-colors w-fit">
                marko@kortix.ai
              </a>
              <a href="https://x.com/markokraemer" target="_blank" rel="noopener noreferrer" className="text-base text-foreground/70 hover:text-foreground underline underline-offset-4 decoration-foreground/20 hover:decoration-foreground/50 transition-colors w-fit">
                @markokraemer
              </a>
              <a href="https://linkedin.com/in/markokraemer" target="_blank" rel="noopener noreferrer" className="text-base text-foreground/70 hover:text-foreground underline underline-offset-4 decoration-foreground/20 hover:decoration-foreground/50 transition-colors w-fit">
                linkedin.com/in/markokraemer
              </a>
            </div>
          </div>
        </Reveal>

      </div>
    </main>
  );
}
