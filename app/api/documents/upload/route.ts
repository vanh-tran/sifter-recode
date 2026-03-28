import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { Storage } from '@google-cloud/storage';
import { createHash, randomUUID } from 'crypto';
import { phase1Queue } from '@sifter/core/queue/index';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'file required' }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const id = randomUUID();
  const gcsKey = `orgs/${ctx.orgId}/documents/${id}.pdf`;

  const storage = new Storage();
  await storage.bucket(process.env.GCS_BUCKET!).file(gcsKey).save(buf, { contentType: 'application/pdf' });

  const { error } = await supabase.from('documents').insert({
    id,
    org_id: ctx.orgId,
    source_type: 'upload',
    filename: 'upload.pdf',
    mime_type: 'application/pdf',
    file_size_bytes: buf.length,
    gcs_key: gcsKey,
    sha256,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await phase1Queue.add(
    `phase1-${id}`,
    { orgId: ctx.orgId, documentId: id, gcsKey, sourceType: 'upload' },
    { jobId: `phase1-${id}` }
  );

  return NextResponse.json({ documentId: id });
}
