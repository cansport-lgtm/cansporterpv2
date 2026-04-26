

## Plan: Default Multiplier to `1` on Daily Stock Closing Entry (Planning)

On `src/pages/planning/DailyStockClosingPage.tsx`, the `× Multiplier` column currently uses `getDefaultMultiplier(unit)` (which returns 12 for dozens, 144 for cartons, etc.) when no existing entry is loaded. Per request, every row should default the multiplier to **`1`** when the entry form opens, while keeping the field freely editable.

### Change

In `src/pages/planning/DailyStockClosingPage.tsx`, inside the `useEffect` that initializes `stockEntries` from `planningItems` + `existingData`:

- When an existing row exists for the date → keep its saved `multiplier` (do not override historical data).
- When no existing row → set `multiplier: 1` instead of `getDefaultMultiplier(item.unit)`.

The `getDefaultMultiplier` helper can stay in the file (unused) or be removed — I'll remove it to keep the file clean.

### Behaviour after fix

- Opening Daily Stock Closing for a fresh date: every row's `× Multi` shows `1`, fully editable.
- Opening a date with previously saved entries: each row shows its saved multiplier (unchanged).
- Lock rules (non-super-admin can't edit once data exists) are unchanged.
- Quantity, remarks, save flow, department grouping — all unchanged.

### Out of scope

- No DB migration (multiplier column stays as-is; only the UI default changes).
- No changes to mobile card layout logic beyond the same default value flowing through.
- No changes to other stock-closing pages (Consumption module's `StockClosingPage` is separate and not affected).

### Acceptance

- New date → all `× Multi` inputs prefilled with `1`, editable.
- Existing date → saved multipliers preserved.
- Saving works exactly as before with whatever value the user leaves in the field.

