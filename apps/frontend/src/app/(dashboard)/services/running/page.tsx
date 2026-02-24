'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTabStore } from '@/stores/tab-store';

/**
 * Route handler for /services/running.
 *
 * The Running Services tab is normally opened via the sidebar action button
 * which uses pushState for URL changes. This page handles direct navigation
 * (e.g. browser refresh, link sharing).
 *
 * If the services tab already exists in the store, it activates it.
 * Otherwise, it creates and activates it.
 */
export default function RunningServicesPage() {
  const router = useRouter();
  const { tabs, setActiveTab, openTab } = useTabStore();

  useEffect(() => {
    const tabId = 'services:running';
    const existingTab = tabs[tabId];

    if (existingTab) {
      // Tab exists — activate it
      setActiveTab(tabId);
    } else {
      // Tab doesn't exist — create it
      openTab({
        id: tabId,
        title: 'Running Services',
        type: 'services',
        href: '/services/running',
      });
    }
  }, [tabs, setActiveTab, openTab, router]);

  // The actual panel is rendered by SessionTabsContainer in layout-content.tsx
  // This page renders nothing visible — it just ensures the tab is activated
  return null;
}
