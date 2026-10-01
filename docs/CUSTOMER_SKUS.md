# Customer SKUs in the Products master

The Products / SKUs master holds two kinds of item in one table:

| Owner | Meaning | Who can buy it |
|---|---|---|
| **Own** | Our company SKU, our brand and packing | Any customer |
| **Customer** | A private-label SKU: the customer's own brand and packaging, produced by us | Only that customer |

Both live in `public.products`, so every table that references `products.id`
(sales orders, quotations, invoices, dispatch, returns, COGS, customer pricing,
inventory, gate pass, quality score) keeps working unchanged.

## Columns (migration `20261003120000_customer_skus.sql`)

| Column | Own SKU | Customer SKU |
|---|---|---|
| `owner_type` | `own` | `customer` |
| `customer_id` | must be NULL | required, the owning customer |
| `base_product_id` | must be NULL | optional, the own SKU it is made from |

Checks enforce the NULL / required rules. A trigger
(`products_customer_sku_before_write`) enforces the rest:

- `base_product_id` must point at an **own** SKU, never another customer SKU
  and never itself.
- An own SKU that is already the base of other SKUs cannot be switched to a
  customer SKU.
- **Code generation.** A customer SKU inserted with a blank code gets
  `<customer.code>-<NNN>` (three-digit serial per customer, e.g. `ACP-001`).
  Generation takes a per-customer advisory lock so concurrent inserts never
  collide. `products.code` stays globally unique; the customer prefix is what
  keeps it unique across own and customer SKUs.
  `next_customer_sku_code(customer_id)` previews the next code for the UI.
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
  showing the customer name and base SKU code.
- *Add Product* creates an own SKU (or a customer SKU when the Customer tab is
  active); the *Customer SKU* button always creates a customer SKU.
- In the form, *SKU Owner = Customer* reveals the Customer and Base Product
  pickers. Picking a base product pre-fills any blank spec fields in the form
  so the user sees what will be saved. The Code field shows the code that will
  be generated and is read-only on create; it is editable on edit.

**Sales pickers** use `productsForCustomer()` from `src/lib/customerSkus.ts`:
own SKUs plus the selected customer's SKUs, the customer's listed first.
Until a customer is chosen only own SKUs are offered. Applied in:

- Sales orders (private label / export via `SalesOrdersPageBase`, domestic
  create and edit)
- Quotations
- Invoice edit dialog (filtered by the invoice's customer)
- Customer pricing form (the list filter still shows every product)

Production, planning, inventory and gate-pass pickers deliberately keep
showing every SKU, because those flows handle customer stock too.

## Existing data

Every existing row is `owner_type = 'own'` after the migration. Rows that are
really customer items (for example *0019 Aero Club Padel*) need to be edited
once in the master: set the owner to Customer, pick the customer and the base
product. Their existing code is kept; only new customer SKUs get generated
codes.

## Out of scope for now

- Row-level security so private-label distributor accounts see only their own
  customer's SKUs. Products are still readable by every signed-in user.
