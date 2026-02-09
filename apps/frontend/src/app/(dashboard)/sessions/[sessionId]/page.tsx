'use client';

import { use, Suspense } from 'react';
import { SessionChat } from '@/components/session/session-chat';
import { KortixLoader } from '@/components/ui/kortix-loader';

export default function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);

  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center">
          <KortixLoader size="small" />
        </div>
      }
    >
      <SessionChat sessionId={sessionId} />
    </Suspense>
  );
}
