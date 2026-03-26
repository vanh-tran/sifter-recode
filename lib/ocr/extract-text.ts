export async function extractTextFromPdfBuffer(buf: Buffer): Promise<string> {
  if (!buf.length) return '';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = (await import('pdf-parse')).default as (b: Buffer) => Promise<{ text: string }>;
  const { text } = await pdfParse(buf);
  return (text ?? '').trim();
}
