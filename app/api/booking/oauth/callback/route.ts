/**
 * GET /api/booking/oauth/callback
 *
 * Handles Google OAuth callback. Exchanges code for tokens,
 * fetches user email, stores refresh_token + email in booking_oauth_tokens.
 */

import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

const OAUTH_STATE_COOKIE = "booking_oauth_state";

/** Redirect to admin-booking with error and clear state cookie. */
function errorRedirect(request: NextRequest, error: string): NextResponse {
  const r = NextResponse.redirect(
    new URL(`/admin-booking?error=${encodeURIComponent(error)}`, request.url)
  );
  r.cookies.set(OAUTH_STATE_COOKIE, "", { maxAge: 0, path: "/" });
  return r;
}

/** Map Google OAuth error codes to safe user-facing messages. Avoids leaking error_description. */
function getSafeOAuthErrorMessage(errorCode: string): string {
  const known: Record<string, string> = {
    access_denied: "Authorization was denied",
    invalid_scope: "Invalid authorization scope",
    invalid_client: "OAuth configuration error",
    invalid_grant: "Authorization expired or invalid. Try connecting again.",
    unauthorized_client: "This app is not authorized for OAuth",
    unsupported_response_type: "OAuth configuration error",
  };
  return known[errorCode] ?? "Authorization failed";
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const errorParam = request.nextUrl.searchParams.get("error");

  if (errorParam) {
    return errorRedirect(request, getSafeOAuthErrorMessage(errorParam));
  }

  if (!code) {
    return errorRedirect(request, "No authorization code received");
  }

  // CSRF protection: validate state matches cookie (constant-time comparison)
  const stateParam = request.nextUrl.searchParams.get("state");
  const stateCookie = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!stateParam || !stateCookie) {
    return errorRedirect(request, "Invalid state. Please try connecting again.");
  }
  if (
    stateParam.length !== stateCookie.length ||
    !timingSafeEqual(Buffer.from(stateParam, "utf8"), Buffer.from(stateCookie, "utf8"))
  ) {
    return errorRedirect(request, "Invalid state. Please try connecting again.");
  }

  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_BOOKING_REDIRECT_URI ||
    `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/booking/oauth/callback`;

  if (!clientId || !clientSecret) {
    return errorRedirect(request, "OAuth credentials not configured");
  }

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error("[booking/oauth] Token exchange failed:", err);
    return errorRedirect(request, "Token exchange failed");
  }

  const tokens = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
  };

  if (!tokens.refresh_token) {
    return errorRedirect(
      request,
      "No refresh token returned. Try revoking app access and reconnecting."
    );
  }

  // Fetch user email via userinfo
  const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userInfoRes.ok) {
    return errorRedirect(request, "Failed to fetch user email");
  }

  const userInfo = (await userInfoRes.json()) as { email?: string };
  const email = userInfo.email?.trim();

  if (!email) {
    return errorRedirect(request, "Could not resolve user email");
  }

  // Store in Supabase (booking_oauth_tokens)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return errorRedirect(request, "Supabase not configured");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { error: insertError } = await supabase.from("booking_oauth_tokens").insert({
    refresh_token: tokens.refresh_token,
    email,
    is_primary: false, // Admin can set is_primary in Supabase after confirming
  });

  if (insertError) {
    console.error("[booking/oauth] Insert failed:", insertError);
    return errorRedirect(request, "Failed to save token");
  }

  const redirectUrl = new URL(`/admin-booking?success=1&email=${encodeURIComponent(email)}`, request.url);
  const response = NextResponse.redirect(redirectUrl);
  // Clear state cookie after successful use
  response.cookies.set(OAUTH_STATE_COOKIE, "", { maxAge: 0, path: "/" });
  return response;
}
