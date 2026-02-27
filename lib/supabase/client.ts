import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// Docs: https://supabase.com/docs/guides/auth/server-side/creating-a-client
// Source: https://github.com/supabase/supabase/blob/master/examples/auth/nextjs/lib/supabase/client.ts
