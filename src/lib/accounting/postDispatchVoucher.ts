import { supabase } from "@/integrations/supabase/client";
import { resolveBillingCustomerParty } from "./getCustomerBillingParty";

// Untyped surface so we can hit the new accounting_* tables before types are regenerated
const sb = supabase as any;

export interface PostDispatchResult {
  ok: boolean;
  skipped?: "flag_off" | "already_posted";
  vouchers?: { customerId: string; voucherId: string; amount: number }[];
  /**
   * Ship-to customers that were skipped because they have no billing customer
   * set. Their revenue is NOT posted until a billing customer is assigned.
   */
  skippedNoBilling?: { customerId: string; name: string }[];
  error?: string;
}

const SOURCE_MODULE = "domestic_sales";

import { isAccAutopostEnabled } from "./appSettings";

const getDefaultAccount = async (key: string): Promise<string | null> => {
  const { data, error } = await sb
    .from("accounting_default_accounts")
    .select("account_id")
    .eq("key", key)
    .maybeSingle();
  if (error || !data?.account_id) return null;
  return data.account_id as string;
};

/**
 * Auto-post AR / Sales journal for a freshly-created dispatch.
 *
 * Posting (per BILLING customer represented in the dispatch):
 *   Dr  Accounts Receivable     amount     (party = billing customer's party)
 *   Cr    Sales - Domestic      amount
 *
 * Idempotency:
 *   - Looks up existing vouchers with source_module='domestic_sales'
 *     AND source_reference_id=dispatchId. If any voucher already exists for
 *     a given party, it is skipped (not duplicated).
 *
 * Behavior:
 *   - Returns ok=true with skipped='flag_off' if VITE_ENABLE_ACC_AUTOPOST != 'true'
 *   - Never throws — caller can ignore the result; the dispatch save is not blocked
 */
