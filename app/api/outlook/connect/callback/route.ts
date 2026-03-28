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

  const tokenRes = await fetch(
    'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.MICROSOFT_OUTLOOK_CLIENT_ID!,
        client_secret: process.env.MICROSOFT_OUTLOOK_CLIENT_SECRET!,
        redirect_uri: process.env.MICROSOFT_OUTLOOK_REDIRECT_URI!,
        grant_type: 'authorization_code',
        code_verifier: session.codeVerifier,
      }),
    }
  );

  if (!tokenRes.ok) {
    return NextResponse.redirect(new URL(`${origin}?error=token_exchange_failed`, request.url));
  }

  const { access_token, refresh_token, expires_in } = await tokenRes.json();

  const meRes = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!meRes.ok) {
    return NextResponse.redirect(new URL(`${origin}?error=userinfo_failed`, request.url));
  }

  const meData = await meRes.json();
  const email: string = meData.mail ?? meData.userPrincipalName;

  try {
    await storeConnection({
      orgId: session.orgId,
      userId: session.userId,
      provider: 'outlook',
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
