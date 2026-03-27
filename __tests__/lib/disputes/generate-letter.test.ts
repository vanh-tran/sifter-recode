import { describe, it, expect } from 'vitest';
import { buildDisputeLetterPrompt, type GenerateLetterInput } from '@/lib/disputes/generate-letter';

const mockInput: GenerateLetterInput = {
  invoiceNumber: 'INV-2024-001',
  invoiceDate: '2024-01-15',
  carrierName: 'FastFreight Inc.',
  orgName: 'Acme Logistics LLC',
  findings: [
    {
      id: 'f-1',
      summary: 'Rate mismatch on line haul charge',
      description_edited: null,
      delta_amount: 125.50,
      amount_edited: null,
      charged_amount: 450.00,
      expected_amount: 324.50,
    },
    {
      id: 'f-2',
      summary: 'Fuel surcharge exceeds contracted cap of 18%',
      description_edited: 'Fuel surcharge billed at 22%, contracted cap is 18%',
      delta_amount: 89.00,
      amount_edited: 89.00,
      charged_amount: 198.00,
      expected_amount: 109.00,
    },
  ],
  totalDisputedAmount: 214.50,
};

describe('buildDisputeLetterPrompt', () => {
  it('returns a non-empty system prompt and user prompt', () => {
    const { systemPrompt, userPrompt } = buildDisputeLetterPrompt(mockInput);
    expect(systemPrompt.length).toBeGreaterThan(0);
    expect(userPrompt.length).toBeGreaterThan(0);
  });

  it('includes invoice number in the prompt', () => {
    const { userPrompt } = buildDisputeLetterPrompt(mockInput);
    expect(userPrompt).toContain('INV-2024-001');
  });

  it('includes carrier name in the prompt', () => {
    const { userPrompt } = buildDisputeLetterPrompt(mockInput);
    expect(userPrompt).toContain('FastFreight Inc.');
  });

  it('includes total disputed amount formatted as USD', () => {
    const { userPrompt } = buildDisputeLetterPrompt(mockInput);
    expect(userPrompt).toContain('214.50');
  });

  it('uses edited description when provided', () => {
    const { userPrompt } = buildDisputeLetterPrompt(mockInput);
    expect(userPrompt).toContain('Fuel surcharge billed at 22%');
  });

  it('uses edited amount when provided', () => {
    const { userPrompt } = buildDisputeLetterPrompt(mockInput);
    expect(userPrompt).toContain('$89.00');
  });
});
