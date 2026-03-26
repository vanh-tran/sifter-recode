/**
 * Client-side API for invoices.
 * Fetches from /api/invoices (cookies sent automatically for same-origin).
 * Per SECURITY_GUIDE: data queries run on server; client calls Route Handlers.
 * Never use supabase.from() or Bearer tokens — use credentials: 'same-origin'.
 */

export interface InvoiceLineItem {
  id: string;
  line_number: number | null;
  code: string | null;
  description: string;
  qty: number | null;
  unit: string | null;
  rate: number | null;
  amount: number;
  charge_type: string | null;
}

export interface InvoiceReference {
  id: string;
  ref_type: string;
  ref_value: string;
}

export interface InvoiceDetail {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  currency: string;
  subtotal_amount: number | null;
  tax_amount: number | null;
  total_amount: number;
  payment_terms_text: string | null;
  ui_status: string;
  confidence_overall: number | null;
  is_duplicate: boolean;
  carrier: {
    id: string;
    name_raw: string;
    name_normalized: string;
    scac: string | null;
  };
  document: {
    id: string;
    filename: string;
    source_type: string;
    pdf_url: string | null;
  };
  line_items: InvoiceLineItem[];
  references: InvoiceReference[];
  findings: Record<string, unknown>[];
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  carrier_name: string;
  invoice_date: string;
  total_amount: number;
  currency: string;
  status: string;
  findings_count: number;
  finding_tags: string[];
  overcharge_amount: number;
  filename: string;
  created_at: string;
}

export interface InvoicesResponse {
  invoices: Invoice[];
  total: number;
  limit: number;
  offset: number;
}

export type InvoiceFilter =
  | 'all'
  | 'new'
  | 'reviewing'
  | 'action_needed'
  | 'cleared'
  | 'archived';

export async function fetchInvoices(
  filter: InvoiceFilter,
  page: number = 0,
  limit: number = 25,
  opts?: { tag?: string; sort?: 'overcharge_desc' | 'created_desc' }
): Promise<InvoicesResponse> {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('offset', String(page * limit));
  if (filter !== 'all') {
    params.set('status', filter);
  }
  if (opts?.tag) {
    params.set('tag', opts.tag);
  }
  if (opts?.sort) {
    params.set('sort', opts.sort);
  }

  const response = await fetch(`/api/invoices?${params.toString()}`, {
    credentials: 'same-origin', // cookies sent for auth (server reads them)
    cache: 'no-store', // SECURITY: prevent browser from serving cached data after org switch
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string })?.error || `Failed to fetch invoices: ${response.statusText}`
    );
  }

  return response.json();
}

/**
 * Fetch a single invoice by ID.
 * Uses credentials: 'same-origin' — cookies sent for auth (server reads them).
 */
export async function fetchInvoice(invoiceId: string): Promise<InvoiceDetail> {
  const response = await fetch(`/api/invoices/${invoiceId}`, {
    credentials: 'same-origin',
    cache: 'no-store', // SECURITY: prevent browser from serving cached data after org switch
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const message =
      response.status === 404
        ? 'Invoice not found'
        : (err as { error?: string })?.error || 'Failed to fetch invoice';
    throw new Error(message);
  }

  return response.json();
}
