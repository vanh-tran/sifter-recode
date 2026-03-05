/**
 * GET /api/invoices/[id]/pdf
 * 
 * Generate presigned URL for invoice PDF
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { generatePresignedUrl } from '@/lib/server/gcs-presigned';
import { isValidUuid } from '@/lib/utils';

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

    // Get invoice (scoped by org_id from JWT — no separate membership check needed)
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select(`
        documents (
          gcs_key
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

    // Get GCS key (handle both single object and array from relation)
    const docs = invoice.documents as { gcs_key?: string } | { gcs_key?: string }[] | null;
    const doc = Array.isArray(docs) ? docs[0] : docs;
    const gcsKey = doc?.gcs_key;
    if (!gcsKey) {
      return NextResponse.json(
        { error: 'PDF not found' },
        { status: 404 }
      );
    }

    // Generate presigned URL (cap expires to 1–60 min to prevent abuse)
    const raw = parseInt(
      request.nextUrl.searchParams.get('expires') || '15',
      10
    );
    const expiresInMinutes = Math.min(
      Math.max(Number.isNaN(raw) ? 15 : raw, 1),
      60
    );

    const pdfUrl = await generatePresignedUrl(gcsKey, orgId, expiresInMinutes);

    return NextResponse.json({
      pdf_url: pdfUrl,
      expires_in_minutes: expiresInMinutes,
    });
  } catch (error) {
    console.error('Error in GET /api/invoices/[id]/pdf:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}