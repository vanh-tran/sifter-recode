import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@google-cloud/kms', () => ({
  KeyManagementServiceClient: class {
    encrypt = vi.fn();
    decrypt = vi.fn();
  },
}));

describe('encryptOAuthSecret (dev mode)', () => {
  beforeEach(() => {
    delete process.env.OAUTH_KMS_KEY_NAME;
    process.env.NODE_ENV = 'development';
  });

  it('base64-encodes plaintext in development', async () => {
    const { encryptOAuthSecret } = await import('@/lib/server/oauth-token-crypto');
    const result = await encryptOAuthSecret('my-secret');
    expect(result).toBe(Buffer.from('my-secret').toString('base64'));
  });

  it('round-trips with decryptOAuthSecret', async () => {
    const { encryptOAuthSecret, decryptOAuthSecret } = await import('@/lib/server/oauth-token-crypto');
    const encrypted = await encryptOAuthSecret('round-trip-secret');
    const decrypted = await decryptOAuthSecret(encrypted);
    expect(decrypted).toBe('round-trip-secret');
  });

  it('throws in production when OAUTH_KMS_KEY_NAME is missing', async () => {
    process.env.NODE_ENV = 'production';
    const { encryptOAuthSecret } = await import('@/lib/server/oauth-token-crypto');
    await expect(encryptOAuthSecret('x')).rejects.toThrow('OAUTH_KMS_KEY_NAME is not configured');
  });
});
