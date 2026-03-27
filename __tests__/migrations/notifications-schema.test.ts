// tests/migrations/notifications-schema.test.ts
import { createClient } from '@/lib/supabase/server';

describe('notifications table', () => {
  it('notifications table exists with correct columns', async () => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('notifications')
      .select('id, org_id, user_id, type, title, body, invoice_id, read, created_at')
      .limit(0);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('organizations has onboarding_completed column', async () => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('organizations')
      .select('onboarding_completed')
      .limit(0);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
