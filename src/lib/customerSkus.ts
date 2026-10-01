/**
 * Customer SKU helpers.
 *
 * The products master holds two kinds of SKU:
 *   - own SKUs (products.customer_id IS NULL)       → sellable to any customer
 *   - customer SKUs (products.customer_id = <uuid>) → sellable only to that customer
 *
 * Sales pickers (quotations, orders, invoices, customer pricing) call
 * `productsForCustomer` so a customer never sees another customer's items.
 */

export type ProductOwnerType = "own" | "customer";

export interface ProductOwnership {
  customer_id?: string | null;
  owner_type?: ProductOwnerType | string | null;
}

/**
 * Narrow a product list to what the given customer may buy:
 * every own SKU plus that customer's own SKUs, with the customer's
 * SKUs listed first.
 *
 * With no customer selected only own SKUs are returned, so a line can never
 * be saved against a customer SKU before the customer is chosen.
 */
export function productsForCustomer<T extends ProductOwnership>(
  products: T[] | null | undefined,
  customerId: string | null | undefined,
): T[] {
  const list = products ?? [];
  const own = list.filter((p) => !p.customer_id);
  if (!customerId) return own;
  const theirs = list.filter((p) => p.customer_id === customerId);
  return [...theirs, ...own];
}

export function isCustomerSku(p: ProductOwnership): boolean {
  return p.owner_type === "customer" || !!p.customer_id;
}
