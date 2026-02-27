import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - static assets (svg, png, jpg, jpeg, gif, webp)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

// Docs: https://supabase.com/docs/guides/auth/server-side/creating-a-client
// Source: https://github.com/supabase/supabase/blob/master/examples/auth/nextjs/proxy.ts
// Next.js 16 migration: https://nextjs.org/docs/app/guides/upgrading/version-16
