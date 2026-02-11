'use client';

import {
  useState,
  useMemo,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
  type ComponentType,
} from 'react';
import { createTwoFilesPatch } from 'diff';
import {
  Terminal,
  FileCode2,
  Search,
  Globe,
  ListTree,
  CheckSquare,
  CircleAlert,
  Loader2,
  Check,
  ChevronDown,
  ChevronRight,
  Cpu,
  MessageCircle,
  Ban,
  ExternalLink,
  Glasses,
  SquareKanban,
  FileText,
  Image as ImageIcon,
  Maximize2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { UnifiedMarkdown } from '@/components/markdown/unified-markdown';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { useRouter } from 'next/navigation';
import { useOpenCodeMessages } from '@/hooks/opencode/use-opencode-sessions';
import { useOpenCodePendingStore } from '@/stores/opencode-pending-store';
import { useOcFileOpen } from '@/components/thread/tool-views/opencode/useOcFileOpen';
import { QuestionPrompt } from '@/components/session/question-prompt';
import {
  type ToolPart,
  type PermissionRequest,
  type QuestionRequest,
  type MessageWithParts,
  type ToolInfo,
  type Diagnostic,
  type ApplyPatchFile,
  type TriggerTitle,
  PERMISSION_LABELS,
  isToolPart,
  getChildSessionId,
  shouldShowToolPart,
  computeStatusFromPart,
  getToolInfo,
  getFilename,
  getDirectory,
  getDiagnostics,
  stripAnsi,
  getChildSessionToolParts,
  getPermissionForTool,
} from '@/ui';

// ============================================================================
// Tool Registry
// ============================================================================

interface ToolProps {
  part: ToolPart;
  sessionId?: string;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  locked?: boolean;
  onPermissionReply?: (requestId: string, reply: 'once' | 'always' | 'reject') => void;
}

type ToolComponent = ComponentType<ToolProps>;

const registry = new Map<string, ToolComponent>();

export const ToolRegistry = {
  register(name: string, component: ToolComponent) {
    registry.set(name, component);
  },
  get(name: string): ToolComponent | undefined {
    return registry.get(name);
  },
};

// ============================================================================
// Helper: extract input/metadata/output/status from part
// ============================================================================

function partInput(part: ToolPart): Record<string, unknown> {
  return part.state.input ?? {};
}

function partMetadata(part: ToolPart): Record<string, unknown> {
  if (part.state.status === 'completed' || part.state.status === 'running' || part.state.status === 'error') {
    return (part.state.metadata as Record<string, unknown>) ?? {};
  }
  return {};
}

function partOutput(part: ToolPart): string {
  if (part.state.status === 'completed') {
    return part.state.output ?? '';
  }
  return '';
}

function partStatus(part: ToolPart): string {
  return part.state.status;
}

// ============================================================================
// StatusIcon
// ============================================================================

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <Check className="size-3 text-emerald-500 flex-shrink-0" />;
    case 'error':
      return <CircleAlert className="size-3 text-muted-foreground flex-shrink-0" />;
    case 'running':
    case 'pending':
      return <Loader2 className="size-3 animate-spin text-muted-foreground flex-shrink-0" />;
    default:
      return null;
  }
}

// ============================================================================
// TriggerTitle type guard
// ============================================================================

function isTriggerTitle(val: unknown): val is TriggerTitle {
  return (
    typeof val === 'object' &&
    val !== null &&
    'title' in val &&
    typeof (val as TriggerTitle).title === 'string'
  );
}

// ============================================================================
// BasicTool — collapsible wrapper
// ============================================================================

interface BasicToolProps {
  icon: ReactNode;
  trigger: TriggerTitle | ReactNode;
  children?: ReactNode;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  locked?: boolean;
  onSubtitleClick?: () => void;
}

