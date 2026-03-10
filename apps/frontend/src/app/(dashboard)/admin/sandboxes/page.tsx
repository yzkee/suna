'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminSandboxes, useDeleteAdminSandbox } from '@/hooks/admin/use-admin-sandboxes';
import type { AdminSandbox } from '@/hooks/admin/use-admin-sandboxes';
import { useAdminRole } from '@/hooks/admin/use-admin-role';
import { toast } from '@/lib/toast';
import { Server, ShieldCheck, Trash2, RefreshCw } from 'lucide-react';

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="secondary">unknown</Badge>;
  switch (status.toLowerCase()) {
    case 'active':
    case 'running':
      return <Badge variant="highlight">{status}</Badge>;
    case 'stopped':
    case 'paused':
      return <Badge variant="secondary">{status}</Badge>;
    case 'error':
    case 'failed':
      return <Badge variant="destructive">{status}</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AdminSandboxesPage() {
  const { data: adminRole, isLoading: roleLoading } = useAdminRole();
  const { data: sandboxes, isLoading, refetch, isFetching } = useAdminSandboxes();
  const deleteMutation = useDeleteAdminSandbox();
  const [confirmDelete, setConfirmDelete] = useState<AdminSandbox | null>(null);

  if (roleLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-6xl mx-auto p-6">
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-72 mb-8" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  if (!adminRole?.isAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <ShieldCheck className="h-12 w-12 text-muted-foreground/40 mx-auto" />
          <h2 className="text-lg font-medium text-foreground/80">Admin access required</h2>
          <p className="text-sm text-muted-foreground">You don&apos;t have permission to view this page.</p>
        </div>
      </div>
    );
  }

  const list = sandboxes ?? [];

  async function handleDelete() {
    if (!confirmDelete) return;
    try {
      await deleteMutation.mutateAsync(confirmDelete.sandboxId);
      toast.success(`Deleted sandbox ${confirmDelete.sandboxId.slice(0, 8)}`, {
        description: confirmDelete.provider === 'hetzner'
          ? 'Removed from DB and Hetzner server deleted.'
          : 'Removed from DB.',
      });
    } catch (err: any) {
      toast.error('Failed to delete sandbox', { description: err.message });
    }
    setConfirmDelete(null);
  }

  const providerCounts = list.reduce<Record<string, number>>((acc, s) => {
    const p = s.provider ?? 'unknown';
    acc[p] = (acc[p] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Server className="h-6 w-6" />
              All Sandboxes
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              View and manage all sandbox instances across all accounts
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Summary cards */}
            <div className="bg-foreground/[0.04] border border-foreground/[0.08] rounded-lg px-4 py-2 text-center min-w-[80px]">
              <p className="text-lg font-semibold">{list.length}</p>
              <p className="text-[11px] text-muted-foreground">Total</p>
            </div>
            {Object.entries(providerCounts).map(([provider, count]) => (
              <div key={provider} className="bg-foreground/[0.04] border border-foreground/[0.08] rounded-lg px-4 py-2 text-center min-w-[80px]">
                <p className="text-lg font-semibold">{count}</p>
                <p className="text-[11px] text-muted-foreground capitalize">{provider}</p>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Server className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No sandboxes found</p>
          </div>
        ) : (
          <div className="border border-foreground/[0.08] rounded-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[120px]">ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[140px]">External ID</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead className="text-right w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((sandbox) => (
                  <TableRow key={sandbox.sandboxId} className="group">
                    <TableCell className="font-mono text-xs text-muted-foreground" title={sandbox.sandboxId}>
                      {sandbox.sandboxId.slice(0, 8)}
                    </TableCell>
                    <TableCell className="font-medium text-sm">
                      {sandbox.name ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-sm capitalize">
                      {sandbox.provider ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={sandbox.status} />
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground" title={sandbox.externalId ?? undefined}>
                      {sandbox.externalId ? sandbox.externalId.toString().slice(0, 10) + '…' : '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground" title={sandbox.accountId ?? undefined}>
                      {sandbox.accountId ? sandbox.accountId.slice(0, 8) + '…' : '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(sandbox.createdAt)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(sandbox.lastUsedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-red-500 hover:text-red-500 hover:bg-red-500/10"
                        onClick={() => setConfirmDelete(sandbox)}
                        title="Delete sandbox"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Confirm delete dialog */}
      <Dialog open={!!confirmDelete} onOpenChange={() => setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Sandbox</DialogTitle>
            <DialogDescription>
              This will permanently delete sandbox{' '}
              <span className="font-mono text-foreground">{confirmDelete?.sandboxId.slice(0, 8)}</span>
              {confirmDelete?.provider === 'hetzner' && ' and terminate the Hetzner server'}.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {confirmDelete && (
            <div className="bg-foreground/[0.04] border border-foreground/[0.08] rounded-lg px-4 py-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Name</span>
                <span>{confirmDelete.name ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Provider</span>
                <span className="capitalize">{confirmDelete.provider ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <span>{confirmDelete.status ?? '—'}</span>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)} disabled={deleteMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
