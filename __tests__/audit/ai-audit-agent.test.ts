import { describe, it, expect } from 'vitest';
import { mergeDedupByRule } from '@/lib/audit/ai-audit-agent';

describe('mergeDedupByRule', () => {
  it('drops AI duplicate when deterministic same rule_id', () => {
    const det = [{ rule_id: 'rate_1', source: 'deterministic' as const }];
    const ai = [{ rule_id: 'rate_1', source: 'ai_audit' as const }];
    expect(mergeDedupByRule(det, ai)).toHaveLength(1);
  });
});
