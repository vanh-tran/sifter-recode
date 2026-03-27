import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { requirePermission } from '@/lib/server/rbac';
import { Storage } from '@google-cloud/storage';
import { randomUUID } from 'crypto';

const storage = new Storage();
const BUCKET = process.env.GCS_BUCKET_NAME!;
const NO_CACHE = { 'Cache-Control': 'no-store, must-revalidate' };

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: carrierId } = await params;
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const forbidden = requirePermission(ctx.role, 'carriers:manage');
  if (forbidden) return forbidden;

  // Verify carrier belongs to org
  const { data: carrier } = await supabase
    .from('carriers')
    .select('id')
    .eq('id', carrierId)
    .eq('org_id', ctx.orgId)
    .maybeSingle();
  if (!carrier) return NextResponse.json({ error: 'Carrier not found' }, { status: 404 });

  // Parse multipart form
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  if (!file || file.type !== 'application/pdf') {
    return NextResponse.json({ error: 'A PDF file is required' }, { status: 400 });
  }

  const fileId = randomUUID();
  const gcsKey = `orgs/${ctx.orgId}/rate-sheets/${carrierId}/${fileId}.pdf`;
  const buffer = Buffer.from(await file.arrayBuffer());

  // Upload to GCS
  try {
    await storage.bucket(BUCKET).file(gcsKey).save(buffer, {
      metadata: { contentType: 'application/pdf' },
    });
  } catch (err) {
    console.error('GCS upload error:', err);
    return NextResponse.json({ error: 'Upload to storage failed' }, { status: 500 });
  }

  // Create document record
  const { data: document, error: docError } = await supabase
    .from('documents')
    .insert({
      org_id: ctx.orgId,
      source_type: 'upload',
      filename: file.name,
      mime_type: 'application/pdf',
      file_size_bytes: file.size,
      gcs_key: gcsKey,
      sha256: '',
      document_type: 'OTHER',
      processing_status: 'completed',
    })
    .select('id')
    .single();

  if (docError || !document) {
    console.error('Document insert error:', docError);
    return NextResponse.json({ error: 'Failed to create document record' }, { status: 500 });
  }

  // Mark previous current rate sheets as superseded
  await supabase
    .from('rate_sheets')
    .update({ status: 'superseded' })
    .eq('carrier_id', carrierId)
    .eq('org_id', ctx.orgId)
    .eq('status', 'current');

  // Insert new rate sheet
  const { data: rateSheet, error: rsError } = await supabase
    .from('rate_sheets')
    .insert({
      org_id: ctx.orgId,
      carrier_id: carrierId,
      document_id: document.id,
      effective_date: null,
      status: 'current',
    })
    .select('id')
    .single();

  if (rsError || !rateSheet) {
    console.error('Rate sheet insert error:', rsError);
    return NextResponse.json({ error: 'Failed to create rate sheet record' }, { status: 500 });
  }

  return NextResponse.json({ rate_sheet_id: rateSheet.id }, { status: 201, headers: NO_CACHE });
}
