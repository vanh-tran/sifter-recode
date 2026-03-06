/**
 * GET /api/booking/oauth/connect
 *
 * Initiates Google OAuth for Calendar (read + create events).
 * Redirects to Google consent screen. Uses state parameter for CSRF protection.
 */

import { randomBytes } from "crypto";
import { NextResponse } from "next/server";

const OAUTH_STATE_COOKIE = "booking_oauth_state";
const STATE_COOKIE_MAX_AGE = 300; // 5 minutes

const SCOPES = [
  "https://www.googleapis.com/auth/calendar", // read + create events
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export async function GET() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const redirectUri =
    process.env.GOOGLE_BOOKING_REDIRECT_URI ||
    `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/booking/oauth/callback`;

  if (!clientId) {
    console.error("[booking/oauth] OAuth not configured: missing GOOGLE_CALENDAR_CLIENT_ID");
    return NextResponse.json({ error: "OAuth not configured" }, { status: 500 });
  }

  const state = randomBytes(32).toString("hex");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent", // Force consent to get refresh token
    state,
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  const response = NextResponse.redirect(authUrl);
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: STATE_COOKIE_MAX_AGE,
    path: "/",
  });
  return response;
}
