'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/app/components/Header';
import { useAuth } from '@/app/components/AuthProvider';
import { useOrg } from '@/app/components/OrgProvider';
import { useQuery } from '@tanstack/react-query';
import {
  fetchFindings,
  type Finding,
  type FindingsFilter,
} from '@/lib/api/findings';
import { Badge, BadgeIndicator } from '@/app/components/ui/badge';

function FindingsSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading findings">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="rounded-lg border border-brand-border bg-brand-surface p-6 shadow-sm"
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="mb-3 flex flex-wrap gap-2">
                <div className="h-5 w-28 animate-pulse rounded-md bg-brand-surface-muted" />
                <div className="h-5 w-24 animate-pulse rounded-md bg-brand-surface-muted" />
                <div className="h-5 w-20 animate-pulse rounded-md bg-brand-surface-muted" />
              </div>
              <div className="mb-2 h-5 w-3/4 animate-pulse rounded bg-brand-surface-muted" />
              <div className="mb-3 h-4 w-full animate-pulse rounded bg-brand-surface-muted" />
              <div className="flex gap-4">
                <div className="h-4 w-24 animate-pulse rounded bg-brand-surface-muted" />
                <div className="h-4 w-24 animate-pulse rounded bg-brand-surface-muted" />
                <div className="h-4 w-20 animate-pulse rounded bg-brand-surface-muted" />
              </div>
            </div>
            <div className="h-8 w-24 animate-pulse rounded bg-brand-surface-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

function getSeverityBadgeVariant(
  severity: string
): 'blocked' | 'in-progress' | 'completed' {
  switch (severity) {
    case 'critical':
      return 'blocked';
    case 'high':
    case 'medium':
      return 'in-progress';
    case 'low':
    default:
      return 'completed';
  }
}

function getConfidenceBadgeVariant(
  confidence: number | null
): 'blocked' | 'in-progress' | 'completed' {
  const c = confidence ?? 0;
  if (c >= 0.9) return 'completed';
  if (c >= 0.7) return 'in-progress';
  return 'blocked';
}

function getLeakTypeLabel(leakType: string): string {
  const labels: Record<string, string> = {
    duplicate_invoice: 'Duplicate Invoice',
    fuel_surcharge_mismatch: 'Fuel Surcharge Mismatch',
    detention_violation: 'Detention Violation',
    lumper_without_receipt: 'Lumper Without Receipt',
    accessorial_without_proof: 'Accessorial Without Proof',
    calculation_error: 'Calculation Error',
  };
  return (
    labels[leakType] ??
    leakType.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
  );
}

