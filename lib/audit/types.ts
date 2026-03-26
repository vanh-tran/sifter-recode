export type FindingDraft = {
  finding_type: string;
  rule_id: string;
  source: 'deterministic' | 'ai_audit';
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  expected_amount?: number | null;
  charged_amount?: number | null;
  delta_amount: number;
  summary: string;
  reasoning: string;
  confidence?: number;
  evidence_json?: Record<string, unknown>;
};
