import OpenAI from 'openai';
import type { FindingDraft } from '@/lib/audit/types';

export const AI_AUDIT_PROMPT = `You are a freight invoice auditor. Given JSON context with:
- normalized invoice (line items, totals)
- rate sheet excerpt (if any)
- BOL excerpt (if any)

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
1) Rate mismatch vs contracted rate sheet
2) BOL mismatch (weight, lanes) vs invoice
3) Fuel surcharge reasonableness vs linehaul
4) Detention without appointment evidence
5) Lumper without receipt when charged
6) Accessorial without proof document

If no issue, return findings: []. Do not duplicate issues already explained by deterministic rules if those appear in the "deterministic_findings" array — skip overlapping rule_id.`;

export async function runAiAuditAgent(context: {
  invoiceJson: unknown;
  rateSheetJson?: unknown;
  bolJson?: unknown;
  deterministicFindings: { rule_id: string }[];
}): Promise<FindingDraft[]> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: `${AI_AUDIT_PROMPT}\n\nCONTEXT:\n${JSON.stringify(context).slice(0, 100_000)}` }],
  });
  const raw = res.choices[0]?.message?.content ?? '{"findings":[]}';
  const parsed = JSON.parse(raw) as { findings: FindingDraft[] };
  return mergeDedupByRule(context.deterministicFindings as FindingDraft[], parsed.findings);
}

export function mergeDedupByRule(
  deterministic: { rule_id: string }[],
  ai: FindingDraft[]
): FindingDraft[] {
  const ruleIds = new Set(deterministic.map((d) => d.rule_id));
  const filteredAi = ai.filter((a) => !ruleIds.has(a.rule_id));
  return [...(deterministic as FindingDraft[]), ...filteredAi];
}
