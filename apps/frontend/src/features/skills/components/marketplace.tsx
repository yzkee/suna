'use client';

import { useMemo, useState } from 'react';
import {
	Check,
	Download,
	FileText,
	Loader2,
	Package,
	Search,
	Sparkles,
	X,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { SpotlightCard } from '@/components/ui/spotlight-card';
import { Ripple } from '@/components/ui/ripple';
import { PageHeader } from '@/components/ui/page-header';
import { getClient } from '@/lib/opencode-sdk';
import { cn } from '@/lib/utils';
import { getPtyWebSocketUrl } from '@/hooks/opencode/use-opencode-pty';

import {
	type RegistryComponent,
	type RegistryComponentBundle,
	useInstalledSkillNames,
	useMarketplaceComponent,
	useMarketplaceSkills,
} from '../hooks/use-marketplace';
import { useMarketplaceStore } from '../store/marketplace-store';
import { skillsKeys } from '../hooks/use-skills';

type FilterKey = 'all' | 'installed' | 'skills' | 'agents' | 'tools' | 'plugins';

const FILTERS: Array<{ key: FilterKey; label: string }> = [
	{ key: 'all', label: 'All' },
	{ key: 'installed', label: 'Installed' },
	{ key: 'skills', label: 'Skills' },
	{ key: 'agents', label: 'Agents' },
	{ key: 'tools', label: 'Tools' },
	{ key: 'plugins', label: 'Plugins' },
];

const TYPE_META: Record<string, { label: string; color: string; dotColor: string }> = {
	'ocx:skill': { label: 'Skill', color: 'text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/20', dotColor: 'bg-blue-500' },
	'ocx:agent': { label: 'Agent', color: 'text-violet-600 dark:text-violet-400 bg-violet-500/10 border-violet-500/20', dotColor: 'bg-violet-500' },
	'ocx:tool': { label: 'Tool', color: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20', dotColor: 'bg-amber-500' },
	'ocx:plugin': { label: 'Plugin', color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20', dotColor: 'bg-emerald-500' },
};

function getComponentMeta(type: string) {
	return TYPE_META[type] ?? { label: type.replace('ocx:', ''), color: 'text-muted-foreground bg-muted border-border', dotColor: 'bg-muted-foreground' };
}

// ── PTY install helpers ───────────────────────────────────────────────────────

async function runPtyCommand(command: string): Promise<string> {
	const client = getClient();
	const created = await client.pty.create({
		command: '/bin/sh',
		args: ['-c', command],
		title: '__marketplace-install__',
	});

	if (created.error) {
		const err = created.error as { data?: { message?: string }; message?: string };
		throw new Error(err.data?.message || err.message || 'Failed to create PTY');
	}

	const pty = created.data as { id?: string };
	if (!pty.id) throw new Error('PTY created but no ID returned');

	const connectUrl = await getPtyWebSocketUrl(pty.id);

	return new Promise<string>((resolve, reject) => {
		const ws = new WebSocket(connectUrl);
		const chunks: string[] = [];
		const timeout = setTimeout(() => {
			ws.close();
			reject(new Error('Install command timed out'));
		}, 60_000);

		ws.onmessage = (event) => {
			if (typeof event.data === 'string') chunks.push(event.data);
		};

		ws.onclose = () => {
			clearTimeout(timeout);
			resolve(chunks.join(''));
		};

		ws.onerror = () => {
			clearTimeout(timeout);
			reject(new Error('Unable to read install output'));
		};
	});
}

async function installComponentWithOcx(componentName: string) {
	const output = await runPtyCommand(
		`cd /workspace && ocx init -q 2>/dev/null && ocx registry add https://master.kortix-registry.pages.dev --name kortix -q 2>/dev/null; ocx add kortix/${componentName} 2>&1`,
	);
	const normalized = output.toLowerCase();
	const isInstalled = normalized.includes('installed') || normalized.includes('done');
	if (!isInstalled) {
		if (normalized.includes('not found') || normalized.includes('failed to') || normalized.includes('registry alias')) {
			throw new Error(output.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim() || 'Install failed');
		}
	}
	try {
		const client = getClient();
		await client.instance.dispose();
	} catch {
		// Non-fatal
	}
	return output;
}

function formatPath(path: string) {
	const parts = path.split('/');
	return parts.length > 1 ? parts.slice(1).join('/') : parts[0];
}

// ── Component Detail Modal ────────────────────────────────────────────────────

function ComponentDetailModal({
	component,
	open,
	onOpenChange,
}: {
	component: RegistryComponent | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { data, isLoading, error } = useMarketplaceComponent(open ? component?.name ?? null : null);
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const queryClient = useQueryClient();
	const installedSkills = useInstalledSkillNames();
	const { installing, markInstalling, clearInstalling } = useMarketplaceStore();
	const [installError, setInstallError] = useState('');

	const bundle = data as RegistryComponentBundle | undefined;
	const meta = component ? getComponentMeta(component.type) : getComponentMeta('ocx:skill');
	const isInstalled = component ? installedSkills.has(component.name.toLowerCase()) : false;
	const isInstalling = component ? installing.includes(component.name) : false;

	const activePath = useMemo(() => {
		if (!bundle) return null;
		if (selectedPath && bundle.files.some((f) => f.path === selectedPath)) return selectedPath;
		return bundle.files[0]?.path ?? null;
	}, [bundle, selectedPath]);

	const activeFile = bundle?.files.find((f) => f.path === activePath) ?? null;

	const handleInstall = async () => {
		if (!component) return;
		setInstallError('');
		markInstalling(component.name);
		try {
			await installComponentWithOcx(component.name);
			await queryClient.invalidateQueries({ queryKey: skillsKeys.all });
		} catch (err) {
			setInstallError(err instanceof Error ? err.message : 'Install failed');
		} finally {
			clearInstalling(component.name);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-5xl w-[calc(100vw-2rem)] h-[80vh] grid grid-rows-[auto_1fr] gap-0 p-0 border-border/50 bg-background overflow-hidden">
				<DialogTitle className="sr-only">
					{component?.name} - Component Details
				</DialogTitle>

				{/* Header */}
				<div className="px-6 sm:px-8 py-6 border-b border-border/50">
					<div className="flex items-start justify-between gap-6 pr-8">
						<div className="min-w-0">
							<div className="flex items-center gap-3">
								<h2 className="text-lg font-semibold tracking-tight text-foreground">{component?.name}</h2>
								<span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border', meta.color)}>
									<span className={cn('h-1.5 w-1.5 rounded-full', meta.dotColor)} />
									{meta.label}
								</span>
								{bundle?.version.version && (
									<Badge variant="outline" className="text-[10px]">v{bundle.version.version}</Badge>
								)}
								{isInstalled && (
									<Badge variant="highlight" className="text-[10px]">Installed</Badge>
								)}
							</div>
							<p className="mt-3 text-sm text-muted-foreground max-w-2xl leading-relaxed">
								{component?.description}
							</p>
						</div>
						<div className="flex items-center gap-2 shrink-0">
							<Button
								variant="outline"
								size="sm"
								className="h-8 px-3 text-xs"
								onClick={() => component && navigator.clipboard.writeText(component.name)}
							>
								Copy
							</Button>
							<Button
								variant="default"
								size="sm"
								className="h-8 px-3 text-xs"
								onClick={handleInstall}
								disabled={!component || isInstalling || isInstalled}
							>
								{isInstalling ? (
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
								) : isInstalled ? (
									<Check className="h-3.5 w-3.5" />
								) : (
									<Download className="h-3.5 w-3.5" />
								)}
								{isInstalling ? 'Installing' : isInstalled ? 'Installed' : 'Install'}
							</Button>
						</div>
					</div>
					{installError && (
						<p className="mt-4 text-xs text-destructive">{installError}</p>
					)}
				</div>

				{/* Body */}
				<div className="grid grid-cols-[240px_1fr] min-h-0">
					{/* File tree */}
					<div className="border-r border-border/50 overflow-y-auto">
						<div className="sticky top-0 px-4 py-3 border-b border-border/50 bg-background">
							<span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Files</span>
						</div>
						<div className="p-2">
							{isLoading ? (
								<div className="flex items-center justify-center py-8">
									<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
								</div>
							) : error ? (
								<p className="px-3 py-4 text-xs text-destructive">{error.message}</p>
							) : (
								bundle?.files.map((file) => (
									<button
										key={file.path}
										onClick={() => setSelectedPath(file.path)}
										className={cn(
											'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors',
											activePath === file.path
												? 'bg-foreground text-background'
												: 'text-foreground hover:bg-muted',
										)}
									>
										<FileText className="h-3.5 w-3.5 shrink-0 opacity-60" />
										<span className="truncate">{formatPath(file.path)}</span>
									</button>
								))
							)}
						</div>
					</div>

					{/* File content */}
					<div className="overflow-y-auto bg-background p-6">
						{activeFile ? (
							<pre className="text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap font-mono">
								<code>{activeFile.content}</code>
							</pre>
						) : (
							<div className="flex items-center justify-center h-full text-sm text-muted-foreground">
								Select a file to preview
							</div>
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

// ── Component Card ────────────────────────────────────────────────────────────

function ComponentCard({
	component,
	onOpen,
	index,
}: {
	component: RegistryComponent;
	onOpen: (c: RegistryComponent) => void;
	index: number;
}) {
	const [error, setError] = useState('');
	const queryClient = useQueryClient();
	const installedSkills = useInstalledSkillNames();
	const { installing, markInstalling, clearInstalling } = useMarketplaceStore();
	const isInstalled = installedSkills.has(component.name.toLowerCase());
	const isInstalling = installing.includes(component.name);
	const meta = getComponentMeta(component.type);

	const handleInstall = async (e: React.MouseEvent) => {
		e.stopPropagation();
		setError('');
		markInstalling(component.name);
		try {
			await installComponentWithOcx(component.name);
			await queryClient.invalidateQueries({ queryKey: skillsKeys.all });
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Install failed');
		} finally {
			clearInstalling(component.name);
		}
	};

	return (
		<motion.div
			layout
			initial={{ opacity: 0, y: 16 }}
			animate={{ opacity: 1, y: 0 }}
			exit={{ opacity: 0, y: -8, scale: 0.95 }}
			transition={{ duration: 0.3, delay: Math.min(index * 0.03, 0.6) }}
		>
			<SpotlightCard className="bg-card border border-border/50">
				<div
					onClick={() => onOpen(component)}
					className="p-4 sm:p-5 flex flex-col h-full cursor-pointer"
				>
					<div className="flex items-start justify-between gap-2 mb-2">
						<div className="min-w-0 flex-1">
							<h3 className="text-sm font-semibold text-foreground truncate">{component.name}</h3>
						</div>
						{isInstalled && (
							<Badge variant="highlight" className="text-[10px] shrink-0">Installed</Badge>
						)}
					</div>

					<div className="flex items-center gap-2 mb-3">
						<span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border', meta.color)}>
							<span className={cn('h-1.5 w-1.5 rounded-full', meta.dotColor)} />
							{meta.label}
						</span>
						<span className="text-[10px] text-muted-foreground/50">v{component.version}</span>
					</div>

					<div className="h-[34px] mb-3">
						<p className="text-xs text-muted-foreground/80 leading-relaxed line-clamp-2">
							{component.description || '\u00A0'}
						</p>
					</div>

					<div className="flex justify-end">
						{isInstalled ? (
							<Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs">
								View
							</Button>
						) : (
							<Button
								variant="default"
								size="sm"
								className="h-8 px-3 text-xs"
								onClick={handleInstall}
								disabled={isInstalling}
							>
								{isInstalling ? (
									<Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
								) : (
									<Download className="h-3.5 w-3.5" />
								)}
								{isInstalling ? 'Installing' : 'Install'}
							</Button>
						)}
					</div>

					{error && (
						<p className="mt-3 text-xs text-destructive">{error}</p>
					)}
				</div>
			</SpotlightCard>
		</motion.div>
	);
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function LoadingSkeleton() {
	return (
		<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
			{[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
				<div key={i} className="rounded-2xl border dark:bg-card p-4 sm:p-5">
					<div className="flex items-start justify-between gap-2 mb-2">
						<Skeleton className="h-4 w-28" />
					</div>
					<div className="flex items-center gap-2 mb-3">
						<Skeleton className="h-5 w-14 rounded-full" />
						<Skeleton className="h-3 w-10" />
					</div>
					<Skeleton className="h-3 w-full mb-1" />
					<Skeleton className="h-3 w-4/5 mb-3" />
					<div className="flex justify-end">
						<Skeleton className="h-8 w-16" />
					</div>
				</div>
			))}
		</div>
	);
}

// ── Empty state ───────────────────────────────────────────────────────────────

function MarketplaceEmptyState({ searchQuery, filter }: { searchQuery: string; filter: FilterKey }) {
	if (searchQuery) {
		return (
			<div className="text-center py-12 text-muted-foreground text-sm">
				No components matching &ldquo;{searchQuery}&rdquo;
			</div>
		);
	}

	if (filter === 'installed') {
		return (
			<div className="relative bg-muted/20 rounded-3xl border border-dashed border-border/50 flex flex-col items-center justify-center py-20 px-4 overflow-hidden">
				<Ripple mainCircleSize={160} mainCircleOpacity={0.12} numCircles={6} />
				<div className="relative z-10 flex flex-col items-center">
					<div className="w-16 h-16 bg-muted border rounded-2xl flex items-center justify-center mb-4">
						<Package className="h-7 w-7 text-muted-foreground" />
					</div>
					<h3 className="text-lg font-semibold text-foreground mb-2">Nothing installed yet</h3>
					<p className="text-sm text-muted-foreground text-center leading-relaxed max-w-md">
						Browse the marketplace and install skills, agents, tools, or plugins to extend your workspace.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="relative bg-muted/20 rounded-3xl border border-dashed border-border/50 flex flex-col items-center justify-center py-20 px-4 overflow-hidden">
			<Ripple mainCircleSize={160} mainCircleOpacity={0.12} numCircles={6} />
			<div className="relative z-10 flex flex-col items-center">
				<div className="w-16 h-16 bg-muted border rounded-2xl flex items-center justify-center mb-4">
					<Sparkles className="h-7 w-7 text-muted-foreground" />
				</div>
				<h3 className="text-lg font-semibold text-foreground mb-2">No components found</h3>
				<p className="text-sm text-muted-foreground text-center leading-relaxed max-w-md">
					No components are available in this category right now.
				</p>
			</div>
		</div>
	);
}

// ── Main Marketplace ──────────────────────────────────────────────────────────

export function Marketplace() {
	const [search, setSearch] = useState('');
	const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
	const [selectedComponent, setSelectedComponent] = useState<RegistryComponent | null>(null);
	const { data: components, isLoading, error } = useMarketplaceSkills();
	const installedSkills = useInstalledSkillNames();

	const counts = useMemo(() => {
		const list = components ?? [];
		return {
			all: list.length,
			installed: list.filter((i) => installedSkills.has(i.name.toLowerCase())).length,
			skills: list.filter((i) => i.type === 'ocx:skill').length,
			agents: list.filter((i) => i.type === 'ocx:agent').length,
			tools: list.filter((i) => i.type === 'ocx:tool').length,
			plugins: list.filter((i) => i.type === 'ocx:plugin').length,
		};
	}, [components, installedSkills]);

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		return (components ?? []).filter((c) => {
			const matches = !q || c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q);
			if (!matches) return false;
			switch (activeFilter) {
				case 'installed': return installedSkills.has(c.name.toLowerCase());
				case 'skills': return c.type === 'ocx:skill';
				case 'agents': return c.type === 'ocx:agent';
				case 'tools': return c.type === 'ocx:tool';
				case 'plugins': return c.type === 'ocx:plugin';
				default: return true;
			}
		});
	}, [activeFilter, components, installedSkills, search]);

	return (
		<>
			<div className="flex-1 overflow-y-auto">
				{/* Page header */}
				<div className="container mx-auto max-w-7xl px-3 sm:px-4 py-4 sm:py-8 animate-in fade-in-0 slide-in-from-bottom-4 duration-500 fill-mode-both">
					<PageHeader icon={Sparkles}>
						<div className="space-y-2 sm:space-y-4">
							<div className="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight">
								<span className="text-primary">Marketplace</span>
							</div>
						</div>
					</PageHeader>
				</div>

				<div className="container mx-auto max-w-7xl px-3 sm:px-4">
					{/* Search + filter bar */}
					<div className="flex items-center gap-2 sm:gap-4 pb-3 sm:pb-4 pt-2 sm:pt-3 animate-in fade-in-0 slide-in-from-bottom-4 duration-500 fill-mode-both delay-75">
						<div className="flex-1 max-w-md">
							<div className="relative group">
								<input
									type="text"
									placeholder="Search components..."
									value={search}
									onChange={(e) => setSearch(e.target.value)}
									className="h-11 w-full rounded-2xl border border-input bg-card px-10 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
								/>
								<div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors">
									<Search className="h-4 w-4" />
								</div>
								{search && (
									<button
										onClick={() => setSearch('')}
										className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-md p-0.5 transition-colors cursor-pointer"
									>
										<X className="h-4 w-4" />
									</button>
								)}
							</div>
						</div>

						{/* Filter segmented control */}
						<div className="hidden sm:flex items-center gap-1 rounded-2xl border border-border bg-muted/30 p-1">
							{FILTERS.map((f) => (
								<button
									key={f.key}
									onClick={() => setActiveFilter(f.key)}
									className={cn(
										'px-3 py-1.5 text-xs font-medium rounded-xl transition-all cursor-pointer',
										activeFilter === f.key
											? 'bg-background text-foreground border border-border/50 shadow-sm'
											: 'text-muted-foreground hover:text-foreground hover:bg-background/70 border border-transparent',
									)}
								>
									{f.label}
									{counts[f.key] > 0 && (
										<span className="ml-1 tabular-nums opacity-60">{counts[f.key]}</span>
									)}
								</button>
							))}
						</div>

						{/* Mobile filter dropdown */}
						<div className="sm:hidden">
							<select
								value={activeFilter}
								onChange={(e) => setActiveFilter(e.target.value as FilterKey)}
								className="h-11 rounded-2xl border border-input bg-card px-3 text-sm"
							>
								{FILTERS.map((f) => (
									<option key={f.key} value={f.key}>
										{f.label} ({counts[f.key]})
									</option>
								))}
							</select>
						</div>
					</div>

					{/* Content */}
					<div className="pb-6 sm:pb-8 animate-in fade-in-0 slide-in-from-bottom-4 duration-500 fill-mode-both delay-150">
						{isLoading ? (
							<LoadingSkeleton />
						) : error ? (
							<div className="text-center py-12">
								<p className="text-sm text-destructive">Failed to load marketplace</p>
								<p className="text-xs text-muted-foreground mt-1">{error.message}</p>
							</div>
						) : filtered.length === 0 ? (
							<MarketplaceEmptyState searchQuery={search} filter={activeFilter} />
						) : (
							<>
								<div className="flex items-center gap-2 mb-4">
									<span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
										{activeFilter === 'all' ? 'All Components' : activeFilter === 'installed' ? 'Installed' : activeFilter.charAt(0).toUpperCase() + activeFilter.slice(1)}
									</span>
									<Badge variant="secondary" className="text-xs tabular-nums">
										{filtered.length}
									</Badge>
								</div>

								<AnimatePresence mode="popLayout">
									<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
										{filtered.map((c, index) => (
											<ComponentCard
												key={c.name}
												component={c}
												onOpen={setSelectedComponent}
												index={index}
											/>
										))}
									</div>
								</AnimatePresence>
							</>
						)}
					</div>
				</div>
			</div>

			<ComponentDetailModal
				component={selectedComponent}
				open={Boolean(selectedComponent)}
				onOpenChange={(open) => !open && setSelectedComponent(null)}
			/>
		</>
	);
}