export async function postDispatchVoucher(dispatchId: string): Promise<PostDispatchResult> {
  try {
    if (!(await isAccAutopostEnabled())) return { ok: true, skipped: "flag_off" };

    // 1) Load dispatch header
    const { data: dispatch, error: dErr } = await sb
      .from("sales_dispatches")
      .select("id, dispatch_number, dispatch_date, order_id, sales_segment")
      .eq("id", dispatchId)
      .single();
    if (dErr || !dispatch) return { ok: false, error: dErr?.message || "Dispatch not found" };

    // Only handle domestic dispatches in Phase 2A
    if (dispatch.sales_segment && dispatch.sales_segment !== "domestic") {
      return { ok: true, skipped: "flag_off" };
    }

    // 2) Load dispatch items + their order_items (for unit_price) + customer info
    const { data: items, error: iErr } = await sb
      .from("sales_dispatch_items")
      .select(
        "id, quantity_dozens, order_item:sales_order_items(id, price_per_dozen, amount, order_id, sales_orders:order_id(id, order_number, customer_id, customers:customer_id(id, name, code, accounting_party_id, billing_customer)))"
      )
      .eq("dispatch_id", dispatchId);
    if (iErr) return { ok: false, error: iErr.message };
    if (!items || items.length === 0) return { ok: true, vouchers: [] };

    // 3) Group amounts + order_numbers by ship-to customer_id
    type Grouped = {
      customer: { id: string; name: string; code: string | null; accounting_party_id: string | null; billing_customer: string | null };
      amount: number;
      orderNumbers: Set<string>;
    };
    const byCustomer = new Map<string, Grouped>();

    for (const item of items as any[]) {
      const oi = item.order_item;
      if (!oi) continue;
      const order = oi.sales_orders;
      const customer = order?.customers;
      if (!customer) continue;

      const lineAmount = Number(item.quantity_dozens || 0) * Number(oi.price_per_dozen || 0);
      if (lineAmount <= 0) continue;

      const existing = byCustomer.get(customer.id);
      if (existing) {
        existing.amount += lineAmount;
        if (order.order_number) existing.orderNumbers.add(order.order_number);
      } else {
        byCustomer.set(customer.id, {
          customer: {
            id: customer.id,
            name: customer.name,
            code: customer.code || null,
            accounting_party_id: customer.accounting_party_id || null,
            billing_customer: customer.billing_customer || null,
          },
          amount: lineAmount,
          orderNumbers: new Set(order.order_number ? [order.order_number] : []),
        });
      }
    }

    if (byCustomer.size === 0) return { ok: true, vouchers: [] };

    // 3b) Resolve each ship-to customer to its BILLING customer party and
    //     re-group by that party, so multiple shops of the same billing customer
    //     (e.g. several "Osama Traders" shops in one dispatch) post to a single
    //     AR voucher and don't collide on the per-(dispatch, party) idempotency
    //     check. Shops with no billing customer are skipped (not posted).
    type PartyGroup = {
      partyId: string;
      displayName: string;
      amount: number;
      orderNumbers: Set<string>;
      customerIds: string[];
    };
    const byParty = new Map<string, PartyGroup>();
    const skippedNoBilling: { customerId: string; name: string }[] = [];

    for (const [customerId, group] of byCustomer.entries()) {
      const { partyId, skipped } = await resolveBillingCustomerParty(group.customer);
      if (!partyId) {
        if (skipped === "no_billing_customer") {
          skippedNoBilling.push({ customerId, name: group.customer.name });
        }
        continue;
      }
      const displayName = (group.customer.billing_customer || "").trim() || group.customer.name;
      const existing = byParty.get(partyId);
      if (existing) {
        existing.amount += group.amount;
        group.orderNumbers.forEach((o) => existing.orderNumbers.add(o));
        existing.customerIds.push(customerId);
      } else {
        byParty.set(partyId, {
          partyId,
          displayName,
          amount: group.amount,
          orderNumbers: new Set(group.orderNumbers),
          customerIds: [customerId],
        });
      }
    }

    const skippedResult = skippedNoBilling.length ? skippedNoBilling : undefined;
    if (byParty.size === 0) return { ok: true, vouchers: [], skippedNoBilling: skippedResult };

    // 4) Look up default accounts
    const arAccountId = await getDefaultAccount("accounts_receivable");
    const salesAccountId = await getDefaultAccount("sales_revenue_domestic");
    if (!arAccountId || !salesAccountId) {
      return { ok: false, error: "Default Sales Revenue or AR account is not configured. Visit /accounting/default-accounts." };
    }

    // 5) Check existing vouchers for idempotency
    const { data: existingVouchers } = await sb
      .from("accounting_vouchers")
      .select("id, party_id")
      .eq("source_module", SOURCE_MODULE)
      .eq("source_reference_id", dispatchId);
    const postedPartyIds = new Set((existingVouchers || []).map((v: any) => v.party_id));

    // 6) For each BILLING party group → create voucher + lines
    const results: { customerId: string; voucherId: string; amount: number }[] = [];
    for (const [partyId, group] of byParty.entries()) {
      const repCustomerId = group.customerIds[0];

      // Skip if a voucher for this (dispatch, party) already exists
      if (postedPartyIds.has(partyId)) {
        results.push({ customerId: repCustomerId, voucherId: "(already posted)", amount: group.amount });
        continue;
      }

      const orderList = Array.from(group.orderNumbers).join(", ") || "—";
      const narration = `Auto: dispatch ${dispatch.dispatch_number || dispatchId.slice(0, 8)} for orders ${orderList} (${group.displayName})`;

      const { data: voucher, error: vErr } = await sb
        .from("accounting_vouchers")
        .insert({
          voucher_number: "",
          voucher_type: "JV",
          voucher_date: dispatch.dispatch_date || new Date().toISOString().split("T")[0],
          party_id: partyId,
          narration,
          total_amount: group.amount,
          status: "posted",
          source_module: SOURCE_MODULE,
          source_reference_id: dispatchId,
        })
        .select("id")
        .single();
      if (vErr || !voucher) continue;

      await sb.from("accounting_voucher_lines").insert([
        {
          voucher_id: voucher.id,
          account_id: arAccountId,
          party_id: partyId,
          debit_amount: group.amount,
          credit_amount: 0,
          line_narration: `AR — ${group.displayName}`,
          line_order: 0,
        },
        {
          voucher_id: voucher.id,
          account_id: salesAccountId,
          party_id: null,
          debit_amount: 0,
          credit_amount: group.amount,
          line_narration: `Sales revenue (domestic) for orders ${orderList}`,
          line_order: 1,
        },
      ]);

      results.push({ customerId: repCustomerId, voucherId: voucher.id, amount: group.amount });
    }

    return { ok: true, vouchers: results, skippedNoBilling: skippedResult };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
