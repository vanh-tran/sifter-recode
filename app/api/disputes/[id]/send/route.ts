import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { requirePermission } from '@/lib/server/rbac';
import { assertTransition, type DisputeStatus } from '@/lib/disputes/state-machine';
import { sendDisputeEmail } from '@/lib/email/send-dispute';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const authContext = await getAuthOrgContext(supabase);
    if (!authContext) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { orgId, role, userId } = authContext;
    const denied = requirePermission(role, 'disputes:create');
    if (denied) return denied;

    const resolvedParams = await params;
    const disputeId = resolvedParams.id;

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(disputeId)) {
      return NextResponse.json({ error: 'Invalid dispute ID' }, { status: 400 });
    }

    const { data: dispute, error: disputeError } = await supabase
      .from('disputes')
      .select('*, invoices(invoice_number)')
      .eq('id', disputeId)
      .eq('org_id', orgId)
      .single();

    if (disputeError || !dispute) {
      return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    }

    // State machine guard
    try {
      assertTransition(dispute.status as DisputeStatus, 'sent');
    } catch {
      return NextResponse.json(
        { error: `Invalid transition: cannot send from status '${dispute.status}'` },
        { status: 422 }
      );
    }

    // Letter must be non-empty
    if (!dispute.draft_letter?.trim()) {
      return NextResponse.json(
        { error: 'Cannot send: dispute letter is empty. Please generate a letter first.' },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const recipientEmail: string = body.recipient_email ?? dispute.recipient_email;
    if (!recipientEmail) {
      return NextResponse.json({ error: 'Recipient email is required' }, { status: 400 });
    }

    // Check billing_email_confirmed
    const { data: invRow } = await supabase
      .from('invoices')
      .select('carrier_id, carriers(billing_email, billing_email_confirmed)')
      .eq('id', dispute.invoice_id)
      .eq('org_id', orgId)
      .single();
    const carrierRow = invRow?.carriers as { billing_email?: string | null; billing_email_confirmed?: boolean } | null;
    if (
      carrierRow?.billing_email &&
      recipientEmail.toLowerCase() === carrierRow.billing_email.toLowerCase() &&
      !carrierRow.billing_email_confirmed
    ) {
      return NextResponse.json(
        { error: 'BILLING_EMAIL_UNCONFIRMED', carrier_id: invRow?.carrier_id },
        { status: 409 }
      );
    }

    const invoiceNumber = (dispute.invoices as { invoice_number?: string } | null)?.invoice_number ?? 'Unknown';
    const subject = body.subject ?? `Freight Invoice Dispute — Invoice ${invoiceNumber}`;

    let sendResult;
    try {
      sendResult = await sendDisputeEmail({
        orgId,
        userId,
        toEmail: recipientEmail,
        toName: body.recipient_name ?? dispute.recipient_name ?? undefined,
        subject,
        body: dispute.draft_letter,
        inReplyToThreadId: dispute.email_thread_id ?? undefined,
      });
    } catch (sendError: unknown) {
      const msg = sendError instanceof Error ? sendError.message : 'Failed to send email';
      console.error('Email send failed:', sendError);
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    const now = new Date().toISOString();

    await supabase.from('dispute_messages').insert({
      org_id: orgId,
      dispute_id: disputeId,
      direction: 'outbound',
      from_email: null,
      to_emails: [recipientEmail],
      subject,
      body: dispute.draft_letter,
      email_message_id: sendResult.messageId,
      email_thread_id: sendResult.threadId,
      sent_at: now,
    });

    const updatePayload: Record<string, unknown> = {
      status: 'sent',
      recipient_email: recipientEmail,
      updated_at: now,
    };
    if (!dispute.email_thread_id) {
      updatePayload.email_thread_id = sendResult.threadId;
    }

    const { data: updated } = await supabase
      .from('disputes')
      .update(updatePayload)
      .eq('id', disputeId)
      .eq('org_id', orgId)
      .select()
      .single();

    return NextResponse.json({ dispute: updated, thread_id: sendResult.threadId });
  } catch (error) {
    console.error('Error in POST /api/disputes/:id/send:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
