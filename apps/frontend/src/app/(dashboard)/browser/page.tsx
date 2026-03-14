'use client';

import { useEffect, useRef } from 'react';
import { useTabStore } from '@/stores/tab-store';

/**
 * /browser — Agent Browser tab
 *
 * Handles direct navigation (hard reload, shared link, bookmarked URL).
 * Opens or activates the browser:main tab so the pre-mounted
 * BrowserTabContent in SessionTabsContainer becomes visible.
 *
 * Renders nothing — the tab container handles all visual output.
 */
export default function BrowserPage() {
  const { tabs, openTab, setActiveTab } = useTabStore();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    const tabId = 'browser:main';

    if (tabs[tabId]) {
      setActiveTab(tabId);
    } else {
      openTab({
        id: tabId,
        title: 'Browser',
        type: 'browser',
        href: '/browser',
      });
    }
  }, [tabs, openTab, setActiveTab]);

  return null;
}
