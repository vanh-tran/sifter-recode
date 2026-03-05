import { createBrowserClient } from "@supabase/ssr";

/**
 * Auth-only Supabase client for the browser.
 *
 * This module exports ONLY the auth object. Data access (.from(), .rpc(), .storage)
 * is intentionally unavailable. All database queries must run on the server via
 * @/lib/supabase/server.
 *
 * Use this for: signInWithOtp, signInWithOAuth, signOut, onAuthStateChange
 */
const _client = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export const auth = _client.auth;
// Docs: https://supabase.com/docs/guides/auth/server-side/creating-a-client
// Source: https://github.com/supabase/supabase/blob/master/examples/auth/nextjs/lib/supabase/client.ts