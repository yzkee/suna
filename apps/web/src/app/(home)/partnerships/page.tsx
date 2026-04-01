import type { Metadata } from 'next';
import PartnershipsPageClient from './partnerships-client';

export const metadata: Metadata = {
  title: 'Partnerships',
  description:
    'Work with Kortix to build autonomous operations for your company. Marko Kraemer and the Kortix team come in on retainer and build the same systems we run ourselves — end-to-end, embedded in your operations.',
  keywords:
    'Kortix partnerships, AI implementation partner, autonomous operations consulting, agent teams, AI workforce deployment, enterprise AI, joint venture AI',
  openGraph: {
    title: 'Partnerships – Kortix',
    description:
      'A handful of selected companies. $20k/month retainer. We come in and build autonomous operations with you — the same way we run our own.',
    url: 'https://www.kortix.com/partnerships',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Partnerships – Kortix',
    description:
      'A handful of selected companies. $20k/month retainer. We come in and build autonomous operations with you — the same way we run our own.',
  },
  alternates: {
    canonical: 'https://www.kortix.com/partnerships',
  },
};

export default function PartnershipsPage() {
  return <PartnershipsPageClient />;
}
