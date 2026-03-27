/**
 * POST /api/invoices/:id/disputes/generate
 *
 * Generate dispute PDF document from approved findings.
 * Uses org_id from JWT claims for scoping.
 */

import { createClient } from '@/lib/supabase/server';
import { generateDisputePdf } from '@/lib/pdf/generateDisputePdf';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { requirePermission } from '@/lib/server/rbac';
import { generatePresignedUrl } from '@/lib/server/gcs-presigned';
import { isValidUuid } from '@/lib/utils';
import { NextRequest, NextResponse } from 'next/server';

const MAX_APPROVED_FINDINGS_PER_REQUEST = 100;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const supabase = await createClient();
    const authContext = await getAuthOrgContext(supabase);
    if (!authContext) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { orgId, userId, role } = authContext;

    const denied = requirePermission(role, 'disputes:create');
    if (denied) return denied;

    // Handle both sync and async params (Next.js 15+ compatibility)
    const resolvedParams = 'then' in params ? await params : params;
    const invoiceId = resolvedParams.id;

    if (!isValidUuid(invoiceId)) {
      return NextResponse.json({ error: 'Invalid invoice ID' }, { status: 400 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { approved_finding_ids, recipient_email, recipient_name } = body;

    if (!approved_finding_ids || !Array.isArray(approved_finding_ids) || approved_finding_ids.length === 0) {
      return NextResponse.json(
        { error: 'approved_finding_ids is required and must be a non-empty array' },
        { status: 400 }
      );
    }
    if (approved_finding_ids.length > MAX_APPROVED_FINDINGS_PER_REQUEST) {
      return NextResponse.json(
        { error: `A maximum of ${MAX_APPROVED_FINDINGS_PER_REQUEST} approved findings can be included` },
        { status: 400 }
      );
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

    // Get approved findings
    const { data: findings, error: findingsError } = await supabase
      .from('findings')
      .select(`
        id,
        finding_type,
        rule_id,
        summary,
        reasoning,
        expected_amount,
        charged_amount,
        delta_amount,
        estimated_savings,
        evidence_json,
        proof_required,
        required_proof_description
      `)
      .eq('invoice_id', invoiceId)
      .eq('org_id', orgId)
      .in('id', approved_finding_ids)
      .eq('is_approved', true); // Only include approved findings

    if (findingsError) {
      console.error('Error fetching findings:', findingsError);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    if (!findings || findings.length === 0) {
      return NextResponse.json(
        { error: 'No approved findings found for the provided IDs' },
        { status: 400 }
      );
    }

    // Verify all requested findings are approved
    const foundIds = findings.map(f => f.id);
    const missingIds = approved_finding_ids.filter(id => !foundIds.includes(id));
    if (missingIds.length > 0) {
      return NextResponse.json(
        { error: `Some findings are not approved or not found: ${missingIds.join(', ')}` },
        { status: 400 }
      );
    }

    // Get organization data
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id, name')
      .eq('id', orgId)
      .single();

    if (orgError || !org) {
      return NextResponse.json(
        { error: 'Organization not found' },
        { status: 404 }
      );
    }

    // Generate PDF
    const gcsKey = await generateDisputePdf(
      {
        invoice_number: invoice.invoice_number,
        invoice_date: invoice.invoice_date,
        carrier: {
          name_normalized: (invoice.carriers as any)?.name_normalized || 'Unknown',
          name_raw: (invoice.carriers as any)?.name_raw,
          scac: (invoice.carriers as any)?.scac,
        },
        currency: invoice.currency,
        total_amount: invoice.total_amount,
      },
      findings.map(f => ({
        id: f.id,
        leak_type: f.finding_type,
        rule_id: f.rule_id,
        summary: f.summary,
        reasoning: f.reasoning,
        expected_amount: f.expected_amount,
        charged_amount: f.charged_amount,
        delta_amount: f.delta_amount,
        estimated_savings: f.estimated_savings,
        evidence_json: f.evidence_json,
        proof_required: f.proof_required,
        required_proof_description: f.required_proof_description,
      })),
      {
        id: org.id,
        name: org.name,
      }
    );

    // Create dispute_documents record
    const filename = `dispute-${invoice.invoice_number}-${new Date().toISOString().split('T')[0]}.pdf`;
    const { data: disputeDocument, error: disputeError } = await supabase
      .from('dispute_documents')
      .insert({
        org_id: orgId,
        invoice_id: invoiceId,
        filename,
        gcs_key: gcsKey,
        status: 'generated',
        recipient_email: recipient_email || null,
        recipient_name: recipient_name || null,
        generated_findings: approved_finding_ids,
        created_by: userId,
      })
      .select()
      .single();

    if (disputeError) {
      console.error('Error creating dispute document:', disputeError);
      // PDF was generated, but we couldn't save the record
      // Still return success with the GCS key
      return NextResponse.json({
        dispute_document: null,
        gcs_key: gcsKey,
        warning: 'PDF generated but database record creation failed',
      });
    }

    // Generate presigned URL for download (15 minutes expiry)
    let pdfUrl: string | null = null;
    try {
      pdfUrl = await generatePresignedUrl(gcsKey, orgId, 15);
    } catch (error) {
      console.error('Error generating presigned URL:', error);
      // Don't fail the request if presigned URL generation fails
    }

    return NextResponse.json({
      dispute_document: disputeDocument,
      gcs_key: gcsKey,
      pdf_url: pdfUrl,
    });
  } catch (error) {
    console.error('Error generating dispute PDF:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
