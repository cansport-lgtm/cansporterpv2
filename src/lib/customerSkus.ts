/**
 * Customer SKU helpers.
 *
 * The products master holds two kinds of SKU:
 *   - own SKUs (products.customer_party_id IS NULL)
 *       → sellable to any customer
 *   - customer SKUs (products.customer_party_id = <accounting party id>)
 *       → owned by one accounts-receivable customer (accounting_parties,
 *         party_type = customer) and sellable only to that customer
 *
 * A sales customer (customers table) reaches its receivables party through
 * customers.accounting_party_id. Sales pickers (quotations, orders, invoices,
 * customer pricing) call `productsForCustomerParty` with that party id so a
 * customer never sees another customer's items.
 */

export type ProductOwnerType = "own" | "customer";

export interface ProductOwnership {
  customer_party_id?: string | null;
  owner_type?: ProductOwnerType | string | null;
}

/**
 * Narrow a product list to what the given receivables customer may buy:
 * every own SKU plus that party's own SKUs, with the party's SKUs first.
 *
 * With no party (no customer chosen yet, or a customer that is not in
 * accounts receivable) only own SKUs are returned.
 */
export function productsForCustomerParty<T extends ProductOwnership>(
  products: T[] | null | undefined,
  customerPartyId: string | null | undefined,
): T[] {
  const list = products ?? [];
  const own = list.filter((p) => !p.customer_party_id);
  if (!customerPartyId) return own;
  const theirs = list.filter((p) => p.customer_party_id === customerPartyId);
  return [...theirs, ...own];
}

/** Receivables party id of a sales customer picked in a form, if any. */
export function partyIdOfCustomer<T extends { id: string; accounting_party_id?: string | null }>(
  customers: T[] | null | undefined,
  customerId: string | null | undefined,
): string | null {
  if (!customerId) return null;
  return customers?.find((c) => c.id === customerId)?.accounting_party_id ?? null;
}

export function isCustomerSku(p: ProductOwnership): boolean {
  return p.owner_type === "customer" || !!p.customer_party_id;
}
