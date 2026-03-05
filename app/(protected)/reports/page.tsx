'use client';

import { useState } from 'react';
import Header from '@/app/components/Header';
import { useAuth } from '@/app/components/AuthProvider';
import { useOrg } from '@/app/components/OrgProvider';

function RecentReportsSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading recent reports">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex items-center justify-between rounded-md border border-brand-border bg-brand-surface p-4"
        >
          <div className="flex-1">
            <div className="mb-2 h-4 w-48 animate-pulse rounded bg-brand-surface-muted" />
            <div className="h-3 w-36 animate-pulse rounded bg-brand-surface-muted" />
          </div>
          <div className="flex gap-2">
            <div className="h-8 w-16 animate-pulse rounded bg-brand-surface-muted" />
            <div className="h-8 w-24 animate-pulse rounded bg-brand-surface-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ReportsPage() {
  const { user } = useAuth();
  const orgId = useOrg();
  const [reportType, setReportType] = useState<'weekly' | 'custom'>('weekly');
  // When real data fetching is added: use enabled: !!user && !!orgId in useQuery
  const reportsLoading = false;

  return (
    <>
      <div className="min-h-screen bg-brand-background">
        <Header
          title="Reports"
          subtitle="Generate weekly Pay Run Reports and export findings for carrier disputes."
          action={{
            label: 'Generate Weekly Report',
            onClick: () => console.log('Generate report'),
          }}
        />

        <div className="page-transition mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Report Type Selection */}
        <div className="mb-8 rounded-lg border border-brand-border bg-brand-surface p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-brand-primary">Report Type</h3>
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Select report type"
          >
            <button
              type="button"
              onClick={() => setReportType('weekly')}
              aria-label="Weekly Pay Run Report"
              aria-pressed={reportType === 'weekly'}
              className={`rounded-md px-6 py-3 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-border-focus ${
                reportType === 'weekly'
                  ? 'btn-brand-primary'
                  : 'border border-brand-border bg-brand-surface-muted text-brand-primary hover:bg-brand-surface'
              }`}
            >
              Weekly Pay Run Report
            </button>
            <button
              type="button"
              onClick={() => setReportType('custom')}
              aria-label="Custom Date Range"
              aria-pressed={reportType === 'custom'}
              className={`rounded-md px-6 py-3 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-border-focus ${
                reportType === 'custom'
                  ? 'btn-brand-primary'
                  : 'border border-brand-border bg-brand-surface-muted text-brand-primary hover:bg-brand-surface'
              }`}
            >
              Custom Date Range
            </button>
          </div>
        </div>

        {/* Report Configuration */}
        {reportType === 'weekly' && (
          <div className="mb-8 rounded-lg border border-brand-border bg-brand-surface p-6 shadow-sm">
            <h3 className="mb-4 text-lg font-semibold text-brand-primary">
              Weekly Report Settings
            </h3>
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="week-ending"
                  className="mb-2 block text-sm font-medium text-brand-muted"
                >
                  Week Ending
                </label>
                <input
                  id="week-ending"
                  type="date"
                  className="input-brand w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-border-focus"
                  defaultValue={new Date().toISOString().split('T')[0]}
                  aria-label="Week ending date for the report"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="high-confidence"
                  type="checkbox"
                  className="rounded border-brand-border text-brand-primary focus:ring-2 focus:ring-brand-border-focus focus:ring-offset-2"
                />
                <label htmlFor="high-confidence" className="text-sm text-brand-muted">
                  Include only high-confidence findings (0.9+)
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="medium-confidence"
                  type="checkbox"
                  defaultChecked
                  className="rounded border-brand-border text-brand-primary focus:ring-2 focus:ring-brand-border-focus focus:ring-offset-2"
                />
                <label htmlFor="medium-confidence" className="text-sm text-brand-muted">
                  Include medium-confidence findings (0.7-0.89)
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="email-ap"
                  type="checkbox"
                  defaultChecked
                  className="rounded border-brand-border text-brand-primary focus:ring-2 focus:ring-brand-border-focus focus:ring-offset-2"
                />
                <label htmlFor="email-ap" className="text-sm text-brand-muted">
                  Email report to AP team
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Recent Reports */}
        <div className="rounded-lg border border-brand-border bg-brand-surface p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-brand-primary">Recent Reports</h3>
          {reportsLoading ? (
            <RecentReportsSkeleton />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-md border border-brand-border bg-brand-surface-muted p-4">
                <div>
                  <p className="text-sm font-medium text-brand-primary">
                    Weekly Report - Week of Jan 15, 2024
                  </p>
                  <p className="mt-1 text-xs text-brand-muted">
                    Generated on Jan 22, 2024 at 9:00 AM
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="link-brand rounded-md px-3 py-1 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-border-focus"
                    aria-label="View Weekly Report - Week of Jan 15, 2024"
                  >
                    View
                  </button>
                  <button
                    type="button"
                    className="rounded-md px-3 py-1 text-sm font-medium text-brand-muted transition-colors hover:text-brand-primary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-border-focus"
                    aria-label="Download Weekly Report as CSV"
                  >
                    Download CSV
                  </button>
                </div>
              </div>
              <div className="py-8 text-center text-brand-muted">
                <div className="mb-2 text-3xl" aria-hidden>📊</div>
                <p className="text-sm">No other reports found.</p>
              </div>
            </div>
          )}
        </div>

        {/* Summary Stats */}
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 md:gap-6">
          <div className="rounded-lg border border-brand-border bg-brand-surface p-6 shadow-sm">
            <p className="mb-1 text-sm font-medium text-brand-muted">
              Total Findings This Week
            </p>
            <p className="text-2xl font-bold tabular-nums text-brand-primary">0</p>
          </div>
          <div className="rounded-lg border border-brand-border bg-brand-surface p-6 shadow-sm">
            <p className="mb-1 text-sm font-medium text-brand-muted">Estimated Savings</p>
            <p className="text-2xl font-bold tabular-nums text-brand-success">$0</p>
          </div>
          <div className="rounded-lg border border-brand-border bg-brand-surface p-6 shadow-sm">
            <p className="mb-1 text-sm font-medium text-brand-muted">Invoices Processed</p>
            <p className="text-2xl font-bold tabular-nums text-brand-primary">0</p>
          </div>
        </div>
        </div>
      </div>
    </>
  );
}
