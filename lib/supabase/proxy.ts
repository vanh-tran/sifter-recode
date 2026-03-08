import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Do not run code between createServerClient and
  // supabase.auth.getClaims(). A simple mistake could make it very hard to
  // debug issues with users being randomly logged out.

  // IMPORTANT: DO NOT REMOVE. Calling getClaims() validates the JWT against
  // the project's JWKS endpoint and refreshes the auth token if expired.
  // Without this, sessions will break silently.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;
  const pathname = request.nextUrl.pathname;

  const copySupabaseCookies = (response: NextResponse) => {
    supabaseResponse.cookies.getAll().forEach(({ name, value, ...options }) => {
      response.cookies.set(name, value, options);
    });
    return response;
  };

  const publicPaths = [
    "/",
    "/login",
    "/register",
    "/contact",
    "/book",
    "/auth",
    "/auth/callback",
    "/auth/auth-code-error",
    "/api/booking/availability",
    "/api/booking/events",
    // /admin-booking and /api/booking/oauth/* require auth — not in publicPaths
  ];
  if (!user && !publicPaths.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return copySupabaseCookies(NextResponse.redirect(url));
  }

  // Authenticated users should not access auth-only pages.
  if (user && (pathname === "/login" || pathname === "/register")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return copySupabaseCookies(NextResponse.redirect(url));
  }

  // IMPORTANT: You *must* return the supabaseResponse object as-is.
  // If you need a new response, copy the cookies over:
  //   const myNewResponse = NextResponse.next({ request })
  //   myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  //   return myNewResponse

  return supabaseResponse;
}

// Docs: https://supabase.com/docs/guides/auth/server-side/creating-a-client
// Docs: https://supabase.com/docs/guides/auth/server-side/nextjs
// Docs: https://supabase.com/docs/guides/auth/server-side/advanced-guide
// Docs: https://supabase.com/docs/guides/troubleshooting/how-do-you-troubleshoot-nextjs---supabase-auth-issues-riMCZV
// Source: https://github.com/supabase/supabase/blob/master/examples/auth/nextjs/lib/supabase/proxy.ts
