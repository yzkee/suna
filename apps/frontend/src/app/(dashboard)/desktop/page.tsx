'use client';

import { useEffect, useRef } from 'react';
import { useTabStore } from '@/stores/tab-store';

/**
 * /desktop — Desktop tab
 *
 * Handles direct navigation (hard reload, shared link, bookmarked URL).
 * Opens or activates the desktop:main tab so the pre-mounted
 * DesktopTabContent in SessionTabsContainer becomes visible.
 *
 * Renders nothing — the tab container handles all visual output.
 */
export default function DesktopPage() {
  const { tabs, openTab, setActiveTab } = useTabStore();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    const tabId = 'desktop:main';

    if (tabs[tabId]) {
      setActiveTab(tabId);
    } else {
      openTab({
        id: tabId,
        title: 'Desktop',
        type: 'desktop',
        href: '/desktop',
      });
    }
  }, [tabs, openTab, setActiveTab]);

  return null;
}
