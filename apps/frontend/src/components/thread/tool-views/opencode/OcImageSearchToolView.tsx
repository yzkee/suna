'use client';

import React, { useMemo } from 'react';
import {
  Image as ImageIcon,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  Search,
} from 'lucide-react';
import { ToolViewProps } from '../types';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ToolViewIconTitle } from '../shared/ToolViewIconTitle';
import { ToolViewFooter } from '../shared/ToolViewFooter';
import { LoadingState } from '../shared/LoadingState';

interface ImageResult {
  url?: string;
  imageUrl?: string;
  image_url?: string;
  title?: string;
  source?: string;
  width?: number;
  height?: number;
  description?: string;
}

function parseImageResults(output: string): ImageResult[] {
  if (!output) return [];
  try {
    const parsed = JSON.parse(output);
    if (Array.isArray(parsed)) return parsed;
    if (parsed.images && Array.isArray(parsed.images)) return parsed.images;
    if (parsed.results && Array.isArray(parsed.results)) return parsed.results;
  } catch {
    // Not JSON
  }
  return [];
}

function getImageUrl(img: ImageResult): string {
  return img.url || img.imageUrl || img.image_url || '';
}

export function OcImageSearchToolView({
  toolCall,
  toolResult,
  assistantTimestamp,
  toolTimestamp,
  isSuccess = true,
  isStreaming = false,
}: ToolViewProps) {
  const args = toolCall?.arguments || {};
  const ocState = args._oc_state as any;
  const query = (args.query as string) || (ocState?.input?.query as string) || '';
  const rawOutput = toolResult?.output || ocState?.output || '';
  const output = typeof rawOutput === 'string' ? rawOutput : String(rawOutput);

  const isError = toolResult?.success === false || !!toolResult?.error;
  const images = useMemo(() => parseImageResults(output), [output]);

  if (isStreaming && !toolResult) {
    return (
      <LoadingState
        icon={ImageIcon}
        iconColor="text-pink-500 dark:text-pink-400"
        bgColor="bg-gradient-to-b from-pink-100 to-pink-50 shadow-inner dark:from-pink-800/40 dark:to-pink-900/60"
        title="Searching for images"
        subtitle={query}
        showProgress={true}
      />
    );
  }

  return (
    <Card className="gap-0 flex border-0 shadow-none p-0 py-0 rounded-none flex-col h-full overflow-hidden bg-card">
      <CardHeader className="h-14 bg-zinc-50/80 dark:bg-zinc-900/80 backdrop-blur-sm border-b p-2 px-4 space-y-2">
        <div className="flex flex-row items-center justify-between">
          <ToolViewIconTitle
            icon={ImageIcon}
            title="Image Search"
            subtitle={query}
          />
          {images.length > 0 && (
            <Badge variant="outline" className="h-6 py-0.5 bg-zinc-50 dark:bg-zinc-900 flex-shrink-0 ml-2">
              {images.length} images
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0 h-full flex-1 overflow-hidden">
        <ScrollArea className="h-full w-full">
          {images.length > 0 ? (
            <div className="p-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {images.map((img, i) => {
                  const imgUrl = getImageUrl(img);
                  if (!imgUrl) return null;
                  return (
                    <a
                      key={i}
                      href={imgUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group relative overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors aspect-[4/3]"
                    >
                      <img
                        src={imgUrl}
                        alt={img.title || `Image ${i + 1}`}
                        className="object-cover w-full h-full group-hover:opacity-90 transition-opacity"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                      {/* Overlay with title */}
                      {img.title && (
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2 pt-6 opacity-0 group-hover:opacity-100 transition-opacity">
                          <p className="text-[10px] text-white/90 truncate">{img.title}</p>
                        </div>
                      )}
                      {/* External link badge */}
                      <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Badge variant="secondary" className="bg-black/60 hover:bg-black/70 text-white border-none shadow-md h-5 px-1.5">
                          <ExternalLink className="h-2.5 w-2.5" />
                        </Badge>
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          ) : isError ? (
            <div className="flex items-start gap-2.5 px-4 py-6 text-muted-foreground">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <p className="text-sm">{output || 'Search failed'}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Search className="h-8 w-8 mb-2 opacity-40" />
              <span className="text-sm">No images found</span>
            </div>
          )}
        </ScrollArea>
      </CardContent>

      <ToolViewFooter
        assistantTimestamp={assistantTimestamp}
        toolTimestamp={toolTimestamp}
        isStreaming={isStreaming}
      >
        {!isStreaming && (
          isError ? (
            <Badge variant="outline" className="h-6 py-0.5 bg-zinc-50 dark:bg-zinc-900 text-muted-foreground">
              <AlertCircle className="h-3 w-3" />
              Failed
            </Badge>
          ) : images.length > 0 ? (
            <Badge variant="outline" className="h-6 py-0.5 bg-zinc-50 dark:bg-zinc-900">
              <CheckCircle className="h-3 w-3 text-green-600 dark:text-green-400" />
              {images.length} images
            </Badge>
          ) : null
        )}
      </ToolViewFooter>
    </Card>
  );
}
