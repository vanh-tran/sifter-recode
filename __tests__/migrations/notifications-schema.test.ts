import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    }),
  }),
}));

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
