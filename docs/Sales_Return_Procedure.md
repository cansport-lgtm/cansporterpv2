# Sales Return — Procedure (SOP)

**Purpose:** How to record a customer sales return (credit note) in the ERP, what the
system posts to the accounts, and how to verify it afterwards.

**Who does this:** Accounts / Sales back-office.

**Module:** Sales → **Sales Returns** (screen title: *"Sales Returns / Credit Notes"*).

---

## 1. Before you start (prerequisites)

1. The goods must have been **dispatched** to the customer earlier — a sales return is
   always recorded **against an existing Dispatch**. (If there is no dispatch, there is
   nothing to return.)
2. For the **cost reversal** to post automatically, the product should have a
   **Standard Cost** set in the product master. If it does not, the sale value is still
   reversed but the cost-of-goods part is skipped (it posts Rs. 0).
3. The customer must roll up to a **Billing Customer** (the accounting customer). If a
   ship-to customer has no billing customer set, the accounting entry will be skipped —
   fix the customer record first.

---

## 2. Step-by-step: record a sales return

1. Go to **Sales → Sales Returns**.
2. Click **New Return** (top-right).
3. **Select the original Dispatch** the goods are coming back from.
   - The screen loads that dispatch's products, the quantity that was dispatched, and the
     unit price from the original order.
4. Enter the header details:
   - **Return Date** – the date the goods came back (defaults to today).
   - **Reason** – choose from the list: *Damaged, Quality issue, Wrong item, Excess
     delivery, Customer cancelled, Other.*
   - **Notes** – any extra explanation (optional).
5. For each product line, enter the **Return Quantity (in dozens)**.
   - You **cannot** return more than was originally dispatched.
   - Decimal quantities are allowed (e.g. `0.5`).
   - You may set a per-line reason as well (optional).
6. Check the totals the system calculates automatically:
   - **Subtotal** = Return Qty × Unit Price (the sales value being reversed).
   - **COGS Total** = Return Qty × Product Standard Cost (the cost being reversed).
7. Click **Save & Post**.
   - The return is saved and given an automatic number in the format **`SRN-YYYYMM-NNNN`**
     (e.g. `SRN-202606-0007`).
   - If automatic posting is enabled, the accounting voucher is created immediately.

---

## 3. What the system posts to the accounts

A sales return creates **one balanced Journal Voucher** with up to two parts:

**A) Sales / Receivable reversal (always):**

| Account | Debit | Credit |
|---|---|---|
| Sales Returns (4010) | Return sales value | |
| Accounts Receivable — *the customer* | | Return sales value |

> This reduces the customer's outstanding balance and reduces net sales.

**B) Cost / Inventory reversal (only if a Standard Cost exists):**

| Account | Debit | Credit |
|---|---|---|
| Finished Goods Inventory | Return cost value | |
| Cost of Goods Sold (5100) | | Return cost value |

> This puts the cost of the returned goods back into inventory value and reduces COGS.

The voucher narration records the customer, the return reference, and the reason.

---

## 4. Important notes / limitations

- **Physical stock is NOT automatically increased.** The return posts the *accounting*
  entries (it puts the value back into the Finished Goods account), but it does **not**
  change the physical stock count. If you track physical quantities, record the stock
  receipt of the returned goods separately in the inventory module.
- **No cost entry without a standard cost.** If the product has no Standard Cost, only the
  sales/receivable side (Part A) is posted; the cost side (Part B) is skipped. Set the
  product's standard cost first if you need the cost reversal.
- **Accounting auto-post can be off.** If the company setting for automatic posting is
  turned off, the return is saved but the voucher is not posted. In that case, post it
  from the accounting side (see the alternative method below).

---

## 5. How to verify the return afterwards

- **Customer balance:** Accounting → **Party Ledger** → select the customer. The return
  voucher should appear and reduce their outstanding balance.
- **Sales Returns account:** Accounting → **General Ledger** → select *Sales Returns
  (4010)* to see the debit.
- **Profit & Loss:** the period's net revenue should drop by the returned sales value (and
  COGS by the returned cost).
- The return itself is listed on the **Sales → Sales Returns** screen with its `SRN-` number
  and status **Posted**.

---

## 6. Alternative: direct entry from the Accounting module

If you do not have a specific dispatch to tie to (e.g. a one-off adjustment), there is a
simpler ledger-only screen at **Accounting → Sales Return**:

1. Select the **Customer**.
2. Enter the **Return Date**.
3. Enter the **Sales Amount** (revenue to reverse).
4. Enter the **COGS Amount** (cost to reverse) — optional; leave 0 if not known.
5. Add a **Reference** and **Notes**.
6. Click **Post Sales Return**.

This posts the same accounting entries described in Section 3, but without linking to a
dispatch or specific product lines. Prefer the **Sales → Sales Returns** screen whenever a
dispatch exists, because it keeps the product-level detail and quantities.

---

## 7. Quick reference

| Item | Value |
|---|---|
| Screen | Sales → Sales Returns |
| Document number | `SRN-YYYYMM-NNNN` (auto) |
| Quantity unit | Dozens (decimals allowed) |
| Sales reversal | Dr Sales Returns 4010 / Cr Accounts Receivable (customer) |
| Cost reversal | Dr Finished Goods / Cr COGS 5100 (only if standard cost set) |
| Physical stock | **Not** updated automatically |
| Statuses | Draft → Posted → Cancelled |