export function BasicTool({
  icon,
  trigger,
  children,
  defaultOpen = false,
  forceOpen,
  locked,
  onSubtitleClick,
}: BasicToolProps) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  const handleOpenChange = useCallback(
    (value: boolean) => {
      if (locked && !value) return;
      setOpen(value);
    },
    [locked],
  );

  return (
    <Collapsible open={open} onOpenChange={handleOpenChange}>
      <CollapsibleTrigger asChild>
        <div
          data-component="tool-trigger"
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg',
            'bg-muted/20 hover:bg-muted/40 border border-border/40',
            'text-xs cursor-pointer transition-colors select-none',
            'max-w-full group',
          )}
        >
          {/* Arrow */}
          {children && !locked && (
            <ChevronRight
              className={cn(
                'size-3 transition-transform flex-shrink-0 text-muted-foreground',
                open && 'rotate-90',
              )}
            />
          )}

          {/* Icon */}
          <span className="flex-shrink-0">{icon}</span>

          {/* Trigger content */}
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            {isTriggerTitle(trigger) ? (
              <>
                <span className="font-medium text-xs text-foreground whitespace-nowrap">
                  {trigger.title}
                </span>
                {trigger.subtitle && (
                  <span
                    className={cn(
                      'text-muted-foreground text-xs truncate font-mono',
                      onSubtitleClick && 'cursor-pointer hover:text-foreground underline-offset-2 hover:underline',
                    )}
                    onClick={
                      onSubtitleClick
                        ? (e) => {
                            e.stopPropagation();
                            onSubtitleClick();
                          }
                        : undefined
                    }
                  >
                    {trigger.subtitle}
                  </span>
                )}
                {trigger.args &&
                  trigger.args.length > 0 &&
                  trigger.args.map((arg, i) => (
                    <span
                      key={i}
                      className="text-[10px] px-1 py-0.5 rounded bg-muted/60 text-muted-foreground font-mono whitespace-nowrap"
                    >
                      {arg}
                    </span>
                  ))}
              </>
            ) : (
              trigger
            )}
          </div>
        </div>
      </CollapsibleTrigger>

      {children && (
        <CollapsibleContent>
          <div className="mt-1.5 mb-2 rounded-lg bg-muted/30 border border-border/30 text-xs overflow-hidden">
            {children}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

// ============================================================================
// InlineDiffView
// ============================================================================

function InlineDiffView({
  oldValue,
  newValue,
  filename,
}: {
  oldValue: string;
  newValue: string;
  filename: string;
}) {
  const patch = useMemo(() => {
    if (!oldValue && !newValue) return '';
    return createTwoFilesPatch(filename, filename, oldValue || '', newValue || '', '', '');
  }, [oldValue, newValue, filename]);

  if (!patch) return null;

  const lines = patch.split('\n');
  const diffLines = lines.slice(4);

  return (
    <pre className="p-2 font-mono text-[11px] leading-relaxed overflow-x-auto">
      {diffLines.map((line, i) => {
        let cls = 'text-muted-foreground/80';
        if (line.startsWith('+')) cls = 'text-emerald-500 bg-emerald-500/5';
        else if (line.startsWith('-')) cls = 'text-red-500 bg-red-500/5';
        else if (line.startsWith('@@')) cls = 'text-blue-500/70';
        return (
          <div key={i} className={cls}>
            {line}
          </div>
        );
      })}
    </pre>
  );
}

// ============================================================================
// DiagnosticsDisplay
// ============================================================================

function DiagnosticsDisplay({ diagnostics }: { diagnostics: Diagnostic[] }) {
  if (diagnostics.length === 0) return null;

  return (
    <div className="space-y-1 px-2 pb-2">
      {diagnostics.map((d, i) => (
        <div key={i} className="flex items-start gap-1.5 text-[10px] text-red-500">
          <CircleAlert className="size-3 flex-shrink-0 mt-0.5" />
          <span>
            [{d.range.start.line + 1}:{d.range.start.character + 1}] {d.message}
          </span>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// DiffChanges
// ============================================================================

function DiffChanges({ additions, deletions }: { additions: number; deletions: number }) {
  if (additions === 0 && deletions === 0) return null;

  return (
    <span className="flex items-center gap-1.5 text-[10px] ml-auto whitespace-nowrap">
      {additions > 0 && <span className="text-emerald-500">+{additions}</span>}
      {deletions > 0 && <span className="text-red-500">-{deletions}</span>}
    </span>
  );
}

// ============================================================================
// Tool Renderers — self-registering
// ============================================================================

// --- Bash ---
function BashTool({ part, defaultOpen, forceOpen, locked }: ToolProps) {
  const input = partInput(part);
  const metadata = partMetadata(part);
  const output = partOutput(part);
  const status = partStatus(part);
  const command = (input.command as string) || (metadata.command as string) || '';
  const description = (input.description as string) || '';
  const strippedOutput = output ? stripAnsi(output) : '';

  const codeBlock = `\`\`\`bash\n$ ${command}${strippedOutput ? '\n\n' + strippedOutput : ''}\n\`\`\``;

  return (
    <BasicTool
      icon={<Terminal className="size-3.5 flex-shrink-0" />}
      trigger={{ title: 'Shell', subtitle: description }}
      defaultOpen={defaultOpen}
      forceOpen={forceOpen}
      locked={locked}
    >
      <div data-scrollable className="p-2 max-h-96 overflow-auto">
        <UnifiedMarkdown content={codeBlock} isStreaming={status === 'running'} />
      </div>
    </BasicTool>
  );
}
ToolRegistry.register('bash', BashTool);

// --- Pty Spawn ---
function PtySpawnTool({ part, defaultOpen, forceOpen, locked }: ToolProps) {
  const input = partInput(part);
  const output = partOutput(part);
  const status = partStatus(part);

  const parsed = useMemo(() => {
    const match = output.match(/<pty_spawned>([\s\S]*?)<\/pty_spawned>/);
    if (!match) return null;
    const fields: Record<string, string> = {};
    for (const line of match[1].trim().split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        fields[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim();
      }
    }
    return fields;
  }, [output]);

  const title = parsed?.Title || (input.title as string) || '';
  const command = parsed?.Command || (input.command as string) || '';
  const processStatus = parsed?.Status || '';
  const pid = parsed?.PID || '';
  const ptyId = parsed?.ID || '';
  const workdir = parsed?.Workdir || '';

  return (
    <BasicTool
      icon={<Terminal className="size-3.5 flex-shrink-0" />}
      trigger={{ title: 'Spawn', subtitle: title || command }}
      defaultOpen={defaultOpen}
      forceOpen={forceOpen}
      locked={locked}
    >
      <div className="p-2.5 space-y-2">
        {command && (
          <div className="font-mono text-[11px] text-foreground/80 bg-muted/40 rounded px-2 py-1.5 break-all">
            <span className="text-muted-foreground/60">$ </span>{command}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {processStatus && (
            <span className={cn(
              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium',
              processStatus === 'running'
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : processStatus === 'exited' || processStatus === 'stopped'
                  ? 'bg-muted/60 text-muted-foreground'
                  : 'bg-muted/60 text-muted-foreground',
            )}>
              {processStatus === 'running' && (
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              )}
              {processStatus}
            </span>
          )}
          {ptyId && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground font-mono">
              {ptyId}
            </span>
          )}
          {pid && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground font-mono">
              PID {pid}
            </span>
          )}
          {workdir && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground font-mono truncate max-w-[200px]" title={workdir}>
              {workdir}
            </span>
          )}
        </div>
      </div>
    </BasicTool>
  );
}
ToolRegistry.register('pty_spawn', PtySpawnTool);

// --- Pty Read ---
function PtyReadTool({ part, defaultOpen, forceOpen, locked }: ToolProps) {
  const input = partInput(part);
  const output = partOutput(part);

  const parsed = useMemo(() => {
    const match = output.match(/<pty_output\s+([^>]*)>([\s\S]*?)<\/pty_output>/);
    if (!match) return { id: '', ptyStatus: '', content: stripAnsi(output), bufferInfo: '' };

    const attrs = match[1];
    const rawContent = match[2];

    const idMatch = attrs.match(/id="([^"]+)"/);
    const statusMatch = attrs.match(/status="([^"]+)"/);

    const lines = rawContent.trim().split('\n');
    const contentLines: string[] = [];
    let bufferInfo = '';

    for (const line of lines) {
      if (/^\(End of buffer/.test(line.trim())) {
        bufferInfo = line.trim();
        continue;
      }
      contentLines.push(line.replace(/^\d{5}\|\s?/, ''));
    }

    return {
      id: idMatch?.[1] || '',
      ptyStatus: statusMatch?.[1] || '',
      content: stripAnsi(contentLines.join('\n').trim()),
      bufferInfo,
    };
  }, [output]);

  const ptyId = parsed.id || (input.id as string) || '';

  return (
    <BasicTool
      icon={<Terminal className="size-3.5 flex-shrink-0" />}
      trigger={
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="font-medium text-xs text-foreground whitespace-nowrap">Terminal Output</span>
          {ptyId && (
            <span className="text-muted-foreground text-[10px] truncate font-mono">{ptyId}</span>
          )}
          {parsed.ptyStatus && (
            <span className={cn(
              'inline-flex items-center gap-1 ml-auto text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0',
              parsed.ptyStatus === 'running'
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-muted/60 text-muted-foreground',
            )}>
              {parsed.ptyStatus === 'running' && (
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              )}
              {parsed.ptyStatus}
            </span>
          )}
        </div>
      }
      defaultOpen={defaultOpen}
      forceOpen={forceOpen}
      locked={locked}
    >
      {parsed.content && (
        <div data-scrollable className="max-h-96 overflow-auto">
          <pre className="p-2.5 font-mono text-[11px] leading-relaxed text-foreground/80 whitespace-pre-wrap">
            {parsed.content}
          </pre>
          {parsed.bufferInfo && (
            <div className="px-2.5 pb-2 text-[10px] text-muted-foreground/50 italic">
              {parsed.bufferInfo}
            </div>
          )}
        </div>
      )}
    </BasicTool>
  );
}
ToolRegistry.register('pty_read', PtyReadTool);

// --- Pty Write ---
function PtyWriteTool({ part, defaultOpen, forceOpen, locked }: ToolProps) {
  const input = partInput(part);
  const output = partOutput(part);
  const ptyInput = (input.input as string) || (input.text as string) || '';
  const ptyId = (input.id as string) || (input.pty_id as string) || '';

  return (
    <BasicTool
      icon={<Terminal className="size-3.5 flex-shrink-0" />}
      trigger={{ title: 'Terminal Input', subtitle: ptyId }}
      defaultOpen={defaultOpen}
      forceOpen={forceOpen}
      locked={locked}
    >
      {ptyInput && (
        <div className="p-2.5">
          <div className="font-mono text-[11px] text-foreground/80 bg-muted/40 rounded px-2 py-1.5 break-all">
            <span className="text-muted-foreground/60">&gt; </span>{ptyInput}
          </div>
        </div>
      )}
    </BasicTool>
  );
}
ToolRegistry.register('pty_write', PtyWriteTool);
ToolRegistry.register('pty_input', PtyWriteTool);

// --- Pty Kill ---
function PtyKillTool({ part, defaultOpen, forceOpen, locked }: ToolProps) {
  const input = partInput(part);
  const output = partOutput(part);
  const status = partStatus(part);
  const ptyId = (input.id as string) || (input.pty_id as string) || '';

  const cleanOutput = useMemo(() => {
    if (!output) return '';
    return output
      .replace(/<\/?[\w_]+(?:\s[^>]*)?>[\s\S]*?(?:<\/[\w_]+>)?/g, '')
      .trim() || output.replace(/<\/?[\w_]+[^>]*>/g, '').trim();
  }, [output]);

  return (
    <BasicTool
      icon={<Terminal className="size-3.5 flex-shrink-0" />}
      trigger={{
        title: 'Kill Process',
        subtitle: ptyId,
      }}
      defaultOpen={defaultOpen}
      forceOpen={forceOpen}
      locked={locked}
    >
      {cleanOutput && (
        <div className="p-2.5 text-[11px] text-muted-foreground">
          {cleanOutput}
        </div>
      )}
    </BasicTool>
  );
}
ToolRegistry.register('pty_kill', PtyKillTool);

// --- Edit ---
function EditTool({ part, defaultOpen, forceOpen, locked }: ToolProps) {
  const input = partInput(part);
  const metadata = partMetadata(part);
  const filediff = metadata.filediff as Record<string, unknown> | undefined;
  const filePath = input.filePath as string | undefined;
  const filename = getFilename(filePath) || '';
  const directory = filePath ? getDirectory(filePath) : undefined;
  const diagnostics = getDiagnostics(
    metadata.diagnostics as Record<string, Diagnostic[]> | undefined,
    filePath,
  );

  const additions = (filediff?.additions as number) ?? 0;
  const deletions = (filediff?.deletions as number) ?? 0;
  const before = (filediff?.before as string) ?? (input.oldString as string) ?? '';
  const after = (filediff?.after as string) ?? (input.newString as string) ?? '';
  const hasDiff = before !== '' || after !== '';

  return (
    <BasicTool
      icon={<FileCode2 className="size-3.5 flex-shrink-0" />}
      trigger={
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="font-medium text-xs text-foreground whitespace-nowrap">Edit</span>
          <span className="text-xs text-foreground font-mono truncate">{filename}</span>
          {directory && (
            <span className="text-muted-foreground text-[10px] font-mono truncate hidden sm:inline">
              {directory}
            </span>
          )}
          {filediff && <DiffChanges additions={additions} deletions={deletions} />}
        </div>
      }
      defaultOpen={defaultOpen}
      forceOpen={forceOpen}
      locked={locked}
    >
      {hasDiff && (
        <div className="max-h-96 overflow-auto rounded border border-border/30">
          <InlineDiffView oldValue={before} newValue={after} filename={filename} />
        </div>
      )}
      <DiagnosticsDisplay diagnostics={diagnostics} />
    </BasicTool>
  );
}
ToolRegistry.register('edit', EditTool);
ToolRegistry.register('morph_edit', EditTool);

// --- Write ---
function WriteTool({ part, defaultOpen, forceOpen, locked }: ToolProps) {
  const input = partInput(part);
  const metadata = partMetadata(part);
  const filePath = input.filePath as string | undefined;
  const filename = getFilename(filePath) || '';
  const directory = filePath ? getDirectory(filePath) : undefined;
  const content = (input.content as string) || '';
  const ext = filename.split('.').pop() || '';
  const diagnostics = getDiagnostics(
    metadata.diagnostics as Record<string, Diagnostic[]> | undefined,
    filePath,
  );

  return (
    <BasicTool
      icon={<FileCode2 className="size-3.5 flex-shrink-0" />}
      trigger={
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="font-medium text-xs text-foreground whitespace-nowrap">Write</span>
          <span className="text-xs text-foreground font-mono truncate">{filename}</span>
          {directory && (
            <span className="text-muted-foreground text-[10px] font-mono truncate hidden sm:inline">
              {directory}
            </span>
          )}
        </div>
      }
      defaultOpen={defaultOpen}
      forceOpen={forceOpen}
      locked={locked}
    >
      {content && (
        <div className="max-h-96 overflow-auto">
          <UnifiedMarkdown content={`\`\`\`${ext}\n${content}\n\`\`\``} isStreaming={false} />
        </div>
      )}
      <DiagnosticsDisplay diagnostics={diagnostics} />
    </BasicTool>
  );
}
ToolRegistry.register('write', WriteTool);

// --- Read ---
function ReadTool({ part, defaultOpen, forceOpen, locked }: ToolProps) {
  const input = partInput(part);
  const metadata = partMetadata(part);
  const status = partStatus(part);
  const filePath = input.filePath as string | undefined;
  const filename = getFilename(filePath) || '';

  const args: string[] = [];
  if (input.offset) args.push('offset=' + String(input.offset));
  if (input.limit) args.push('limit=' + String(input.limit));

  const loaded = useMemo(() => {
    if (status !== 'completed') return [];
    const val = metadata.loaded;
    if (!val || !Array.isArray(val)) return [];
    return val.filter((p): p is string => typeof p === 'string');
  }, [status, metadata.loaded]);

  return (
    <>
      <BasicTool
        icon={<Glasses className="size-3.5 flex-shrink-0" />}
        trigger={{ title: 'Read', subtitle: filename, args }}
        defaultOpen={defaultOpen}
        forceOpen={forceOpen}
        locked={locked}
      />
      {loaded.length > 0 && (
        <div className="mt-1 space-y-0.5 pl-2">
          {loaded.map((filepath, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="text-emerald-500">+</span>
              <span className="truncate font-mono text-[10px]">{filepath}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
ToolRegistry.register('read', ReadTool);

// ============================================================================
// Parsing helpers for Glob/Grep/List output
// ============================================================================

/** Try to parse output into a list of file paths (one per line) */
function parseFilePaths(output: string): string[] | null {
  if (!output) return null;
  const lines = output.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const pathLike = lines.filter((l) => l.startsWith('/') || l.startsWith('./') || l.startsWith('~'));
  if (pathLike.length >= lines.length * 0.7) return pathLike;
  return null;
}

interface GrepMatch { line: number; content: string; }
interface GrepFileGroup { filePath: string; matches: GrepMatch[]; }

/** Parse grep output into structured file groups */
function parseGrepOutput(output: string): { matchCount: number; groups: GrepFileGroup[] } | null {
  if (!output) return null;
  const text = String(output).trim();
  const headerMatch = text.match(/^Found\s+(\d+)\s+match/i);
  const matchCount = headerMatch ? parseInt(headerMatch[1], 10) : 0;
  const body = headerMatch ? text.slice(headerMatch[0].length).trim() : text;
  if (!body) return null;

  const groups: GrepFileGroup[] = [];
  const blocks = body.split(/\n\n+/);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const fileMatch = trimmed.match(/^(\/[^:]+?):\s*/);
    if (!fileMatch) continue;
    const filePath = fileMatch[1];
    const rest = trimmed.slice(fileMatch[0].length);
    const matches: GrepMatch[] = [];
    const lineRegex = /Line\s+(\d+):\s*([\s\S]*?)(?=\s*(?:Line\s+\d+:|$))/g;
    let m: RegExpExecArray | null;
    while ((m = lineRegex.exec(rest)) !== null) {
      matches.push({ line: parseInt(m[1], 10), content: m[2].trim().replace(/;$/, '') });
    }
    if (matches.length > 0) groups.push({ filePath, matches });
  }

  if (groups.length === 0) return null;
  return { matchCount: matchCount || groups.reduce((sum, g) => sum + g.matches.length, 0), groups };
}

// ============================================================================
// InlineFileList — styled file path list for Glob/List
// ============================================================================

function InlineFileList({ paths, onFileClick, toDisplayPath }: { paths: string[]; onFileClick: (path: string) => void; toDisplayPath: (p: string) => string }) {
  return (
    <div className="py-0.5">
      {paths.map((fp, i) => {
        const dp = toDisplayPath(fp);
        const name = getFilename(dp);
        const dir = getDirectory(dp);
        return (
          <div
            key={i}
            className="flex items-center gap-2 px-3 py-1 cursor-pointer hover:bg-muted/50 transition-colors group"
            onClick={() => onFileClick(fp)}
            title={dp}
          >
            <FileText className="size-3 text-muted-foreground/50 flex-shrink-0 group-hover:text-foreground/60 transition-colors" />
            <span className="text-[11px] min-w-0 flex items-baseline gap-1.5 overflow-hidden">
              <span className="text-foreground font-medium font-mono whitespace-nowrap flex-shrink-0">{name}</span>
              {dir && <span className="text-muted-foreground/40 truncate text-[10px]">{dir}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// InlineGrepResults — styled grep result groups
// ============================================================================

function InlineGrepResults({ groups, onFileClick, toDisplayPath }: { groups: GrepFileGroup[]; onFileClick: (path: string) => void; toDisplayPath: (p: string) => string }) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(groups.length === 1 ? 0 : null);

  return (
    <div className="py-1 px-2 space-y-1">
      {groups.map((group, i) => {
        const dp = toDisplayPath(group.filePath);
        const name = getFilename(dp);
        const dir = getDirectory(dp);
        const isExpanded = expandedIndex === i;

        return (
          <div key={i} className="rounded-md border border-border/30 overflow-hidden">
            <div
              className="flex items-center gap-1.5 px-2.5 py-1.5 cursor-pointer hover:bg-muted/50 transition-colors group"
              onClick={() => setExpandedIndex(isExpanded ? null : i)}
            >
              {isExpanded ? (
                <ChevronDown className="size-3 text-muted-foreground flex-shrink-0" />
              ) : (
                <ChevronRight className="size-3 text-muted-foreground flex-shrink-0" />
              )}
              <FileText className="size-3 text-muted-foreground/50 flex-shrink-0" />
              <span className="text-[11px] min-w-0 flex items-baseline gap-1.5 overflow-hidden flex-1">
                <span
                  className="text-foreground font-medium font-mono whitespace-nowrap flex-shrink-0 cursor-pointer hover:text-blue-500 transition-colors"
                  onClick={(e) => { e.stopPropagation(); onFileClick(group.filePath); }}
                  title={group.filePath}
                >
                  {name}
                </span>
                {dir && <span className="text-muted-foreground/40 truncate text-[10px]">{dir}</span>}
              </span>
              <span className="text-[10px] text-muted-foreground flex-shrink-0">{group.matches.length}</span>
            </div>
            {isExpanded && (
              <div className="border-t border-border/20">
                {group.matches.map((match, j) => (
                  <div
                    key={j}
                    className="flex items-start gap-0 border-b last:border-b-0 border-border/10"
                  >
                    <span className="text-[10px] font-mono text-muted-foreground/50 w-10 text-right pr-2 py-1 flex-shrink-0 select-none">
                      {match.line}
                    </span>
                    <span className="text-[10px] font-mono text-foreground/70 py-1 pr-2 break-all leading-relaxed">
                      {match.content}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Glob ---
function GlobTool({ part, defaultOpen, forceOpen, locked }: ToolProps) {
  const input = partInput(part);
  const output = partOutput(part);
  const { openFile, openFileWithList, toDisplayPath } = useOcFileOpen();
  const directory = getDirectory(input.path as string) || undefined;
  const args: string[] = [];
  if (input.pattern) args.push('pattern=' + String(input.pattern));

  const filePaths = useMemo(() => parseFilePaths(output), [output]);

  return (
    <BasicTool
      icon={<Search className="size-3.5 flex-shrink-0" />}
      trigger={{ title: 'Glob', subtitle: directory, args }}
      defaultOpen={defaultOpen}
      forceOpen={forceOpen}
      locked={locked}
    >
      {filePaths && filePaths.length > 0 ? (
        <div data-scrollable className="max-h-72 overflow-auto">
          <InlineFileList paths={filePaths} onFileClick={(fp) => openFileWithList(fp, filePaths)} toDisplayPath={toDisplayPath} />
        </div>
      ) : output ? (
        <div data-scrollable className="p-2 max-h-72 overflow-auto">
          <UnifiedMarkdown content={output} isStreaming={false} />
        </div>
      ) : null}
    </BasicTool>
  );
}
ToolRegistry.register('glob', GlobTool);

// --- Grep ---
function GrepTool({ part, defaultOpen, forceOpen, locked }: ToolProps) {
  const input = partInput(part);
  const output = partOutput(part);
  const { openFile, toDisplayPath } = useOcFileOpen();
  const directory = getDirectory(input.path as string) || undefined;
  const args: string[] = [];
  if (input.pattern) args.push('pattern=' + String(input.pattern));
  if (input.include) args.push('include=' + String(input.include));

  const grepResult = useMemo(() => parseGrepOutput(output), [output]);

  return (
    <BasicTool
      icon={<Search className="size-3.5 flex-shrink-0" />}
      trigger={{ title: 'Grep', subtitle: directory, args }}
      defaultOpen={defaultOpen}
      forceOpen={forceOpen}
      locked={locked}
    >
      {grepResult ? (
        <div data-scrollable className="max-h-72 overflow-auto">
          <InlineGrepResults groups={grepResult.groups} onFileClick={(fp) => openFile(fp)} toDisplayPath={toDisplayPath} />
        </div>
      ) : output ? (
        <div data-scrollable className="p-2 max-h-72 overflow-auto">
          <UnifiedMarkdown content={output} isStreaming={false} />
        </div>
      ) : null}
    </BasicTool>
  );
}
ToolRegistry.register('grep', GrepTool);

// --- List ---
function ListTool({ part, defaultOpen, forceOpen, locked }: ToolProps) {
  const input = partInput(part);
  const output = partOutput(part);
  const { openFile, openFileWithList, toDisplayPath } = useOcFileOpen();
  const directory = getDirectory(input.path as string) || (input.path as string) || undefined;

  const filePaths = useMemo(() => parseFilePaths(output), [output]);

  return (
    <BasicTool
      icon={<ListTree className="size-3.5 flex-shrink-0" />}
      trigger={{ title: 'List', subtitle: directory }}
      defaultOpen={defaultOpen}
      forceOpen={forceOpen}
      locked={locked}
    >
      {filePaths && filePaths.length > 0 ? (
        <div data-scrollable className="max-h-72 overflow-auto">
          <InlineFileList paths={filePaths} onFileClick={(fp) => openFileWithList(fp, filePaths)} toDisplayPath={toDisplayPath} />
        </div>
      ) : output ? (
        <div data-scrollable className="p-2 max-h-72 overflow-auto">
          <UnifiedMarkdown content={output} isStreaming={false} />
        </div>
      ) : null}
    </BasicTool>
  );
}
ToolRegistry.register('list', ListTool);

// --- WebFetch ---
function WebFetchTool({ part, defaultOpen, forceOpen, locked }: ToolProps) {
  const input = partInput(part);
  const output = partOutput(part);
  const url = (input.url as string) || '';
  const args: string[] = [];
  if (input.format) args.push('format=' + String(input.format));

  return (
    <BasicTool
      icon={<Globe className="size-3.5 flex-shrink-0" />}
      trigger={
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="font-medium text-xs text-foreground whitespace-nowrap">Web Fetch</span>
          <span className="text-muted-foreground text-xs truncate font-mono">{url}</span>
          {args.map((arg, i) => (
            <span
              key={i}
              className="text-[10px] px-1 py-0.5 rounded bg-muted/60 text-muted-foreground font-mono whitespace-nowrap"
            >
              {arg}
            </span>
          ))}
          <ExternalLink className="size-3 text-muted-foreground/60 flex-shrink-0 ml-auto" />
        </div>
      }
      defaultOpen={defaultOpen}
      forceOpen={forceOpen}
      locked={locked}
    >
      {output && (
        <div data-scrollable className="p-2 max-h-72 overflow-auto">
          <UnifiedMarkdown content={output} isStreaming={false} />
        </div>
      )}
    </BasicTool>
  );
}
ToolRegistry.register('webfetch', WebFetchTool);

// --- Image Search — visual grid preview ---
interface ImageResult {
  url: string;
  imageUrl?: string;
  title?: string;
  width?: number;
  height?: number;
  description?: string;
  source?: string;
}

const IMAGE_FALLBACK_SVG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='3' width='18' height='18' rx='2' ry='2'%3E%3C/rect%3E%3Ccircle cx='8.5' cy='8.5' r='1.5'%3E%3C/circle%3E%3Cpolyline points='21 15 16 10 5 21'%3E%3C/polyline%3E%3C/svg%3E";

function parseImageSearchOutput(output: string): ImageResult[] {
  if (!output) return [];
  try {
    const parsed = JSON.parse(output);
    if (parsed?.images && Array.isArray(parsed.images)) return parsed.images;
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // try to extract JSON from mixed text
    const match = output.match(/\{[\s\S]*"images"\s*:\s*\[[\s\S]*\]/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed?.images) return parsed.images;
      } catch { /* ignore */ }
    }
  }
  return [];
}

function ImageSearchTool({ part, defaultOpen, forceOpen, locked }: ToolProps) {
  const input = partInput(part);
  const output = partOutput(part);
  const query = (input.query as string) || '';
  const numResults = input.num_results as number | undefined;
  const status = partStatus(part);
  const images = useMemo(() => parseImageSearchOutput(output), [output]);

  return (
    <BasicTool
      icon={<ImageIcon className="size-3.5 flex-shrink-0" />}
      trigger={{
        title: 'image-search',
        subtitle: query + (numResults ? ` (${numResults})` : ''),
      }}
      defaultOpen={defaultOpen || images.length > 0}
      forceOpen={forceOpen}
      locked={locked}
    >
      <div className="p-2">
        {status === 'running' && images.length === 0 && (
          <div className="flex items-center gap-2 py-4 justify-center text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Searching images...
          </div>
        )}

        {status === 'completed' && images.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 py-4 text-muted-foreground">
            <ImageIcon className="size-5" />
            <span className="text-xs">No images found</span>
          </div>
        )}

        {images.length > 0 && (
          <>
            <div className="text-[10px] text-muted-foreground mb-2">
              {images.length} image{images.length !== 1 ? 's' : ''}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {images.map((img, idx) => {
                const imageUrl = img.url || img.imageUrl || '';
                const hasDimensions = img.width && img.height && img.width > 0 && img.height > 0;

                return (
                  <TooltipProvider key={idx}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <a
                          href={imageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group relative overflow-hidden rounded-md border border-border/40 bg-muted/30 hover:border-primary/40 transition-colors"
                        >
                          <img
                            src={imageUrl}
                            alt={img.title || `Image ${idx + 1}`}
                            className="object-cover w-full h-28 group-hover:opacity-90 transition-opacity"
                            loading="lazy"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.src = IMAGE_FALLBACK_SVG;
                              target.classList.add('p-4');
                            }}
                          />
                          {/* Metadata overlay */}
                          <div className="absolute top-0 left-0 right-0 p-1 flex justify-between items-start">
                            <div className="flex gap-0.5">
                              {hasDimensions && (
                                <span className="inline-flex items-center gap-0.5 bg-black/60 text-white text-[9px] px-1 py-0 rounded">
                                  <Maximize2 className="size-2" />
                                  {img.width}&times;{img.height}
                                </span>
                              )}
                            </div>
                            <span className="bg-black/60 text-white p-0.5 rounded">
                              <ExternalLink className="size-2.5" />
                            </span>
                          </div>
                          {/* Title at bottom */}
                          {(img.title || img.source) && (
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-1.5 pt-3">
                              <p className="text-[9px] text-white/90 truncate leading-tight">
                                {img.title || img.source}
                              </p>
                            </div>
                          )}
                        </a>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-xs">
                        <div className="space-y-1">
                          {img.title && (
                            <p className="font-medium text-xs">{img.title.length > 80 ? img.title.slice(0, 80) + '...' : img.title}</p>
                          )}
                          {hasDimensions && (
                            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <Maximize2 className="size-2.5" />
                              {img.width} &times; {img.height}px
                            </p>
                          )}
                          {img.description && (
                            <p className="text-[10px] text-muted-foreground">{img.description.length > 120 ? img.description.slice(0, 120) + '...' : img.description}</p>
                          )}
                          {img.source && (
                            <p className="text-[10px] text-muted-foreground truncate">Source: {img.source}</p>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                );
              })}
            </div>
          </>
        )}
      </div>
    </BasicTool>
  );
}
ToolRegistry.register('image-search', ImageSearchTool);

// --- Task (sub-agent) — Slack-thread-style inline card ---
function TaskTool({ part, sessionId, defaultOpen, forceOpen, locked, onPermissionReply }: ToolProps) {
  const router = useRouter();
  const input = partInput(part);
  const status = partStatus(part);
  const childSessionId = getChildSessionId(part);
  const isRunning = status === 'running' || status === 'pending';
  const isDone = status === 'completed';
  const isError = status === 'error';
  const subagentType = (input.subagent_type as string) || 'task';
  const description = (input.description as string) || '';

  // Fetch child session messages
  const { data: childMessages } = useOpenCodeMessages(childSessionId || '');

  // Get child session permissions from pending store
  const allPermissions = useOpenCodePendingStore((s) => s.permissions);
  const childPermission = useMemo(() => {
    if (!childSessionId) return undefined;
    return Object.values(allPermissions).find((p) => p.sessionID === childSessionId);
  }, [allPermissions, childSessionId]);

  // Extract child tool parts
  const childToolParts = useMemo(() => {
    if (!childMessages) return [];
    return getChildSessionToolParts(childMessages);
  }, [childMessages]);

  // Find the child tool part matching the permission
  const childPermissionToolPart = useMemo(() => {
    if (!childPermission?.tool || !childMessages) return undefined;
    for (const msg of childMessages) {
      if (msg.info.role !== 'assistant') continue;
      for (const p of msg.parts) {
        if (isToolPart(p) && p.callID === childPermission.tool.callID) {
          return p;
        }
      }
    }
    return undefined;
  }, [childPermission, childMessages]);

  const hasChildPermission = !!childPermission;

  const handleOpenThread = useCallback(() => {
    if (childSessionId) {
      router.push(`/sessions/${childSessionId}`);
    }
  }, [childSessionId, router]);

  // Permission mode — render the child tool that needs attention inline
  if (hasChildPermission) {
    return (
      <div className="space-y-1.5">
        {childPermissionToolPart ? (
          (() => {
            const Comp = ToolRegistry.get(childPermissionToolPart.tool);
            return Comp ? (
              <Comp part={childPermissionToolPart} sessionId={childSessionId} defaultOpen forceOpen locked />
            ) : (
              <GenericTool part={childPermissionToolPart} />
            );
          })()
        ) : (
          <TaskThreadCard
            subagentType={subagentType}
            description={description}
            isRunning={true}
            isDone={false}
            isError={false}
            childToolParts={childToolParts}
            onOpen={handleOpenThread}
            hasChild={!!childSessionId}
          />
        )}
        {childPermission && (
          <PermissionPromptInline permission={childPermission} onReply={onPermissionReply} />
        )}
      </div>
    );
  }

  // Normal mode — thread card
  return (
    <TaskThreadCard
      subagentType={subagentType}
      description={description}
      isRunning={isRunning}
      isDone={isDone}
      isError={isError}
      childToolParts={childToolParts}
      onOpen={handleOpenThread}
      hasChild={!!childSessionId}
    />
  );
}
ToolRegistry.register('task', TaskTool);

// --- TaskThreadCard — clean inline sub-agent card ---
function TaskThreadCard({
  subagentType,
  description,
  isRunning,
  isDone,
  isError,
  childToolParts,
  onOpen,
  hasChild,
}: {
  subagentType: string;
  description: string;
  isRunning: boolean;
  isDone: boolean;
  isError: boolean;
  childToolParts: ToolPart[];
  onOpen: () => void;
  hasChild: boolean;
}) {
  const stepCount = childToolParts.length;
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll tool list when new items are added
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [stepCount]);

  return (
    <div
      className={cn(
        'rounded-lg border overflow-hidden',
        isError
          ? 'border-destructive/25'
          : 'border-border/50',
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/20">
        {/* Status */}
        {isRunning ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground flex-shrink-0" />
        ) : isError ? (
          <CircleAlert className="size-3.5 text-muted-foreground flex-shrink-0" />
        ) : isDone ? (
          <Check className="size-3.5 text-emerald-500 flex-shrink-0" />
        ) : (
          <SquareKanban className="size-3.5 text-muted-foreground flex-shrink-0" />
        )}

        {/* Title */}
        <span className="font-medium text-xs text-foreground capitalize flex-1 min-w-0 truncate">
          {subagentType} Agent
        </span>

        {/* Thread badge */}
        <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground flex-shrink-0">
          <ListTree className="size-2.5" />
          Thread
        </span>

        {/* Meta */}
        {stepCount > 0 && (
          <span className="text-[10px] text-muted-foreground/60 tabular-nums flex-shrink-0">
            {stepCount} {stepCount === 1 ? 'step' : 'steps'}
          </span>
        )}
      </div>

      {/* Description */}
      {description && (
        <div className="px-3 py-1.5 border-b border-border/30">
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{description}</p>
        </div>
      )}

      {/* Scrollable tool activity list */}
      {childToolParts.length > 0 && (
        <div ref={scrollRef} data-scrollable className="max-h-48 overflow-y-auto">
          {childToolParts.map((childPart, i) => {
            const info = getToolInfo(childPart.tool, childPart.state.input ?? {});
            return (
              <div
                key={childPart.id}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs',
                  i > 0 && 'border-t border-border/20',
                )}
              >
                <ToolIconForName name={info.icon} />
                <span className="font-medium text-foreground/80 whitespace-nowrap">{info.title}</span>
                {info.subtitle && (
                  <span className="truncate text-muted-foreground font-mono text-[10px]">{info.subtitle}</span>
                )}
                <span className="ml-auto flex-shrink-0">
                  <StatusIcon status={childPart.state.status} />
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer — Open Thread */}
      {hasChild && (
        <button
          onClick={onOpen}
          className={cn(
            'flex items-center justify-center gap-1.5 w-full px-3 py-2 text-xs font-medium',
            'border-t border-border/30',
            'text-muted-foreground hover:text-foreground hover:bg-muted/30',
            'transition-colors cursor-pointer',
          )}
        >
          <ExternalLink className="size-3" />
          Open Thread
        </button>
      )}
    </div>
  );
}

// --- ToolIconForName: maps icon string to Lucide icon ---
function ToolIconForName({ name }: { name: string }) {
  const cls = 'size-3 flex-shrink-0';
  switch (name) {
    case 'terminal':
    case 'console':
      return <Terminal className={cls} />;
    case 'file-pen':
    case 'code-lines':
      return <FileCode2 className={cls} />;
    case 'glasses':
      return <Glasses className={cls} />;
    case 'search':
    case 'magnifying-glass-menu':
      return <Search className={cls} />;
    case 'globe':
    case 'window-cursor':
      return <Globe className={cls} />;
    case 'list':
    case 'bullet-list':
      return <ListTree className={cls} />;
    case 'check-square':
    case 'checklist':
      return <CheckSquare className={cls} />;
    case 'message-circle':
    case 'bubble-5':
      return <MessageCircle className={cls} />;
    case 'square-kanban':
    case 'task':
      return <SquareKanban className={cls} />;
    case 'image':
      return <ImageIcon className={cls} />;
    default:
      return <Cpu className={cls} />;
  }
}

// --- TodoWrite ---
function TodoWriteTool({ part, defaultOpen, forceOpen, locked }: ToolProps) {
  const input = partInput(part);
  const metadata = partMetadata(part);

  const todos = useMemo(() => {
    const meta = metadata.todos;
    if (Array.isArray(meta)) return meta;
    const inp = input.todos;
    if (Array.isArray(inp)) return inp;
    return [];
  }, [metadata.todos, input.todos]);

  const completed = useMemo(
    () => todos.filter((t: Record<string, unknown>) => t.status === 'completed').length,
    [todos],
  );

  const subtitle = todos.length > 0 ? `${completed}/${todos.length}` : '';

  return (
    <BasicTool
      icon={<CheckSquare className="size-3.5 flex-shrink-0" />}
      trigger={{ title: 'Todos', subtitle }}
      defaultOpen={defaultOpen ?? true}
      forceOpen={forceOpen}
      locked={locked}
    >
      {todos.length > 0 && (
        <div className="p-2 space-y-1">
          {todos.map((todo: Record<string, unknown>, i: number) => (
            <label key={i} className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={todo.status === 'completed'}
                readOnly
                className="mt-0.5 rounded border-border accent-primary"
              />
              <span
                className={cn(
                  'leading-relaxed',
                  todo.status === 'completed' && 'line-through text-muted-foreground',
                )}
              >
                {String(todo.content || '')}
              </span>
            </label>
          ))}
        </div>
      )}
    </BasicTool>
  );
}
ToolRegistry.register('todowrite', TodoWriteTool);

// --- Question ---
function QuestionToolRenderer({ part, defaultOpen, forceOpen, locked }: ToolProps) {
  const input = partInput(part);
  const metadata = partMetadata(part);

  const questions = useMemo(
    () => (Array.isArray(input.questions) ? input.questions : []) as Array<{ question: string; options?: { label: string; description?: string }[] }>,
    [input.questions],
  );

  const answers = useMemo(
    () => (Array.isArray(metadata.answers) ? metadata.answers : []) as string[][],
    [metadata.answers],
  );

  const isAnswered = answers.length > 0;
  const subtitle = questions.length > 0
    ? isAnswered
      ? `${answers.length} answered`
      : `${questions.length} ${questions.length > 1 ? 'questions' : 'question'}`
    : '';

  return (
    <BasicTool
      icon={<MessageCircle className="size-3.5 flex-shrink-0" />}
      trigger={{ title: 'Questions', subtitle }}
      defaultOpen={defaultOpen ?? isAnswered}
      forceOpen={forceOpen || isAnswered}
      locked={locked}
    >
      {isAnswered && (
        <div className="p-2 space-y-2">
          {questions.map((q, i) => {
            const answer = answers[i] || [];
            return (
              <div key={i} className="space-y-0.5">
                <p className="text-xs font-medium text-foreground">{q.question}</p>
                <p className="text-xs text-muted-foreground">
                  {answer.join(', ') || 'No answer'}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </BasicTool>
  );
}
ToolRegistry.register('question', QuestionToolRenderer);

// --- Apply Patch ---
function ApplyPatchTool({ part, defaultOpen, forceOpen, locked }: ToolProps) {
  const metadata = partMetadata(part);

  const files = useMemo(
    () => (Array.isArray(metadata.files) ? metadata.files : []) as ApplyPatchFile[],
    [metadata.files],
  );

  const subtitle = files.length > 0
    ? `${files.length} ${files.length > 1 ? 'files' : 'file'}`
    : '';

  return (
    <BasicTool
      icon={<FileCode2 className="size-3.5 flex-shrink-0" />}
      trigger={{ title: 'Patch', subtitle }}
      defaultOpen={defaultOpen}
      forceOpen={forceOpen}
      locked={locked}
    >
      {files.length > 0 && (
        <div className="p-2 space-y-2">
          {files.map((file, i) => (
            <div key={i} className="space-y-1">
              {/* File header */}
              <div className="flex items-center gap-2 text-xs">
                <span
                  className={cn(
                    'px-1.5 py-0.5 rounded text-[9px] font-bold uppercase',
                    file.type === 'add' && 'bg-emerald-500/15 text-emerald-500',
                    file.type === 'update' && 'bg-amber-500/15 text-amber-500',
                    file.type === 'delete' && 'bg-red-500/15 text-red-500',
                    file.type === 'move' && 'bg-blue-500/15 text-blue-500',
                  )}
                >
                  {file.type === 'add'
                    ? 'Created'
                    : file.type === 'update'
                      ? 'Patched'
                      : file.type === 'delete'
                        ? 'Deleted'
                        : 'Moved'}
                </span>
                <span className="font-mono text-[11px] text-foreground truncate">
                  {file.relativePath}
                </span>
                {file.type !== 'delete' && (
                  <DiffChanges additions={file.additions} deletions={file.deletions} />
                )}
                {file.type === 'delete' && file.deletions > 0 && (
                  <span className="ml-auto text-[10px] text-red-500">-{file.deletions}</span>
                )}
              </div>

              {/* File diff */}
              {file.type !== 'delete' && (file.before || file.after) && (
                <div className="max-h-72 overflow-auto rounded border border-border/30">
                  <InlineDiffView
                    oldValue={file.before}
                    newValue={file.after}
                    filename={file.relativePath}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </BasicTool>
  );
}
ToolRegistry.register('apply_patch', ApplyPatchTool);

// ============================================================================
// ToolError
// ============================================================================

export function ToolError({ error }: { error: string }) {
  const cleaned = error.replace(/^Error:\s*/, '');
  const colonIdx = cleaned.indexOf(': ');
  const hasTitle = colonIdx > 0 && colonIdx < 30;
  const title = hasTitle ? cleaned.slice(0, colonIdx) : undefined;
  const message = hasTitle ? cleaned.slice(colonIdx + 2) : cleaned;

  return (
    <div className="flex items-start gap-2 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground">
      <Ban className="size-3 flex-shrink-0 mt-0.5" />
      {title ? (
        <div className="min-w-0">
          <span className="font-medium text-foreground/70">{title}: </span>
          <span className="break-all">{message}</span>
        </div>
      ) : (
        <span className="break-all">{message}</span>
      )}
    </div>
  );
}

// ============================================================================
// GenericTool (fallback)
// ============================================================================

export function GenericTool({ part }: ToolProps) {
  const output = partOutput(part);

  const parsedXml = useMemo(() => {
    if (!output) return null;
    const match = output.match(/<(\w[\w_-]*?)(\s[^>]*)?>([^]*?)<\/\1>/);
    if (!match) return null;

    const tagName = match[1];
    const attrStr = match[2] || '';
    const innerText = match[3].trim();

    // Parse attributes
    const attrs: Record<string, string> = {};
    const attrRegex = /(\w+)="([^"]+)"/g;
    let m;
    while ((m = attrRegex.exec(attrStr)) !== null) {
      attrs[m[1]] = m[2];
    }

    // Detect key-value pairs
    const fields: Record<string, string> = {};
    const lines = innerText.split('\n').filter((l) => l.trim());
    let kvCount = 0;
    for (const line of lines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0 && colonIdx < 40) {
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        if (key && /^[\w\s-]+$/.test(key)) {
          fields[key] = value;
          kvCount++;
        }
      }
    }

    const isStructured = kvCount >= 2 && kvCount >= lines.length * 0.5;

    return { tagName, attrs, innerText, fields, isStructured };
  }, [output]);

  if (parsedXml) {
    return (
      <BasicTool
        icon={<Cpu className="size-3.5 flex-shrink-0" />}
        trigger={
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="font-medium text-xs text-foreground whitespace-nowrap">{part.tool}</span>
            <span className="text-[10px] px-1 py-0.5 rounded bg-primary/10 text-primary font-mono whitespace-nowrap">
              {parsedXml.tagName}
            </span>
            {Object.entries(parsedXml.attrs).map(([key, val]) => (
              <span
                key={key}
                className="text-[10px] px-1 py-0.5 rounded bg-muted/60 text-muted-foreground font-mono whitespace-nowrap truncate max-w-[150px]"
                title={`${key}=${val}`}
              >
                {key}={val}
              </span>
            ))}
          </div>
        }
      >
        <div className="p-2.5 max-h-72 overflow-auto">
          {parsedXml.isStructured ? (
            <div className="space-y-1">
              {Object.entries(parsedXml.fields).map(([key, value]) => (
                <div key={key} className="flex items-baseline gap-2 text-[11px]">
                  <span className="text-muted-foreground font-medium min-w-[80px] flex-shrink-0">{key}</span>
                  <span className="text-foreground/80 font-mono break-all">{value}</span>
                </div>
              ))}
            </div>
          ) : (
            <pre className="font-mono text-[11px] whitespace-pre-wrap text-foreground/80 leading-relaxed">
              {parsedXml.innerText}
            </pre>
          )}
        </div>
      </BasicTool>
    );
  }

  return (
    <BasicTool
      icon={<Cpu className="size-3.5 flex-shrink-0" />}
      trigger={{ title: part.tool }}
    >
      {output && (
        <div className="p-2 max-h-72 overflow-auto font-mono text-[11px]">
          <pre className="whitespace-pre-wrap text-muted-foreground">{output}</pre>
        </div>
      )}
    </BasicTool>
  );
}

// ============================================================================
// PermissionPromptInline
// ============================================================================

interface PermissionPromptInlineProps {
  permission: PermissionRequest;
  onReply?: (requestId: string, reply: 'once' | 'always' | 'reject') => void;
}

function PermissionPromptInline({ permission, onReply }: PermissionPromptInlineProps) {
  const [visible, setVisible] = useState(false);
  const [replying, setReplying] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  const label = PERMISSION_LABELS[permission.permission] || permission.permission;

  const handleReply = useCallback(
    (reply: 'once' | 'always' | 'reject') => {
      if (replying) return;
      setReplying(true);
      onReply?.(permission.id, reply);
    },
    [replying, permission.id, onReply],
  );

  if (!visible) return null;

  return (
    <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-amber-500/30 bg-amber-500/5">
      <span className="text-xs text-foreground flex-1">
        Permission: <span className="font-medium">{label}</span>
      </span>
      <div className="flex items-center gap-1.5">
        <button
          disabled={replying}
          onClick={() => handleReply('reject')}
          className="px-2 py-1 text-[11px] rounded-md text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
        >
          Deny
        </button>
        <button
          disabled={replying}
          onClick={() => handleReply('always')}
          className="px-2 py-1 text-[11px] rounded-md text-foreground hover:bg-muted transition-colors border border-border disabled:opacity-50"
        >
          Allow always
        </button>
        <button
          disabled={replying}
          onClick={() => handleReply('once')}
          className="px-2 py-1 text-[11px] rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          Allow once
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// ToolPartRenderer — main dispatch (primary export)
// ============================================================================

interface ToolPartRendererProps {
  part: ToolPart;
  permission?: PermissionRequest;
  question?: QuestionRequest;
  onPermissionReply?: (requestId: string, reply: 'once' | 'always' | 'reject') => void;
  onQuestionReply?: (requestId: string, answers: string[][]) => void;
  onQuestionReject?: (requestId: string) => void;
  defaultOpen?: boolean;
}

export function ToolPartRenderer({
  part,
  sessionId,
  permission,
  question,
  onPermissionReply,
  onQuestionReply,
  onQuestionReject,
  defaultOpen,
}: ToolPartRendererProps & { sessionId?: string }) {
  // Skip todoread
  if (part.tool === 'todoread') return null;

  // Error state
  if (part.state.status === 'error' && 'error' in part.state) {
    return <ToolError error={(part.state as { error: string }).error} />;
  }

  // Look up registered component
  const RegisteredComponent = ToolRegistry.get(part.tool);
  const forceOpen = !!permission || !!question;
  const isLocked = !!permission || !!question;

  const toolElement = RegisteredComponent ? (
    <RegisteredComponent
      part={part}
      sessionId={sessionId}
      defaultOpen={defaultOpen}
      forceOpen={forceOpen}
      locked={isLocked}
      onPermissionReply={onPermissionReply}
    />
  ) : (
    <GenericTool part={part} />
  );

  return (
    <div className="relative">
      {toolElement}

      {/* Permission prompt */}
      {permission && onPermissionReply && (
        <div className="mt-1.5">
          <PermissionPromptInline permission={permission} onReply={onPermissionReply} />
        </div>
      )}

      {/* Question prompt */}
      {question && onQuestionReply && onQuestionReject && (
        <div className="mt-1.5">
          <QuestionPrompt
            request={question}
            onReply={onQuestionReply}
            onReject={onQuestionReject}
          />
        </div>
      )}
    </div>
  );
}
