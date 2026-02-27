'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  GitBranch,
  FileCode2,
  Files,
  Archive,
  FolderOpen,
  Folder,
  File,
  ChevronRight,
  Check,
  Plus,
  Trash2,
  ChevronDown,
  Loader2,
  Rocket,
  Wand2,
  Pencil,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCreateDeployment, type Deployment, type DeploymentSource, type CreateDeploymentData } from '@/hooks/deployments/use-deployments';
import { useFileList } from '@/features/files/hooks/use-file-list';
import { listFiles, readFile } from '@/features/files/api/opencode-files';
import type { FileNode } from '@/features/files/types';
import { toast } from 'sonner';

function generateSubdomain(): string {
  const adjectives = ['swift', 'bright', 'cool', 'fast', 'neat', 'bold', 'calm', 'keen', 'warm', 'wise'];
  const nouns = ['app', 'site', 'hub', 'lab', 'box', 'dev', 'web', 'api', 'run', 'kit'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const id = Math.random().toString(36).slice(2, 6);
  return `${adj}-${noun}-${id}.style.dev`;
}

// ─── Source type config ─────────────────────────────────────────────────────

type UISourceType = DeploymentSource | 'workspace';

const sourceTypes: Array<{
  value: UISourceType;
  label: string;
  icon: React.ElementType;
  description: string;
}> = [
  { value: 'workspace', label: 'Workspace', icon: FolderOpen, description: 'Deploy from your workspace' },
  { value: 'git', label: 'Git', icon: GitBranch, description: 'Deploy from a Git repository' },
  { value: 'code', label: 'Code', icon: FileCode2, description: 'Deploy inline code' },
  { value: 'files', label: 'Files', icon: Files, description: 'Deploy from file contents' },
  { value: 'tar', label: 'Tar', icon: Archive, description: 'Deploy from a tarball URL' },
];

// ─── Workspace folder picker helpers ────────────────────────────────────────

/** Recursively collect all text files from a directory */
async function collectFilesRecursively(
  dirPath: string,
  basePath: string,
): Promise<Array<{ path: string; content: string; encoding?: string }>> {
  const nodes = await listFiles(dirPath);
  const result: Array<{ path: string; content: string; encoding?: string }> = [];

  for (const node of nodes) {
    // Skip hidden files/dirs and common non-deployable paths
    if (node.name.startsWith('.')) continue;
    if (node.name === 'node_modules' || node.name === '__pycache__' || node.name === '.git') continue;

    if (node.type === 'directory') {
      const children = await collectFilesRecursively(
        node.absolute || node.path,
        basePath,
      );
      result.push(...children);
    } else {
      try {
        const content = await readFile(node.absolute || node.path);
        // Get relative path from the selected folder
        const absolutePath = node.absolute || node.path;
        const relativePath = absolutePath.startsWith(basePath)
          ? absolutePath.slice(basePath.length).replace(/^\//, '')
          : node.name;

        if (content.type === 'binary' && content.encoding === 'base64') {
          result.push({ path: relativePath, content: content.content, encoding: 'base64' });
        } else {
          result.push({ path: relativePath, content: content.content });
        }
      } catch {
        // Skip files that can't be read
      }
    }
  }

  return result;
}

/** Simple folder browser row component */
function FolderBrowserItem({
  node,
  isSelected,
  isExpanded,
  onToggleExpand,
  onSelect,
  depth,
}: {
  node: FileNode;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onSelect: () => void;
  depth: number;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors cursor-pointer',
        isSelected
          ? 'bg-primary/10 text-primary'
          : 'text-foreground hover:bg-muted/50',
      )}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      {node.type === 'directory' && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
          className="p-0.5 rounded hover:bg-muted/50 cursor-pointer shrink-0"
        >
          <ChevronRight
            className={cn(
              'h-3 w-3 transition-transform',
              isExpanded && 'rotate-90',
            )}
          />
        </button>
      )}
      {node.type === 'directory' ? (
        <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
      ) : (
        <File className="h-4 w-4 text-muted-foreground shrink-0 ml-4" />
      )}
      <span className="truncate flex-1">{node.name}</span>
      {isSelected && node.type === 'directory' && (
        <Check className="h-3.5 w-3.5 text-primary shrink-0" />
      )}
    </div>
  );
}

