-- ============================================================================
-- Gate Pass — Phase 2 (Returnable, Job work) and Phase 3 (Scrap, Manual backfill)
-- ----------------------------------------------------------------------------
-- Builds on 20260928120100_gate_pass.sql (Phase 1). Same rules: one GP number
-- series, tables read-only to the app, every write through a role-checked
-- SECURITY DEFINER function.
--
-- RETURNABLE  Machines, fixed assets, spare parts, store items or anything
--             else sent out for repair / loan, due back by a date. Manager
--             approval. At the gate: store items / products move to the
--             "Out for repair" location (stock_movements); spare parts leave
--             spare_parts.current_stock. Receipts bring them back.
-- JOB WORK    Material sent to a vendor for a process (printing, cutting…),
--             coming back as processed goods. Manager approval. At the gate the
--             material moves to "At job work". Each receipt uses up the
--             material there and receives the processed item. Whatever is left
--             when the pass is closed is booked as vendor wastage.
--             Both: status out → partially_returned → returned, or closed by a
--             manager with a reason. Overdue passes are notified daily.
-- SCRAP       Sold scrap, by scrap category. Needs manager approval. Rates are
--             entered per pass and kept in gate_pass_scrap_rates, which the gate
--             guard cannot read. At the gate the guard weighs the empty truck
--             then after each category, enters the slip numbers and a photo of
--             the weighbridge slip. Held (never released) if the vehicle does not
--             match, a category has more than the Scrap Yard holds, or the total
--             is over the approved estimate by more than the tolerance (10%).
--             Scrap Yard stock = opening balance + Scrap In entries − scrap out.
-- BACKFILL    A paper pass written in an emergency, entered later by a manager:
--             book + serial (must be in the book's range, unused, not spoiled),
--             the date/time on paper (no older than the backfill limit, default
--             7 days), a photo of the paper pass and a reason. Saved straight
--             to Out, dated on paper, with the same stock effects as the type.
--
-- Nothing in the existing dispatch, invoice, COGS or purchase flows changes.
-- ============================================================================

-- 1. Settings ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.gate_pass_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  backfill_max_days integer NOT NULL DEFAULT 7 CHECK (backfill_max_days BETWEEN 1 AND 60),
  scrap_overweight_pct numeric NOT NULL DEFAULT 10 CHECK (scrap_overweight_pct >= 0),
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.gate_pass_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- 2. Scrap Yard --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.gate_pass_scrap_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (length(btrim(name)) > 0),
  uom text NOT NULL DEFAULT 'kg',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- opening (one per category) and Scrap In add stock; scrap passes take it out.
CREATE TABLE IF NOT EXISTS public.gate_pass_scrap_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.gate_pass_scrap_categories(id) ON DELETE RESTRICT,
  entry_type text NOT NULL CHECK (entry_type IN ('opening','in','out')),
  entry_date date NOT NULL,
  quantity numeric NOT NULL CHECK (quantity >= 0),
  gate_pass_id uuid,
  remarks text,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gate_pass_scrap_opening_uk
  ON public.gate_pass_scrap_entries (category_id) WHERE entry_type = 'opening';
CREATE INDEX IF NOT EXISTS gate_pass_scrap_entries_idx
  ON public.gate_pass_scrap_entries (category_id, entry_date);

-- 3. Paper books (manual backfill) -------------------------------------------

CREATE TABLE IF NOT EXISTS public.gate_pass_books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_number text NOT NULL UNIQUE CHECK (length(btrim(book_number)) > 0),
  serial_from integer NOT NULL CHECK (serial_from > 0),
  serial_to integer NOT NULL,
  issued_to text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gate_pass_books_range_ck CHECK (serial_to >= serial_from AND serial_to - serial_from < 1000)
);

CREATE TABLE IF NOT EXISTS public.gate_pass_book_spoiled (
  book_id uuid NOT NULL REFERENCES public.gate_pass_books(id) ON DELETE CASCADE,
  serial integer NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (book_id, serial)
);

-- 4. New columns on passes and lines -----------------------------------------

