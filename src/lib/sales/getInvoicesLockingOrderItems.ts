import { supabase } from "@/integrations/supabase/client";

/**
 * Invoice numbers that freeze the dispatch items linked to the given order
 * items. Once a dispatch is invoiced, its item quantities are the source of
 * record for the invoice and the WIP ledger's sales outflow — deleting them
 * (e.g. by deleting the parent sales order) would orphan the invoice. A DB
 * trigger enforces this too; checking here lets the UI fail fast with a
 * readable message. Cancelled invoices don't lock.
 */
export async function getInvoicesLockingOrderItems(orderItemIds: string[]): Promise<string[]> {
  if (orderItemIds.length === 0) return [];

  const { data: dispatchItems, error } = await supabase
    .from("sales_dispatch_items")
    .select("dispatch_id")
    .in("order_item_id", orderItemIds);
  if (error) throw error;
  const dispatchIds = [...new Set((dispatchItems || []).map(d => d.dispatch_id).filter((id): id is string => !!id))];
  if (dispatchIds.length === 0) return [];

  const { data: invoices, error: invError } = await supabase
    .from("domestic_invoices")
    .select("invoice_number")
    .in("dispatch_id", dispatchIds)
    .neq("status", "cancelled");
  if (invError) throw invError;
  return [...new Set((invoices || []).map(i => i.invoice_number))];
}
