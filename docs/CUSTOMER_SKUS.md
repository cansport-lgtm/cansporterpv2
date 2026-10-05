# Customer SKUs in the Products master

The Products / SKUs master holds two kinds of item in one table:

| Owner | Meaning | Who can buy it |
|---|---|---|
| **Own** | Our company SKU, our brand and packing | Any customer |
| **Customer** | A private-label SKU: the customer's own brand and packaging, produced by us | Only that customer |

Both live in `public.products`, so every table that references `products.id`
(sales orders, quotations, invoices, dispatch, returns, COGS, customer pricing,
inventory, gate pass, quality score) keeps working unchanged.

## Who "the customer" is

The owner of a customer SKU is the **accounts-receivable customer**: a row of
`accounting_parties` with `party_type = 'customer'`. It is *not* a row of the
sales `customers` master. That master mixes billing customers with their
ship-to shops (one receivables party can have 20+ customer rows) and most of
its rows are not accounting customers at all. Each sales customer reaches its
receivables party through `customers.accounting_party_id`.

## Columns

Migrations `20261003120000_customer_skus.sql`,
`20261003150000_customer_sku_owner_party.sql` and
`20261003160000_customer_sku_drop_customer_id.sql`.

| Column | Own SKU | Customer SKU |
|---|---|---|
| `owner_type` | `own` | `customer` |
| `customer_party_id` | must be NULL | required, the owning receivables party |
| `base_product_id` | must be NULL | optional, the own SKU it is made from |

Checks enforce the NULL / required rules. The trigger
`products_customer_sku_before_write` enforces the rest:

- `customer_party_id` must point at a party of type `customer`.
- `base_product_id` must point at an **own** SKU, never another customer SKU
  and never itself. An own SKU that is already the base of other SKUs cannot
  be switched to a customer SKU.
- **Code generation.** A customer SKU inserted with a blank code gets
  `<prefix>-<NNN>`, a three-digit serial per party. The prefix is the party's
  `code` when set, otherwise the first 8 letters/digits of the party name in
  upper case (`Aero Group` → `AEROGROU-001`). Set a code on the party in the
  accounting module to control the prefix. Generation takes a per-party
  advisory lock, skips codes already taken, and `products.code` stays
  globally unique. `next_customer_sku_code(p_party_id)` previews the next
  code for the UI.
- **Inheritance from the base product.** On insert or update of a customer
  SKU, every spec field left NULL is copied from the base product: grade, UOM,
  standard output rate, planning item, standard cost, and (when 0 / NULL)
  standard selling price. Values entered explicitly always win.

Inheritance is **write-time**, not live. Changing the base product later does
not update the customer SKUs built on it. This keeps the monthly production
report, COGS posting and every other reader of `planning_item_id` /
`standard_cost` untouched. Re-save the customer SKU with the field cleared to
pull a new value from the base.

## UI

**Masters → Products / SKUs**

- Tabs: *All / Own SKUs / Customer SKUs* with counts, plus an **Owner** column
  showing the receivables party and base SKU code. Owner details are resolved
  on the client from the party and product lists the page loads; the master
  query itself has no embeds (a hinted self-join on `products` is rejected by
  PostgREST).
- *Add Product* creates an own SKU (or a customer SKU when the Customer tab is
  active); the *Customer SKU* button always creates a customer SKU.
- In the form, *SKU Owner = Customer* reveals the **Customer (accounts
  receivable)** picker, listing active customer parties, and the Base Product
  picker. Picking a base product pre-fills any blank spec fields. The Code
  field shows the code that will be generated and is read-only on create; it
  is editable on edit.

**Sales pickers** use `productsForCustomerParty()` from
`src/lib/customerSkus.ts`: own SKUs plus the SKUs of the selected customer's
receivables party, the party's listed first. A customer with no receivables
party, or no customer chosen yet, sees own SKUs only. Applied in:

- Sales orders (private label / export via `SalesOrdersPageBase`, domestic
  create and edit)
- Quotations
- Invoice edit dialog (by the invoice customer's party)
- Customer pricing form (the list filter still shows every product)

Production, planning, inventory and gate-pass pickers deliberately keep
showing every SKU, because those flows handle customer stock too.

## Existing data

Every existing row is `owner_type = 'own'` after the migrations. Rows that are
really customer items (for example *0019 Aero Club Padel*) need to be edited
once in the master: set the owner to Customer, pick the receivables party and
the base product. Their existing code is kept; only new customer SKUs get
generated codes.

## Out of scope for now

- Row-level security so private-label distributor accounts see only their own
  customer's SKUs. Products are still readable by every signed-in user.
