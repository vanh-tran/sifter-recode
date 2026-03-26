import { describe, it, expect } from 'vitest';
import { extractTextFromPdfBuffer } from '@/lib/ocr/extract-text';

describe('extractTextFromPdfBuffer', () => {
  it('returns empty string for empty buffer', async () => {
    await expect(extractTextFromPdfBuffer(Buffer.alloc(0))).resolves.toBe('');
  });
});
