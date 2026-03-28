import { randomBytes, createHash } from 'crypto';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { encryptOAuthSecret } from '@/lib/server/oauth-token-crypto';

export function generatePkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

export async function createOAuthSession({
  orgId,
  userId,
  state,
  codeVerifier,
  codeChallenge,
}: {
  orgId: string;
  userId: string;
  state: string;
  codeVerifier: string;
  codeChallenge: string;
}): Promise<void> {
  const admin = createServiceRoleClient();
  const { error } = await admin.from('oauth_sessions').insert({
    org_id: orgId,
    user_id: userId,
    state,
    code_verifier: codeVerifier,
    code_challenge: codeChallenge,
    status: 'pending',
  });
  if (error) throw new Error(`Failed to create OAuth session: ${error.message}`);
}

export async function validateAndConsumeSession(state: string): Promise<{
  orgId: string;
  userId: string;
  codeVerifier: string;
} | null> {
  const admin = createServiceRoleClient();
  const { data: session } = await admin
    .from('oauth_sessions')
    .select('id, org_id, user_id, code_verifier, status, expires_at')
    .eq('state', state)
    .maybeSingle();

  if (!session) return null;
  if (session.status !== 'pending') return null;
  if (new Date(session.expires_at) < new Date()) return null;

  await admin.from('oauth_sessions').update({ status: 'used' }).eq('id', session.id);

  return {
    orgId: session.org_id as string,
    userId: session.user_id as string,
    codeVerifier: session.code_verifier as string,
  };
}

export async function storeConnection({
  orgId,
  userId,
  provider,
  email,
  refreshToken,
  accessToken,
  tokenExpiry,
}: {
  orgId: string;
  userId: string;
  provider: 'gmail' | 'outlook';
  email: string;
  refreshToken: string;
  accessToken: string;
  tokenExpiry: Date | null;
}): Promise<void> {
  const admin = createServiceRoleClient();

  const [encryptedRefresh, encryptedAccess] = await Promise.all([
    encryptOAuthSecret(refreshToken),
    encryptOAuthSecret(accessToken),
  ]);

  const { data: conn, error: connError } = await admin
    .from('email_connections')
    .upsert(
      { org_id: orgId, user_id: userId, provider, email, status: 'active' },
      { onConflict: 'org_id,provider,email' }
    )
    .select('id')
    .single();

  if (connError || !conn) {
    throw new Error(`Failed to upsert email_connections: ${connError?.message}`);
  }

  const { error: tokenError } = await admin
    .from('oauth_tokens')
    .upsert(
      {
        connection_id: conn.id,
        refresh_token_encrypted: encryptedRefresh,
        access_token_encrypted: encryptedAccess,
        expires_at: tokenExpiry?.toISOString() ?? null,
      },
      { onConflict: 'connection_id' }
    );

  if (tokenError) throw new Error(`Failed to upsert oauth_tokens: ${tokenError.message}`);
}
