'use client';

import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertCircle,
  RefreshCw,
  CreditCard,
  Zap,
  ArrowDownCircle,
  RotateCcw,
  CalendarSync,
  Clock,
  ChevronLeft,
  ChevronRight,
  Receipt,
  Wallet,
} from 'lucide-react';
import { useTransactions } from '@/hooks/billing/use-transactions';
import { cn } from '@/lib/utils';
import { creditsToDollars, formatCredits } from '@kortix/shared';

type FilterTab = 'all' | 'topups' | 'subscription' | 'refunds';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDollars(creditsAsDisplayed: number): string {
  const dollars = Math.abs(creditsToDollars(creditsAsDisplayed));
  if (dollars === 0) return '$0.00';
  if (dollars < 0.01) return `< $0.01`;
  return `$${dollars.toFixed(2)}`;
}

// ─── Transaction type config ─────────────────────────────────────────────────

interface TypeConfig {
  label: string;
  icon: React.ElementType;
  badgeClass: string;
  category: FilterTab;
  paymentLabel: string;
}

const TYPE_CONFIG: Record<string, TypeConfig> = {
  tier_grant: {
    label: 'Subscription',
    icon: CalendarSync,
    badgeClass: 'bg-sky-500/10 text-sky-600 border-sky-500/20',
    category: 'subscription',
    paymentLabel: 'Monthly plan',
  },
  daily_refresh: {
    label: 'Daily Refresh',
    icon: RotateCcw,
    badgeClass: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    category: 'all',
    paymentLabel: 'Refresh',
  },
  purchase: {
    label: 'Credit Top-up',
    icon: CreditCard,
    badgeClass: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    category: 'topups',
    paymentLabel: 'One-time top-up',
  },
  auto_topup: {
    label: 'Auto Top-up',
    icon: RotateCcw,
    badgeClass: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    category: 'topups',
    paymentLabel: 'Automatic top-up',
  },
  refund: {
    label: 'Refund',
    icon: ArrowDownCircle,
    badgeClass: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    category: 'refunds',
    paymentLabel: 'Refund',
  },
  adjustment: {
    label: 'Adjustment',
    icon: Zap,
    badgeClass: 'bg-muted text-muted-foreground border-border',
    category: 'all',
    paymentLabel: 'Adjustment',
  },
  expired: {
    label: 'Expired',
    icon: Clock,
    badgeClass: 'bg-red-500/10 text-red-600 border-red-500/20',
    category: 'all',
    paymentLabel: 'Expired',
  },
};

function getTypeConfig(type: string): TypeConfig {
  return (
    TYPE_CONFIG[type] ?? {
      label: type,
      icon: Receipt,
      badgeClass: 'bg-muted text-muted-foreground border-border',
      category: 'all' as FilterTab,
      paymentLabel: 'Payment',
    }
  );
}

const PAYMENT_TYPES = ['purchase', 'auto_topup', 'tier_grant', 'refund'] as const;

function isPaymentTransaction(type: string) {
  return PAYMENT_TYPES.includes(type as (typeof PAYMENT_TYPES)[number]);
}

// ─── Summary stats strip ─────────────────────────────────────────────────────

interface SummaryStatsProps {
  transactions: ReturnType<typeof useTransactions>['data'];
}

