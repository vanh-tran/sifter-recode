/**
 * GET /api/invoices/[id]
 *
 * Get invoice detail with line items, references, and findings.
 * Uses org_id from JWT claims for scoping.
 */

import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { generatePresignedUrl } from '@/lib/server/gcs-presigned';
import { isValidUuid } from '@/lib/utils';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const supabase = await createClient();
    const authContext = await getAuthOrgContext(supabase);
    if (!authContext) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { orgId } = authContext;

    // Handle both sync and async params (Next.js 15+ compatibility)
    const resolvedParams = 'then' in params ? await params : params;
    const invoiceId = resolvedParams.id;

    if (!isValidUuid(invoiceId)) {
      return NextResponse.json({ error: 'Invalid invoice ID' }, { status: 400 });
    }

    // Get invoice (scoped by org_id from JWT)
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select(`
        *,
        carriers (
          id,
          name_raw,
          name_normalized,
          scac
        ),
        documents (
          id,
          filename,
          gcs_key,
          source_type
        )
      `)
      .eq('id', invoiceId)
      .eq('org_id', orgId)
      .single();

    if (invoiceError || !invoice) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      );
    }

    // Get line items
    const { data: lineItems, error: lineItemsError } = await supabase
      .from('invoice_line_items')
      .select('*')
      .eq('invoice_id', invoiceId)
      .eq('org_id', orgId)
      .order('line_number', { ascending: true });

    if (lineItemsError) {
      console.error('Error fetching line items:', lineItemsError);
    }

    // Get references
    const { data: references, error: referencesError } = await supabase
      .from('invoice_references')
      .select('*')
      .eq('invoice_id', invoiceId)
      .eq('org_id', orgId);

    if (referencesError) {
      console.error('Error fetching references:', referencesError);
    }

    // Get findings
    const { data: findings, error: findingsError } = await supabase
      .from('findings')
      .select(`
        id,
        leak_type,
        rule_id,
        severity,
        confidence,
        expected_amount,
        charged_amount,
        delta_amount,
        delta_percent,
        estimated_savings,
        summary,
        reasoning,
        evidence_json,
        proof_required,
        proof_provided,
        proof_type,
        required_proof_description,
        is_approved,
        approved_by,
        approved_at,
        created_at
      `)
      .eq('invoice_id', invoiceId)
      .eq('org_id', orgId)
      .order('confidence', { ascending: false, nullsFirst: false });

    if (findingsError) {
      console.error('Error fetching findings:', findingsError);
    }

    // Generate presigned URL for PDF (handle both single object and array from relation)
    let pdfUrl: string | null = null;
    const docs = invoice.documents as
      | { id?: string; filename?: string; gcs_key?: string; source_type?: string }
      | { id?: string; filename?: string; gcs_key?: string; source_type?: string }[]
      | null;
    const doc = Array.isArray(docs) ? docs[0] : docs;
    const gcsKey = doc?.gcs_key;
    if (gcsKey) {
      try {
        pdfUrl = await generatePresignedUrl(gcsKey, orgId, 15);
      } catch (error) {
        console.error('Error generating presigned URL:', error);
        // Don't fail the request if PDF URL generation fails
      }
    }

    // Format response
    const response = {
      id: invoice.id,
      invoice_number: invoice.invoice_number,
      invoice_date: invoice.invoice_date,
      due_date: invoice.due_date,
      currency: invoice.currency,
      subtotal_amount: invoice.subtotal_amount,
      tax_amount: invoice.tax_amount,
      total_amount: invoice.total_amount,
      payment_terms_text: invoice.payment_terms_text,
      ui_status: invoice.ui_status,
      confidence_overall: invoice.confidence_overall,
      is_duplicate: invoice.is_duplicate,
      duplicate_of_invoice_id: invoice.duplicate_of_invoice_id,
      carrier: {
        id: (invoice.carriers as any)?.id,
        name_raw: (invoice.carriers as any)?.name_raw,
        name_normalized: (invoice.carriers as any)?.name_normalized,
        scac: (invoice.carriers as any)?.scac,
      },
      document: {
        id: doc?.id,
        filename: doc?.filename,
        source_type: doc?.source_type,
        pdf_url: pdfUrl,
      },
      line_items: lineItems || [],
      references: references || [],
      findings: findings || [],
      created_at: invoice.created_at,
      updated_at: invoice.updated_at,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error in GET /api/invoices/[id]:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

