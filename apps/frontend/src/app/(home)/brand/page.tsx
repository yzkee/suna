'use client';

import { useState } from 'react';
import { Download, Check, Copy, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Reveal } from '@/components/home/reveal';

/* ─────────────────────── Data ─────────────────────── */

const BRAND_COLORS = [
  { name: 'Black', hex: '#000000', oklch: 'oklch(0 0 0)', light: false },
  { name: 'Off-Black', hex: '#1A1A1A', oklch: 'oklch(0.145 0 0)', light: false },
  { name: 'White', hex: '#FFFFFF', oklch: 'oklch(1 0 0)', light: true },
  { name: 'Off-White', hex: '#F5F5F5', oklch: 'oklch(0.965 0 0)', light: true },
] as const;

const ACCENT_COLORS = [
  { name: 'Teal', hex: '#22808D', light: false },
  { name: 'Amber', hex: '#D4A017', light: true },
  { name: 'Rose', hex: '#D14D72', light: false },
  { name: 'Violet', hex: '#7C5CFC', light: false },
  { name: 'Emerald', hex: '#2D9F6F', light: false },
  { name: 'Neon', hex: '#E8E000', light: true },
] as const;

type LogoFormat = 'svg' | 'png';

interface LogoAsset {
  id: string;
  label: string;
  variant: string;
  svgSrc: string;
  pngSrc: string;
  dark: boolean;
}

const LOGO_ASSETS: LogoAsset[] = [
  {
    id: 'brandmark-black',
    label: 'Symbol',
    variant: 'Black',
    svgSrc: '/brandkit/Logo/Brandmark/SVG/Brandmark Black.svg',
    pngSrc: '/brandkit/Logo/Brandmark/PNG/Brandmark Black.png',
    dark: false,
  },
  {
    id: 'brandmark-white',
    label: 'Symbol',
    variant: 'White',
    svgSrc: '/brandkit/Logo/Brandmark/SVG/Brandmark White.svg',
    pngSrc: '/brandkit/Logo/Brandmark/PNG/Brandmark White.png',
    dark: true,
  },
  {
    id: 'wordmark-black',
    label: 'Wordmark',
    variant: 'Black',
    svgSrc: '/brandkit/Logo/Wordmark/SVG/Wordmark Black.svg',
    pngSrc: '/brandkit/Logo/Wordmark/PNG/Wordmark Black.png',
    dark: false,
  },
  {
    id: 'wordmark-white',
    label: 'Wordmark',
    variant: 'White',
    svgSrc: '/brandkit/Logo/Wordmark/SVG/Wordmark White.svg',
    pngSrc: '/brandkit/Logo/Wordmark/PNG/Wordmark White.png',
    dark: true,
  },
];

/* ─────────────────── Components ─────────────────── */

function Hex({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
      className="inline-flex items-center gap-1.5 group cursor-pointer"
    >
      <span className="font-mono text-[11px] text-muted-foreground/50 group-hover:text-muted-foreground/80 transition-colors">
        {value}
      </span>
      {copied
        ? <Check className="size-2.5 text-emerald-500" />
        : <Copy className="size-2.5 text-muted-foreground/25 group-hover:text-muted-foreground/50 transition-colors" />}
    </button>
  );
}

