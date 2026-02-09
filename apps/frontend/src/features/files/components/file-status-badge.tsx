'use client';

import { cn } from '@/lib/utils';
import type { FileStatus } from '../types';

interface FileStatusBadgeProps {
  status: FileStatus['status'];
  className?: string;
}

const statusConfig = {
  added: { label: 'A', color: 'text-green-500', bg: 'bg-green-500/10' },
  modified: { label: 'M', color: 'text-yellow-500', bg: 'bg-yellow-500/10' },
  deleted: { label: 'D', color: 'text-red-500', bg: 'bg-red-500/10' },
} as const;

export function FileStatusBadge({ status, className }: FileStatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded px-1 py-0.5 text-[10px] font-mono font-semibold leading-none',
        config.color,
        config.bg,
        className,
      )}
      title={status}
    >
      {config.label}
    </span>
  );
}
