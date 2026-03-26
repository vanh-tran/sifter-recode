import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('createServiceRoleClient', () => {
  const OLD_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const OLD_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = OLD_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = OLD_KEY;
  });

  it('throws if service role key missing', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await expect(import('@/lib/supabase/service-role')).rejects.toThrow();
  });
});
