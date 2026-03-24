'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronsUpDown,
  Moon,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { createClient } from '@/lib/supabase/client';
import { openTabAndNavigate } from '@/stores/tab-store';
import { useTheme } from 'next-themes';
import { isBillingEnabled } from '@/lib/config';
import { clearUserLocalStorage } from '@/lib/utils/clear-local-storage';
import { UserSettingsModal } from '@/components/settings/user-settings-modal';
import { useTranslations } from 'next-intl';
import { ServerSelector } from '@/components/sidebar/server-selector';
import { useSleep } from '@/components/dashboard/sleep-overlay';
import {
  getItemsByGroup,
  themeOptions,
  type MenuItemDef,
  type SettingsTabId,
} from '@/lib/menu-registry';

interface UserMenuProps {
  user: {
    name: string;
    email: string;
    avatar: string;
    isAdmin?: boolean;
  };
}

export function UserMenu({ user }: UserMenuProps) {
  const t = useTranslations('sidebar');
  const router = useRouter();
  const { isMobile } = useSidebar();
  const billingActive = isBillingEnabled();
  const [showSettingsModal, setShowSettingsModal] = React.useState(false);
  const [settingsTab, setSettingsTab] = React.useState<SettingsTabId>('general');
  const { theme, setTheme } = useTheme();
  const { sleep } = useSleep();

  const openSettings = (tab: SettingsTabId) => {
    setSettingsTab(tab);
    setShowSettingsModal(true);
  };

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    clearUserLocalStorage();
    router.push('/auth');
  };

  const getInitials = (name: string) =>
    name.split(' ').map((p) => p.charAt(0)).join('').toUpperCase().substring(0, 2);

  const generalItems = getItemsByGroup('userMenu', 'preferences').filter(
    (item) => !item.requiresBilling || billingActive,
  );
  const accountItems = getItemsByGroup('userMenu', 'account').filter(
    (item) => !item.requiresBilling || billingActive,
  );
  const adminItems = getItemsByGroup('userMenu', 'admin').filter(
    (item) => !item.requiresAdmin || user.isAdmin,
  );
  const viewItems = getItemsByGroup('userMenu', 'view').filter(
    (item) => item.id !== 'toggle-sidebar',
  );

  const handleMenuNav = (href: string, label: string) => {
    openTabAndNavigate({
      id: `page:${href}`,
      title: label,
      type: href.startsWith('/settings') ? 'settings' : 'page',
      href,
    }, router);
  };

  const handleRegistryItem = (item: MenuItemDef) => {
    if (item.kind === 'navigate') handleMenuNav(item.href!, item.label);
    else if (item.kind === 'settings') openSettings(item.settingsTab!);
    else if (item.kind === 'action' && item.actionId === 'logout') handleLogout();
  };

  const renderRegistryItem = (item: MenuItemDef) => {
    const Icon = item.icon;
    return (
      <DropdownMenuItem key={item.id} onClick={() => handleRegistryItem(item)} className="gap-2 p-2 cursor-pointer">
        <Icon className="h-4 w-4" />
        <span>{item.label}</span>
      </DropdownMenuItem>
    );
  };

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem className="relative group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton size="lg" className="bg-muted/40 hover:bg-muted/20 rounded-2xl border">
                <Avatar className="h-8 w-8 rounded-full flex-shrink-0">
                  <AvatarImage src={user.avatar} alt={user.name} />
                  <AvatarFallback className="rounded-full text-xs">{getInitials(user.name)}</AvatarFallback>
                </Avatar>
                <div className="flex flex-col justify-center flex-1 min-w-0 gap-0.5 group-data-[collapsible=icon]:hidden">
                  <span className="truncate font-medium text-[13px] leading-tight">{user.name}</span>
                  <span className="truncate text-[11px] text-muted-foreground leading-tight">{user.email}</span>
                </div>
                <ChevronsUpDown className="ml-auto size-3.5 flex-shrink-0 group-data-[collapsible=icon]:hidden" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-(--radix-dropdown-menu-trigger-width) min-w-56 p-2"
              side={isMobile ? 'bottom' : 'top'}
              align="start"
              sideOffset={4}
            >
              <ServerSelector />
              <DropdownMenuSeparator className="my-1" />

              <DropdownMenuLabel className="text-muted-foreground text-xs px-2 py-1.5">General</DropdownMenuLabel>
              <DropdownMenuGroup>
                {accountItems.map(renderRegistryItem)}
                {generalItems.map(renderRegistryItem)}
              </DropdownMenuGroup>

              {adminItems.length > 0 && (
                <>
                  <DropdownMenuSeparator className="my-1" />
                  <DropdownMenuLabel className="text-muted-foreground text-xs px-2 py-1.5">Advanced</DropdownMenuLabel>
                  <DropdownMenuGroup>
                    {adminItems.map(renderRegistryItem)}
                  </DropdownMenuGroup>
                </>
              )}

              {/* Theme switcher */}
              <div className="px-2 py-1.5">
                <div className="flex gap-0.5 p-0.5 bg-muted/50 rounded-md w-fit">
                  {themeOptions.map((mode) => {
                    const Icon = mode.icon;
                    const isActive = theme === mode.value;
                    return (
                      <button
                        key={mode.value}
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setTheme(mode.value); }}
                        className={`p-1.5 rounded-sm transition-all duration-150 ${
                          isActive ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <Icon className="size-3.5" />
                      </button>
                    );
                  })}
                </div>
              </div>

              <DropdownMenuSeparator className="my-1" />
              <DropdownMenuItem onClick={sleep} className="gap-2 p-2 cursor-pointer">
                <Moon className="h-4 w-4" />
                <span>Sleep</span>
              </DropdownMenuItem>
              {viewItems.map(renderRegistryItem)}
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>

      <UserSettingsModal
        open={showSettingsModal}
        onOpenChange={setShowSettingsModal}
        defaultTab={settingsTab}
        returnUrl={typeof window !== 'undefined' ? window?.location?.href || '/' : '/'}
      />
    </>
  );
}
