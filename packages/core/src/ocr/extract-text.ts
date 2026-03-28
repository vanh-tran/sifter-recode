import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export async function extractTextFromPdfBuffer(buf: Buffer): Promise<string> {
  if (!buf.length) return '';
  // pdf-parse v2 uses class-based API: new PDFParse({ data: buffer }).getText()
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('pdf-parse');
  const PDFParse = (mod.PDFParse ?? mod.default?.PDFParse) as new (opts: { data: Buffer }) => { getText(): Promise<{ text: string }> };
  const parser = new PDFParse({ data: buf });
  const { text } = await parser.getText();
  return (text ?? '').trim();
}
