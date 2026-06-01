import { supabase } from "@/integrations/supabase/client";

// Untyped surface so we can hit the new accounting_* tables before types are regenerated
const sb = supabase as any;

export interface BillingPartyResolution {
  partyId: string | null;
  /**
   * Set when the customer cannot be resolved to a billing party because it has
   * no billing customer designated. Callers should skip accounting for it
   * rather than auto-creating a ship-to party (which would pollute the
   * accounting party dropdowns).
   */
  skipped?: "no_billing_customer";
}

/**
 * Resolve the accounting party for a sales customer, following the
 * billing-customer model: the real accounting customer is the *billing parent*
 * named in `customers.billing_customer`, not the individual ship-to shop.
 *
 * Resolution order:
 *   1. If the customer already has `accounting_party_id`, use it. (Ship-to
 *      records are linked to their billing parent by the data backfill, and
 *      billing customers link to their own party.)
 *   2. Otherwise, if `billing_customer` is set, find an existing ACTIVE customer
 *      party whose name matches the billing name (case-insensitive); create one
 *      if none exists. Link the customer to it so future postings are O(1).
 *   3. If `billing_customer` is blank, return `skipped: "no_billing_customer"`
 *      WITHOUT creating a party — the shop is not an accounting customer.
 */
export async function resolveBillingCustomerParty(customer: {
  id: string;
  name?: string | null;
  code?: string | null;
  accounting_party_id?: string | null;
  billing_customer?: string | null;
}): Promise<BillingPartyResolution> {
  if (customer.accounting_party_id) return { partyId: customer.accounting_party_id };

  const billing = (customer.billing_customer || "").trim();
  if (!billing) return { partyId: null, skipped: "no_billing_customer" };

  // Find an existing active billing-customer party by (case-insensitive) name.
  // `billing` is treated as a literal here (no callers pass wildcards), so an
  // exact case-insensitive match is what we want.
  const { data: matches } = await sb
    .from("accounting_parties")
    .select("id")
    .eq("party_type", "customer")
    .eq("is_active", true)
    .ilike("name", billing)
    .limit(1);

  let partyId: string | null = matches?.[0]?.id || null;

  if (!partyId) {
    const { data: created, error } = await sb
      .from("accounting_parties")
      .insert({ name: billing, party_type: "customer", is_active: true })
      .select("id")
      .single();
    if (error || !created) return { partyId: null };
    partyId = created.id as string;
  }

  // Link the ship-to / billing customer record to the resolved party so the
  // next posting short-circuits at step 1.
  await sb.from("customers").update({ accounting_party_id: partyId }).eq("id", customer.id);
  return { partyId };
}
