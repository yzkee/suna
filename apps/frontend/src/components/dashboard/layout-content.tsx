"use client";

import { usePathname, useRouter } from "next/navigation";
import { lazy, Suspense, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useConnectionToasts } from "@/components/dashboard/connecting-screen";
import { AppProviders } from "@/components/layout/app-providers";
import { TabBar } from "@/components/tabs/tab-bar";
import { useAdminRole } from "@/hooks/admin";
import { useSystemStatusQuery } from "@/hooks/edge-flags";
import { OpenCodeEventStreamProvider } from "@/hooks/opencode/use-opencode-events";
import { useSandbox } from "@/hooks/platform/use-sandbox";
import { useSandboxConnection } from "@/hooks/platform/use-sandbox-connection";
import { useWebNotifications } from "@/hooks/use-web-notifications";
import { backendApi } from "@/lib/api-client";
import { KortixLoader } from "@/components/ui/kortix-loader";

import { featureFlags } from "@/lib/feature-flags";
import { buildInstancePath, getActiveInstanceIdFromCookie, getCurrentInstanceIdFromPathname } from "@/lib/instance-routes";
import { cn } from "@/lib/utils";
import { useSandboxConnectionStore } from "@/stores/sandbox-connection-store";
import { getActiveOpenCodeUrl, useServerStore, switchToInstanceAsync } from "@/stores/server-store";
import { useTabStore } from "@/stores/tab-store";
import { AnnouncementDialog } from "../announcements/announcement-dialog";
import { NovuInboxProvider } from "../notifications/novu-inbox-provider";
import { FilePreviewDialog } from "../common/file-preview-dialog";

/** Monitors session status transitions and fires browser notifications. Renders nothing. */
function WebNotificationProvider() {
	useWebNotifications();
	return null;
}

/** Monitors sandbox connection health + shows toast on connect/disconnect. Renders nothing. */
function SandboxConnectionProvider() {
	useSandboxConnection();
	useConnectionToasts();
	return null;
}

// Lazy load heavy components that aren't needed for initial render

const MaintenancePage = lazy(() =>
	import("@/components/maintenance/maintenance-page").then((mod) => ({
		default: mod.MaintenancePage,
	})),
);
const StatusOverlay = lazy(() =>
	import("@/components/ui/status-overlay").then((mod) => ({
		default: mod.StatusOverlay,
	})),
);
const PresentationViewerWrapper = lazy(() =>
	import("@/stores/presentation-viewer-store").then((mod) => ({
		default: mod.PresentationViewerWrapper,
	})),
);

const OnboardingProvider = lazy(() =>
	import("@/components/onboarding/onboarding-provider").then((mod) => ({
		default: mod.OnboardingProvider,
	})),
);


const DashboardPromoBanner = lazy(() =>
	import("@/components/home/dashboard-promo-banner").then((mod) => ({
		default: mod.DashboardPromoBanner,
	})),
);

const KortixAppBanners = lazy(() =>
	import("@/components/announcements/kortix-app-banners").then((mod) => ({
		default: mod.KortixAppBanners,
	})),
);

const TutorialsBanner = lazy(() =>
	import("@/components/announcements/tutorials-banner").then((mod) => ({
		default: mod.TutorialsBanner,
	})),
);

const MobileAppInterstitial = lazy(() =>
	import("@/components/announcements/mobile-app-interstitial").then((mod) => ({
		default: mod.MobileAppInterstitial,
	})),
);

const SleepOverlay = lazy(() =>
	import("@/components/dashboard/sleep-overlay").then((mod) => ({
		default: mod.SleepOverlay,
	})),
);

const TechnicalIssueBanner = lazy(() =>
	import("@/components/announcements/technical-issue-banner").then((mod) => ({
		default: mod.TechnicalIssueBanner,
	})),
);

const MaintenanceCountdownBanner = lazy(() =>
	import("@/components/announcements/maintenance-countdown-banner").then(
		(mod) => ({ default: mod.MaintenanceCountdownBanner }),
	),
);



const CommandPalette = lazy(() =>
	import("@/components/command-palette").then((mod) => ({
		default: mod.CommandPalette,
	})),
);

const GlobalProviderModal = lazy(() =>
	import("@/components/providers/provider-modal").then((mod) => ({
		default: mod.GlobalProviderModal,
	})),
);

const ConnectingScreen = lazy(() =>
	import("@/components/dashboard/connecting-screen").then((mod) => ({
		default: mod.ConnectingScreen,
	})),
);

