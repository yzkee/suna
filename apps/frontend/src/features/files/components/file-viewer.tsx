'use client';

import { useMemo, useCallback } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  FileWarning,
  Loader2,
  GitBranch,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useFilesStore } from '../store/files-store';
import { useFileContent, useFileStatusMap } from '../hooks';
import { FileStatusBadge } from './file-status-badge';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLanguageFromExt(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
    java: 'java', c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    cs: 'csharp', swift: 'swift', kt: 'kotlin', php: 'php',
    html: 'html', css: 'css', scss: 'scss', less: 'less',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    xml: 'xml', sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash',
    md: 'markdown', mdx: 'markdown', txt: 'plaintext',
    dockerfile: 'dockerfile', makefile: 'makefile',
    vue: 'vue', svelte: 'svelte',
  };
  return map[ext] || 'plaintext';
}

function isImageMime(mimeType?: string): boolean {
  return !!mimeType && mimeType.startsWith('image/');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FileViewer() {
  const selectedFilePath = useFilesStore((s) => s.selectedFilePath);
  const filePathList = useFilesStore((s) => s.filePathList);
  const currentFileIndex = useFilesStore((s) => s.currentFileIndex);
  const goBackToBrowser = useFilesStore((s) => s.goBackToBrowser);
  const nextFile = useFilesStore((s) => s.nextFile);
  const prevFile = useFilesStore((s) => s.prevFile);

  const statusMap = useFileStatusMap();
  const fileStatus = selectedFilePath ? statusMap.get(selectedFilePath) : undefined;

  const { data: fileContent, isLoading, error } = useFileContent(selectedFilePath);

  const fileName = selectedFilePath?.split('/').pop() || '';
  const language = getLanguageFromExt(fileName);

  const hasNext = currentFileIndex < filePathList.length - 1;
  const hasPrev = currentFileIndex > 0;

  // Download handler
  const handleDownload = useCallback(() => {
    if (!fileContent || !fileName) return;

    let blob: Blob;
    if (fileContent.encoding === 'base64') {
      const binary = atob(fileContent.content);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      blob = new Blob([bytes], { type: fileContent.mimeType || 'application/octet-stream' });
    } else {
      blob = new Blob([fileContent.content], { type: 'text/plain;charset=utf-8' });
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }, [fileContent, fileName]);

  // Image rendering
  const imageDataUrl = useMemo(() => {
    if (
      fileContent?.encoding === 'base64' &&
      isImageMime(fileContent.mimeType)
    ) {
      return `data:${fileContent.mimeType};base64,${fileContent.content}`;
    }
    return null;
  }, [fileContent]);

  return (
    <div className="flex flex-col h-full">
      {/* Viewer header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={goBackToBrowser}
          title="Back to browser"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="font-medium text-sm truncate">{fileName}</span>
          {fileStatus && <FileStatusBadge status={fileStatus.status} />}
          {fileContent?.diff && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 shrink-0">
              <GitBranch className="h-3 w-3" />
              changed
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* File navigation */}
          {filePathList.length > 1 && (
            <div className="flex items-center gap-0.5 mr-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={prevFile}
                disabled={!hasPrev}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums min-w-[3ch] text-center">
                {currentFileIndex + 1}/{filePathList.length}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={nextFile}
                disabled={!hasNext}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleDownload}
            disabled={!fileContent}
            title="Download"
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto">
        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Error */}
        {error && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
            <FileWarning className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Failed to load file
            </p>
            <p className="text-xs text-muted-foreground max-w-sm">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
          </div>
        )}

        {/* Image content */}
        {!isLoading && !error && imageDataUrl && (
          <div className="flex items-center justify-center p-4 h-full bg-muted/30">
            <img
              src={imageDataUrl}
              alt={fileName}
              className="max-w-full max-h-full object-contain rounded"
            />
          </div>
        )}

        {/* Binary (non-image) content */}
        {!isLoading &&
          !error &&
          fileContent &&
          fileContent.type === 'binary' &&
          !imageDataUrl && (
            <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
              <FileWarning className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Binary file — cannot display preview
              </p>
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Download
              </Button>
            </div>
          )}

        {/* Text content */}
        {!isLoading &&
          !error &&
          fileContent &&
          fileContent.type === 'text' &&
          !imageDataUrl && (
            <div className="relative">
              {/* Diff indicator */}
              {fileContent.patch && fileContent.patch.hunks.length > 0 && (
                <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-1.5 bg-yellow-500/5 border-b border-yellow-500/20 text-xs text-yellow-600 dark:text-yellow-400">
                  <GitBranch className="h-3 w-3" />
                  File has uncommitted changes
                </div>
              )}
              <pre
                className={cn(
                  'text-sm leading-relaxed p-4 font-mono',
                  'overflow-x-auto whitespace-pre',
                  'selection:bg-primary/20',
                )}
              >
                <code>{fileContent.content}</code>
              </pre>
            </div>
          )}
      </div>

      {/* Path bar */}
      {selectedFilePath && (
        <div className="px-3 py-1.5 border-t text-xs text-muted-foreground truncate shrink-0 bg-muted/30">
          {selectedFilePath}
        </div>
      )}
    </div>
  );
}
