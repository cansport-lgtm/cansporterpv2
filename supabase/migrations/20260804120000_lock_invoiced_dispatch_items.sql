-- ============================================================================
-- sales_dispatch_items: freeze invoiced lines
-- ----------------------------------------------------------------------------
-- A dispatch item whose dispatch has been invoiced is the source of record for
-- the invoice quantity, the Sales/COGS vouchers, and the WIP ledger's "Sales"
-- outflow. Deleting it (e.g. via a sales-order delete, which cascades into
-- dispatch items) or changing its quantity leaves the invoice orphaned: the
-- customer is billed for goods the ledgers no longer see (this is exactly what
-- happened to DC-00141 / INV-202607-0067 on 17-18 Jul 2026).
--
-- This trigger blocks, for any dispatch item covered by a non-cancelled
-- domestic invoice (linked either via domestic_invoices.dispatch_id or
-- domestic_invoice_items.dispatch_item_id):
--   * DELETE
--   * UPDATE of quantity_dozens, or moving the row to another dispatch/order item
-- Logistics-only fields (packages, packing_type) stay editable. To change or
-- remove an invoiced quantity, cancel/reverse the invoice first.
-- ============================================================================

create or replace function public.guard_invoiced_dispatch_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice text;
begin
  select inv.invoice_number
    into v_invoice
    from domestic_invoices inv
   where coalesce(inv.status, '') <> 'cancelled'
     and (
       inv.dispatch_id = old.dispatch_id
       or exists (
         select 1
           from domestic_invoice_items ii
          where ii.invoice_id = inv.id
            and ii.dispatch_item_id = old.id
       )
     )
   limit 1;

  if v_invoice is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Cannot delete dispatch item: it is already invoiced (%). Cancel/reverse the invoice first.', v_invoice
      using errcode = 'P0001';
  end if;

  if new.quantity_dozens is distinct from old.quantity_dozens
     or new.dispatch_id is distinct from old.dispatch_id
     or new.order_item_id is distinct from old.order_item_id then
    raise exception 'Cannot change the quantity of an invoiced dispatch item (invoice %). Cancel/reverse the invoice first.', v_invoice
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_invoiced_dispatch_item on public.sales_dispatch_items;
create trigger trg_guard_invoiced_dispatch_item
  before update or delete on public.sales_dispatch_items
  for each row execute function public.guard_invoiced_dispatch_item();
