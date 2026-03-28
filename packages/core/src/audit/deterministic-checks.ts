export type CheckResult = {
  triggered: boolean;
  finding_type: string;
  rule_id: string;
  description: string;
  delta_amount: number;
};

export function mathErrorCheck(input: { lineSum: number; totalAmount: number; tolerance?: number }): CheckResult {
  const tol = input.tolerance ?? 0.01;
  const diff = Math.abs(input.lineSum - input.totalAmount);
  if (diff <= tol) return { triggered: false, finding_type: 'math_error', rule_id: 'math_sum', description: '', delta_amount: 0 };
  return {
    triggered: true,
    finding_type: 'math_error',
    rule_id: 'math_sum',
    description: `Line items sum to ${input.lineSum.toFixed(2)} but invoice total is ${input.totalAmount.toFixed(2)}.`,
    delta_amount: Math.abs(input.totalAmount - input.lineSum),
  };
}

export function duplicateInvoiceCheck(input: { hasExistingClearedDuplicate: boolean; delta_amount: number }): CheckResult {
  if (!input.hasExistingClearedDuplicate)
    return { triggered: false, finding_type: 'duplicate_invoice', rule_id: 'dup_inv', description: '', delta_amount: 0 };
  return {
    triggered: true,
    finding_type: 'duplicate_invoice',
    rule_id: 'dup_inv',
    description: 'Another invoice with same carrier, number, and total was already cleared.',
    delta_amount: input.delta_amount,
  };
}

export function timestampSanityCheck(invoiceDate: Date, now = new Date()): CheckResult {
  const ms = invoiceDate.getTime();
  const futureLimit = 30 * 86400_000;
  const pastLimit = 730 * 86400_000;
  if (invoiceDate.getTime() > now.getTime() + futureLimit)
    return { triggered: true, finding_type: 'late_submission', rule_id: 'ts_future', description: 'Invoice date is more than 30 days in the future.', delta_amount: 0 };
  if (now.getTime() - ms > pastLimit)
    return { triggered: true, finding_type: 'late_submission', rule_id: 'ts_old', description: 'Invoice date is more than 2 years in the past.', delta_amount: 0 };
  return { triggered: false, finding_type: 'late_submission', rule_id: 'ts', description: '', delta_amount: 0 };
}

export function unitMismatchHeuristic(lineDescriptions: string[]): CheckResult {
  const text = lineDescriptions.join(' ').toLowerCase();
  const pairs: [string, string][] = [['mi', 'km'], ['lbs', 'kg'], ['miles', 'kilometers']];
  for (const [a, b] of pairs) {
    if (text.includes(a) && text.includes(b))
      return { triggered: true, finding_type: 'unit_mismatch', rule_id: 'unit_mix', description: `Possible mixed units (${a} vs ${b}) in line descriptions.`, delta_amount: 0 };
  }
  return { triggered: false, finding_type: 'unit_mismatch', rule_id: 'unit_mix', description: '', delta_amount: 0 };
}

export function lateSubmissionCheck(invoiceDate: Date, receivedAt: Date, maxDays = 30): CheckResult {
  const days = (receivedAt.getTime() - invoiceDate.getTime()) / 86400_000;
  if (days <= maxDays)
    return { triggered: false, finding_type: 'late_submission', rule_id: 'late_sub', description: '', delta_amount: 0 };
  return {
    triggered: true,
    finding_type: 'late_submission',
    rule_id: 'late_sub',
    description: `Invoice received ${Math.floor(days)} days after invoice date (limit ${maxDays}).`,
    delta_amount: 0,
  };
}

export function runDeterministicChecks(ctx: {
  lineSum: number;
  totalAmount: number;
  invoiceDate: Date;
  receivedAt: Date;
  lineDescriptions: string[];
  hasExistingClearedDuplicate: boolean;
  duplicateDelta: number;
}): CheckResult[] {
  const out: CheckResult[] = [];
  const m = mathErrorCheck({ lineSum: ctx.lineSum, totalAmount: ctx.totalAmount });
  if (m.triggered) out.push(m);
  const d = duplicateInvoiceCheck({ hasExistingClearedDuplicate: ctx.hasExistingClearedDuplicate, delta_amount: ctx.duplicateDelta });
  if (d.triggered) out.push(d);
  const t = timestampSanityCheck(ctx.invoiceDate);
  if (t.triggered) out.push(t);
  const u = unitMismatchHeuristic(ctx.lineDescriptions);
  if (u.triggered) out.push(u);
  const l = lateSubmissionCheck(ctx.invoiceDate, ctx.receivedAt);
  if (l.triggered) out.push(l);
  return out;
}
