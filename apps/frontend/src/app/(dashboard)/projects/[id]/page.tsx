'use client';

import { use, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  Clock,
  Copy,
  Folder,
  FolderOpen,
  GitBranch,
  MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useOpenCodeSessions,
  useOpenCodeProjects,
  type Session,
  type Project,
} from '@/hooks/opencode/use-opencode-sessions';
import { useFileList } from '@/features/files/hooks/use-file-list';
import type { FileNode } from '@/features/files/types';
import { getFileIcon } from '@/features/files/components';
import { openTabAndNavigate } from '@/stores/tab-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelative(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

function resolveProjectName(project: Project | null, fallback: string): string {
  if (!project) return fallback;
  const isGlobal = project.id === 'global' || project.worktree === '/' || project.worktree === '/workspace';
  if (isGlobal) return 'Global';
  return project.name || project.worktree?.split('/').pop() || fallback;
}

// ---------------------------------------------------------------------------
// Sidebar card — Manus-style clickable section
// ---------------------------------------------------------------------------

function SidebarCard({
  title,
  description,
  count,
  onClick,
  children,
}: {
  title: string;
  description?: string;
  count?: number;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card/50 overflow-hidden">
      <div
        onClick={onClick}
        className={cn(
          'flex items-center gap-2 px-5 py-4',
          onClick && 'cursor-pointer hover:bg-muted/30 transition-colors',
        )}
      >
        <span className="text-sm font-semibold text-foreground flex-1">{title}</span>
        {count !== undefined && (
          <span className="text-xs tabular-nums text-muted-foreground/50">{count}</span>
        )}
        {onClick && <ChevronRight className="h-4 w-4 text-muted-foreground/30" />}
      </div>
      {(description || children) && (
        <div className="px-5 pb-4 -mt-1">
          {description && <p className="text-xs text-muted-foreground/60 leading-relaxed">{description}</p>}
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// File browser — prop-controlled, no global store
// ---------------------------------------------------------------------------

function ProjectFileBrowser({ rootPath }: { rootPath: string }) {
  const [currentPath, setCurrentPath] = useState(rootPath);
  const { data: files, isLoading } = useFileList(currentPath);

  const sorted = useMemo(() => {
    if (!files) return [];
    return files
      .filter(f => !f.ignored && !f.name.startsWith('.'))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [files]);

  const breadcrumbs = useMemo(() => {
    const rootName = rootPath === '/' ? '/' : rootPath.split('/').pop() || '/';
    if (currentPath === rootPath) return [{ name: rootName, path: rootPath }];
    const relative = currentPath.startsWith(rootPath) ? currentPath.slice(rootPath.length) : currentPath;
    const parts = relative.split('/').filter(Boolean);
    const crumbs = [{ name: rootName, path: rootPath }];
    let acc = rootPath;
    for (const part of parts) {
      acc = acc === '/' ? `/${part}` : `${acc}/${part}`;
      crumbs.push({ name: part, path: acc });
    }
    return crumbs;
  }, [currentPath, rootPath]);

  const handleClick = (node: FileNode) => {
    if (node.type === 'directory') {
      setCurrentPath(node.path);
    } else {
      openTabAndNavigate({ id: `file:${node.path}`, title: node.name, type: 'file', href: `/files/${encodeURIComponent(node.path)}` });
    }
  };

  return (
    <div className="rounded-2xl border border-border/50 bg-card/50 overflow-hidden">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 px-4 py-2.5 border-b border-border/30 text-xs overflow-x-auto">
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.path} className="flex items-center gap-1 shrink-0">
            {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/30" />}
            <button
              onClick={() => setCurrentPath(crumb.path)}
              className={cn(
                'hover:text-foreground transition-colors cursor-pointer px-1 py-0.5 rounded',
                i === breadcrumbs.length - 1 ? 'text-foreground font-medium' : 'text-muted-foreground hover:bg-muted/40',
              )}
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </div>

      {/* File list */}
      {isLoading ? (
        <div className="p-4 space-y-2">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-8" />)}
        </div>
      ) : sorted.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-muted-foreground/50">Empty directory</div>
      ) : (
        <div className="divide-y divide-border/20 max-h-[400px] overflow-y-auto">
          {sorted.map(node => (
            <button
              key={node.path}
              onClick={() => handleClick(node)}
              className="w-full flex items-center gap-3 px-4 py-2 hover:bg-muted/30 transition-colors cursor-pointer text-left"
            >
              {node.type === 'directory'
                ? <Folder className="h-4 w-4 shrink-0 text-primary/60" />
                : getFileIcon(node.name, { className: 'h-4 w-4 shrink-0 text-muted-foreground/50' })
              }
              <span className={cn('text-sm truncate', node.type === 'directory' ? 'text-foreground font-medium' : 'text-foreground/80')}>
                {node.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent session row — compact
// ---------------------------------------------------------------------------

function RecentSessionRow({ session }: { session: Session }) {
  return (
    <button
      onClick={() => openTabAndNavigate({ id: session.id, title: session.title || 'Session', type: 'session', href: `/sessions/${session.id}` })}
      className="w-full flex items-center gap-2.5 py-2 hover:bg-muted/30 -mx-1 px-1 rounded-lg transition-colors cursor-pointer text-left group"
    >
      <MessageSquare className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0 group-hover:text-primary/50 transition-colors" />
      <p className="text-xs text-foreground/80 truncate flex-1">{session.title || 'Untitled'}</p>
      <span className="text-[10px] text-muted-foreground/25 shrink-0 tabular-nums">{formatRelative(session.time.updated)}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Project Detail Page
// ---------------------------------------------------------------------------

export default function ProjectDetailPage({
  params,
}: {
  params?: Promise<{ id: string }>;
}) {
  const resolved = params ? use(params) : { id: '' };
  const projectId = resolved.id ? decodeURIComponent(resolved.id) : '';
  const [copied, setCopied] = useState(false);

  // Data
  const { data: projects, isLoading: projectsLoading } = useOpenCodeProjects();
  const { data: sessions } = useOpenCodeSessions();

  const project = useMemo(() => {
    if (!projects) return null;
    return projects.find((p: Project) => p.id === projectId) ?? null;
  }, [projects, projectId]);

  const projectName = resolveProjectName(project, projectId);

  const projectSessions = useMemo(() => {
    if (!sessions) return [];
    return sessions
      .filter((s: Session) => s.projectID === projectId && !s.parentID)
      .sort((a: Session, b: Session) => b.time.updated - a.time.updated);
  }, [sessions, projectId]);

  const { data: rootFiles } = useFileList(project?.worktree || '/', { enabled: !!project });
  const fileCount = useMemo(() => rootFiles?.filter(f => !f.ignored && !f.name.startsWith('.')).length ?? 0, [rootFiles]);

  // Loading
  if (projectsLoading) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <Skeleton className="h-4 w-16 mb-8" />
          <div className="flex items-center gap-4 mb-3">
            <Skeleton className="w-12 h-12 rounded-2xl" />
            <div className="space-y-2"><Skeleton className="h-7 w-48" /><Skeleton className="h-4 w-72" /></div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8 mt-10">
            <Skeleton className="h-40 rounded-2xl" />
            <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
          </div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <FolderOpen className="h-10 w-10 text-muted-foreground/30 mx-auto" />
          <h2 className="text-base font-semibold">Project not found</h2>
          <code className="text-xs bg-muted px-2 py-1 rounded font-mono text-muted-foreground">{projectId}</code>
          <div>
            <Button variant="outline" size="sm" onClick={() => openTabAndNavigate({ id: 'page:/workspace', title: 'Workspace', type: 'page', href: '/workspace' })}>
              <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />Back to Workspace
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8 sm:py-10">

        {/* Back */}
        <button
          onClick={() => openTabAndNavigate({ id: 'page:/workspace', title: 'Workspace', type: 'page', href: '/workspace' })}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-8 cursor-pointer group"
        >
          <ArrowLeft className="h-3.5 w-3.5 group-hover:-translate-x-0.5 transition-transform" />
          Workspace
        </button>

        {/* ── Header — Manus-style: icon + name + metadata ───── */}
        <div className="flex items-center gap-4 mb-2">
          <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-muted border border-border/50 shrink-0">
            <FolderOpen className="h-5 w-5 text-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-foreground truncate">{projectName}</h1>
            <p className="text-xs text-muted-foreground/50 flex items-center gap-1.5 mt-0.5">
              {project.worktree && project.worktree !== '/' && (
                <span className="font-mono truncate max-w-[250px]">{project.worktree}</span>
              )}
              {project.time?.updated && (
                <>
                  {project.worktree && project.worktree !== '/' && <span className="text-border">·</span>}
                  <span>Updated {formatRelative(project.time.updated)}</span>
                </>
              )}
            </p>
          </div>
        </div>

        {/* ── Two-column layout — main + sidebar ─────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8 mt-10">

          {/* ═ LEFT — Main content area ═══════════════════════ */}
          <div>
            {/* Sessions heading */}
            <h2 className="text-lg font-semibold text-foreground mb-1">Sessions</h2>
            <p className="text-xs text-muted-foreground/50 mb-6">
              {projectSessions.length === 0 ? 'Your sessions stay private unless shared' : `${projectSessions.length} session${projectSessions.length !== 1 ? 's' : ''}`}
            </p>

            {projectSessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-border/40 flex items-center justify-center mb-4">
                  <MessageSquare className="h-6 w-6 text-muted-foreground/20" />
                </div>
                <p className="text-sm text-muted-foreground/40">Create a new session to get started</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-border/50 bg-card/50 overflow-hidden">
                {projectSessions.map((s: Session) => (
                  <button
                    key={s.id}
                    onClick={() => openTabAndNavigate({ id: s.id, title: s.title || 'Session', type: 'session', href: `/sessions/${s.id}` })}
                    className="w-full flex items-center gap-3 px-4 py-3 border-b border-border/30 last:border-b-0 hover:bg-muted/30 transition-colors cursor-pointer text-left group"
                  >
                    <MessageSquare className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0 group-hover:text-primary/50 transition-colors" />
                    <p className="text-sm text-foreground truncate flex-1">{s.title || 'Untitled session'}</p>
                    {s.summary && (s.summary.additions > 0 || s.summary.deletions > 0) && (
                      <div className="hidden sm:flex items-center gap-1 shrink-0">
                        <span className="text-[10px] text-green-500/70 tabular-nums">+{s.summary.additions}</span>
                        <span className="text-[10px] text-red-400/70 tabular-nums">-{s.summary.deletions}</span>
                      </div>
                    )}
                    <span className="text-[10px] text-muted-foreground/25 shrink-0 tabular-nums">{formatRelative(s.time.updated)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ═ RIGHT — Sidebar cards (Manus-style) ════════════ */}
          <div className="space-y-3">

            {/* Files */}
            <SidebarCard
              title="Files"
              description="Browse and edit project files."
              count={fileCount}
              onClick={() => openTabAndNavigate({ id: 'page:/files', title: 'Files', type: 'page', href: '/files' })}
            />

            {/* File preview */}
            <ProjectFileBrowser rootPath={project.worktree || '/'} />

            {/* Project Info */}
            <div className="rounded-2xl border border-border/50 bg-card/50 px-5 py-4 space-y-3">
              <span className="text-sm font-semibold text-foreground">Project Info</span>
              <div className="space-y-2.5">
                {project.vcs && (
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                    <span className="text-xs text-foreground/70">{project.vcs}</span>
                  </div>
                )}
                {project.time?.created && (
                  <div className="flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                    <span className="text-xs text-foreground/70">Created {formatRelative(project.time.created)}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { navigator.clipboard.writeText(project.id); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-foreground transition-colors cursor-pointer"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {copied ? 'Copied!' : 'Copy project ID'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