function LogoCard({ asset, fmt }: { asset: LogoAsset; fmt: LogoFormat }) {
  const isWordmark = asset.label === 'Wordmark';
  const downloadHref = fmt === 'png' ? asset.pngSrc : asset.svgSrc;
  const downloadName = `kortix-${asset.label.toLowerCase()}-${asset.variant.toLowerCase()}.${fmt}`;

  return (
    <div className="group relative">
      <div className={cn(
        'aspect-[3/2] rounded-lg flex items-center justify-center transition-all relative overflow-hidden',
        isWordmark ? 'px-6 py-8' : 'p-10',
        asset.dark
          ? 'bg-neutral-950 ring-1 ring-white/[0.06]'
          : 'bg-white ring-1 ring-black/[0.06]'
      )}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.svgSrc}
          alt={`Kortix ${asset.label} ${asset.variant}`}
          className={cn(
            'object-contain',
            isWordmark ? 'max-h-8 md:max-h-10 w-full' : 'max-h-10 md:max-h-12 w-auto',
          )}
        />

        <a
          href={downloadHref}
          download={downloadName}
          className="absolute inset-0 flex items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 transition-opacity bg-black/[0.04] dark:bg-white/[0.04] cursor-pointer"
        >
          <span className="flex items-center gap-1.5 text-[11px] font-medium bg-background ring-1 ring-border rounded-full px-3 py-1.5 shadow-sm">
            <Download className="size-3" /> {fmt.toUpperCase()}
          </span>
        </a>
      </div>

      <div className="mt-2 flex items-baseline gap-1.5 px-0.5">
        <span className="text-xs font-medium text-foreground/60">{asset.label}</span>
        <span className="text-[10px] font-mono text-muted-foreground/30">{asset.variant}</span>
      </div>
    </div>
  );
}

