'use client';

import { findingTypeToLabel } from '@/lib/finding-type-labels';

type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

interface Finding {
  id: string;
  finding_type: string;
  source: 'deterministic' | 'ai_audit';
  severity: Severity;
  summary: string;
  description_edited: string | null;
  delta_amount: number;
  amount_edited: number | null;
  confidence?: number;
  proof_clip_urls: { finding_id: string; url: string }[];
}

export default function FindingsList({
  findings,
  selectedIds,
  onToggle,
}: {
  findings: Finding[];
  selectedIds: string[];
  onToggle: (findingId: string, checked: boolean) => void;
}) {
  const severityColors: Record<Severity, string> = {
    info: 'bg-blue-100 text-blue-800',
    low: 'bg-yellow-100 text-yellow-800',
    medium: 'bg-orange-100 text-orange-800',
    high: 'bg-red-100 text-red-800',
    critical: 'bg-red-200 text-red-900',
  };

  const formatAmount = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

  return (
    <div className="space-y-3">
      {findings.map((f) => {
        const checked = selectedIds.includes(f.id);
        const displayText = f.description_edited ?? f.summary;
        const displayAmount = f.amount_edited ?? f.delta_amount;

        return (
          <div
            key={f.id}
            className={`rounded-lg border p-4 transition-colors ${checked ? 'border-brand-accent bg-brand-surface' : 'border-brand-border bg-brand-background'}`}
          >
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onToggle(f.id, e.target.checked)}
                className="mt-1 h-4 w-4 cursor-pointer"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-brand-primary">
                    {findingTypeToLabel(f.finding_type)}
                  </span>
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${severityColors[f.severity]}`}>
                    {f.severity}
                  </span>
                  <span className="ml-auto text-sm font-semibold text-pastel-rose-text">
                    {formatAmount(displayAmount)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-brand-muted">{displayText}</p>
                {f.proof_clip_urls.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {f.proof_clip_urls.map((clip) => (
                      <a
                        key={clip.url}
                        href={clip.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-brand-accent underline"
                      >
                        View proof
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
