import { KeyManagementServiceClient } from '@google-cloud/kms';

const kms = new KeyManagementServiceClient();

export async function decryptOAuthSecret(ciphertext: string): Promise<string> {
  const keyName = process.env.OAUTH_KMS_KEY_NAME;
  if (!keyName) {
    if (process.env.NODE_ENV === 'development') {
      return Buffer.from(ciphertext, 'base64').toString('utf-8');
    }
    throw new Error('OAUTH_KMS_KEY_NAME is not configured');
  }
  const [result] = await kms.decrypt({
    name: keyName,
    ciphertext: Buffer.from(ciphertext, 'base64'),
  });
  return result.plaintext!.toString('utf-8');
}
