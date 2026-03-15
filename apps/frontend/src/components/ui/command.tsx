'use client';

import * as React from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { SearchIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        'bg-transparent text-popover-foreground flex h-full w-full flex-col overflow-hidden rounded-xl',
        className,
      )}
      {...props}
    />
  );
}

function CommandDialog({
  title = 'Command Palette',
  description = 'Search for a command to run...',
  children,
  className,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string;
  description?: string;
  className?: string;
}) {
  return (
    <Dialog {...props}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        className={cn(
          'overflow-hidden p-0',
          // Spotlight positioning — anchored near top of viewport
          'top-[22%] translate-y-0',
          // Border
          'border-border/30 rounded-xl',
          // Solid popover with very subtle translucency
          'bg-popover backdrop-blur-sm',
          // Refined floating shadow
          'shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3),0_0_0_1px_rgba(0,0,0,0.03)]',
          'dark:shadow-[0_20px_60px_-15px_rgba(0,0,0,0.7),0_0_0_1px_rgba(255,255,255,0.05)]',
          // Subtle slide-in from above
          'data-[state=open]:slide-in-from-top-[2%] data-[state=closed]:slide-out-to-top-[2%]',
          className,
        )}
        hideCloseButton
      >
        <Command
          shouldFilter={false}
          className={cn(
            // Group headings
            '[&_[cmdk-group-heading]]:text-muted-foreground/50',
            '[&_[cmdk-group-heading]]:px-3',
            '[&_[cmdk-group-heading]]:py-2',
            '[&_[cmdk-group-heading]]:text-[11px]',
            '[&_[cmdk-group-heading]]:font-medium',
            '[&_[cmdk-group-heading]]:uppercase',
            '[&_[cmdk-group-heading]]:tracking-wider',
            // Groups
            '[&_[cmdk-group]]:px-1.5',
            '[&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0',
            // Input
            '[&_[cmdk-input-wrapper]_svg]:h-[18px] [&_[cmdk-input-wrapper]_svg]:w-[18px]',
            '[&_[cmdk-input]]:h-14',
            // Items
            '[&_[cmdk-item]]:px-3',
            '[&_[cmdk-item]]:py-2.5',
            '[&_[cmdk-item]_svg]:h-4 [&_[cmdk-item]_svg]:w-4',
          )}
        >
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="flex h-14 items-center gap-3 border-b border-border/40 px-4"
    >
      <SearchIcon className="size-[18px] shrink-0 text-muted-foreground/50" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          'placeholder:text-muted-foreground/40 flex h-14 w-full bg-transparent text-[15px] outline-hidden disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    </div>
  );
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        'max-h-[min(60vh,480px)] scroll-py-1 overflow-x-hidden overflow-y-auto scrollbar-minimal',
        className,
      )}
      {...props}
    />
  );
}

function CommandEmpty({
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className="py-10 text-center text-sm text-muted-foreground/60"
      {...props}
    />
  );
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        'text-foreground overflow-hidden py-1',
        '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground/50',
        className,
      )}
      {...props}
    />
  );
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn('bg-border/30 -mx-1 h-px', className)}
      {...props}
    />
  );
}

function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        'relative flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm outline-hidden select-none transition-all duration-75',
        'data-[selected=true]:bg-foreground/[0.07] data-[selected=true]:text-foreground',
        "[&_svg:not([class*='text-'])]:text-muted-foreground/60",
        'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-40',
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        'ml-auto inline-flex items-center gap-0.5 text-[11px] font-medium text-muted-foreground/40 tracking-wide',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Footer bar for the command palette — shows keyboard hints.
 */
function CommandFooter({
  className,
  children,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="command-footer"
      className={cn(
        'flex items-center gap-4 border-t border-border/30 px-4 py-2 text-[11px] text-muted-foreground/40',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
  CommandFooter,
};
