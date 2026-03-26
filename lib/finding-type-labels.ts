export const FINDING_TYPE_LABELS: Record<string, string> = {
  rate_mismatch: 'Rate Mismatch',
  bol_mismatch: 'BOL Mismatch',
  fuel_surcharge: 'Fuel Surcharge',
  detention: 'Detention',
  accessorial_without_proof: 'Accessorial',
  math_error: 'Math Error',
  duplicate_invoice: 'Duplicate',
  late_submission: 'Late Submission',
  unit_mismatch: 'Unit Mismatch',
  lumper_without_receipt: 'Lumper',
};

export function findingTypeToLabel(t: string): string {
  return FINDING_TYPE_LABELS[t] ?? t.replace(/_/g, ' ');
}
