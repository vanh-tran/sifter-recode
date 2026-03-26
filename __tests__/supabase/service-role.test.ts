import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('createServiceRoleClient', () => {
  const OLD_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const OLD_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = OLD_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = OLD_KEY;
  });

  it('throws if service role key missing', async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service-role');
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => createServiceRoleClient()).toThrow('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  });

  it('returns a client when env vars are present', async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service-role');
    const client = createServiceRoleClient();
    expect(client).toBeDefined();
  });
});
