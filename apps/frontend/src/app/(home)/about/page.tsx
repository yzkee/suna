'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Reveal } from '@/components/home/reveal';

type ParagraphItem = 
  | string 
  | { text: string; linkText: string; linkHref: string };

const paragraphs: ParagraphItem[] = [
  "We build self-driving companies.",
  "The world's highest-expertise team on autonomous operations. 70% agents, 30% humans — where humans verify, steer, and govern. Agents do the work.",
  "Kortix is the foundation. A stateful, 24/7 machine where every agent shares context, access, and control. But the platform isn't the point. What you build on it is.",
  "We run our own companies on it. Highest conviction comes from highest exposure.",
  { text: "Want to build with us? ", linkText: "We're hiring.", linkHref: "/careers" }
];

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-background">
      <article className="max-w-3xl mx-auto px-6 pt-24 sm:pt-32 pb-24 sm:pb-32">
        
        {/* Hero Image */}
        <Reveal>
          <div className="relative aspect-[16/9] w-full overflow-hidden rounded-lg mb-14">
            <Image
              src="/images/team.webp"
              alt="The Kortix team"
              fill
              className="object-cover object-top"
              priority
            />
          </div>
        </Reveal>

        <div className="space-y-5">
          {paragraphs.map((paragraph, index) => (
            <Reveal key={index} delay={index * 0.08}>
              <p className="text-base text-muted-foreground/60 leading-relaxed">
                {typeof paragraph === 'string' ? (
                  paragraph
                ) : (
                  <>
                    {paragraph.text}
                    <Link 
                      href={paragraph.linkHref} 
                      className="text-foreground/70 hover:text-foreground underline underline-offset-4 decoration-foreground/20 hover:decoration-foreground/50 transition-colors"
                    >
                      {paragraph.linkText}
                    </Link>
                  </>
                )}
              </p>
            </Reveal>
          ))}
        </div>

      </article>
    </main>
  );
}
