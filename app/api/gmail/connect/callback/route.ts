import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { validateAndConsumeSession, storeConnection } from '@/lib/server/oauth-connect';

function getReturnUrl(returnTo: string | undefined): string {
  if (returnTo === 'onboarding') return '/onboarding';
  return '/settings';
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const cookieStore = await cookies();
  const returnTo = cookieStore.get('oauth_return_to')?.value;
  const origin = getReturnUrl(returnTo);

  const providerError = searchParams.get('error');
  if (providerError) {
    const errorKey = providerError === 'access_denied' ? 'access_denied' : 'oauth_error';
    return NextResponse.redirect(new URL(`${origin}?error=${errorKey}`, request.url));
  }

  const state = searchParams.get('state');
  const code = searchParams.get('code');
  if (!state || !code) {
    return NextResponse.redirect(new URL(`${origin}?error=oauth_error`, request.url));
  }

  const session = await validateAndConsumeSession(state);
  if (!session) {
    return NextResponse.redirect(new URL('/settings?error=invalid_session', request.url));
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_GMAIL_CLIENT_ID!,
      client_secret: process.env.GOOGLE_GMAIL_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_GMAIL_REDIRECT_URI!,
      grant_type: 'authorization_code',
      code_verifier: session.codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(new URL(`${origin}?error=token_exchange_failed`, request.url));
  }

  const { access_token, refresh_token, expires_in } = await tokenRes.json();

  const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v1/userinfo', {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!userinfoRes.ok) {
    return NextResponse.redirect(new URL(`${origin}?error=userinfo_failed`, request.url));
  }

  const { email } = await userinfoRes.json();

  try {
    await storeConnection({
      orgId: session.orgId,
      userId: session.userId,
      provider: 'gmail',
      email,
      refreshToken: refresh_token,
      accessToken: access_token,
      tokenExpiry: expires_in ? new Date(Date.now() + expires_in * 1000) : null,
    });
  } catch {
    return NextResponse.redirect(new URL(`${origin}?error=connection_failed`, request.url));
  }

  cookieStore.delete('oauth_return_to');
  return NextResponse.redirect(new URL(origin, request.url));
}
