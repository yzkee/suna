'use client';

import { useEffect, useRef } from 'react';
import { useTabStore } from '@/stores/tab-store';

/**
 * /services/running — Service Manager tab
 *
 * Handles direct navigation (hard reload, shared link, bookmarked URL).
 * Opens or activates the services:running tab so the pre-mounted
 * RunningServicesPanel in SessionTabsContainer becomes visible.
 *
 * Renders nothing — the tab container handles all visual output.
 */
export default function RunningServicesPage() {
  const { tabs, openTab, setActiveTab } = useTabStore();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    const tabId = 'services:running';

    if (tabs[tabId]) {
      setActiveTab(tabId);
    } else {
      openTab({
        id: tabId,
        title: 'Service Manager',
        type: 'services',
        href: '/services/running',
      });
    }
  }, [tabs, openTab, setActiveTab]);

  return null;
}
