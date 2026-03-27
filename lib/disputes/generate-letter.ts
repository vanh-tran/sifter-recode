import OpenAI from 'openai';

export interface FindingForLetter {
  id: string;
  summary: string;
  description_edited: string | null;
  delta_amount: number;
  amount_edited: number | null;
  charged_amount: number | null;
  expected_amount: number | null;
}

export interface GenerateLetterInput {
  invoiceNumber: string;
  invoiceDate: string;
  carrierName: string;
  orgName: string;
  findings: FindingForLetter[];
  totalDisputedAmount: number;
}

export function buildDisputeLetterPrompt(input: GenerateLetterInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt = `You are a professional freight billing dispute specialist writing on behalf of a shipper's accounts payable team.
Write formal, concise, and factual dispute letters. Use professional business letter tone.
Do not include placeholders like [Your Name] — use the provided data directly.
Structure: opening paragraph stating the dispute, numbered list of issues with amounts, closing paragraph requesting a credit memo or corrected invoice, professional sign-off.
Output only the letter body text — no preamble, no explanation, no markdown formatting.`;

  const findingLines = input.findings
    .map((f, i) => {
      const description = f.description_edited ?? f.summary;
      const disputedAmt = f.amount_edited ?? f.delta_amount;
      const chargedStr = f.charged_amount != null ? ` (charged: $${f.charged_amount.toFixed(2)}` : '';
      const expectedStr = f.expected_amount != null ? `, expected: $${f.expected_amount.toFixed(2)})` : chargedStr ? ')' : '';
      return `${i + 1}. ${description}${chargedStr}${expectedStr} — disputed amount: $${disputedAmt.toFixed(2)}`;
    })
    .join('\n');

  const userPrompt = `Write a formal freight invoice dispute letter with the following details:

Sender (AP Team): ${input.orgName}
Carrier: ${input.carrierName}
Invoice Number: ${input.invoiceNumber}
Invoice Date: ${input.invoiceDate}
Total Disputed Amount: $${input.totalDisputedAmount.toFixed(2)}

Disputed Charges:
${findingLines}

Request: Issue a credit memo for $${input.totalDisputedAmount.toFixed(2)} or provide a corrected invoice reflecting the contracted rates. Include a reference to the invoice number in the subject line suggestion.`;

  return { systemPrompt, userPrompt };
}

export async function generateDisputeLetter(input: GenerateLetterInput): Promise<string> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const { systemPrompt, userPrompt } = buildDisputeLetterPrompt(input);

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 1200,
    temperature: 0.3,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const letter = response.choices[0]?.message?.content;
  if (!letter) {
    throw new Error('OpenAI returned empty letter content');
  }
  return letter.trim();
}
