import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { generatePkce, createOAuthSession } from '@/lib/server/oauth-connect';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.redirect(new URL('/login', request.url));

  const returnTo = request.nextUrl.searchParams.get('return_to') ?? 'settings';
  const { codeVerifier, codeChallenge } = generatePkce();
  const state = randomUUID();

  await createOAuthSession({
    orgId: ctx.orgId,
    userId: ctx.userId,
    state,
    codeVerifier,
    codeChallenge,
  });

  const cookieStore = await cookies();
  cookieStore.set('oauth_return_to', returnTo, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 300,
  });

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_GMAIL_CLIENT_ID!,
    redirect_uri: process.env.GOOGLE_GMAIL_REDIRECT_URI!,
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
      'openid',
    ].join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  );
}