/** Recursive folder browser */
function FolderBrowser({
  dirPath,
  selectedPath,
  onSelectPath,
  depth = 0,
}: {
  dirPath: string;
  selectedPath: string | null;
  onSelectPath: (path: string, name: string) => void;
  depth?: number;
}) {
  const { data: nodes, isLoading } = useFileList(dirPath);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  if (isLoading && depth === 0) {
    return (
      <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading workspace...
      </div>
    );
  }

  const dirs = (nodes ?? []).filter(
    (n) => n.type === 'directory' && !n.name.startsWith('.') && n.name !== 'node_modules' && n.name !== '__pycache__',
  );

  if (dirs.length === 0 && depth === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-sm text-muted-foreground">
        <FolderOpen className="h-6 w-6 mb-2 opacity-40" />
        No folders found in workspace
      </div>
    );
  }

  return (
    <div>
      {dirs.map((node) => {
        const nodePath = node.absolute || node.path;
        const isExpanded = expandedDirs.has(nodePath);
        const isSelected = selectedPath === nodePath;

        return (
          <div key={nodePath}>
            <FolderBrowserItem
              node={node}
              isSelected={isSelected}
              isExpanded={isExpanded}
              onToggleExpand={() => toggleExpand(nodePath)}
              onSelect={() => onSelectPath(nodePath, node.name)}
              depth={depth}
            />
            {isExpanded && (
              <FolderBrowser
                dirPath={nodePath}
                selectedPath={selectedPath}
                onSelectPath={onSelectPath}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

interface CreateDeploymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
  /** Pre-fill the form from an existing deployment for "Edit & Redeploy" */
  prefillFrom?: Deployment | null;
}

export function CreateDeploymentDialog({
  open,
  onOpenChange,
  onCreated,
  prefillFrom,
}: CreateDeploymentDialogProps) {
  const createMutation = useCreateDeployment();

  // Form state
  const defaultDomain = useMemo(() => generateSubdomain(), []);
  const [sourceType, setSourceType] = useState<UISourceType>('code');
  const [domains, setDomains] = useState(defaultDomain);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Git fields
  const [sourceRef, setSourceRef] = useState('');
  const [branch, setBranch] = useState('');
  const [rootPath, setRootPath] = useState('');

  // Code field
  const [code, setCode] = useState('');

  // Files fields
  const [files, setFiles] = useState<Array<{ path: string; content: string }>>([
    { path: '', content: '' },
  ]);

  // Tar field
  const [tarUrl, setTarUrl] = useState('');

  // Workspace fields
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [workspaceFolderName, setWorkspaceFolderName] = useState<string>('');
  const [workspaceFiles, setWorkspaceFiles] = useState<Array<{ path: string; content: string; encoding?: string }>>([]);
  const [isCollectingFiles, setIsCollectingFiles] = useState(false);

  // Advanced config
  const [entrypoint, setEntrypoint] = useState('');
  const [framework, setFramework] = useState('');
  const [buildCommand, setBuildCommand] = useState('');
  const [buildOutDir, setBuildOutDir] = useState('');
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>([]);
  const [staticOnly, setStaticOnly] = useState(false);

  const resetForm = useCallback(() => {
    setSourceType('code');
    setDomains(generateSubdomain());
    setSourceRef('');
    setBranch('');
    setRootPath('');
    setCode('');
    setFiles([{ path: '', content: '' }]);
    setTarUrl('');
    setWorkspacePath(null);
    setWorkspaceFolderName('');
    setWorkspaceFiles([]);
    setIsCollectingFiles(false);
    setEntrypoint('');
    setFramework('');
    setBuildCommand('');
    setBuildOutDir('');
    setEnvVars([]);
    setStaticOnly(false);
    setShowAdvanced(false);
  }, []);

  // When a workspace folder is selected, collect all its files
  const handleSelectWorkspaceFolder = useCallback(async (path: string, name: string) => {
    setWorkspacePath(path);
    setWorkspaceFolderName(name);
    setWorkspaceFiles([]);
    setIsCollectingFiles(true);
    try {
      const collected = await collectFilesRecursively(path, path);
      setWorkspaceFiles(collected);
      if (collected.length === 0) {
        toast.error('No files found in the selected folder');
      }
    } catch (err) {
      toast.error('Failed to read workspace files');
      setWorkspacePath(null);
      setWorkspaceFolderName('');
    } finally {
      setIsCollectingFiles(false);
    }
  }, []);

  // Pre-fill form from an existing deployment (Edit & Redeploy)
  useEffect(() => {
    if (!prefillFrom || !open) return;
    const d = prefillFrom;

    setSourceType(d.sourceType as UISourceType);
    setDomains(d.domains?.join(', ') || generateSubdomain());
    setEntrypoint(d.entrypoint || '');
    setFramework(d.framework || '');

    // Source-specific fields
    if (d.sourceType === 'git') {
      setSourceRef(d.sourceRef || '');
      // Extract branch/rootPath from metadata if available
      const src = (d.metadata as Record<string, unknown>)?.freestyleSource as Record<string, unknown> | undefined;
      setBranch((src?.branch as string) || '');
      setRootPath((src?.dir as string) || '');
    } else if (d.sourceType === 'code') {
      // Extract code from metadata.freestyleSource.files['index.ts'].content
      const src = (d.metadata as Record<string, unknown>)?.freestyleSource as Record<string, unknown> | undefined;
      const filesObj = src?.files as Record<string, { content?: string }> | undefined;
      const codeContent = filesObj?.['index.ts']?.content || '';
      setCode(codeContent);
    } else if (d.sourceType === 'files') {
      const src = (d.metadata as Record<string, unknown>)?.freestyleSource as Record<string, unknown> | undefined;
      const filesObj = src?.files as Record<string, { content?: string }> | undefined;
      if (filesObj) {
        setFiles(Object.entries(filesObj).map(([path, f]) => ({ path, content: f?.content || '' })));
      }
    } else if (d.sourceType === 'tar') {
      const src = (d.metadata as Record<string, unknown>)?.freestyleSource as Record<string, unknown> | undefined;
      setTarUrl((src?.url as string) || d.sourceRef || '');
    }

    // Advanced config
    if (d.envVars && Object.keys(d.envVars).length > 0) {
      setEnvVars(Object.entries(d.envVars).map(([key, value]) => ({ key, value })));
      setShowAdvanced(true);
    }
    if (d.buildConfig) {
      const bc = d.buildConfig as Record<string, unknown>;
      setBuildCommand((bc.command as string) || '');
      setBuildOutDir((bc.outDir as string) || '');
      if (bc.command || bc.outDir) setShowAdvanced(true);
    }
  }, [prefillFrom, open]);

  const handleSubmit = async () => {
    // Validate domains
    const domainList = domains
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);
    if (domainList.length === 0) {
      toast.error('At least one domain is required');
      return;
    }

    // Resolve the actual API source type (workspace maps to 'files')
    const apiSourceType: DeploymentSource = sourceType === 'workspace' ? 'files' : sourceType;

    // Build payload
    const payload: CreateDeploymentData = {
      source_type: apiSourceType,
      domains: domainList,
    };

    // Source-specific fields
    if (sourceType === 'workspace') {
      if (workspaceFiles.length === 0) {
        toast.error('Please select a workspace folder with files');
        return;
      }
      payload.files = workspaceFiles;
    } else if (sourceType === 'git') {
      if (!sourceRef) {
        toast.error('Repository URL is required');
        return;
      }
      payload.source_ref = sourceRef;
      if (branch) payload.branch = branch;
      if (rootPath) payload.root_path = rootPath;
    } else if (sourceType === 'code') {
      if (!code) {
        toast.error('Code is required');
        return;
      }
      payload.code = code;
    } else if (sourceType === 'files') {
      const validFiles = files.filter((f) => f.path && f.content);
      if (validFiles.length === 0) {
        toast.error('At least one file with path and content is required');
        return;
      }
      payload.files = validFiles;
    } else if (sourceType === 'tar') {
      if (!tarUrl) {
        toast.error('Tar URL is required');
        return;
      }
      payload.tar_url = tarUrl;
    }

    // Advanced fields
    if (entrypoint) payload.entrypoint = entrypoint;
    if (framework) payload.framework = framework;
    if (staticOnly) payload.static_only = true;

    if (buildCommand || buildOutDir) {
      payload.build = {
        ...(buildCommand && { command: buildCommand }),
        ...(buildOutDir && { outDir: buildOutDir }),
      };
    }

    const validEnvVars = envVars.filter((e) => e.key);
    if (validEnvVars.length > 0) {
      payload.env_vars = Object.fromEntries(validEnvVars.map((e) => [e.key, e.value]));
    }

    try {
      const result = await createMutation.mutateAsync(payload);
      if (result.status === 'active') {
        toast.success('Deployment is live!', {
          description: result.liveUrl || undefined,
        });
      } else if (result.status === 'failed') {
        toast.error('Deployment failed', {
          description: result.error || 'Unknown error',
        });
      } else {
        toast.success('Deployment created');
      }
      resetForm();
      onOpenChange(false);
      onCreated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create deployment');
    }
  };

  // File list management
  const addFile = () => setFiles((prev) => [...prev, { path: '', content: '' }]);
  const removeFile = (index: number) => setFiles((prev) => prev.filter((_, i) => i !== index));
  const updateFile = (index: number, field: 'path' | 'content', value: string) => {
    setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, [field]: value } : f)));
  };

  // Env var management
  const addEnvVar = () => setEnvVars((prev) => [...prev, { key: '', value: '' }]);
  const removeEnvVar = (index: number) => setEnvVars((prev) => prev.filter((_, i) => i !== index));
  const updateEnvVar = (index: number, field: 'key' | 'value', value: string) => {
    setEnvVars((prev) => prev.map((e, i) => (i === index ? { ...e, [field]: value } : e)));
  };

  const inputClass =
    'h-9 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
  const textareaClass =
    'w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 font-mono min-h-[100px] resize-y';
  const labelClass = 'block text-sm font-medium text-foreground mb-1.5';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" aria-describedby="create-deployment-description">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {prefillFrom ? <Pencil className="h-5 w-5" /> : <Rocket className="h-5 w-5" />}
            {prefillFrom ? 'Edit & Redeploy' : 'New Deployment'}
          </DialogTitle>
          <DialogDescription id="create-deployment-description">
            {prefillFrom
              ? 'Modify the configuration and deploy a new version.'
              : 'Deploy your application to production via Freestyle.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Source Type Selector */}
          <div>
            <label className={labelClass}>Source Type</label>
            <div className="grid grid-cols-5 gap-2">
              {sourceTypes.map((st) => {
                const Icon = st.icon;
                return (
                  <button
                    key={st.value}
                    type="button"
                    onClick={() => setSourceType(st.value)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 p-3 rounded-xl border text-sm transition-colors cursor-pointer',
                      sourceType === st.value
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="font-medium">{st.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Domain */}
          <div>
            <label className={labelClass}>
              Domain <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={domains}
                onChange={(e) => setDomains(e.target.value)}
                placeholder="my-app.style.dev"
                className={cn(inputClass, 'flex-1')}
              />
              <button
                type="button"
                onClick={() => setDomains(generateSubdomain())}
                className="h-9 px-2.5 rounded-xl border border-input bg-background text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer shrink-0"
                title="Generate random subdomain"
              >
                <Wand2 className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Free subdomains available under <span className="font-medium text-foreground/70">*.style.dev</span>. Use your own verified domain for production.
            </p>
          </div>

          {/* Source-specific fields */}
          {sourceType === 'workspace' && (
            <div>
              <label className={labelClass}>
                Select Folder <span className="text-red-500">*</span>
              </label>
              <div className="rounded-xl border overflow-hidden">
                {/* Selected folder indicator */}
                {workspacePath && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b">
                    <FolderOpen className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-sm font-medium text-foreground truncate">
                      {workspaceFolderName}
                    </span>
                    {isCollectingFiles ? (
                      <Badge variant="beta" className="text-xs ml-auto shrink-0">
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        Scanning...
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs ml-auto shrink-0">
                        {workspaceFiles.length} {workspaceFiles.length === 1 ? 'file' : 'files'}
                      </Badge>
                    )}
                  </div>
                )}
                {/* Folder tree browser */}
                <div className="max-h-[240px] overflow-y-auto p-1">
                  <FolderBrowser
                    dirPath="/workspace"
                    selectedPath={workspacePath}
                    onSelectPath={handleSelectWorkspaceFolder}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                Select a project folder from your workspace. All files will be collected for deployment.
              </p>

              {/* File preview (collapsed) */}
              {workspaceFiles.length > 0 && !isCollectingFiles && (
                <details className="mt-3">
                  <summary className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                    Preview files ({workspaceFiles.length})
                  </summary>
                  <div className="mt-2 rounded-lg border bg-muted/20 max-h-[160px] overflow-y-auto">
                    <div className="p-2 space-y-0.5">
                      {workspaceFiles.map((f) => (
                        <div
                          key={f.path}
                          className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground"
                        >
                          <File className="h-3 w-3 shrink-0" />
                          <span className="truncate font-mono">{f.path}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </details>
              )}
            </div>
          )}

          {sourceType === 'git' && (
            <div className="space-y-4">
              <div>
                <label className={labelClass}>
                  Repository URL <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={sourceRef}
                  onChange={(e) => setSourceRef(e.target.value)}
                  placeholder="https://github.com/user/repo.git"
                  className={inputClass}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Branch</label>
                  <input
                    type="text"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="main"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Root Path</label>
                  <input
                    type="text"
                    value={rootPath}
                    onChange={(e) => setRootPath(e.target.value)}
                    placeholder="/"
                    className={inputClass}
                  />
                </div>
              </div>
            </div>
          )}

          {sourceType === 'code' && (
            <div>
              <label className={labelClass}>
                Code <span className="text-red-500">*</span>
              </label>
              <textarea
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={'// Your application code\nconsole.log("Hello, World!");'}
                className={textareaClass}
                rows={8}
              />
            </div>
          )}

          {sourceType === 'files' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className={labelClass}>
                  Files <span className="text-red-500">*</span>
                </label>
                <Button type="button" variant="ghost" size="sm" onClick={addFile}>
                  <Plus className="h-3 w-3 mr-1" />
                  Add File
                </Button>
              </div>
              <div className="space-y-3">
                {files.map((file, i) => (
                  <div key={i} className="rounded-xl border p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={file.path}
                        onChange={(e) => updateFile(i, 'path', e.target.value)}
                        placeholder="index.ts"
                        className={cn(inputClass, 'flex-1')}
                      />
                      {files.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeFile(i)}
                          className="p-2 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <textarea
                      value={file.content}
                      onChange={(e) => updateFile(i, 'content', e.target.value)}
                      placeholder="File content..."
                      className={cn(textareaClass, 'min-h-[60px]')}
                      rows={4}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {sourceType === 'tar' && (
            <div>
              <label className={labelClass}>
                Tarball URL <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={tarUrl}
                onChange={(e) => setTarUrl(e.target.value)}
                placeholder="https://example.com/app.tar.gz"
                className={inputClass}
              />
            </div>
          )}

          {/* Advanced config (collapsible) */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <ChevronDown
                className={cn(
                  'h-4 w-4 transition-transform',
                  showAdvanced && 'rotate-180',
                )}
              />
              Advanced Configuration
              {(entrypoint || framework || buildCommand || envVars.length > 0 || staticOnly) && (
                <Badge variant="secondary" className="text-xs">configured</Badge>
              )}
            </button>

            {showAdvanced && (
              <div className="mt-4 space-y-4 pl-6 border-l-2 border-border/40">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Entrypoint</label>
                    <input
                      type="text"
                      value={entrypoint}
                      onChange={(e) => setEntrypoint(e.target.value)}
                      placeholder="server.js"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Framework</label>
                    <input
                      type="text"
                      value={framework}
                      onChange={(e) => setFramework(e.target.value)}
                      placeholder="nextjs, vite, etc."
                      className={inputClass}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Build Command</label>
                    <input
                      type="text"
                      value={buildCommand}
                      onChange={(e) => setBuildCommand(e.target.value)}
                      placeholder="npm run build"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Build Output Dir</label>
                    <input
                      type="text"
                      value={buildOutDir}
                      onChange={(e) => setBuildOutDir(e.target.value)}
                      placeholder="dist"
                      className={inputClass}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="static-only"
                    type="checkbox"
                    checked={staticOnly}
                    onChange={(e) => setStaticOnly(e.target.checked)}
                    className="rounded border-border"
                  />
                  <label htmlFor="static-only" className="text-sm text-foreground">
                    Static site only (no server)
                  </label>
                </div>

                {/* Environment Variables */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className={labelClass}>Environment Variables</label>
                    <Button type="button" variant="ghost" size="sm" onClick={addEnvVar}>
                      <Plus className="h-3 w-3 mr-1" />
                      Add
                    </Button>
                  </div>
                  {envVars.length > 0 && (
                    <div className="space-y-2">
                      {envVars.map((ev, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={ev.key}
                            onChange={(e) => updateEnvVar(i, 'key', e.target.value)}
                            placeholder="KEY"
                            className={cn(inputClass, 'flex-1')}
                          />
                          <input
                            type="text"
                            value={ev.value}
                            onChange={(e) => updateEnvVar(i, 'value', e.target.value)}
                            placeholder="value"
                            className={cn(inputClass, 'flex-1')}
                          />
                          <button
                            type="button"
                            onClick={() => removeEnvVar(i)}
                            className="p-2 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={createMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending || isCollectingFiles}
          >
            {createMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Deploying...
              </>
            ) : (
              <>
                <Rocket className="h-4 w-4 mr-2" />
                Deploy
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
