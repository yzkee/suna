'use client';

import { useMemo, useState } from 'react';
import {
	ArrowRight,
	Bot,
	Check,
	ChevronDown,
	Cpu,
	Download,
	FileText,
	FolderTree,
	Loader2,
	Puzzle,
	Search,
	Sparkles,
	Wrench,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from '@/components/ui/dialog';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { getClient } from '@/lib/opencode-sdk';
import { cn } from '@/lib/utils';
import { getActiveOpenCodeUrl } from '@/stores/server-store';

import {
	type RegistryComponent,
	type RegistryComponentBundle,
	useMarketplaceComponent,
	useMarketplaceSkills,
} from '../hooks/use-marketplace';
import { useMarketplaceStore } from '../store/marketplace-store';

type FilterKey = 'all' | 'installed' | 'skills' | 'agents' | 'tools' | 'plugins';

const FILTERS: Array<{ key: FilterKey; label: string }> = [
	{ key: 'all', label: 'All' },
	{ key: 'installed', label: 'Installed' },
	{ key: 'skills', label: 'Skills' },
	{ key: 'agents', label: 'Agents' },
	{ key: 'tools', label: 'Tools' },
	{ key: 'plugins', label: 'Plugins' },
];

const TYPE_META: Record<string, { icon: typeof Bot; label: string }> = {
	'ocx:skill': { icon: Bot, label: 'Skill' },
	'ocx:agent': { icon: Cpu, label: 'Agent' },
	'ocx:tool': { icon: Wrench, label: 'Tool' },
	'ocx:plugin': { icon: Puzzle, label: 'Plugin' },
};

function getComponentMeta(type: string) {
	return TYPE_META[type] ?? { icon: Bot, label: type.replace('ocx:', '') };
}

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

	const baseUrl = getActiveOpenCodeUrl();
	if (!baseUrl) throw new Error('No OpenCode server URL configured');

	const wsBase = baseUrl.replace('https://', 'wss://').replace('http://', 'ws://');

	return new Promise<string>((resolve, reject) => {
		const ws = new WebSocket(`${wsBase}/pty/${pty.id}/connect`);
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
	const output = await runPtyCommand(`ocx add kortix/${componentName}`);
	const normalized = output.toLowerCase();
	if (normalized.includes('error') || normalized.includes('failed')) {
		throw new Error(output.trim() || 'Install failed');
	}
	return output;
}

function formatPath(path: string) {
	const parts = path.split('/');
	return parts.length > 1 ? parts.slice(1).join('/') : parts[0];
}

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
	const { installed, markInstalled, unmark } = useMarketplaceStore();
	const [isInstalling, setIsInstalling] = useState(false);
	const [installError, setInstallError] = useState('');

	const bundle = data as RegistryComponentBundle | undefined;
	const meta = component ? getComponentMeta(component.type) : getComponentMeta('ocx:skill');
	const Icon = meta.icon;
	const isInstalled = component ? installed.includes(component.name) : false;

	const activePath = useMemo(() => {
		if (!bundle) return null;
		if (selectedPath && bundle.files.some((f) => f.path === selectedPath)) return selectedPath;
		return bundle.files[0]?.path ?? null;
	}, [bundle, selectedPath]);

	const activeFile = bundle?.files.find((f) => f.path === activePath) ?? null;

	const handleInstall = async () => {
		if (!component) return;
		setInstallError('');
		setIsInstalling(true);
		try {
			await installComponentWithOcx(component.name);
			markInstalled(component.name);
		} catch (err) {
			setInstallError(err instanceof Error ? err.message : 'Install failed');
		} finally {
			setIsInstalling(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-5xl w-[calc(100vw-2rem)] h-[80vh] grid grid-rows-[auto_1fr] gap-0 p-0 border-border/50 bg-background overflow-hidden">
				<DialogTitle className="sr-only">
					{component?.name} - Component Details
				</DialogTitle>
				<div className="px-8 py-6 border-b border-border/50 bg-muted/20">
					<div className="flex items-start justify-between gap-6 pr-8">
						<div className="min-w-0">
							<div className="flex items-center gap-3">
								<div className="flex size-9 items-center justify-center rounded-xl bg-muted">
									<Icon className="size-4 text-foreground/80" />
								</div>
								<h2 className="text-lg font-medium tracking-tight">{component?.name}</h2>
								<Badge variant="secondary" className="text-[10px]">{meta.label}</Badge>
								{bundle?.version.version && <Badge variant="outline" className="text-[10px]">v{bundle.version.version}</Badge>}
								{isInstalled && <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-200 text-[10px]">Installed</Badge>}
							</div>
							<p className="mt-3 text-sm text-muted-foreground max-w-2xl leading-relaxed">{component?.description}</p>
						</div>
						<div className="flex items-center gap-2 shrink-0">
							<Button variant="outline" size="sm" className="rounded-xl" onClick={() => component && navigator.clipboard.writeText(component.name)}>
								Copy
							</Button>
							<Button size="sm" className="rounded-xl" onClick={handleInstall} disabled={!component || isInstalling || isInstalled}>
								{isInstalling ? <Loader2 className="size-4 animate-spin" /> : isInstalled ? <Check className="size-4" /> : <Download className="size-4" />}
								{isInstalling ? 'Installing' : isInstalled ? 'Installed' : 'Install'}
							</Button>
						</div>
					</div>
					{installError && <p className="mt-4 text-xs text-destructive">{installError}</p>}
				</div>

				<div className="grid grid-cols-[240px_1fr] min-h-0">
					<div className="border-r border-border/50 bg-muted/10 overflow-y-auto">
						<div className="sticky top-0 px-4 py-3 border-b border-border/50 bg-muted/20">
							<span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Files</span>
						</div>
						<div className="p-2">
							{isLoading ? (
								<div className="flex items-center justify-center py-8"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>
							) : error ? (
								<p className="px-3 py-4 text-xs text-destructive">{error.message}</p>
							) : (
								bundle?.files.map((file) => (
									<button
										key={file.path}
										onClick={() => setSelectedPath(file.path)}
										className={cn(
											'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors',
											activePath === file.path ? 'bg-foreground text-background' : 'text-foreground hover:bg-muted',
										)}
									>
										<FileText className="size-3.5 shrink-0 opacity-60" />
										<span className="truncate">{formatPath(file.path)}</span>
									</button>
								))
							)}
						</div>
					</div>
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

function ComponentCard({
	component,
	onOpen,
}: {
	component: RegistryComponent;
	onOpen: (c: RegistryComponent) => void;
}) {
	const [isInstalling, setIsInstalling] = useState(false);
	const [error, setError] = useState('');
	const { installed, markInstalled, unmark } = useMarketplaceStore();
	const isInstalled = installed.includes(component.name);
	const meta = getComponentMeta(component.type);
	const Icon = meta.icon;

	const handleInstall = async (e: React.MouseEvent) => {
		e.stopPropagation();
		setError('');
		setIsInstalling(true);
		try {
			await installComponentWithOcx(component.name);
			markInstalled(component.name);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Install failed');
		} finally {
			setIsInstalling(false);
		}
	};

	return (
		<div
			onClick={() => onOpen(component)}
			className="w-full text-left rounded-2xl border border-border/50 bg-card p-5 transition-all hover:border-foreground/10 hover:shadow-sm group cursor-pointer"
		>
			<div className="flex items-start justify-between gap-4">
				<div className="flex items-start gap-3 min-w-0">
					<div className="flex size-9 items-center justify-center rounded-xl bg-muted shrink-0">
						<Icon className="size-4 text-foreground/70" />
					</div>
					<div className="min-w-0">
						<div className="flex items-center gap-2">
							<h3 className="text-[15px] font-medium truncate">{component.name}</h3>
							<Badge variant="outline" className="text-[10px] shrink-0">{meta.label}</Badge>
						</div>
						<p className="mt-2 line-clamp-2 text-sm text-muted-foreground leading-relaxed">{component.description}</p>
					</div>
				</div>
			</div>

			<div className="mt-4 flex items-center justify-between">
				<div className="flex items-center gap-2">
					{isInstalled ? (
						<Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-200 text-[10px]">Installed</Badge>
					) : (
						<span className="text-xs text-muted-foreground">v{component.version}</span>
					)}
				</div>
				<div className="flex items-center gap-2">
					{isInstalled ? (
						<Button size="sm" variant="outline" className="rounded-xl h-8" onClick={(e) => { e.stopPropagation(); unmark(component.name); }}>
							Reset
						</Button>
					) : null}
					<Button
						size="sm"
						className="rounded-xl h-8"
						onClick={handleInstall}
						disabled={isInstalling || isInstalled}
					>
						{isInstalling ? <Loader2 className="size-3.5 animate-spin" /> : isInstalled ? <Check className="size-3.5" /> : <Download className="size-3.5" />}
						{isInstalling ? 'Installing' : isInstalled ? 'Installed' : 'Install'}
					</Button>
				</div>
			</div>
			{error && <p className="mt-3 text-xs text-destructive">{error}</p>}
		</div>
	);
}

export function Marketplace() {
	const [search, setSearch] = useState('');
	const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
	const [selectedComponent, setSelectedComponent] = useState<RegistryComponent | null>(null);
	const { data: components, isLoading, error } = useMarketplaceSkills();
	const { installed } = useMarketplaceStore();

	const counts = useMemo(() => {
		const list = components ?? [];
		return {
			all: list.length,
			installed: list.filter((i) => installed.includes(i.name)).length,
			skills: list.filter((i) => i.type === 'ocx:skill').length,
			agents: list.filter((i) => i.type === 'ocx:agent').length,
			tools: list.filter((i) => i.type === 'ocx:tool').length,
			plugins: list.filter((i) => i.type === 'ocx:plugin').length,
		};
	}, [components, installed]);

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		return (components ?? []).filter((c) => {
			const matches = !q || c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q);
			if (!matches) return false;
			switch (activeFilter) {
				case 'installed': return installed.includes(c.name);
				case 'skills': return c.type === 'ocx:skill';
				case 'agents': return c.type === 'ocx:agent';
				case 'tools': return c.type === 'ocx:tool';
				case 'plugins': return c.type === 'ocx:plugin';
				default: return true;
			}
		});
	}, [activeFilter, components, installed, search]);

	return (
		<>
			<div className="flex-1 overflow-y-auto bg-background">
				<div className="border-b border-border/50 bg-background/80 backdrop-blur-sm px-8 py-5">
					<div className="mx-auto max-w-6xl flex items-center justify-between gap-4">
						<div className="flex items-center gap-3">
							<div className="flex size-8 items-center justify-center rounded-xl bg-foreground text-background">
								<Sparkles className="size-4" />
							</div>
							<h1 className="text-lg font-medium tracking-tight">Marketplace</h1>
						</div>
						<div className="flex items-center gap-3">
							<div className="relative hidden md:block">
								<Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
								<Input
									value={search}
									onChange={(e) => setSearch(e.target.value)}
									placeholder="Search"
									className="h-9 w-64 rounded-xl border-border/50 bg-muted/50 pl-9"
								/>
							</div>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button variant="outline" className="h-9 rounded-xl border-border/50">
										Add
										<ChevronDown className="size-3 ml-1" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end" className="w-56">
									<DropdownMenuItem className="cursor-pointer">
										<Download className="size-4 mr-2" />
										Install from registry
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					</div>
				</div>

				<div className="mx-auto max-w-6xl px-8 py-8">
					<div className="grid gap-8 lg:grid-cols-[1fr_220px]">
						<div>
							<div className="rounded-2xl border border-border/50 bg-muted/20 p-6">
								<div className="md:hidden mb-4">
									<Input
										value={search}
										onChange={(e) => setSearch(e.target.value)}
										placeholder="Search"
										className="h-9 rounded-xl border-border/50 bg-background"
									/>
								</div>
								<div className="flex flex-wrap gap-2">
									{FILTERS.map((f) => (
										<button
											key={f.key}
											onClick={() => setActiveFilter(f.key)}
											className={cn(
												'rounded-xl border px-3 py-1.5 text-sm font-medium transition-colors',
												activeFilter === f.key
													? 'border-foreground bg-foreground text-background'
													: 'border-border/50 bg-background text-muted-foreground hover:text-foreground',
											)}
										>
											{f.label}
											<span className="ml-1.5 text-xs opacity-60">{counts[f.key]}</span>
										</button>
									))}
								</div>
							</div>

							<div className="mt-6 grid gap-4 sm:grid-cols-2">
								{isLoading ? (
									<div className="sm:col-span-2 flex items-center justify-center py-16 rounded-2xl border border-border/50">
										<Loader2 className="size-5 animate-spin text-muted-foreground" />
									</div>
								) : error ? (
									<div className="sm:col-span-2 py-16 text-center">
										<p className="text-sm text-destructive">Failed to load marketplace</p>
										<p className="text-xs text-muted-foreground mt-1">{error.message}</p>
									</div>
								) : filtered.length === 0 ? (
									<div className="sm:col-span-2 py-16 text-center">
										<p className="text-sm text-muted-foreground">No components found</p>
									</div>
								) : (
									filtered.map((c) => (
										<ComponentCard key={c.name} component={c} onOpen={setSelectedComponent} />
									))
								)}
							</div>
						</div>

						<div className="space-y-4 h-fit lg:sticky lg:top-6">
							<div className="rounded-2xl border border-border/50 bg-card p-5">
								<p className="text-sm font-medium">Overview</p>
								<p className="mt-2 text-xs text-muted-foreground leading-relaxed">
									Browse and install components from the Kortix registry. Open any package to preview its files before installing.
								</p>
								<div className="mt-4 grid gap-3">
									<div className="rounded-xl bg-muted/50 p-3">
										<p className="text-xs uppercase tracking-widest text-muted-foreground">Available</p>
										<p className="mt-1 text-xl font-semibold">{counts.all}</p>
									</div>
									<div className="rounded-xl bg-muted/50 p-3">
										<p className="text-xs uppercase tracking-widest text-muted-foreground">Installed</p>
										<p className="mt-1 text-xl font-semibold">{counts.installed}</p>
									</div>
								</div>
							</div>
						</div>
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