const SessionLayout = lazy(() =>
	import("@/components/session/session-layout").then((mod) => ({
		default: mod.SessionLayout,
	})),
);
const SessionChat = lazy(() =>
	import("@/components/session/session-chat").then((mod) => ({
		default: mod.SessionChat,
	})),
);
const FileTabContent = lazy(() =>
	import("@/components/tabs/file-tab-content").then((mod) => ({
		default: mod.FileTabContent,
	})),
);
const PreviewTabContent = lazy(() =>
	import("@/components/tabs/preview-tab-content").then((mod) => ({
		default: mod.PreviewTabContent,
	})),
);
const TerminalTabContent = lazy(() =>
	import("@/components/tabs/terminal-tab-content").then((mod) => ({
		default: mod.TerminalTabContent,
	})),
);
const PageTabContent = lazy(() =>
	import("@/components/tabs/page-tab-content").then((mod) => ({
		default: mod.PageTabContent,
	})),
);
const RunningServicesPanel = lazy(() =>
	import("@/components/tabs/running-services-panel").then((mod) => ({
		default: mod.RunningServicesPanel,
	})),
);
const BrowserTabContent = lazy(() =>
	import("@/components/tabs/browser-tab-content").then((mod) => ({
		default: mod.BrowserTabContent,
	})),
);
const DesktopTabContent = lazy(() =>
	import("@/components/tabs/desktop-tab-content").then((mod) => ({
		default: mod.DesktopTabContent,
	})),
);

// Skeleton shell that renders immediately for FCP
function DashboardSkeleton() {
	return (
		<div className="flex h-full w-full bg-background">
			{/* Sidebar skeleton */}
			<div className="hidden md:flex w-[280px] flex-col bg-sidebar">
				<div className="p-4 space-y-4">
					<div className="h-8 w-32 bg-muted/40 rounded animate-pulse" />
					<div className="space-y-2">
						{[1, 2, 3].map((i) => (
							<div key={i} className="h-10 bg-muted/30 rounded animate-pulse" />
						))}
					</div>
				</div>
			</div>
			{/* Main content skeleton */}
			<div className="flex-1 flex flex-col">
				<div className="flex-1 flex items-center justify-center">
					<div className="w-full max-w-3xl px-4 space-y-6">
						<div className="h-10 w-64 mx-auto bg-muted/30 rounded animate-pulse" />
						<div className="h-24 bg-muted/20 rounded-xl animate-pulse" />
					</div>
				</div>
			</div>
		</div>
	);
}

function InstanceRouteSyncScreen({ instanceId }: { instanceId: string }) {
	return (
		<div className="flex h-full w-full items-center justify-center bg-background">
			<div className="flex max-w-md flex-col items-center gap-4 px-6 text-center">
				<KortixLoader size="large" />
				<div className="space-y-1">
					<p className="text-sm font-medium text-foreground">Switching instance…</p>
					<p className="text-xs text-muted-foreground break-all">{instanceId}</p>
				</div>
			</div>
		</div>
	);
}

