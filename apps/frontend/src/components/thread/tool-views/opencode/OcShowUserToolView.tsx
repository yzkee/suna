'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Code2,
  ExternalLink,
  FileIcon,
  FileText,
  Globe,
  Image as ImageIcon,
  Loader2,
  MonitorPlay,
  Music,
  RefreshCw,
  Type,
  Video,
} from 'lucide-react';
import { ToolViewProps } from '../types';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { ToolViewIconTitle } from '../shared/ToolViewIconTitle';
import { ToolViewFooter } from '../shared/ToolViewFooter';
import { useAuthenticatedPreviewUrl } from '@/hooks/use-authenticated-preview-url';
import {
  isProxiableLocalhostUrl,
  parseLocalhostUrl,
  proxyLocalhostUrl,
} from '@/lib/utils/sandbox-url';
import { useServerStore, getActiveOpenCodeUrl, deriveSubdomainOpts } from '@/stores/server-store';
import { openTabAndNavigate } from '@/stores/tab-store';
import { enrichPreviewMetadata } from '@/lib/utils/session-context';
import { cn } from '@/lib/utils';
import { useFileContent } from '@/features/files';
import { HighlightedCode, UnifiedMarkdown } from '@/components/markdown/unified-markdown';

// ── Regexes ──────────────────────────────────────────────────────────────────
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|mov|avi|mkv|ogv)$/i;
const AUDIO_EXT_RE = /\.(mp3|wav|ogg|aac|flac|m4a|opus)$/i;
const PDF_EXT_RE = /\.pdf$/i;

// ── Theme accent styles ─────────────────────────────────────────────────────
const THEME_STYLES: Record<string, { border: string; badge: string; badgeText: string; icon: string }> = {
  default:  { border: 'border-border',            badge: 'bg-muted',           badgeText: 'text-muted-foreground', icon: 'text-muted-foreground' },
  success:  { border: 'border-emerald-500/30',    badge: 'bg-emerald-500/10',  badgeText: 'text-emerald-600',      icon: 'text-emerald-500' },
  warning:  { border: 'border-amber-500/30',      badge: 'bg-amber-500/10',    badgeText: 'text-amber-600',        icon: 'text-amber-500' },
  info:     { border: 'border-blue-500/30',        badge: 'bg-blue-500/10',     badgeText: 'text-blue-600',         icon: 'text-blue-500' },
  danger:   { border: 'border-red-500/30',         badge: 'bg-red-500/10',      badgeText: 'text-red-600',          icon: 'text-red-500' },
};

function aspectRatioToCSS(ar: string | undefined): string | undefined {
  if (!ar || ar === 'auto') return undefined;
  const [w, h] = ar.split(':').map(Number);
  if (w && h) return `${w}/${h}`;
  return undefined;
}

function typeIcon(type: string) {
  switch (type) {
    case 'image':    return ImageIcon;
    case 'video':    return Video;
    case 'audio':    return Music;
    case 'code':     return Code2;
    case 'markdown': return Type;
    case 'html':     return Globe;
    case 'pdf':      return FileText;
    case 'url':      return Globe;
    case 'error':    return AlertTriangle;
    case 'file':     return FileIcon;
    default:         return FileIcon;
  }
}

function isLocalSandboxFilePath(value: string): boolean {
  if (!value) return false;
  if (/^(https?:|data:|blob:)/i.test(value)) return false;
  return value.startsWith('/');
}

// ---------------------------------------------------------------------------
// Embedded iframe preview for localhost URLs in the side-panel
// ---------------------------------------------------------------------------

