'use client';

import React, { Suspense, lazy, useLayoutEffect } from 'react';
import { SidebarProvider, SidebarInset, useSidebar } from '@/components/ui/sidebar';
import { RightSidebarProvider } from '@/components/ui/sidebar-right-provider';
import { useOnboardingModeStore } from '@/stores/onboarding-mode-store';
import { useDeleteOperationEffects } from '@/stores/delete-operation-store';
import { SubscriptionStoreSync } from '@/stores/subscription-store';
import { NewInstanceModal } from '@/components/billing/pricing/new-instance-modal';
import { useNewInstanceModalStore } from '@/stores/pricing-modal-store';

const SidebarLeft = lazy(() =>
  import('@/components/sidebar/sidebar-left').then(mod => ({ default: mod.SidebarLeft }))
);
const SidebarRight = lazy(() =>
  import('@/components/sidebar/sidebar-right').then(mod => ({ default: mod.SidebarRight }))
);

function SidebarSkeleton() {
  return (
    <div className="hidden md:flex w-[280px] flex-col bg-sidebar shrink-0">
      <div className="p-4 space-y-4">
        <div className="h-8 w-32 bg-muted/40 rounded animate-pulse" />
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-9 bg-muted/30 rounded animate-pulse" />
          ))}
        </div>
      </div>
      <div className="flex-1" />
      <div className="p-4">
        <div className="h-10 bg-muted/30 rounded animate-pulse" />
      </div>
    </div>
  );
}

function DeleteOperationEffectsWrapper({ children }: { children: React.ReactNode }) {
  useDeleteOperationEffects();
  return <>{children}</>;
}

/**
 * Syncs left sidebar open state with onboarding mode.
 * useLayoutEffect runs before paint → no flash.
 */
function OnboardingSidebarSync() {
  const { setOpen } = useSidebar();
  const active = useOnboardingModeStore((s) => s.active);
  const morphing = useOnboardingModeStore((s) => s.morphing);
  useLayoutEffect(() => {
    if (active && !morphing) setOpen(false);
    else if (morphing) setOpen(true);
  }, [active, morphing, setOpen]);
  return null;
}

/** Store-driven NewInstanceModal — mounted once globally */
function GlobalNewInstanceModal() {
  const { isOpen, title, closeNewInstanceModal } = useNewInstanceModalStore();
  return <NewInstanceModal open={isOpen} onOpenChange={(o) => !o && closeNewInstanceModal()} title={title} />;
}

interface AppProvidersProps {
  children: React.ReactNode;
  showSidebar?: boolean;
  defaultSidebarOpen?: boolean;
  sidebarContent?: React.ReactNode;
  sidebarSiblings?: React.ReactNode;
}

export function AppProviders({
  children,
  showSidebar = true,
  defaultSidebarOpen,
  sidebarContent,
  sidebarSiblings
}: AppProvidersProps) {
  const content = (
    <DeleteOperationEffectsWrapper>
      <SubscriptionStoreSync>
        {children}
        <GlobalNewInstanceModal />
      </SubscriptionStoreSync>
    </DeleteOperationEffectsWrapper>
  );

  if (!showSidebar) return content;

  return (
    <SidebarProvider defaultOpen={defaultSidebarOpen}>
      <OnboardingSidebarSync />
      {sidebarContent || (
        <Suspense fallback={<SidebarSkeleton />}>
          <SidebarLeft />
        </Suspense>
      )}
      <SidebarInset>
        <RightSidebarProvider>
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {content}
          </div>
          <Suspense fallback={null}>
            <SidebarRight />
          </Suspense>
        </RightSidebarProvider>
      </SidebarInset>
      {sidebarSiblings}
    </SidebarProvider>
  );
}
