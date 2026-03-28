import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export async function extractTextFromPdfBuffer(buf: Buffer): Promise<string> {
  if (!buf.length) return '';
  // pdf-parse is CJS-only; use createRequire for NodeNext ESM compatibility
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require('pdf-parse') as (b: Buffer) => Promise<{ text: string }>;
  const { text } = await pdfParse(buf);
  return (text ?? '').trim();
}
