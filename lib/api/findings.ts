/**
 * Client-side API for findings.
 * Fetches from /api/findings (cookies sent automatically for same-origin).
 * Per SECURITY_GUIDE: data queries run on server; client calls Route Handlers.
 */

export type FindingsFilter = 'all' | 'high-confidence' | 'medium-confidence';

export interface FindingInvoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  total_amount: number;
  carriers?: { name_normalized: string };
}

export interface Finding {
  id: string;
  invoice_id: string;
  leak_type: string;
  rule_id: string;
  severity: string;
  confidence: number | null;
  expected_amount: number | null;
  charged_amount: number | null;
  delta_amount: number;
  delta_percent: number | null;
  estimated_savings: number | null;
  summary: string;
  created_at: string;
  invoices: FindingInvoice;
}

export interface FindingsResponse {
  findings: Finding[];
  total: number;
  limit: number;
  offset: number;
  summary?: { total_savings: number };
}

export async function fetchFindings(
  filter: FindingsFilter = 'all',
  limit: number = 25,
  offset: number = 0
): Promise<FindingsResponse> {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('offset', String(offset));

  if (filter === 'all') {
    params.set('min_confidence', '0'); // No floor: show all findings
  } else if (filter === 'high-confidence') {
    params.set('min_confidence', '0.9'); // 0.9+
  } else if (filter === 'medium-confidence') {
    params.set('min_confidence', '0.7');
    params.set('max_confidence', '0.9'); // 0.7 <= confidence < 0.9 (excludes high)
  }

  const response = await fetch(`/api/findings?${params.toString()}`, {
    credentials: 'same-origin',
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string })?.error ||
        `Failed to fetch findings: ${response.statusText}`
    );
  }

  return response.json();
}
