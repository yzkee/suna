'use client';

import { useEffect, useRef } from 'react';
import { useTabStore } from '@/stores/tab-store';

/**
 * /memory — Memory page tab
 *
 * Handles direct navigation (hard reload, shared link, bookmarked URL).
 * Opens or activates the memory page tab so it becomes visible in the
 * pre-mounted PageTabContent in SessionTabsContainer.
 *
 * Renders nothing — the tab container handles all visual output.
 */
export default function MemoryPage() {
  const { tabs, openTab, setActiveTab } = useTabStore();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    const tabId = 'page:/memory';

    if (tabs[tabId]) {
      setActiveTab(tabId);
    } else {
      openTab({
        id: tabId,
        title: 'Memory',
        type: 'page',
        href: '/memory',
      });
    }
  }, [tabs, openTab, setActiveTab]);

  return null;
}