export default function FindingsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const orgId = useOrg();
  const [filter, setFilter] = useState<FindingsFilter>('all');

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['findings', orgId, filter],
    queryFn: () => fetchFindings(filter),
    enabled: !!user && !!orgId,
  });

  const findings = data?.findings ?? [];
  const totalCount = data?.total ?? 0;
  const totalSavings = data?.summary?.total_savings ?? 0;
  const loading = isLoading || isFetching;

  const filterButtons = [
    { value: 'all' as const, label: 'All Findings', ariaLabel: 'Show all findings' },
    { value: 'high-confidence' as const, label: 'High Confidence (0.9+)', ariaLabel: 'Show high confidence findings (90% or more)' },
    { value: 'medium-confidence' as const, label: 'Medium Confidence (0.7-0.89)', ariaLabel: 'Show medium confidence findings (70-89%)' },
  ];

  return (
    <>
      <div className="min-h-screen bg-brand-background">
        <Header
          title="Audit Findings"
          subtitle="Review detected overcharges and discrepancies with confidence scores and evidence."
        />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Summary Stats */}
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-brand-border bg-brand-surface p-6 shadow-sm">
              <h3 className="text-sm font-medium text-brand-muted">Total Findings</h3>
              <p className="mt-1 text-2xl font-bold text-brand-charcoal tabular-nums">
                {totalCount}
              </p>
            </div>
            <div className="rounded-lg border border-brand-border bg-brand-surface p-6 shadow-sm">
              <h3 className="text-sm font-medium text-brand-muted">Estimated Savings</h3>
              <p className="mt-1 text-2xl font-bold text-brand-success tabular-nums">
                ${totalSavings.toFixed(2)}
              </p>
            </div>
          </div>

          {/* Filters */}
          <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Filter findings by confidence">
            {filterButtons.map(({ value, label, ariaLabel }) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                aria-label={ariaLabel}
                aria-pressed={filter === value}
                className={`rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-border-focus ${
                  filter === value
                    ? 'btn-brand-primary'
                    : 'bg-brand-surface text-brand-primary border border-brand-border hover:bg-brand-surface-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Findings List */}
          {loading ? (
            <FindingsSkeleton />
          ) : findings.length === 0 ? (
            <div className="rounded-lg border border-brand-border bg-brand-surface p-12 shadow-sm">
              <div className="py-8 text-center text-brand-muted">
                <div className="mb-4 text-4xl" aria-hidden>🔍</div>
                <p className="text-sm">No findings match your current filter.</p>
                <p className="mt-2 text-xs">
                  Findings will appear here as invoices are processed.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {findings.map((finding: Finding) => (
                <article
                  key={finding.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/invoices/${finding.invoice_id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      router.push(`/invoices/${finding.invoice_id}`);
                    }
                  }}
                  aria-label={`View finding: ${getLeakTypeLabel(finding.leak_type)} on invoice ${finding.invoices?.invoice_number ?? finding.invoice_id}`}
                  className="group cursor-pointer rounded-lg border border-brand-border bg-brand-surface p-6 shadow-sm transition-all duration-200 hover:border-brand-border-focus hover:shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-border-focus"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <Badge
                          className={`badge-${getSeverityBadgeVariant(finding.severity)}`}
                        >
                          <BadgeIndicator
                            variant={getSeverityBadgeVariant(finding.severity)}
                          />
                          {getLeakTypeLabel(finding.leak_type)}
                        </Badge>
                        <Badge
                          className={`badge-${getConfidenceBadgeVariant(finding.confidence)}`}
                        >
                          <BadgeIndicator
                            variant={getConfidenceBadgeVariant(finding.confidence)}
                          />
                          {((finding.confidence || 0) * 100).toFixed(0)}%
                          confidence
                        </Badge>
                        <Badge className="border border-brand-border bg-brand-surface-muted text-brand-muted">
                          {finding.rule_id.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                      <h3 className="mb-2 text-lg font-semibold text-brand-primary">
                        Invoice #{finding.invoices?.invoice_number} -{' '}
                        {finding.invoices?.carriers?.name_normalized ?? 'Unknown'}
                      </h3>
                      <p className="mb-4 text-sm leading-relaxed text-brand-muted">
                        {finding.summary}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-brand-muted">
                        {finding.estimated_savings != null &&
                          finding.estimated_savings > 0 && (
                            <span>
                              <span className="font-medium text-brand-charcoal">Est. Savings:</span>{' '}
                              <span className="text-brand-success">${finding.estimated_savings.toFixed(2)}</span>
                            </span>
                          )}
                        {finding.delta_amount !== 0 && (
                          <span>
                            <span className="font-medium text-brand-charcoal">Delta:</span> $
                            {finding.delta_amount.toFixed(2)}
                          </span>
                        )}
                        <span>
                          <span className="font-medium text-brand-charcoal">Date:</span>{' '}
                          {new Date(finding.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/invoices/${finding.invoice_id}`);
                        }}
                        className="rounded-md border border-brand-border bg-brand-surface px-3 py-1.5 text-sm font-medium text-brand-primary transition-colors hover:bg-brand-surface-muted focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-border-focus"
                        aria-label={`View invoice ${finding.invoices?.invoice_number ?? finding.invoice_id}`}
                      >
                        View Invoice
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
