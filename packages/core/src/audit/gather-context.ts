export type RateSheetRow = { id: string; effective_date: string | null };

export function pickLatestRateSheet(rows: RateSheetRow[]): RateSheetRow | null {
  if (!rows.length) return null;
  return rows.reduce((best, r) => {
    if (!r.effective_date) return best;
    if (!best.effective_date) return r;
    return r.effective_date > best.effective_date ? r : best;
  });
}