function FormatToggle({ value, onChange }: { value: LogoFormat; onChange: (v: LogoFormat) => void }) {
  return (
    <div className="flex items-center gap-0.5 bg-foreground/[0.05] rounded-full p-0.5">
      {(['svg', 'png'] as const).map((f) => (
        <button
          key={f}
          onClick={() => onChange(f)}
          className={cn(
            'text-[11px] font-mono px-3 py-1 rounded-full transition-all cursor-pointer',
            value === f
              ? 'bg-background text-foreground/80 shadow-sm ring-1 ring-foreground/[0.06]'
              : 'text-foreground/35 hover:text-foreground/55'
          )}
        >
          {f.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

/* ───────────────────── Page ───────────────────── */

export default function BrandPage() {
  const [logoFmt, setLogoFmt] = useState<LogoFormat>('svg');

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 pt-24 sm:pt-32 pb-24 sm:pb-32">

        {/* Hero */}
        <Reveal>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-medium tracking-tight text-foreground mb-5">
            Brand
          </h1>
        </Reveal>
        <Reveal delay={0.08}>
          <p className="text-base text-muted-foreground/60 leading-relaxed max-w-xl">
            Logo assets, color palette, typography, and usage rules for representing Kortix consistently. Always use the provided files — don{"'"}t recreate.
          </p>
        </Reveal>

        {/* ─── Logo ─── */}
        <Reveal delay={0.1}>
          <div className="mt-14">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xs uppercase tracking-widest text-muted-foreground/40">
                Logo
              </h2>
              <FormatToggle value={logoFmt} onChange={setLogoFmt} />
            </div>
            <p className="text-base text-muted-foreground/60 leading-relaxed mb-6">
              Two forms — the symbol and the wordmark. Each in black and white.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {LOGO_ASSETS.map((a) => (
                <LogoCard key={a.id} asset={a} fmt={logoFmt} />
              ))}
            </div>
            <p className="text-sm text-muted-foreground/40 leading-relaxed mt-6">
              The symbol is derived from the letter K — connectivity and intelligence abstracted into a geometric mark.
              Use it as a favicon, app icon, or whenever the full wordmark isn{"'"}t practical. Never stretch, rotate, or recolor it.
            </p>
          </div>
        </Reveal>

        {/* ─── Colors ─── */}
        <Reveal>
          <div className="mt-14 pt-8 border-t border-border/50">
            <h2 className="text-xs uppercase tracking-widest text-muted-foreground/40 mb-5">
              Colors
            </h2>
            <p className="text-base text-muted-foreground/60 leading-relaxed mb-6">
              Black and white is the foundation. Each UI theme pairs the neutral base
              with exactly one accent color.
            </p>

            <div className="mb-8">
              <p className="text-xs text-muted-foreground/40 mb-3">Foundation</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {BRAND_COLORS.map((c) => (
                  <div key={c.hex}>
                    <div className={cn('aspect-[4/3] rounded-lg', c.light ? 'ring-1 ring-black/[0.08]' : '')}
                      style={{ backgroundColor: c.hex }} />
                    <div className="mt-2 px-0.5 space-y-0.5">
                      <span className="text-xs font-medium text-foreground/60">{c.name}</span>
                      <div className="flex flex-col">
                        <Hex value={c.hex} />
                        <Hex value={c.oklch} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs text-muted-foreground/40 mb-3">Theme accents</p>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                {ACCENT_COLORS.map((c) => (
                  <div key={c.hex}>
                    <div className={cn('aspect-square rounded-lg', c.light ? 'ring-1 ring-black/[0.06]' : '')}
                      style={{ backgroundColor: c.hex }} />
                    <div className="mt-2 px-0.5">
                      <span className="text-xs font-medium text-foreground/60 block">{c.name}</span>
                      <Hex value={c.hex} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Reveal>

        {/* ─── Typography ─── */}
        <Reveal>
          <div className="mt-14 pt-8 border-t border-border/50">
            <h2 className="text-xs uppercase tracking-widest text-muted-foreground/40 mb-5">
              Typography
            </h2>
            <p className="text-base text-muted-foreground/60 leading-relaxed mb-8">
              Roobert — a geometric sans-serif. Font-medium (500) is the brand weight. Roobert Mono for code and data.
            </p>

            <div className="space-y-6">
              {[
                { label: 'Medium · 500', cls: 'font-medium' },
                { label: 'Regular · 400', cls: 'font-normal' },
              ].map((s) => (
                <div key={s.label} className="border-b border-border/30 pb-5">
                  <span className="font-mono text-[10px] text-muted-foreground/30 tracking-widest block mb-2">{s.label}</span>
                  <p className={cn('text-3xl md:text-5xl tracking-tight text-foreground/80', s.cls)}>
                    Kortix Computer
                  </p>
                </div>
              ))}
            </div>

            <div className="bg-neutral-950 text-neutral-100 rounded-lg p-5 md:p-6 mt-6">
              <span className="font-mono text-[10px] text-neutral-500 tracking-widest block mb-3">Roobert Mono</span>
              <p className="font-mono text-lg md:text-2xl tracking-tight">const agent = new Kortix();</p>
              <p className="font-mono text-[11px] text-neutral-600 mt-4">
                ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789
              </p>
            </div>
          </div>
        </Reveal>

        {/* ─── Usage ─── */}
        <Reveal>
          <div className="mt-14 pt-8 border-t border-border/50">
            <h2 className="text-xs uppercase tracking-widest text-muted-foreground/40 mb-5">
              Usage
            </h2>

            <div className="grid md:grid-cols-2 gap-10">
              <div>
                <p className="text-xs text-emerald-600 dark:text-emerald-400 tracking-widest uppercase mb-4">Do</p>
                {[
                  'Use the logo on solid black or white backgrounds',
                  'Maintain minimum clear space on all sides',
                  'Use the provided SVG/PNG files',
                  'Black logo on light, white on dark',
                  'Scale proportionally',
                  'Use font-medium (500) for headings',
                ].map((t) => (
                  <div key={t} className="flex items-start gap-2.5 py-2 border-b border-border/30">
                    <span className="mt-0.5 flex items-center justify-center size-4 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
                      <Check className="size-2.5" />
                    </span>
                    <span className="text-sm text-muted-foreground/50">{t}</span>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs text-red-600 dark:text-red-400 tracking-widest uppercase mb-4">Don{"'"}t</p>
                {[
                  'Rotate, skew, or stretch the logo',
                  'Add drop shadows or effects',
                  'Place on busy or patterned backgrounds',
                  'Use unapproved color combinations',
                  'Use bold (700) for headings',
                  'Use colored or tinted backgrounds',
                ].map((t) => (
                  <div key={t} className="flex items-start gap-2.5 py-2 border-b border-border/30">
                    <span className="mt-0.5 flex items-center justify-center size-4 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 shrink-0">
                      <X className="size-2.5" />
                    </span>
                    <span className="text-sm text-muted-foreground/50">{t}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Reveal>

      </div>
    </main>
  );
}