function SidePanelIframePreview({ url, title }: { url: string; title?: string }) {
  const activeServer = useServerStore((s) => {
    return s.servers.find((srv) => srv.id === s.activeServerId) ?? null;
  });
  const serverUrl = activeServer?.url || getActiveOpenCodeUrl();
  const mappedPorts = activeServer?.mappedPorts;
  const subdomainOpts = useMemo(() => deriveSubdomainOpts(activeServer), [activeServer]);

  const proxy = useMemo(() => {
    if (!url) return null;
    if (!isProxiableLocalhostUrl(url)) return null;
    const parsed = parseLocalhostUrl(url);
    if (!parsed) return null;
    const proxyUrl = proxyLocalhostUrl(url, serverUrl, mappedPorts, subdomainOpts);
    if (!proxyUrl) return null;
    return { proxyUrl, port: parsed.port };
  }, [url, serverUrl, mappedPorts, subdomainOpts]);

  const authenticatedUrl = useAuthenticatedPreviewUrl(proxy?.proxyUrl || url);
  const isAuthReady = authenticatedUrl !== null;
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = useCallback(() => {
    setIsLoading(true);
    setHasError(false);
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!isLoading) return;
    const t = setTimeout(() => setIsLoading(false), 5000);
    return () => clearTimeout(t);
  }, [isLoading, refreshKey]);

  const displayLabel = title || (proxy ? `localhost:${proxy.port}` : url);

  const navigateToPreviewTab = useCallback(() => {
    if (!proxy) return;
    openTabAndNavigate({
      id: `preview:${proxy.port}`,
      title: `localhost:${proxy.port}`,
      type: 'preview',
      href: `/preview/${proxy.port}`,
      metadata: enrichPreviewMetadata({
        url: proxy.proxyUrl,
        port: proxy.port,
        originalUrl: url,
      }),
    });
  }, [proxy, url]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1.5 h-9 px-3 bg-muted/30 border-b border-border/30 shrink-0">
        <Globe className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
        <span className="text-xs text-muted-foreground font-mono truncate flex-1">{displayLabel}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={handleRefresh} className="p-1 rounded hover:bg-muted/60 text-muted-foreground/50 hover:text-muted-foreground transition-colors">
              <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Refresh</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={() => authenticatedUrl && window.open(authenticatedUrl, '_blank', 'noopener,noreferrer')} disabled={!isAuthReady} className="p-1 rounded hover:bg-muted/60 text-muted-foreground/50 hover:text-muted-foreground transition-colors disabled:opacity-30">
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Open in browser</TooltipContent>
        </Tooltip>
        {proxy && (
          <Button variant="default" size="sm" className="h-6 text-[10px] gap-1 px-2 rounded-md" onClick={navigateToPreviewTab}>
            <MonitorPlay className="h-3 w-3" />
            Open Tab
          </Button>
        )}
      </div>
      <div className="relative flex-1 min-h-0">
        {(isLoading || !isAuthReady) && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60 z-10">
            <div className="flex items-center gap-2 text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span className="text-xs">{!isAuthReady ? 'Authenticating...' : 'Loading preview...'}</span>
            </div>
          </div>
        )}
        {hasError && (
          <div className="absolute inset-0 flex items-center justify-center bg-background z-10">
            <div className="text-center text-muted-foreground">
              <p className="text-sm">Failed to load preview</p>
              <button type="button" onClick={handleRefresh} className="text-xs text-primary hover:underline mt-1">Retry</button>
            </div>
          </div>
        )}
        {isAuthReady && (
          <iframe
            key={refreshKey}
            src={authenticatedUrl}
            title={displayLabel}
            className="w-full h-full border-0 bg-white"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads allow-modals"
            onLoad={() => setIsLoading(false)}
            onError={() => { setIsLoading(false); setHasError(true); }}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component — variant-aware side-panel renderer
// ---------------------------------------------------------------------------

export function OcShowUserToolView({
  toolCall,
  toolResult,
  assistantTimestamp,
  toolTimestamp,
  isSuccess = true,
  isStreaming = false,
}: ToolViewProps) {
  const args = toolCall?.arguments || {};
  const ocState = args._oc_state as any;

  // ── Extract all fields (from args or ocState fallback) ──
  const title       = (args.title as string)       || (ocState?.input?.title as string)       || '';
  const description = (args.description as string) || (ocState?.input?.description as string) || '';
  const type        = (args.type as string)        || (ocState?.input?.type as string)        || '';
  const path        = (args.path as string)        || (ocState?.input?.path as string)        || '';
  const url         = (args.url as string)         || (ocState?.input?.url as string)         || '';
  const content     = (args.content as string)     || (ocState?.input?.content as string)     || '';
  const variant     = (args.variant as string)     || (ocState?.input?.variant as string)     || '';
  const aspectRatio = (args.aspect_ratio as string) || (ocState?.input?.aspect_ratio as string) || '';
  const theme       = (args.theme as string)       || (ocState?.input?.theme as string)       || 'default';
  const language    = (args.language as string)    || (ocState?.input?.language as string)    || '';

  const themeStyle = THEME_STYLES[theme] || THEME_STYLES.default;
  const arCSS = aspectRatioToCSS(aspectRatio);
  const Icon = typeIcon(type);

  const isError = type === 'error' || toolResult?.success === false || !!toolResult?.error;
  const isImage = type === 'image' || IMAGE_EXT_RE.test(path);
  const isVideo = type === 'video' || VIDEO_EXT_RE.test(path);
  const isAudio = type === 'audio' || AUDIO_EXT_RE.test(path);
  const isPdf = type === 'pdf' || PDF_EXT_RE.test(path);
  const isCode = type === 'code';
  const isMarkdown = type === 'markdown';
  const isHtml = type === 'html';
  const hasLocalhostUrl = !!parseLocalhostUrl(url);

  // ── Server/proxy state ──
  const activeServer = useServerStore((s) => {
    return s.servers.find((srv) => srv.id === s.activeServerId) ?? null;
  });
  const serverUrl = activeServer?.url || getActiveOpenCodeUrl();
  const mappedPorts = activeServer?.mappedPorts;
  const subdomainOpts2 = useMemo(() => deriveSubdomainOpts(activeServer), [activeServer]);
  const resolvedUrl = useMemo(
    () => proxyLocalhostUrl(url, serverUrl, mappedPorts, subdomainOpts2) ?? url,
    [url, serverUrl, mappedPorts, subdomainOpts2],
  );

  // ── Image loading (base64 from sandbox filesystem) ──
  const isLocalPath = isImage && path ? isLocalSandboxFilePath(path) : false;
  const fileContentPath = useMemo(() => {
    if (!isLocalPath || !path) return null;
    return path.replace(/^\/workspace\//, '');
  }, [isLocalPath, path]);
  const { data: fileContentData, isLoading: isImageLoading } = useFileContent(
    fileContentPath,
    { enabled: !!fileContentPath },
  );
  const imageUrl = useMemo(() => {
    if (fileContentData?.encoding === 'base64' && fileContentData?.content) {
      const binary = atob(fileContentData.content);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: fileContentData.mimeType || 'image/webp' });
      return URL.createObjectURL(blob);
    }
    return null;
  }, [fileContentData]);
  const displayImageSrc = isLocalPath ? (imageUrl || '') : (path || '');

  // ── HTML blob URL (unconditional for hooks rules) ──
  const htmlBlobUrl = useMemo(() => {
    if (!isHtml || !content) return null;
    const blob = new Blob([content], { type: 'text/html' });
    return URL.createObjectURL(blob);
  }, [isHtml, content]);

  const displayTitle = title || description || 'Output';

  // ── Footer badge ──
  const footerBadge = useMemo(() => {
    if (isStreaming) return null;
    if (isError && type === 'error') {
      return (
        <Badge variant="outline" className={cn('h-6 py-0.5', THEME_STYLES.danger.badge)}>
          <AlertTriangle className={cn('h-3 w-3', THEME_STYLES.danger.icon)} />
          Error
        </Badge>
      );
    }
    if (hasLocalhostUrl) {
      return (
        <Badge variant="outline" className="h-6 py-0.5 bg-muted">
          <CheckCircle className="h-3 w-3 text-emerald-500" />
          Live Preview
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className={cn('h-6 py-0.5', themeStyle.badge)}>
        <CheckCircle className={cn('h-3 w-3', themeStyle.icon)} />
        Displayed
      </Badge>
    );
  }, [isStreaming, isError, type, hasLocalhostUrl, themeStyle]);

  // ═══════════════════════════════════════════════════════════════════════════
  // LOCALHOST URL → full iframe preview
  // ═══════════════════════════════════════════════════════════════════════════
  if (hasLocalhostUrl) {
    return (
      <Card className="gap-0 flex border-0 shadow-none p-0 py-0 rounded-none flex-col h-full overflow-hidden bg-card">
        <CardHeader className="h-14 bg-muted/50 backdrop-blur-sm border-b p-2 px-4 space-y-2">
          <div className="flex flex-row items-center justify-between">
            <ToolViewIconTitle icon={Globe} title={displayTitle} subtitle={resolvedUrl || undefined} />
            <a href={resolvedUrl} target="_blank" rel="noopener noreferrer" className="p-1 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </CardHeader>
        <CardContent className="p-0 h-full flex-1 overflow-hidden">
          <SidePanelIframePreview url={url} title={title || description || undefined} />
        </CardContent>
        <ToolViewFooter assistantTimestamp={assistantTimestamp} toolTimestamp={toolTimestamp} isStreaming={isStreaming}>
          {footerBadge}
        </ToolViewFooter>
      </Card>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXTERNAL URL → full iframe preview (no proxy needed)
  // ═══════════════════════════════════════════════════════════════════════════
  if (type === 'url' && url && !hasLocalhostUrl) {
    return (
      <Card className="gap-0 flex border-0 shadow-none p-0 py-0 rounded-none flex-col h-full overflow-hidden bg-card">
        <CardHeader className="h-14 bg-muted/50 backdrop-blur-sm border-b p-2 px-4 space-y-2">
          <div className="flex flex-row items-center justify-between">
            <ToolViewIconTitle icon={Globe} title={displayTitle} subtitle={url} />
            <a href={url} target="_blank" rel="noopener noreferrer" className="p-1 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </CardHeader>
        <CardContent className="p-0 h-full flex-1 overflow-hidden">
          <div className="flex flex-col h-full">
            {/* Mini toolbar */}
            <div className="flex items-center gap-1.5 h-9 px-3 bg-muted/30 border-b border-border/30 shrink-0">
              <Globe className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
              <span className="text-xs text-muted-foreground font-mono truncate flex-1">{url}</span>
              <a href={url} target="_blank" rel="noopener noreferrer" className="p-1 rounded hover:bg-muted/60 text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
            <div className="relative flex-1 min-h-0">
              <iframe
                src={url}
                title={title || url}
                className="w-full h-full border-0 bg-white"
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
              />
            </div>
          </div>
        </CardContent>
        <ToolViewFooter assistantTimestamp={assistantTimestamp} toolTimestamp={toolTimestamp} isStreaming={isStreaming}>
          {footerBadge}
        </ToolViewFooter>
      </Card>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Everything else — rich content area in ScrollArea
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <Card className="gap-0 flex border-0 shadow-none p-0 py-0 rounded-none flex-col h-full overflow-hidden bg-card">
      <CardHeader className="h-14 bg-muted/50 backdrop-blur-sm border-b p-2 px-4 space-y-2">
        <div className="flex flex-row items-center justify-between">
          <ToolViewIconTitle icon={Icon} title={displayTitle} subtitle={path || url || language || undefined} />
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer" className="p-1 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0 h-full flex-1 overflow-hidden">
        <ScrollArea className="h-full w-full">
          <div className="space-y-0">

            {/* ── Image ── */}
            {isImage && path && (
              <div className="flex justify-center p-4 bg-muted/10">
                {displayImageSrc ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={displayImageSrc}
                    alt={title || 'Output image'}
                    className={cn('max-w-full rounded-lg border object-contain', themeStyle.border, arCSS ? '' : 'max-h-[500px]')}
                    style={arCSS ? { aspectRatio: arCSS, maxHeight: '600px', width: 'auto' } : undefined}
                  />
                ) : isImageLoading ? (
                  <div className="w-full rounded-lg border border-border bg-muted/20 px-2.5 py-2 text-[11px] text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading image preview...
                  </div>
                ) : (
                  <div className="w-full rounded-lg border border-border bg-muted/20 px-2.5 py-2 text-[11px] text-muted-foreground font-mono break-all">
                    {path}
                  </div>
                )}
              </div>
            )}

            {/* ── Video ── */}
            {isVideo && path && (
              <div className="p-4 bg-black/5 dark:bg-white/5">
                <video
                  src={path}
                  controls
                  className="w-full rounded-lg"
                  style={arCSS ? { aspectRatio: arCSS } : { aspectRatio: '16/9' }}
                  preload="metadata"
                />
              </div>
            )}

            {/* ── Audio ── */}
            {isAudio && path && (
              <div className="p-4">
                <audio src={path} controls className="w-full" preload="metadata" />
              </div>
            )}

            {/* ── Code ── */}
            {isCode && content && (
              <div className="overflow-hidden">
                {language ? (
                  <HighlightedCode code={content} language={language}>
                    <code>{content}</code>
                  </HighlightedCode>
                ) : (
                  <pre className="p-4 text-sm font-mono overflow-x-auto bg-muted/30">
                    <code>{content}</code>
                  </pre>
                )}
              </div>
            )}

            {/* ── Markdown ── */}
            {isMarkdown && content && (
              <div className="p-4">
                <UnifiedMarkdown content={content} />
              </div>
            )}

            {/* ── HTML ── */}
            {isHtml && htmlBlobUrl && (
              <div className="overflow-hidden">
                <iframe
                  src={htmlBlobUrl}
                  title={title || 'HTML Preview'}
                  className="w-full border-0 bg-white"
                  style={{ height: arCSS ? undefined : '480px', aspectRatio: arCSS || undefined }}
                  sandbox="allow-scripts allow-same-origin"
                />
              </div>
            )}

            {/* ── PDF ── */}
            {isPdf && path && (
              <div className="flex items-center gap-4 p-4">
                <div className={cn('flex items-center justify-center w-12 h-12 rounded-xl', themeStyle.badge)}>
                  <FileText className={cn('h-6 w-6', themeStyle.icon)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{title || 'PDF Document'}</div>
                  <div className="text-xs text-muted-foreground font-mono truncate mt-0.5">{path}</div>
                </div>
              </div>
            )}

            {/* ── Error ── */}
            {isError && type === 'error' && content && (
              <div className={cn('p-4 border-t', THEME_STYLES.danger.border, THEME_STYLES.danger.badge)}>
                <div className="flex items-start gap-2.5">
                  <AlertCircle className={cn('h-4 w-4 flex-shrink-0 mt-0.5', THEME_STYLES.danger.icon)} />
                  <p className="text-sm text-foreground whitespace-pre-wrap">{content}</p>
                </div>
              </div>
            )}

            {/* ── Text ── */}
            {type === 'text' && content && (
              <div className={cn('p-4 border-t', themeStyle.border, theme !== 'default' && themeStyle.badge)}>
                <p className="text-sm text-foreground whitespace-pre-wrap">{content}</p>
              </div>
            )}

            {/* ── Description (shown when title also present) ── */}
            {description && title && !isCode && !isMarkdown && (
              <div className="px-4 py-3 border-t border-border/30">
                <p className="text-sm text-muted-foreground">{description}</p>
              </div>
            )}

            {/* ── URL link (non-localhost) ── */}
            {url && !hasLocalhostUrl && (
              <div className="px-4 py-3 border-t border-border/30">
                <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-primary hover:underline">
                  <ExternalLink className="w-3.5 h-3.5" />
                  {url}
                </a>
              </div>
            )}

            {/* ── File path (non-image, non-video, non-audio, non-pdf) ── */}
            {path && !isImage && !isVideo && !isAudio && !isPdf && (
              <div className="flex items-center gap-2 p-4 border-t border-border/30 bg-muted/20">
                <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="text-xs text-foreground font-mono truncate">{path}</span>
              </div>
            )}

            {/* ── Generic error from toolResult ── */}
            {isError && type !== 'error' && (
              <div className="flex items-start gap-2.5 p-4 text-muted-foreground border-t border-border/30">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <p className="text-sm">{toolResult?.error || 'Operation failed'}</p>
              </div>
            )}

          </div>
        </ScrollArea>
      </CardContent>

      <ToolViewFooter assistantTimestamp={assistantTimestamp} toolTimestamp={toolTimestamp} isStreaming={isStreaming}>
        {footerBadge}
      </ToolViewFooter>
    </Card>
  );
}