// ============================================================================
// Pre-mounted session tabs: keeps all open sessions alive in the DOM so
// switching between tabs is instant (no re-mount, no loading spinner).
// ============================================================================
function SessionTabsContainer({ children }: { children: React.ReactNode }) {
	const tabs = useTabStore((s) => s.tabs);
	const tabOrder = useTabStore((s) => s.tabOrder);
	const activeTabId = useTabStore((s) => s.activeTabId);

	// Collect tab IDs by type
	const sessionTabIds = tabOrder.filter((id) => tabs[id]?.type === "session");
	const fileTabIds = tabOrder.filter((id) => tabs[id]?.type === "file");
	const previewTabIds = tabOrder.filter((id) => tabs[id]?.type === "preview");
	const terminalTabIds = tabOrder.filter((id) => tabs[id]?.type === "terminal");
	const servicesTabIds = tabOrder.filter((id) => tabs[id]?.type === "services");
	const browserTabIds = tabOrder.filter((id) => tabs[id]?.type === "browser");
	const desktopTabIds = tabOrder.filter((id) => tabs[id]?.type === "desktop");
	const pageTabIds = tabOrder.filter((id) => {
		const t = tabs[id]?.type;
		return t === "settings" || t === "page" || t === "project" || t === "dashboard";
	});
	const activeTab = activeTabId ? tabs[activeTabId] : null;
	// All tab types are now pre-mounted — route-based children are never shown
	const showingMountedTab = !!activeTab;

	return (
		<div
			className={cn(
				"bg-background flex-1 min-h-0 flex flex-col overflow-hidden relative",
			)}
		>
			{/* Pre-mounted session tabs — always rendered, shown/hidden via CSS */}
			{sessionTabIds.map((id) => (
				<div
					key={id}
					className={cn(
						"absolute inset-0 flex flex-col",
						id !== activeTabId && "hidden",
					)}
				>
					<Suspense fallback={null}>
						<SessionLayout sessionId={id}>
							<SessionChat sessionId={id} />
						</SessionLayout>
					</Suspense>
				</div>
			))}

			{/* File tabs — rendered when active */}
			{fileTabIds.map((id) => {
				const tab = tabs[id];
				if (!tab) return null;
				// Extract file path from tab id (strip "file:" prefix)
				const filePath = id.startsWith("file:") ? id.slice(5) : id;
				return (
					<div
						key={id}
						className={cn(
							"absolute inset-0 flex flex-col",
							id !== activeTabId && "hidden",
						)}
					>
						<Suspense fallback={null}>
							<FileTabContent tabId={id} filePath={filePath} />
						</Suspense>
					</div>
				);
			})}

			{/* Preview tabs — iframe previews of sandbox services */}
			{previewTabIds.map((id) => (
				<div
					key={id}
					className={cn(
						"absolute inset-0 flex flex-col",
						id !== activeTabId && "hidden",
					)}
				>
					<Suspense fallback={null}>
						<PreviewTabContent tabId={id} />
					</Suspense>
				</div>
			))}

			{/* Terminal tabs — 1 tab = 1 PTY */}
			{terminalTabIds.map((id) => {
				const ptyId = id.startsWith("terminal:") ? id.slice(9) : id;
				return (
					<div
						key={id}
						className={cn(
							"absolute inset-0 flex flex-col",
							id !== activeTabId && "hidden",
						)}
					>
						<Suspense fallback={null}>
							<TerminalTabContent
								ptyId={ptyId}
								tabId={id}
								hidden={id !== activeTabId}
							/>
						</Suspense>
					</div>
				);
			})}

			{/* Services tabs — Running Services panel */}
			{servicesTabIds.map((id) => (
				<div
					key={id}
					className={cn(
						"absolute inset-0 flex flex-col",
						id !== activeTabId && "hidden",
					)}
				>
					<Suspense fallback={null}>
						<RunningServicesPanel />
					</Suspense>
				</div>
			))}

	{/* Browser tabs — agent-browser CDP viewport (port 9224, Chrome-only) */}
	{browserTabIds.map((id) => (
		<div
			key={id}
			className={cn(
				"absolute inset-0 flex flex-col",
				id !== activeTabId && "hidden",
			)}
		>
			<Suspense fallback={null}>
				<BrowserTabContent />
			</Suspense>
		</div>
	))}

	{/* Desktop tabs — full Selkies desktop stream (port 6080) */}
	{desktopTabIds.map((id) => (
		<div
			key={id}
			className={cn(
				"absolute inset-0 flex flex-col",
				id !== activeTabId && "hidden",
			)}
		>
			<Suspense fallback={null}>
				<DesktopTabContent />
			</Suspense>
		</div>
	))}

	{/* Page/settings/dashboard tabs — pre-mounted, shown/hidden via CSS */}
		{pageTabIds.map((id) => {
				const tab = tabs[id];
				if (!tab) return null;
				return (
					<div
						key={id}
						className={cn(
							"absolute inset-0 flex flex-col overflow-y-auto",
							id !== activeTabId && "hidden",
						)}
					>
						<Suspense fallback={null}>
							<PageTabContent href={tab.href} />
						</Suspense>
					</div>
				);
			})}

			{/* Route-based children (fallback — hidden since all types are pre-mounted) */}
			<div
				className={cn(
					"flex-1 min-h-0 flex flex-col overflow-y-auto",
					showingMountedTab && "hidden",
				)}
			>
				{children}
			</div>
		</div>
	);
}

interface DashboardLayoutContentProps {
	children: React.ReactNode;
}

