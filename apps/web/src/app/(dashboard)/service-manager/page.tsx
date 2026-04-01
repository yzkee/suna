'use client';

import { useEffect, useRef } from 'react';
import { useTabStore } from '@/stores/tab-store';

/**
 * /service-manager — Service Manager tab
 *
 * Opens or activates the service-manager tab so the pre-mounted
 * RunningServicesPanel in SessionTabsContainer becomes visible.
 */
export default function ServiceManagerPage() {
  const { tabs, openTab, setActiveTab } = useTabStore();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    const tabId = 'service-manager';

    if (tabs[tabId]) {
      setActiveTab(tabId);
    } else {
      openTab({
        id: tabId,
        title: 'Service Manager',
        type: 'services',
        href: '/service-manager',
      });
    }
  }, [tabs, openTab, setActiveTab]);

  return null;
}