function SummaryStats({ transactions }: SummaryStatsProps) {
  const txList = (transactions?.transactions ?? []).filter((tx) => isPaymentTransaction(tx.type));

  const totalCreditsPurchased = txList
    .filter((t) => t.type === 'purchase' || t.type === 'auto_topup')
    .reduce((s, t) => s + t.amount, 0);

  const totalCharged = txList
    .filter((t) => t.type === 'purchase' || t.type === 'auto_topup')
    .reduce((s, t) => s + t.amount, 0);

  const recurringPayments = txList.filter((t) => t.type === 'tier_grant').length;

  return (
    <div className="mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
      {[
        {
          label: 'Charged',
          value: formatDollars(totalCharged),
          icon: Wallet,
          cls: 'text-emerald-500',
        },
        {
          label: 'Credits Added',
          value: formatCredits(totalCreditsPurchased),
          icon: CreditCard,
          cls: 'text-sky-500',
        },
        {
          label: 'Subscription Charges',
          value: recurringPayments.toString(),
          icon: CalendarSync,
          cls: 'text-primary',
        },
      ].map((stat) => {
        const Icon = stat.icon;
        return (
          <div
            key={stat.label}
            className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/70 px-3.5 py-3"
          >
            <div className={cn('rounded-lg bg-muted p-1.5', stat.cls)}>
              <Icon className="h-3.5 w-3.5" />
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">{stat.label}</p>
              <p className="text-sm font-semibold tabular-nums">{stat.value}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const LIMIT = 50;

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'topups', label: 'Top-ups' },
  { id: 'subscription', label: 'Subscription' },
  { id: 'refunds', label: 'Refunds' },
];

export default function BillingHistory() {
  const [tab, setTab] = useState<FilterTab>('all');
  const [offset, setOffset] = useState(0);

  const { data, isLoading, error, refetch } = useTransactions(
    LIMIT,
    offset,
    [...PAYMENT_TYPES],
  );

  const allTx = (data?.transactions ?? []).filter((tx) => isPaymentTransaction(tx.type));

  const transactions = allTx.filter((tx) => {
    if (tab === 'all') return true;
    const config = getTypeConfig(tx.type);
    if (tab === 'topups') return config.category === 'topups';
    if (tab === 'subscription') return config.category === 'subscription';
    if (tab === 'refunds') return config.category === 'refunds';
    return true;
  });

  const handleTabChange = (newTab: FilterTab) => {
    setTab(newTab);
    setOffset(0);
  };

  // ── Loading skeleton ──
  if (isLoading && offset === 0) {
    return (
      <div className="space-y-4">
        {/* Stats skeleton */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
        {/* Table skeleton */}
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          {(error as Error).message || 'Failed to load billing history'}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary stats for the visible data (full 50-item page) */}
      <SummaryStats transactions={data} />

      {/* Filter tabs + refresh */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1">
          {FILTER_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => handleTabChange(t.id)}
              className={cn(
                'cursor-pointer rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                tab === t.id
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={() => refetch()}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Table */}
      {transactions.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 py-10 text-center">
          <Receipt className="h-8 w-8 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">No billing events found</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            {tab !== 'all'
              ? 'Try switching to "All" to see your full payment history'
              : 'Subscription renewals, top-ups, and refunds will show up here'}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-border/70 bg-card/30">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="hover:bg-transparent border-b border-border">
                  <TableHead className="w-[150px] px-3 text-[11px] font-medium text-muted-foreground">
                    Date
                  </TableHead>
                  <TableHead className="w-[140px] px-3 text-[11px] font-medium text-muted-foreground">
                    Payment
                  </TableHead>
                  <TableHead className="px-3 text-[11px] font-medium text-muted-foreground">
                    Details
                  </TableHead>
                  <TableHead className="w-[110px] px-3 text-right text-[11px] font-medium text-muted-foreground">
                    Amount
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx, idx) => {
                  const config = getTypeConfig(tx.type);
                  const Icon = config.icon;
                  const isRefund = tx.type === 'refund';

                  return (
                    <TableRow
                      key={tx.id}
                      className={cn(
                        'group transition-colors',
                        idx % 2 === 1 ? 'bg-muted/20' : 'bg-transparent',
                      )}
                    >
                      <TableCell className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground">
                        {formatDate(tx.created_at)}
                      </TableCell>

                      <TableCell className="px-3 py-2.5 align-top">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium',
                            config.badgeClass,
                          )}
                        >
                          <Icon className="h-3 w-3 flex-shrink-0" />
                          {config.label}
                        </span>
                      </TableCell>

                      <TableCell className="px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-foreground/90">{config.paymentLabel}</p>
                          <p className="line-clamp-2 whitespace-normal break-words text-[11px] text-muted-foreground">
                            {tx.description || '—'}
                          </p>
                        </div>
                      </TableCell>

                      <TableCell className="px-3 py-2.5 text-right align-top">
                        <span
                          className={cn(
                            'font-mono text-xs font-semibold tabular-nums',
                            isRefund ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground',
                          )}
                        >
                          {isRefund ? '+' : ''}
                          {formatDollars(tx.amount)}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                          {formatCredits(Math.abs(tx.amount))} credits
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {data?.pagination && (
            <div className="flex items-center justify-between pt-1">
              <p className="text-xs text-muted-foreground">
                Showing {offset + 1}–
                {Math.min(offset + LIMIT, data.pagination.total)} of{' '}
                {data.pagination.total} billing events
              </p>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                  disabled={offset === 0}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setOffset(offset + LIMIT)}
                  disabled={!data.pagination.has_more}
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