ALTER TABLE public.gate_passes
  ADD COLUMN IF NOT EXISTS expected_return_date date,
  ADD COLUMN IF NOT EXISTS process_name text,
  ADD COLUMN IF NOT EXISTS weighbridge_photo_path text,
  ADD COLUMN IF NOT EXISTS is_backfill boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS book_id uuid REFERENCES public.gate_pass_books(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS book_serial integer,
  ADD COLUMN IF NOT EXISTS paper_datetime timestamptz,
  ADD COLUMN IF NOT EXISTS paper_photo_path text,
  ADD COLUMN IF NOT EXISTS backfill_reason text,
  ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS close_reason text;
CREATE UNIQUE INDEX IF NOT EXISTS gate_passes_book_serial_uk
  ON public.gate_passes (book_id, book_serial) WHERE book_id IS NOT NULL AND status <> 'cancelled';
CREATE INDEX IF NOT EXISTS gate_passes_return_due_idx
  ON public.gate_passes (expected_return_date) WHERE status IN ('out','partially_returned');

ALTER TABLE public.gate_pass_items
  ADD COLUMN IF NOT EXISTS item_id uuid REFERENCES public.items(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS machine_id uuid REFERENCES public.machines(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS fixed_asset_id uuid REFERENCES public.fixed_assets(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS spare_part_id uuid REFERENCES public.spare_parts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS scrap_category_id uuid REFERENCES public.gate_pass_scrap_categories(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS estimated_quantity numeric,
  ADD COLUMN IF NOT EXISTS expected_output_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expected_output_item_id uuid REFERENCES public.items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expected_output_description text,
  ADD COLUMN IF NOT EXISTS wastage_quantity numeric NOT NULL DEFAULT 0 CHECK (wastage_quantity >= 0);

-- Scrap rates: office only. The gate guard never reads money.
CREATE TABLE IF NOT EXISTS public.gate_pass_scrap_rates (
  gate_pass_id uuid NOT NULL REFERENCES public.gate_passes(id) ON DELETE CASCADE,
  scrap_category_id uuid NOT NULL REFERENCES public.gate_pass_scrap_categories(id) ON DELETE RESTRICT,
  rate numeric NOT NULL CHECK (rate >= 0),
  PRIMARY KEY (gate_pass_id, scrap_category_id)
);

CREATE TABLE IF NOT EXISTS public.gate_pass_weighments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gate_pass_id uuid NOT NULL REFERENCES public.gate_passes(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  scrap_category_id uuid REFERENCES public.gate_pass_scrap_categories(id) ON DELETE RESTRICT, -- NULL = empty truck
  reading numeric NOT NULL CHECK (reading >= 0),
  net numeric,
  slip_number text,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gate_pass_weighments_pass_idx ON public.gate_pass_weighments (gate_pass_id, seq);

-- Goods coming back against a returnable / job-work pass.
CREATE SEQUENCE IF NOT EXISTS public.gate_pass_receipt_number_seq;
CREATE TABLE IF NOT EXISTS public.gate_pass_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number text NOT NULL UNIQUE
    DEFAULT 'GPR-' || lpad(nextval('public.gate_pass_receipt_number_seq')::text, 6, '0'),
  gate_pass_id uuid NOT NULL REFERENCES public.gate_passes(id) ON DELETE CASCADE,
  receipt_date date NOT NULL,
  remarks text,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gate_pass_receipts_pass_idx ON public.gate_pass_receipts (gate_pass_id, receipt_date);

-- settled_quantity: what this receipt settles of the line sent (returned
-- as-is for a returnable; material used up for job work). The output_* fields
-- are the processed goods received (job work only).
CREATE TABLE IF NOT EXISTS public.gate_pass_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.gate_pass_receipts(id) ON DELETE CASCADE,
  gate_pass_item_id uuid NOT NULL REFERENCES public.gate_pass_items(id) ON DELETE CASCADE,
  settled_quantity numeric NOT NULL DEFAULT 0 CHECK (settled_quantity >= 0),
  output_product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
  output_item_id uuid REFERENCES public.items(id) ON DELETE RESTRICT,
  output_description text,
  output_uom text,
  output_quantity numeric NOT NULL DEFAULT 0 CHECK (output_quantity >= 0),
  rejected_quantity numeric NOT NULL DEFAULT 0 CHECK (rejected_quantity >= 0),
  remarks text
);
CREATE INDEX IF NOT EXISTS gate_pass_receipt_items_line_idx ON public.gate_pass_receipt_items (gate_pass_item_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['gate_pass_settings','gate_pass_scrap_categories','gate_pass_scrap_entries',
    'gate_pass_books','gate_pass_book_spoiled','gate_pass_weighments','gate_pass_receipts','gate_pass_receipt_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Read %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Read %s" ON public.%I FOR SELECT TO public USING (true);', t, t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated, service_role;', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', t);
  END LOOP;
END $$;

-- Rates are readable by the office gate pass roles only (not gate_security).
ALTER TABLE public.gate_pass_scrap_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read gate_pass_scrap_rates" ON public.gate_pass_scrap_rates;
CREATE POLICY "Read gate_pass_scrap_rates" ON public.gate_pass_scrap_rates FOR SELECT TO public
  USING (public.gate_pass_has_any_role(ARRAY['super_admin','gate_pass_manager','gate_pass_officer','gate_pass_viewer']));
GRANT SELECT ON public.gate_pass_scrap_rates TO anon, authenticated, service_role;
GRANT ALL ON public.gate_pass_scrap_rates TO service_role;

-- 5. Locations and photo storage --------------------------------------------

INSERT INTO public.inventory_locations (code, name, location_type, description) VALUES
  ('GP-REPAIR', 'Out for repair (gate pass)', 'external', 'Returnable goods outside the factory on a gate pass'),
  ('GP-JOBWORK', 'At job work (gate pass)', 'external', 'Material with job-work vendors on a gate pass')
ON CONFLICT (code) DO NOTHING;

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public) VALUES ('gate-pass-photos', 'gate-pass-photos', true)
    ON CONFLICT (id) DO NOTHING;
    DROP POLICY IF EXISTS "gate_pass_photos_read" ON storage.objects;
    CREATE POLICY "gate_pass_photos_read" ON storage.objects FOR SELECT USING (bucket_id = 'gate-pass-photos');
    DROP POLICY IF EXISTS "gate_pass_photos_insert" ON storage.objects;
    CREATE POLICY "gate_pass_photos_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'gate-pass-photos');
  END IF;
END $$;

-- 6. Views -------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_scrap_yard_balance AS
SELECT c.id AS category_id, c.name, c.uom, c.is_active,
       COALESCE(SUM(e.quantity) FILTER (WHERE e.entry_type = 'opening'), 0) AS opening,
       COALESCE(SUM(e.quantity) FILTER (WHERE e.entry_type = 'in'), 0) AS scrap_in,
       COALESCE(SUM(e.quantity) FILTER (WHERE e.entry_type = 'out'), 0) AS scrap_out,
       COALESCE(SUM(CASE WHEN e.entry_type = 'out' THEN -e.quantity ELSE e.quantity END), 0) AS balance
  FROM public.gate_pass_scrap_categories c
  LEFT JOIN public.gate_pass_scrap_entries e ON e.category_id = c.id
 GROUP BY c.id, c.name, c.uom, c.is_active;

-- Every line of a returnable / job-work pass that has gone out, with what came
-- back. balance = sent − settled by receipts − booked as wastage on close.
CREATE OR REPLACE VIEW public.v_gate_pass_open_lines AS
SELECT g.id AS gate_pass_id, g.pass_number, g.pass_type, g.status, g.party_name, g.process_name,
       g.expected_return_date, g.gate_out_at,
       (g.status IN ('out','partially_returned')
        AND g.expected_return_date < (now() AT TIME ZONE 'Asia/Karachi')::date) AS is_overdue,
       i.id AS gate_pass_item_id, i.line_no, i.description, i.uom, i.quantity AS sent,
       i.expected_output_description,
       COALESCE(r.settled, 0) AS settled,
       COALESCE(r.output, 0) AS output_received,
       COALESCE(r.rejected, 0) AS rejected,
       i.wastage_quantity AS wastage,
       i.quantity - COALESCE(r.settled, 0) - i.wastage_quantity AS balance
  FROM public.gate_passes g
  JOIN public.gate_pass_items i ON i.gate_pass_id = g.id
  LEFT JOIN (
    SELECT ri.gate_pass_item_id, SUM(ri.settled_quantity) AS settled,
           SUM(ri.output_quantity) AS output, SUM(ri.rejected_quantity) AS rejected
      FROM public.gate_pass_receipt_items ri GROUP BY ri.gate_pass_item_id
  ) r ON r.gate_pass_item_id = i.id
 WHERE g.pass_type IN ('returnable','job_work')
   AND g.status IN ('out','partially_returned','returned','closed')
   AND i.quantity > 0;

-- Each serial of each paper book, and what it was used for.
CREATE OR REPLACE VIEW public.v_gate_pass_book_serials AS
SELECT b.id AS book_id, b.book_number, s.serial,
       g.id AS gate_pass_id, g.pass_number, sp.reason AS spoiled_reason
  FROM public.gate_pass_books b
  CROSS JOIN LATERAL generate_series(b.serial_from, b.serial_to) AS s(serial)
  LEFT JOIN public.gate_passes g ON g.book_id = b.id AND g.book_serial = s.serial AND g.status <> 'cancelled'
  LEFT JOIN public.gate_pass_book_spoiled sp ON sp.book_id = b.id AND sp.serial = s.serial;

GRANT SELECT ON public.v_scrap_yard_balance, public.v_gate_pass_open_lines, public.v_gate_pass_book_serials
  TO anon, authenticated, service_role;

-- 7. Helpers -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.gate_pass_is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.gate_pass_has_any_role(ARRAY['super_admin']); $$;

CREATE OR REPLACE FUNCTION public.gate_pass_scrap_balance(p_category uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(SUM(CASE WHEN entry_type = 'out' THEN -quantity ELSE quantity END), 0)
    FROM public.gate_pass_scrap_entries WHERE category_id = p_category;
$$;

CREATE OR REPLACE FUNCTION public.gate_pass_location(p_code text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT id FROM public.inventory_locations WHERE code = p_code; $$;

-- What is still out on a line.
CREATE OR REPLACE FUNCTION public.gate_pass_line_balance(p_item uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT i.quantity - i.wastage_quantity
         - COALESCE((SELECT SUM(settled_quantity) FROM public.gate_pass_receipt_items WHERE gate_pass_item_id = i.id), 0)
    FROM public.gate_pass_items i WHERE i.id = p_item;
$$;

-- One stock movement for a line's product / store item, if it has one.
CREATE OR REPLACE FUNCTION public.gate_pass_move(
  p_kind text, p_product uuid, p_item uuid, p_qty numeric, p_from uuid, p_to uuid,
  p_date date, p_pass public.gate_passes, p_remarks text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_type text;
  v_id uuid;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN RETURN; END IF;
  IF p_product IS NOT NULL THEN
    v_type := 'finished_goods'; v_id := p_product;
  ELSIF p_item IS NOT NULL THEN
    SELECT CASE WHEN category::text = 'raw_material' THEN 'raw_material' ELSE 'consumable' END
      INTO v_type FROM public.items WHERE id = p_item;
    v_id := p_item;
  ELSE
    RETURN;
  END IF;
  INSERT INTO public.stock_movements
    (movement_number, movement_type, movement_date, item_type, item_id, quantity,
     from_location_id, to_location_id, reference_type, reference_id, reference_number,
     remarks, status, created_by)
  VALUES ('', p_kind, p_date, COALESCE(v_type, 'consumable'), v_id, p_qty,
          p_from, p_to, 'gate_pass', p_pass.id, p_pass.pass_number,
          p_remarks, 'completed', public.app_user_id());
END;
$$;

-- 8. Building lines ----------------------------------------------------------

-- Returnable and job-work lines.
-- p_lines: [{ kind: product|item|machine|fixed_asset|spare_part|other, ref_id, description,
--             uom, quantity, remarks,
--             output_kind: product|item|other, output_ref_id, output_description }]  -- output_*: job work
CREATE OR REPLACE FUNCTION public.gate_pass_build_goods(p_id uuid, p_type text, p_lines jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  l jsonb;
  v_no integer := 0;
  v_kind text;
  v_ref uuid;
  v_qty numeric;
  v_desc text;
  v_uom text;
  v_stock numeric;
  v_okind text;
  v_oref uuid;
  v_odesc text;
BEGIN
  DELETE FROM public.gate_pass_items WHERE gate_pass_id = p_id;
  FOR l IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    v_kind := COALESCE(NULLIF(l->>'kind', ''), 'other');
    v_ref := NULLIF(l->>'ref_id', '')::uuid;
    v_qty := NULLIF(l->>'quantity', '')::numeric;
    v_uom := NULLIF(btrim(l->>'uom'), '');
    v_desc := NULL;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Every line needs a quantity greater than zero.';
    END IF;
    IF p_type = 'job_work' AND v_kind NOT IN ('product','item','other') THEN
      RAISE EXCEPTION 'Job work lines are products, store items or free text.';
    END IF;
    IF v_kind <> 'other' AND v_ref IS NULL THEN
      RAISE EXCEPTION 'Select the % on every line.', replace(v_kind, '_', ' ');
    END IF;

    IF v_kind = 'product' THEN
      SELECT code || ' · ' || name INTO v_desc FROM public.products WHERE id = v_ref;
      v_uom := COALESCE(v_uom, 'pcs');
    ELSIF v_kind = 'item' THEN
      SELECT it.code || ' · ' || it.name, COALESCE(v_uom, NULLIF(u.symbol, ''), 'unit') INTO v_desc, v_uom
        FROM public.items it LEFT JOIN public.units_of_measure u ON u.id = it.uom_id WHERE it.id = v_ref;
    ELSIF v_kind = 'machine' THEN
      SELECT code || ' · ' || name INTO v_desc FROM public.machines WHERE id = v_ref;
      v_uom := 'no';
    ELSIF v_kind = 'fixed_asset' THEN
      SELECT asset_code || ' · ' || name INTO v_desc FROM public.fixed_assets WHERE id = v_ref;
      v_uom := 'no';
    ELSIF v_kind = 'spare_part' THEN
      SELECT code || ' · ' || name, COALESCE(NULLIF(unit_of_measure, ''), 'pcs'), COALESCE(current_stock, 0)
        INTO v_desc, v_uom, v_stock FROM public.spare_parts WHERE id = v_ref;
      IF v_qty <> trunc(v_qty) THEN
        RAISE EXCEPTION 'Spare parts are sent in whole numbers.';
      END IF;
      IF v_desc IS NOT NULL AND v_qty > v_stock THEN
        RAISE EXCEPTION 'Only % of spare part % are in stock.', v_stock, v_desc;
      END IF;
    ELSIF v_kind = 'other' THEN
      v_desc := NULLIF(btrim(l->>'description'), '');
      v_uom := COALESCE(v_uom, 'pcs');
    ELSE
      RAISE EXCEPTION 'Unknown line kind %.', v_kind;
    END IF;
    IF v_desc IS NULL AND v_kind = 'other' THEN
      RAISE EXCEPTION 'Describe every free-text line.';
    ELSIF v_desc IS NULL THEN
      RAISE EXCEPTION 'A selected % no longer exists.', replace(v_kind, '_', ' ');
    END IF;
    IF v_kind IN ('machine','fixed_asset') AND v_qty <> 1 THEN
      RAISE EXCEPTION 'A machine or asset line is always quantity 1.';
    END IF;

    v_okind := NULL; v_oref := NULL; v_odesc := NULL;
    IF p_type = 'job_work' THEN
      v_okind := COALESCE(NULLIF(l->>'output_kind', ''), 'other');
      v_oref := NULLIF(l->>'output_ref_id', '')::uuid;
      IF v_okind = 'product' AND v_oref IS NOT NULL THEN
        SELECT code || ' · ' || name INTO v_odesc FROM public.products WHERE id = v_oref;
      ELSIF v_okind = 'item' AND v_oref IS NOT NULL THEN
        SELECT code || ' · ' || name INTO v_odesc FROM public.items WHERE id = v_oref;
      ELSE
        v_okind := 'other'; v_oref := NULL;
        v_odesc := NULLIF(btrim(l->>'output_description'), '');
      END IF;
      IF v_odesc IS NULL THEN
        RAISE EXCEPTION 'Say what comes back from job work on every line.';
      END IF;
    END IF;

    v_no := v_no + 1;
    INSERT INTO public.gate_pass_items
      (gate_pass_id, line_no, description, uom, quantity, count_basis, remarks,
       product_id, item_id, machine_id, fixed_asset_id, spare_part_id,
       expected_output_product_id, expected_output_item_id, expected_output_description)
    VALUES (p_id, v_no, v_desc, v_uom, v_qty, 'quantity', NULLIF(btrim(l->>'remarks'), ''),
            CASE WHEN v_kind = 'product' THEN v_ref END,
            CASE WHEN v_kind = 'item' THEN v_ref END,
            CASE WHEN v_kind = 'machine' THEN v_ref END,
            CASE WHEN v_kind = 'fixed_asset' THEN v_ref END,
            CASE WHEN v_kind = 'spare_part' THEN v_ref END,
            CASE WHEN v_okind = 'product' THEN v_oref END,
            CASE WHEN v_okind = 'item' THEN v_oref END,
            v_odesc);
  END LOOP;
  IF v_no = 0 THEN
    RAISE EXCEPTION 'Add at least one line.';
  END IF;
END;
$$;

-- Scrap lines, one per category. p_lines: [{ scrap_category_id, quantity, rate }]
-- quantity is the estimate (the gate weighs the real figure); for a backfill it
-- is the weight on the paper pass.
CREATE OR REPLACE FUNCTION public.gate_pass_build_scrap(p_id uuid, p_lines jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  l jsonb;
  v_no integer := 0;
  v_cat public.gate_pass_scrap_categories%ROWTYPE;
  v_qty numeric;
  v_rate numeric;
  v_bal numeric;
BEGIN
  DELETE FROM public.gate_pass_items WHERE gate_pass_id = p_id;
  DELETE FROM public.gate_pass_scrap_rates WHERE gate_pass_id = p_id;
  FOR l IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    SELECT * INTO v_cat FROM public.gate_pass_scrap_categories
     WHERE id = NULLIF(l->>'scrap_category_id', '')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Select the scrap category on every line.';
    END IF;
    IF NOT v_cat.is_active THEN
      RAISE EXCEPTION 'Scrap category % is not active.', v_cat.name;
    END IF;
    IF EXISTS (SELECT 1 FROM public.gate_pass_items WHERE gate_pass_id = p_id AND scrap_category_id = v_cat.id) THEN
      RAISE EXCEPTION 'Scrap category % is on the pass twice.', v_cat.name;
    END IF;
    v_qty := NULLIF(l->>'quantity', '')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Enter the weight for %.', v_cat.name;
    END IF;
    v_rate := NULLIF(l->>'rate', '')::numeric;
    IF v_rate IS NULL OR v_rate < 0 THEN
      RAISE EXCEPTION 'Enter the rate for %.', v_cat.name;
    END IF;
    v_bal := public.gate_pass_scrap_balance(v_cat.id);
    IF v_qty > v_bal THEN
      RAISE EXCEPTION 'The Scrap Yard has only % % of %.', v_bal, v_cat.uom, v_cat.name;
    END IF;
    v_no := v_no + 1;
    INSERT INTO public.gate_pass_items
      (gate_pass_id, line_no, description, uom, quantity, estimated_quantity, count_basis, scrap_category_id)
    VALUES (p_id, v_no, v_cat.name, v_cat.uom, v_qty, v_qty, 'quantity', v_cat.id);
    INSERT INTO public.gate_pass_scrap_rates (gate_pass_id, scrap_category_id, rate)
    VALUES (p_id, v_cat.id, v_rate);
  END LOOP;
  IF v_no = 0 THEN
    RAISE EXCEPTION 'Add at least one scrap category.';
  END IF;
END;
$$;

-- 9. Save / submit (replaces the Phase 1 versions) ----------------------------

-- p_data (in addition to Phase 1):
--   returnable: party_kind supplier|other, party_id, party_name, expected_return_date, lines
--   job_work:   the same + process_name; lines carry output_*
--   scrap:      party_kind customer|supplier|other, party_id, party_name, lines [{scrap_category_id, quantity, rate}]
--   backfill:   { book_id, book_serial, paper_datetime, photo_path, reason } — managers only;
--               the pass is saved straight to Out, dated on paper.
CREATE OR REPLACE FUNCTION public.gate_pass_save(p_id uuid, p_data jsonb, p_submit boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_type text := p_data->>'pass_type';
  v_old public.gate_passes%ROWTYPE;
  v_id uuid := p_id;
  v_party_name text;
  v_party_id uuid;
  v_party_kind text;
  v_ids uuid[];
  v_vehicle text := NULLIF(btrim(p_data->>'vehicle_number'), '');
  v_remarks text := NULLIF(btrim(p_data->>'remarks'), '');
  v_bf jsonb := CASE WHEN jsonb_typeof(p_data->'backfill') = 'object' THEN p_data->'backfill' END;
  v_book public.gate_pass_books%ROWTYPE;
  v_serial integer;
  v_paper timestamptz;
  v_max integer;
  v_due date := NULLIF(p_data->>'expected_return_date', '')::date;
  v_date date := COALESCE(NULLIF(p_data->>'pass_date', '')::date, (now() AT TIME ZONE 'Asia/Karachi')::date);
BEGIN
  IF NOT public.gate_pass_can('create') THEN
    RAISE EXCEPTION 'You do not have permission to make gate passes.';
  END IF;
  IF v_type IS NULL OR v_type NOT IN ('sales','sample','supplier_return','returnable','job_work','scrap') THEN
    RAISE EXCEPTION 'Choose what is leaving.';
  END IF;

  IF v_bf IS NOT NULL THEN
    IF NOT public.gate_pass_can('approve') THEN
      RAISE EXCEPTION 'Only a gate pass manager can enter a manual backfill.';
    END IF;
    IF p_id IS NOT NULL THEN
      RAISE EXCEPTION 'A backfill is entered in one go, not from a draft.';
    END IF;
    SELECT * INTO v_book FROM public.gate_pass_books WHERE id = NULLIF(v_bf->>'book_id', '')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Select the paper book.';
    END IF;
    IF NOT v_book.is_active THEN
      RAISE EXCEPTION 'Paper book % is closed.', v_book.book_number;
    END IF;
    v_serial := NULLIF(v_bf->>'book_serial', '')::integer;
    IF v_serial IS NULL OR v_serial NOT BETWEEN v_book.serial_from AND v_book.serial_to THEN
      RAISE EXCEPTION 'Serial must be between % and % for book %.', v_book.serial_from, v_book.serial_to, v_book.book_number;
    END IF;
    IF EXISTS (SELECT 1 FROM public.gate_pass_book_spoiled WHERE book_id = v_book.id AND serial = v_serial) THEN
      RAISE EXCEPTION 'Serial % of book % is marked spoiled.', v_serial, v_book.book_number;
    END IF;
    IF EXISTS (SELECT 1 FROM public.gate_passes WHERE book_id = v_book.id AND book_serial = v_serial AND status <> 'cancelled') THEN
      RAISE EXCEPTION 'Serial % of book % is already entered.', v_serial, v_book.book_number;
    END IF;
    v_paper := NULLIF(v_bf->>'paper_datetime', '')::timestamptz;
    SELECT backfill_max_days INTO v_max FROM public.gate_pass_settings WHERE id;
    IF v_paper IS NULL THEN
      RAISE EXCEPTION 'Enter the date and time written on the paper pass.';
    END IF;
    IF v_paper > now() + interval '5 minutes' THEN
      RAISE EXCEPTION 'The paper date cannot be in the future.';
    END IF;
    IF v_paper < now() - make_interval(days => COALESCE(v_max, 7)) THEN
      RAISE EXCEPTION 'A paper pass older than % days cannot be backfilled.', COALESCE(v_max, 7);
    END IF;
    IF NULLIF(btrim(v_bf->>'photo_path'), '') IS NULL THEN
      RAISE EXCEPTION 'Add a photo of the paper pass.';
    END IF;
    IF NULLIF(btrim(v_bf->>'reason'), '') IS NULL THEN
      RAISE EXCEPTION 'Say why a paper pass was used.';
    END IF;
    v_date := (v_paper AT TIME ZONE 'Asia/Karachi')::date;
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT * INTO v_old FROM public.gate_passes WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Gate pass not found.';
    END IF;
    IF v_old.status <> 'draft' THEN
      RAISE EXCEPTION 'Gate pass % is % and can no longer be edited.', v_old.pass_number, replace(v_old.status, '_', ' ');
    END IF;
    IF v_old.pass_type <> v_type THEN
      RAISE EXCEPTION 'The type of a saved pass cannot be changed. Cancel it and make a new one.';
    END IF;
    IF v_old.created_by IS DISTINCT FROM v_uid AND NOT public.gate_pass_can('approve') THEN
      RAISE EXCEPTION 'Only the person who made this draft or a manager can edit it.';
    END IF;
  ELSE
    -- A placeholder number until every check has passed, so a failed save
    -- never uses up a GP number and the series stays without gaps.
    INSERT INTO public.gate_passes (pass_number, pass_type, party_name, created_by)
    VALUES ('NEW-' || gen_random_uuid()::text, v_type, '—', v_uid)
    RETURNING id INTO v_id;
  END IF;

  IF v_type = 'sales' THEN
    IF v_vehicle IS NULL THEN
      RAISE EXCEPTION 'Enter the vehicle number.';
    END IF;
    SELECT array_agg(DISTINCT x::uuid) INTO v_ids
      FROM jsonb_array_elements_text(COALESCE(p_data->'dispatch_ids', '[]'::jsonb)) x;
    SELECT b.party_name, b.party_id INTO v_party_name, v_party_id
      FROM public.gate_pass_build_sales(v_id, v_ids) b;
    v_party_kind := 'customer';
  ELSIF v_type = 'supplier_return' THEN
    SELECT b.party_name, b.party_id INTO v_party_name, v_party_id
      FROM public.gate_pass_build_supplier_return(v_id, NULLIF(p_data->>'purchase_return_id', '')::uuid) b;
    v_party_kind := 'supplier';
  ELSE
    v_party_kind := COALESCE(NULLIF(p_data->>'party_kind', ''), 'other');
    v_party_id := NULLIF(p_data->>'party_id', '')::uuid;
    IF v_type = 'sample' AND v_party_kind NOT IN ('customer','distributor','other')
       OR v_type IN ('returnable','job_work') AND v_party_kind NOT IN ('supplier','other')
       OR v_type = 'scrap' AND v_party_kind NOT IN ('customer','supplier','other') THEN
      RAISE EXCEPTION 'Choose who the goods are going to.';
    END IF;
    IF v_party_kind = 'other' THEN
      v_party_id := NULL;
      v_party_name := NULLIF(btrim(p_data->>'party_name'), '');
    ELSIF v_party_id IS NOT NULL THEN
      SELECT name INTO v_party_name
        FROM (SELECT id, name FROM public.customers WHERE v_party_kind = 'customer'
              UNION ALL SELECT id, name FROM public.distributors WHERE v_party_kind = 'distributor'
              UNION ALL SELECT id, name FROM public.suppliers WHERE v_party_kind = 'supplier') p
       WHERE p.id = v_party_id;
    END IF;
    IF v_party_name IS NULL THEN
      RAISE EXCEPTION 'Choose who the goods are going to.';
    END IF;

    IF v_type = 'sample' THEN
      IF v_remarks IS NULL THEN
        RAISE EXCEPTION 'Give the reason for these samples.';
      END IF;
      PERFORM public.gate_pass_build_sample(v_id, p_data->'lines');
    ELSIF v_type IN ('returnable','job_work') THEN
      IF v_due IS NULL THEN
        RAISE EXCEPTION 'Enter the date the goods are due back.';
      END IF;
      IF v_due < v_date THEN
        RAISE EXCEPTION 'The return date cannot be before the pass date.';
      END IF;
      IF v_type = 'job_work' AND NULLIF(btrim(p_data->>'process_name'), '') IS NULL THEN
        RAISE EXCEPTION 'Say what process the vendor is doing (e.g. printing).';
      END IF;
      PERFORM public.gate_pass_build_goods(v_id, v_type, p_data->'lines');
    ELSE
      PERFORM public.gate_pass_build_scrap(v_id, p_data->'lines');
    END IF;
  END IF;

  UPDATE public.gate_passes
     SET pass_date = v_date,
         party_kind = v_party_kind,
         party_id = v_party_id,
         party_name = v_party_name,
         vehicle_number = v_vehicle,
         driver_name = NULLIF(btrim(p_data->>'driver_name'), ''),
         driver_contact = NULLIF(btrim(p_data->>'driver_contact'), ''),
         transporter_name = NULLIF(btrim(p_data->>'transporter_name'), ''),
         purchase_return_id = CASE WHEN v_type = 'supplier_return'
                                   THEN NULLIF(p_data->>'purchase_return_id', '')::uuid END,
         expected_return_date = CASE WHEN v_type IN ('returnable','job_work') THEN v_due END,
         process_name = CASE WHEN v_type = 'job_work' THEN NULLIF(btrim(p_data->>'process_name'), '') END,
         remarks = v_remarks,
         pass_number = CASE WHEN p_id IS NULL
                            THEN 'GP-' || lpad(nextval('public.gate_pass_number_seq')::text, 6, '0')
                            ELSE pass_number END,
         updated_at = now()
   WHERE id = v_id;

  PERFORM public.gate_pass_log(v_id, CASE WHEN p_id IS NULL THEN 'created' ELSE 'edited' END);

  IF v_bf IS NOT NULL THEN
    -- The goods already left on the paper pass: straight to Out, dated on paper.
    UPDATE public.gate_passes
       SET is_backfill = true, book_id = v_book.id, book_serial = v_serial,
           paper_datetime = v_paper, paper_photo_path = btrim(v_bf->>'photo_path'),
           backfill_reason = btrim(v_bf->>'reason'),
           status = 'approved', submitted_at = now(), approved_by = v_uid, approved_at = now(),
           approval_remarks = 'Manual backfill of paper pass ' || v_book.book_number || ' / ' || v_serial,
           updated_at = now()
     WHERE id = v_id;
    PERFORM public.gate_pass_log(v_id, 'backfilled',
      'Paper pass ' || v_book.book_number || ' / ' || v_serial || ': ' || btrim(v_bf->>'reason'));
    PERFORM public.gate_pass_mark_out(v_id, v_paper);
  ELSIF p_submit THEN
    PERFORM public.gate_pass_submit(v_id);
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.gate_pass_submit(p_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.gate_passes%ROWTYPE;
  v_ids uuid[];
  v_bad text;
BEGIN
  IF NOT public.gate_pass_can('create') THEN
    RAISE EXCEPTION 'You do not have permission to submit gate passes.';
  END IF;
  SELECT * INTO g FROM public.gate_passes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate pass not found.';
  END IF;
  IF g.status <> 'draft' THEN
    RAISE EXCEPTION 'Gate pass % is already %.', g.pass_number, replace(g.status, '_', ' ');
  END IF;

  -- Re-check the source documents and stock: they may have changed since the draft.
  IF g.pass_type = 'sales' THEN
    SELECT array_agg(dispatch_id) INTO v_ids FROM public.gate_pass_dispatches WHERE gate_pass_id = p_id;
    PERFORM public.gate_pass_build_sales(p_id, v_ids);
  ELSIF g.pass_type = 'supplier_return' THEN
    PERFORM public.gate_pass_build_supplier_return(p_id, g.purchase_return_id);
  ELSIF NOT EXISTS (SELECT 1 FROM public.gate_pass_items WHERE gate_pass_id = p_id) THEN
    RAISE EXCEPTION 'Add at least one line.';
  ELSIF g.pass_type = 'scrap' THEN
    SELECT string_agg(i.description, ', ') INTO v_bad
      FROM public.gate_pass_items i
     WHERE i.gate_pass_id = p_id AND i.quantity > public.gate_pass_scrap_balance(i.scrap_category_id);
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'The Scrap Yard no longer holds enough of: %.', v_bad;
    END IF;
  END IF;

  IF g.pass_type IN ('sales','supplier_return') THEN
    UPDATE public.gate_passes
       SET status = 'approved', submitted_at = now(), approved_at = now(), approved_by = NULL,
           approval_remarks = CASE g.pass_type
             WHEN 'sales' THEN 'Approved automatically: the sales orders are approved.'
             ELSE 'Approved automatically: goes back on a purchase return.' END,
           updated_at = now()
     WHERE id = p_id;
    PERFORM public.gate_pass_log(p_id, 'approved', 'Approved automatically');
    RETURN 'approved';
  END IF;

  UPDATE public.gate_passes
     SET status = 'pending_approval', submitted_at = now(), updated_at = now()
   WHERE id = p_id;
  PERFORM public.gate_pass_log(p_id, 'submitted', 'Sent for approval');
  SELECT * INTO g FROM public.gate_passes WHERE id = p_id;
  PERFORM public.gate_pass_notify(g, 'Gate pass needs approval',
    g.pass_number || ' · ' || initcap(replace(g.pass_type, '_', ' ')) || ' for ' || g.party_name,
    'info', false, true);
  RETURN 'pending_approval';
END;
$$;

-- 10. Out (replaces the Phase 1 version; adds p_at for backfills) ------------

DROP FUNCTION IF EXISTS public.gate_pass_mark_out(uuid);
CREATE OR REPLACE FUNCTION public.gate_pass_mark_out(p_id uuid, p_at timestamptz DEFAULT now())
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  g public.gate_passes%ROWTYPE;
  i public.gate_pass_items%ROWTYPE;
  v_day date := (p_at AT TIME ZONE 'Asia/Karachi')::date;
  v_loc uuid;
BEGIN
  UPDATE public.gate_passes
     SET status = 'out', gate_out_by = v_uid, gate_out_at = p_at, updated_at = now()
   WHERE id = p_id
  RETURNING * INTO g;

  IF g.pass_type = 'sample' THEN
    INSERT INTO public.stock_movements
      (movement_number, movement_type, movement_date, item_type, item_id, quantity,
       reference_type, reference_id, reference_number, remarks, status, created_by)
    SELECT '', 'issue', v_day, 'finished_goods', it.product_id,
           CASE it.uom WHEN 'pcs' THEN it.quantity / 12 ELSE it.quantity END,
           'gate_pass', g.id, g.pass_number,
           'Sample to ' || g.party_name || ' (' || it.quantity || ' ' || it.uom || ')',
           'completed', v_uid
      FROM public.gate_pass_items it
     WHERE it.gate_pass_id = g.id AND it.product_id IS NOT NULL AND it.quantity > 0;
  ELSIF g.pass_type = 'sales' THEN
    UPDATE public.sales_dispatches sd
       SET delivery_status = 'in_transit'
      FROM public.gate_pass_dispatches gd
     WHERE gd.gate_pass_id = g.id AND sd.id = gd.dispatch_id AND sd.delivery_status = 'pending';
  ELSIF g.pass_type IN ('returnable','job_work') THEN
    v_loc := public.gate_pass_location(CASE g.pass_type WHEN 'returnable' THEN 'GP-REPAIR' ELSE 'GP-JOBWORK' END);
    FOR i IN SELECT * FROM public.gate_pass_items WHERE gate_pass_id = g.id AND quantity > 0 LOOP
      PERFORM public.gate_pass_move('transfer', i.product_id, i.item_id, i.quantity, NULL, v_loc, v_day, g,
        initcap(replace(g.pass_type, '_', ' ')) || ' to ' || g.party_name);
      IF i.spare_part_id IS NOT NULL THEN
        UPDATE public.spare_parts SET current_stock = COALESCE(current_stock, 0) - i.quantity::integer
         WHERE id = i.spare_part_id;
      END IF;
    END LOOP;
  ELSIF g.pass_type = 'scrap' THEN
    INSERT INTO public.gate_pass_scrap_entries
      (category_id, entry_type, entry_date, quantity, gate_pass_id, remarks, created_by)
    SELECT it.scrap_category_id, 'out', v_day, it.quantity, g.id,
           g.pass_number || ' to ' || g.party_name, v_uid
      FROM public.gate_pass_items it
     WHERE it.gate_pass_id = g.id AND it.scrap_category_id IS NOT NULL AND it.quantity > 0;
  END IF;

  PERFORM public.gate_pass_log(p_id, 'out', CASE WHEN g.is_backfill THEN 'Left on the paper pass' ELSE 'Vehicle left the gate' END);
END;
$$;

-- 11. Gate check / release: scrap is weighed, never counted or released -----

-- Wrap the Phase 1 gate check: scrap goes through gate_pass_scrap_weigh.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'gate_pass_gate_check_count') THEN
    ALTER FUNCTION public.gate_pass_gate_check(uuid, jsonb, text, text) RENAME TO gate_pass_gate_check_count;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.gate_pass_gate_check_count(uuid, jsonb, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.gate_pass_gate_check(
  p_id uuid, p_counts jsonb, p_vehicle text DEFAULT NULL, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.gate_passes WHERE id = p_id AND pass_type = 'scrap') THEN
    RAISE EXCEPTION 'A scrap pass is weighed at the gate, not counted.';
  END IF;
  RETURN public.gate_pass_gate_check_count(p_id, p_counts, p_vehicle, p_note);
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'gate_pass_release_counted') THEN
    ALTER FUNCTION public.gate_pass_release(uuid, text) RENAME TO gate_pass_release_counted;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.gate_pass_release_counted(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.gate_pass_release(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.gate_passes WHERE id = p_id AND pass_type = 'scrap') THEN
    RAISE EXCEPTION 'A held scrap pass cannot be released. Unload to the approved weight and weigh again, or cancel the pass.';
  END IF;
  PERFORM public.gate_pass_release_counted(p_id, p_reason);
END;
$$;

-- The guard's weighment for a scrap pass.
-- p_readings (in weighing order): [{ "scrap_category_id": null, "reading": 3420, "slip": "WB-1" },   -- empty truck
--                                  { "scrap_category_id": "<uuid>", "reading": 4280, "slip": "WB-2" }, …]
-- Returns { status: out|held, problems: [text], nets: [{scrap_category_id, net}] }.
CREATE OR REPLACE FUNCTION public.gate_pass_scrap_weigh(
  p_id uuid, p_readings jsonb, p_vehicle text, p_photo_path text, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  g public.gate_passes%ROWTYPE;
  r jsonb;
  v_seq integer := 0;
  v_prev numeric;
  v_read numeric;
  v_cat uuid;
  v_problems text[] := ARRAY[]::text[];
  v_pct numeric;
  v_total numeric;
  v_est numeric;
  v_bad text;
BEGIN
  IF NOT public.gate_pass_can('gate') THEN
    RAISE EXCEPTION 'Only gate security or a gate pass manager can weigh at the gate.';
  END IF;
  SELECT * INTO g FROM public.gate_passes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR g.pass_type <> 'scrap' THEN
    RAISE EXCEPTION 'This is not a scrap pass.';
  END IF;
  IF g.status = 'out' THEN
    RAISE EXCEPTION 'Gate pass % has already gone out.', g.pass_number;
  END IF;
  IF g.status NOT IN ('approved','held') THEN
    RAISE EXCEPTION 'Gate pass % is % — it cannot leave yet.', g.pass_number, replace(g.status, '_', ' ');
  END IF;
  IF NULLIF(btrim(p_photo_path), '') IS NULL THEN
    RAISE EXCEPTION 'Take a photo of the weighbridge slip.';
  END IF;
  IF jsonb_typeof(p_readings) <> 'array' OR jsonb_array_length(p_readings) < 2 THEN
    RAISE EXCEPTION 'Weigh the empty truck and then after each scrap category.';
  END IF;

  DELETE FROM public.gate_pass_weighments WHERE gate_pass_id = p_id;
  FOR r IN SELECT * FROM jsonb_array_elements(p_readings) LOOP
    v_read := NULLIF(r->>'reading', '')::numeric;
    v_cat := NULLIF(r->>'scrap_category_id', '')::uuid;
    IF v_read IS NULL OR v_read < 0 THEN
      RAISE EXCEPTION 'Enter every scale reading.';
    END IF;
    IF v_seq = 0 AND v_cat IS NOT NULL THEN
      RAISE EXCEPTION 'The first weighing is the empty truck.';
    END IF;
    IF v_seq > 0 THEN
      IF v_cat IS NULL OR NOT EXISTS (SELECT 1 FROM public.gate_pass_items WHERE gate_pass_id = p_id AND scrap_category_id = v_cat) THEN
        RAISE EXCEPTION 'Each weighing after the empty truck must be for a scrap category on the pass.';
      END IF;
      IF EXISTS (SELECT 1 FROM public.gate_pass_weighments WHERE gate_pass_id = p_id AND scrap_category_id = v_cat) THEN
        RAISE EXCEPTION 'A scrap category was weighed twice.';
      END IF;
      IF v_read <= v_prev THEN
        RAISE EXCEPTION 'Each reading must be higher than the one before it.';
      END IF;
    END IF;
    v_seq := v_seq + 1;
    INSERT INTO public.gate_pass_weighments (gate_pass_id, seq, scrap_category_id, reading, net, slip_number, created_by)
    VALUES (p_id, v_seq, v_cat, v_read, CASE WHEN v_seq > 1 THEN v_read - v_prev END,
            NULLIF(btrim(r->>'slip'), ''), v_uid);
    v_prev := v_read;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.gate_pass_items i WHERE i.gate_pass_id = p_id AND NOT EXISTS
               (SELECT 1 FROM public.gate_pass_weighments w WHERE w.gate_pass_id = p_id AND w.scrap_category_id = i.scrap_category_id)) THEN
    RAISE EXCEPTION 'Weigh every scrap category on the pass.';
  END IF;

  -- The weighed net becomes the line quantity (the estimate stays in estimated_quantity).
  UPDATE public.gate_pass_items i
     SET quantity = w.net, counted = w.net, counted_by = v_uid, counted_at = now()
    FROM public.gate_pass_weighments w
   WHERE i.gate_pass_id = p_id AND w.gate_pass_id = p_id AND w.scrap_category_id = i.scrap_category_id;

  IF public.gate_pass_norm_vehicle(g.vehicle_number) IS NOT NULL
     AND public.gate_pass_norm_vehicle(g.vehicle_number) IS DISTINCT FROM public.gate_pass_norm_vehicle(p_vehicle) THEN
    v_problems := v_problems || ('Vehicle ' || COALESCE(NULLIF(btrim(p_vehicle), ''), '(none)') || ' is not ' || g.vehicle_number);
  END IF;
  SELECT string_agg(i.description || ' ' || i.quantity || ' ' || i.uom || ' (yard has '
                    || public.gate_pass_scrap_balance(i.scrap_category_id) || ')', '; ')
    INTO v_bad
    FROM public.gate_pass_items i
   WHERE i.gate_pass_id = p_id AND i.quantity > public.gate_pass_scrap_balance(i.scrap_category_id);
  IF v_bad IS NOT NULL THEN
    v_problems := v_problems || ('More than the Scrap Yard holds: ' || v_bad);
  END IF;
  SELECT scrap_overweight_pct INTO v_pct FROM public.gate_pass_settings WHERE id;
  SELECT SUM(quantity), SUM(estimated_quantity) INTO v_total, v_est FROM public.gate_pass_items WHERE gate_pass_id = p_id;
  IF v_total > v_est * (1 + COALESCE(v_pct, 10) / 100) THEN
    v_problems := v_problems || ('Weighed ' || v_total || ' kg against an approved ' || v_est
                                 || ' kg (over ' || COALESCE(v_pct, 10) || '%)');
  END IF;

  UPDATE public.gate_passes
     SET gate_vehicle_number = NULLIF(btrim(p_vehicle), ''), weighbridge_photo_path = btrim(p_photo_path)
   WHERE id = p_id;

  IF cardinality(v_problems) = 0 THEN
    PERFORM public.gate_pass_mark_out(p_id);
    RETURN jsonb_build_object('status', 'out', 'problems', '[]'::jsonb);
  END IF;

  UPDATE public.gate_passes
     SET status = 'held', held_by = v_uid, held_at = now(),
         hold_note = array_to_string(v_problems, '; ') || COALESCE(' — ' || NULLIF(btrim(p_note), ''), ''),
         updated_at = now()
   WHERE id = p_id
  RETURNING * INTO g;
  PERFORM public.gate_pass_log(p_id, 'held', g.hold_note, jsonb_build_object('problems', to_jsonb(v_problems)));
  PERFORM public.gate_pass_notify(g, 'Scrap vehicle held at gate', g.pass_number || ' for ' || g.party_name || ': ' || g.hold_note,
    'warning', true, true);
  RETURN jsonb_build_object('status', 'held', 'problems', to_jsonb(v_problems));
END;
$$;

-- 12. Receipts and closing (returnable / job work) ----------------------------

-- p_lines: [{ gate_pass_item_id, settled_quantity, output_kind: product|item|other, output_ref_id,
--             output_description, output_uom, output_quantity, rejected_quantity, remarks }]
-- Returns the new receipt id.
CREATE OR REPLACE FUNCTION public.gate_pass_receive(p_id uuid, p_date date, p_lines jsonb, p_remarks text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.gate_passes%ROWTYPE;
  i public.gate_pass_items%ROWTYPE;
  l jsonb;
  v_rid uuid;
  v_n integer := 0;
  v_settle numeric;
  v_out numeric;
  v_rej numeric;
  v_okind text;
  v_oref uuid;
  v_odesc text;
  v_ouom text;
  v_loc uuid;
  v_bal numeric;
BEGIN
  IF NOT public.gate_pass_can('create') THEN
    RAISE EXCEPTION 'You do not have permission to receive goods on gate passes.';
  END IF;
  SELECT * INTO g FROM public.gate_passes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR g.pass_type NOT IN ('returnable','job_work') THEN
    RAISE EXCEPTION 'Only a returnable or job-work pass takes receipts.';
  END IF;
  IF g.status NOT IN ('out','partially_returned') THEN
    RAISE EXCEPTION 'Gate pass % is % — nothing is waiting to come back.', g.pass_number, replace(g.status, '_', ' ');
  END IF;
  IF p_date IS NULL OR p_date > (now() AT TIME ZONE 'Asia/Karachi')::date THEN
    RAISE EXCEPTION 'Enter the date the goods came back (not in the future).';
  END IF;
  v_loc := public.gate_pass_location(CASE g.pass_type WHEN 'returnable' THEN 'GP-REPAIR' ELSE 'GP-JOBWORK' END);

  -- Placeholder number until every line has passed its checks (no gaps in the GPR series).
  INSERT INTO public.gate_pass_receipts (receipt_number, gate_pass_id, receipt_date, remarks, created_by)
  VALUES ('NEW-' || gen_random_uuid()::text, p_id, p_date, NULLIF(btrim(p_remarks), ''), public.app_user_id())
  RETURNING id INTO v_rid;

  FOR l IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    SELECT * INTO i FROM public.gate_pass_items
     WHERE id = NULLIF(l->>'gate_pass_item_id', '')::uuid AND gate_pass_id = p_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A receipt line does not belong to this pass.';
    END IF;
    v_settle := COALESCE(NULLIF(l->>'settled_quantity', '')::numeric, 0);
    v_out := COALESCE(NULLIF(l->>'output_quantity', '')::numeric, 0);
    v_rej := COALESCE(NULLIF(l->>'rejected_quantity', '')::numeric, 0);
    IF v_settle < 0 OR v_out < 0 OR v_rej < 0 THEN
      RAISE EXCEPTION 'Quantities cannot be negative.';
    END IF;
    IF g.pass_type = 'returnable' THEN
      v_out := 0; v_rej := 0;
    END IF;
    IF v_settle = 0 AND v_out = 0 AND v_rej = 0 THEN
      CONTINUE;
    END IF;
    v_bal := public.gate_pass_line_balance(i.id);
    IF v_settle > v_bal THEN
      RAISE EXCEPTION '% — only % % is still out.', i.description, v_bal, i.uom;
    END IF;
    IF i.spare_part_id IS NOT NULL AND v_settle <> trunc(v_settle) THEN
      RAISE EXCEPTION 'Spare parts come back in whole numbers.';
    END IF;

    v_okind := NULL; v_oref := NULL; v_odesc := NULL; v_ouom := NULL;
    IF g.pass_type = 'job_work' AND (v_out > 0 OR v_rej > 0) THEN
      v_okind := COALESCE(NULLIF(l->>'output_kind', ''),
                          CASE WHEN i.expected_output_product_id IS NOT NULL THEN 'product'
                               WHEN i.expected_output_item_id IS NOT NULL THEN 'item' ELSE 'other' END);
      v_oref := COALESCE(NULLIF(l->>'output_ref_id', '')::uuid,
                         CASE v_okind WHEN 'product' THEN i.expected_output_product_id
                                      WHEN 'item' THEN i.expected_output_item_id END);
      IF v_okind = 'product' AND v_oref IS NOT NULL THEN
        SELECT code || ' · ' || name INTO v_odesc FROM public.products WHERE id = v_oref;
      ELSIF v_okind = 'item' AND v_oref IS NOT NULL THEN
        SELECT code || ' · ' || name INTO v_odesc FROM public.items WHERE id = v_oref;
      ELSE
        v_okind := 'other'; v_oref := NULL;
        v_odesc := COALESCE(NULLIF(btrim(l->>'output_description'), ''), i.expected_output_description);
      END IF;
      v_ouom := COALESCE(NULLIF(btrim(l->>'output_uom'), ''), i.uom);
    END IF;

    INSERT INTO public.gate_pass_receipt_items
      (receipt_id, gate_pass_item_id, settled_quantity, output_product_id, output_item_id,
       output_description, output_uom, output_quantity, rejected_quantity, remarks)
    VALUES (v_rid, i.id, v_settle,
            CASE WHEN v_okind = 'product' THEN v_oref END, CASE WHEN v_okind = 'item' THEN v_oref END,
            v_odesc, v_ouom, v_out, v_rej, NULLIF(btrim(l->>'remarks'), ''));
    v_n := v_n + 1;

    IF g.pass_type = 'returnable' THEN
      PERFORM public.gate_pass_move('transfer', i.product_id, i.item_id, v_settle, v_loc, NULL, p_date, g,
        'Back from ' || g.party_name);
      IF i.spare_part_id IS NOT NULL AND v_settle > 0 THEN
        UPDATE public.spare_parts SET current_stock = COALESCE(current_stock, 0) + v_settle::integer
         WHERE id = i.spare_part_id;
      END IF;
    ELSE
      PERFORM public.gate_pass_move('issue', i.product_id, i.item_id, v_settle, v_loc, NULL, p_date, g,
        'Used in job work by ' || g.party_name);
      PERFORM public.gate_pass_move('receipt',
        CASE WHEN v_okind = 'product' THEN v_oref END, CASE WHEN v_okind = 'item' THEN v_oref END,
        v_out, NULL, NULL, p_date, g, 'Job work output from ' || g.party_name);
    END IF;
  END LOOP;

  IF v_n = 0 THEN
    RAISE EXCEPTION 'Enter what came back on at least one line.';
  END IF;
  UPDATE public.gate_pass_receipts
     SET receipt_number = 'GPR-' || lpad(nextval('public.gate_pass_receipt_number_seq')::text, 6, '0')
   WHERE id = v_rid;

  UPDATE public.gate_passes
     SET status = CASE WHEN EXISTS (SELECT 1 FROM public.gate_pass_items it
                                     WHERE it.gate_pass_id = p_id AND public.gate_pass_line_balance(it.id) > 0)
                       THEN 'partially_returned' ELSE 'returned' END,
         updated_at = now()
   WHERE id = p_id
  RETURNING * INTO g;
  PERFORM public.gate_pass_log(p_id, 'received',
    (SELECT receipt_number FROM public.gate_pass_receipts WHERE id = v_rid)
      || CASE WHEN g.status = 'returned' THEN ' — everything is back' ELSE '' END);
  RETURN v_rid;
END;
$$;

-- A manager closes a returnable / job-work pass that will not come back in
-- full: what is still out is booked as wastage (job work) or written off.
CREATE OR REPLACE FUNCTION public.gate_pass_close(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.gate_passes%ROWTYPE;
  i public.gate_pass_items%ROWTYPE;
  v_bal numeric;
  v_loc uuid;
BEGIN
  IF NOT public.gate_pass_can('approve') THEN
    RAISE EXCEPTION 'Only a gate pass manager can close a pass.';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Give the reason for closing the pass.';
  END IF;
  SELECT * INTO g FROM public.gate_passes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR g.pass_type NOT IN ('returnable','job_work') THEN
    RAISE EXCEPTION 'Only a returnable or job-work pass can be closed.';
  END IF;
  IF g.status NOT IN ('out','partially_returned') THEN
    RAISE EXCEPTION 'Gate pass % is % and cannot be closed.', g.pass_number, replace(g.status, '_', ' ');
  END IF;
  v_loc := public.gate_pass_location(CASE g.pass_type WHEN 'returnable' THEN 'GP-REPAIR' ELSE 'GP-JOBWORK' END);

  FOR i IN SELECT * FROM public.gate_pass_items WHERE gate_pass_id = p_id LOOP
    v_bal := public.gate_pass_line_balance(i.id);
    IF v_bal > 0 THEN
      UPDATE public.gate_pass_items SET wastage_quantity = wastage_quantity + v_bal WHERE id = i.id;
      PERFORM public.gate_pass_move('issue', i.product_id, i.item_id, v_bal, v_loc, NULL,
        (now() AT TIME ZONE 'Asia/Karachi')::date, g,
        CASE g.pass_type WHEN 'job_work' THEN 'Job work wastage: ' ELSE 'Not returned: ' END || btrim(p_reason));
    END IF;
  END LOOP;

  UPDATE public.gate_passes
     SET status = 'closed', closed_by = public.app_user_id(), closed_at = now(), close_reason = btrim(p_reason),
         updated_at = now()
   WHERE id = p_id
  RETURNING * INTO g;
  PERFORM public.gate_pass_log(p_id, 'closed', btrim(p_reason));
  PERFORM public.gate_pass_notify(g, 'Gate pass closed', g.pass_number || ' for ' || g.party_name || ': ' || btrim(p_reason),
    'info', true, false);
END;
$$;

-- Daily: tell the maker and the managers about returnable / job-work passes past their return date.
CREATE OR REPLACE FUNCTION public.gate_pass_notify_overdue()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.gate_passes%ROWTYPE;
  v_n integer := 0;
  v_today date := (now() AT TIME ZONE 'Asia/Karachi')::date;
BEGIN
  FOR g IN SELECT * FROM public.gate_passes
            WHERE pass_type IN ('returnable','job_work') AND status IN ('out','partially_returned')
              AND expected_return_date < v_today LOOP
    PERFORM public.gate_pass_notify(g, 'Gate pass overdue',
      g.pass_number || ' · ' || initcap(replace(g.pass_type, '_', ' ')) || ' with ' || g.party_name
        || ' was due back on ' || to_char(g.expected_return_date, 'DD Mon YYYY')
        || ' (' || (v_today - g.expected_return_date) || ' day(s) late)',
      'warning', true, true);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'gate-pass-overdue';
    -- 04:05 UTC = 09:05 in Pakistan.
    PERFORM cron.schedule('gate-pass-overdue', '5 4 * * *', 'SELECT public.gate_pass_notify_overdue()');
  END IF;
END $$;

-- 13. Scrap Yard, paper books and settings -----------------------------------

CREATE OR REPLACE FUNCTION public.gate_pass_scrap_category_save(p_id uuid, p_name text, p_uom text, p_active boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid := p_id;
BEGIN
  IF NOT public.gate_pass_is_super_admin() THEN
    RAISE EXCEPTION 'Only a super admin can change scrap categories.';
  END IF;
  IF NULLIF(btrim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Enter the category name.';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.gate_pass_scrap_categories (name, uom, is_active)
    VALUES (btrim(p_name), COALESCE(NULLIF(btrim(p_uom), ''), 'kg'), COALESCE(p_active, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.gate_pass_scrap_categories
       SET name = btrim(p_name), uom = COALESCE(NULLIF(btrim(p_uom), ''), uom), is_active = COALESCE(p_active, is_active)
     WHERE id = v_id;
  END IF;
  RETURN v_id;
END;
$$;

-- Opening balance of a category (super admin). Can be changed until the
-- category has any Scrap In or scrap out.
CREATE OR REPLACE FUNCTION public.gate_pass_scrap_set_opening(p_category uuid, p_quantity numeric, p_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.gate_pass_is_super_admin() THEN
    RAISE EXCEPTION 'Only a super admin can set Scrap Yard opening balances.';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 0 OR p_date IS NULL THEN
    RAISE EXCEPTION 'Enter the opening weight and date.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.gate_pass_scrap_entries WHERE category_id = p_category AND entry_type <> 'opening') THEN
    RAISE EXCEPTION 'This category already has movements; its opening balance is locked.';
  END IF;
  DELETE FROM public.gate_pass_scrap_entries WHERE category_id = p_category AND entry_type = 'opening';
  INSERT INTO public.gate_pass_scrap_entries (category_id, entry_type, entry_date, quantity, remarks, created_by)
  VALUES (p_category, 'opening', p_date, p_quantity, 'Opening balance', public.app_user_id());
END;
$$;

CREATE OR REPLACE FUNCTION public.gate_pass_scrap_in(p_category uuid, p_quantity numeric, p_date date, p_remarks text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.gate_pass_can('create') THEN
    RAISE EXCEPTION 'You do not have permission to add scrap.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gate_pass_scrap_categories WHERE id = p_category AND is_active) THEN
    RAISE EXCEPTION 'Select an active scrap category.';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Enter the weight added.';
  END IF;
  IF p_date IS NULL OR p_date > (now() AT TIME ZONE 'Asia/Karachi')::date THEN
    RAISE EXCEPTION 'Enter the date (not in the future).';
  END IF;
  IF NULLIF(btrim(p_remarks), '') IS NULL THEN
    RAISE EXCEPTION 'Say where this scrap came from.';
  END IF;
  INSERT INTO public.gate_pass_scrap_entries (category_id, entry_type, entry_date, quantity, remarks, created_by)
  VALUES (p_category, 'in', p_date, p_quantity, btrim(p_remarks), public.app_user_id());
END;
$$;

CREATE OR REPLACE FUNCTION public.gate_pass_book_save(
  p_id uuid, p_book_number text, p_from integer, p_to integer, p_issued_to text, p_active boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid := p_id;
BEGIN
  IF NOT public.gate_pass_can('approve') THEN
    RAISE EXCEPTION 'Only a gate pass manager can manage paper books.';
  END IF;
  IF NULLIF(btrim(p_book_number), '') IS NULL OR p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'Enter the book number and a valid serial range.';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.gate_pass_books (book_number, serial_from, serial_to, issued_to, is_active, created_by)
    VALUES (btrim(p_book_number), p_from, p_to, NULLIF(btrim(p_issued_to), ''), COALESCE(p_active, true), public.app_user_id())
    RETURNING id INTO v_id;
  ELSE
    IF EXISTS (SELECT 1 FROM public.gate_passes WHERE book_id = v_id AND status <> 'cancelled'
                 AND (book_serial < p_from OR book_serial > p_to)) THEN
      RAISE EXCEPTION 'Serials already entered fall outside the new range.';
    END IF;
    UPDATE public.gate_pass_books
       SET book_number = btrim(p_book_number), serial_from = p_from, serial_to = p_to,
           issued_to = NULLIF(btrim(p_issued_to), ''), is_active = COALESCE(p_active, is_active)
     WHERE id = v_id;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.gate_pass_book_spoil(p_book uuid, p_serial integer, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE b public.gate_pass_books%ROWTYPE;
BEGIN
  IF NOT public.gate_pass_can('approve') THEN
    RAISE EXCEPTION 'Only a gate pass manager can mark a serial spoiled.';
  END IF;
  SELECT * INTO b FROM public.gate_pass_books WHERE id = p_book;
  IF NOT FOUND OR p_serial NOT BETWEEN b.serial_from AND b.serial_to THEN
    RAISE EXCEPTION 'That serial is not in the book.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.gate_passes WHERE book_id = p_book AND book_serial = p_serial AND status <> 'cancelled') THEN
    RAISE EXCEPTION 'Serial % is already entered as a gate pass.', p_serial;
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Give the reason (e.g. torn, written wrongly).';
  END IF;
  INSERT INTO public.gate_pass_book_spoiled (book_id, serial, reason, created_by)
  VALUES (p_book, p_serial, btrim(p_reason), public.app_user_id())
  ON CONFLICT (book_id, serial) DO UPDATE SET reason = EXCLUDED.reason;
END;
$$;

CREATE OR REPLACE FUNCTION public.gate_pass_settings_save(p_backfill_days integer, p_scrap_overweight_pct numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.gate_pass_is_super_admin() THEN
    RAISE EXCEPTION 'Only a super admin can change gate pass settings.';
  END IF;
  UPDATE public.gate_pass_settings
     SET backfill_max_days = p_backfill_days, scrap_overweight_pct = p_scrap_overweight_pct,
         updated_by = public.app_user_id(), updated_at = now()
   WHERE id;
END;
$$;

-- 14. Permissions ------------------------------------------------------------

GRANT EXECUTE ON FUNCTION
  public.gate_pass_is_super_admin(),
  public.gate_pass_scrap_balance(uuid),
  public.gate_pass_line_balance(uuid),
  public.gate_pass_save(uuid, jsonb, boolean),
  public.gate_pass_submit(uuid),
  public.gate_pass_gate_check(uuid, jsonb, text, text),
  public.gate_pass_release(uuid, text),
  public.gate_pass_scrap_weigh(uuid, jsonb, text, text, text),
  public.gate_pass_receive(uuid, date, jsonb, text),
  public.gate_pass_close(uuid, text),
  public.gate_pass_scrap_category_save(uuid, text, text, boolean),
  public.gate_pass_scrap_set_opening(uuid, numeric, date),
  public.gate_pass_scrap_in(uuid, numeric, date, text),
  public.gate_pass_book_save(uuid, text, integer, integer, text, boolean),
  public.gate_pass_book_spoil(uuid, integer, text),
  public.gate_pass_settings_save(integer, numeric)
TO anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION
  public.gate_pass_location(text),
  public.gate_pass_move(text, uuid, uuid, numeric, uuid, uuid, date, public.gate_passes, text),
  public.gate_pass_build_goods(uuid, text, jsonb),
  public.gate_pass_build_scrap(uuid, jsonb),
  public.gate_pass_mark_out(uuid, timestamptz),
  public.gate_pass_notify_overdue()
FROM PUBLIC, anon, authenticated;
