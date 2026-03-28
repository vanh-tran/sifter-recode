import OpenAI from 'openai';
import type { FindingDraft } from './types.js';

export const AI_AUDIT_PROMPT = `You are a freight invoice auditor. Given context with:
- invoiceJson: normalized invoice fields (carrier, invoice number, date, total, line items)
- invoiceRawText: raw OCR text from the invoice PDF
- rateSheetText: raw OCR text from the contracted rate sheet (if available)
- bolTexts: array of raw OCR texts from Bills of Lading (if available)

Return JSON { "findings": FindingDraft[] } where each finding has:
finding_type in [rate_mismatch, fuel_surcharge, detention, accessorial_without_proof, bol_mismatch, lumper_without_receipt]
rule_id: unique string per finding
source: always "ai_audit"
severity: low|medium|high
expected_amount, charged_amount (nullable), delta_amount (positive = overcharge)
summary: one sentence for AP
reasoning: short justification
confidence: 0-1
evidence_json: page references or snippet ids

Checks to perform:
1) Rate mismatch: compare invoice line item amounts against rates in rateSheetText
2) BOL mismatch: check weight, lanes, dates between bolTexts and invoiceRawText
3) Fuel surcharge: verify percentage vs linehaul in invoiceRawText
4) Detention without appointment evidence in supporting docs
5) Lumper without receipt when charged on invoice
6) Accessorial without proof document

If no issues, return findings: []. Do not duplicate rule_ids already present in deterministic_findings.`;

export async function runAiAuditAgent(context: {
  invoiceJson: unknown;
  invoiceRawText?: string;
  rateSheetText?: string;
  bolTexts?: string[];
  deterministicFindings: { rule_id: string }[];
}): Promise<FindingDraft[]> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: `${AI_AUDIT_PROMPT}\n\nCONTEXT:\n${JSON.stringify(context).slice(0, 100_000)}`,
    }],
  });
  const raw = res.choices[0]?.message?.content ?? '{"findings":[]}';
  let parsed: { findings: FindingDraft[] };
  try {
    parsed = JSON.parse(raw) as { findings: FindingDraft[] };
  } catch {
    throw new Error(`ai-audit-agent: failed to parse LLM response. Raw: ${raw.slice(0, 500)}`);
  }
  return mergeDedupByRule(context.deterministicFindings as FindingDraft[], parsed.findings);
}

export function mergeDedupByRule(
  deterministic: { rule_id: string }[],
  ai: FindingDraft[]
): FindingDraft[] {
  const ruleIds = new Set(deterministic.map((d) => d.rule_id));
  return [...(deterministic as FindingDraft[]), ...ai.filter((a) => !ruleIds.has(a.rule_id))];
}