export default function DashboardLayoutContent({
	children,
}: DashboardLayoutContentProps) {
	const { user, isLoading } = useAuth();
	const router = useRouter();
	const pathname = usePathname();
	const explicitRouteInstanceId = getCurrentInstanceIdFromPathname(pathname);
	const routeInstanceId = explicitRouteInstanceId || getActiveInstanceIdFromCookie();
	const { data: systemStatus, isLoading: systemStatusLoading } =
		useSystemStatusQuery();
	const maintenanceNotice = systemStatus?.maintenanceNotice;
	const technicalIssue = systemStatus?.technicalIssue;
	const statusUpdatedAt = systemStatus?.updatedAt;
	// NOTE: useApiHealth was removed from the layout guards. Its momentary
	// failures were unmounting the ENTIRE component tree (including session
	// tabs and chat input), causing the "random refresh/flicker" bug.
	// Sandbox reachability is handled by ConnectingScreen (overlay, not
	// early return), which never unmounts children.

	// Register the primary sandbox in the server store so the OpenCode SDK can
	// connect. Must run before the onboarding check.
	useSandbox();

	const { data: adminRoleData, isLoading: isCheckingAdminRole } =
		useAdminRole();
	const isAdmin = adminRoleData?.isAdmin ?? false;

	useEffect(() => {
		if (user) {
			backendApi.post("/prewarm", undefined, { showErrors: false });
		}
	}, [user]);

	// Check authentication status
	useEffect(() => {
		if (!isLoading && !user) {
			router.push("/auth");
		}
	}, [user, isLoading, router]);

	// Hard gate: redirect to /onboarding if ONBOARDING_COMPLETE is not "true".
	// Reads directly from the sandbox env — same endpoint as the Secrets Manager page.
	// Re-runs when the sandbox registers (activeServerId changes) so we get a URL.
	const activeServerId = useServerStore((s) => s.activeServerId);
	const [onboardingChecked, setOnboardingChecked] = useState(false);
	const [routeSyncing, setRouteSyncing] = useState(false);

	useEffect(() => {
		setOnboardingChecked(false);
	}, [routeInstanceId]);

	// Timeout fallback: if sandbox URL never arrives, fail open fast.
	// We already have a connecting overlay later; don't trap the user in a long skeleton.
	useEffect(() => {
		if (onboardingChecked || routeSyncing) return;
		const timer = setTimeout(() => {
			if (!onboardingChecked) {
				console.warn("[layout] Onboarding check timed out — failing open");
				setOnboardingChecked(true);
			}
		}, 1000);
		return () => clearTimeout(timer);
	}, [onboardingChecked, routeSyncing]);

	useEffect(() => {
		const checkOnboarding = async () => {
			if (routeSyncing) return;
			const currentInstanceId = routeInstanceId || getActiveInstanceIdFromCookie();
			const instanceUrl = getActiveOpenCodeUrl();
			if (!instanceUrl) {
				// Sandbox URL not known yet — wait for next re-run when it registers
				// (timeout above prevents infinite wait)
				return;
			}
			const { authenticatedFetch } = await import("@/lib/auth-token");
			try {
				const res = await authenticatedFetch(`${instanceUrl}/env/ONBOARDING_COMPLETE`, undefined, { retryOnAuthError: false });
				if (!res.ok) {
					// Sandbox unreachable — let through, don't block
					setOnboardingChecked(true);
					return;
				}
				const data = await res.json();
				if (data?.ONBOARDING_COMPLETE === 'true') {
					setOnboardingChecked(true);
				} else {
					if (currentInstanceId) {
						router.replace(`/instances/${currentInstanceId}/onboarding`);
					} else {
						// No instance context — send to instances page
						router.replace("/instances");
					}
				}
			} catch {
				// Unreachable — let through
				setOnboardingChecked(true);
			}
		};
		checkOnboarding();
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [activeServerId, routeInstanceId, routeSyncing]);

	// Keep the active server in sync with the current instance.
	// Source of truth: URL path (/instances/:id/...) OR active-instance cookie
	// (set by middleware on rewrite). The store MUST point at that instance.
	useEffect(() => {
		if (!routeInstanceId || !user) {
			setRouteSyncing(false);
			return;
		}

		// Already pointing at the right instance? Skip.
		const state = useServerStore.getState();
		const active = state.servers.find((s) => s.id === state.activeServerId);
		if (active?.instanceId === routeInstanceId) {
			setRouteSyncing(false);
			return;
		}

		let cancelled = false;
		setRouteSyncing(true);
		switchToInstanceAsync(routeInstanceId, { validate: true })
			.then((result) => {
				if (cancelled) return;
				if (!result) {
					router.replace(`/instances/${routeInstanceId}`);
					return;
				}
				setRouteSyncing(false);
			})
			.catch(() => {
				if (cancelled) return;
				router.replace(`/instances/${routeInstanceId}`);
			});

		return () => {
			cancelled = true;
		};
	}, [routeInstanceId, user, router]);

	const isMaintenanceActive = (() => {
		if (
			!maintenanceNotice?.enabled ||
			!maintenanceNotice.startTime ||
			!maintenanceNotice.endTime
		) {
			return false;
		}
		const now = new Date();
		const start = new Date(maintenanceNotice.startTime);
		const end = new Date(maintenanceNotice.endTime);
		return now >= start && now <= end;
	})();

	const isMaintenanceScheduled = (() => {
		if (
			!maintenanceNotice?.enabled ||
			!maintenanceNotice.startTime ||
			!maintenanceNotice.endTime
		) {
			return false;
		}
		const now = new Date();
		const start = new Date(maintenanceNotice.startTime);
		const end = new Date(maintenanceNotice.endTime);
		return now < start && now < end;
	})();

	if (isLoading) {
		return <DashboardSkeleton />;
	}

	if (routeSyncing && routeInstanceId) {
		return <InstanceRouteSyncScreen instanceId={routeInstanceId} />;
	}

	if (!onboardingChecked) {
		return <DashboardSkeleton />;
	}

	if (!user) {
		return <DashboardSkeleton />;
	}

	if (
		isMaintenanceActive &&
		!systemStatusLoading &&
		!isCheckingAdminRole &&
		!isAdmin
	) {
		return (
			<Suspense fallback={<DashboardSkeleton />}>
				<MaintenancePage />
			</Suspense>
		);
	}

	return (
		<NovuInboxProvider>
			<Suspense fallback={null}>
				<SleepOverlay />
			</Suspense>
			<AppProviders
				showSidebar={true}
				defaultSidebarOpen={true}
				sidebarSiblings={
					<Suspense fallback={null}>
						{/* Status overlay for deletion operations */}
						<StatusOverlay />

					</Suspense>
				}
			>
			<SandboxConnectionProvider />
			<OpenCodeEventStreamProvider />
			<WebNotificationProvider />
			<Suspense fallback={null}>
				<ConnectingScreen />
			</Suspense>

			{/* Fixed overlay banners — outside document flow, won't affect layout */}
				<Suspense fallback={null}>
					<DashboardPromoBanner />
				</Suspense>

				<div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
					<Suspense fallback={null}>
						<AnnouncementDialog />
					</Suspense>

					<FilePreviewDialog />

					<Suspense fallback={null}>
						<CommandPalette />
					</Suspense>
					<Suspense fallback={null}>
						<GlobalProviderModal />
					</Suspense>
					<Suspense fallback={null}>
						<OnboardingProvider>
							<TabBar />
							<div className="flex-1 min-h-0 flex flex-col md:border md:border-b-0 md:border-border/50 overflow-hidden md:rounded-t-xl">
								<SessionTabsContainer>{children}</SessionTabsContainer>
							</div>
						</OnboardingProvider>
					</Suspense>
					<Suspense fallback={null}>
						<PresentationViewerWrapper />
					</Suspense>
				</div>

				{/* Fixed-position notification toasts — rendered outside main flex to not affect layout */}
				{technicalIssue?.enabled && technicalIssue.message && (
					<Suspense fallback={null}>
						<TechnicalIssueBanner
							message={technicalIssue.message}
							statusUrl={technicalIssue.statusUrl}
							updatedAt={statusUpdatedAt}
						/>
					</Suspense>
				)}
				{isMaintenanceScheduled &&
					maintenanceNotice?.startTime &&
					maintenanceNotice?.endTime && (
						<Suspense fallback={null}>
							<MaintenanceCountdownBanner
								startTime={maintenanceNotice.startTime}
								endTime={maintenanceNotice.endTime}
								updatedAt={statusUpdatedAt}
							/>
						</Suspense>
					)}
				<Suspense fallback={null}>
					<KortixAppBanners
						disableMobileAdvertising={featureFlags.disableMobileAdvertising}
					/>
				</Suspense>
				<Suspense fallback={null}>
					<TutorialsBanner />
				</Suspense>
				{!featureFlags.disableMobileAdvertising ? (
					<Suspense fallback={null}>
						<MobileAppInterstitial />
					</Suspense>
				) : null}
			</AppProviders>
		</NovuInboxProvider>
	);
}
