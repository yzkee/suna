'use client';

import { useEffect, useRef } from 'react';
import { useTabStore } from '@/stores/tab-store';

/**
 * Route handler for /services/running.
 *
 * The Running Services tab is normally opened via the sidebar action button.
 * This page handles direct navigation (e.g. browser refresh, link sharing).
 *
 * If the services tab already exists in the store it activates it.
 * Otherwise it creates the tab so the page always renders.
 */
export default function RunningServicesPage() {
  const { tabs, setActiveTab, openTab } = useTabStore();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    const tabId = 'services:running';
    const existingTab = tabs[tabId];

    if (existingTab) {
      setActiveTab(tabId);
    } else {
      openTab({
        id: tabId,
        title: 'Running Services',
        type: 'services',
        href: '/services/running',
      });
      setActiveTab(tabId);
    }
  }, [tabs, setActiveTab, openTab]);

  return null;
}
