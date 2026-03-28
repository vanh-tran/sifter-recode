export function normalizeCarrierName(name: string): string {
  return name.trim().toLowerCase();
}

export async function upsertCarrier(
  supabase: import('@supabase/supabase-js').SupabaseClient,
  orgId: string,
  nameRaw: string,
  billingEmailFromMetadata: string | null
) {
  const name_normalized = normalizeCarrierName(nameRaw);
  const { data: existing } = await supabase
    .from('carriers')
    .select('id')
    .eq('org_id', orgId)
    .eq('name_normalized', name_normalized)
    .maybeSingle();

  if (existing?.id) return existing.id as string;

  const { data, error } = await supabase
    .from('carriers')
    .insert({
      org_id: orgId,
      name_raw: nameRaw,
      name_normalized,
      billing_email: billingEmailFromMetadata,
      billing_email_confirmed: false,
    })
    .select('id')
    .single();

  if (error) throw error;
  return data!.id as string;
}
