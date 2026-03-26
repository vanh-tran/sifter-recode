/**
 * Inngest webhook endpoint.
 * Configure in Inngest dashboard: https://your-domain.com/api/inngest
 *
 * Auth model differs from app JSON APIs: Inngest Cloud validates requests using
 * signing keys / dev server handshake — not Supabase JWT. Do not use this handler
 * for tenant data without an explicit verification step inside a function.
 */
import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { inngestFunctions } from '@/lib/inngest/functions';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: inngestFunctions,
});
