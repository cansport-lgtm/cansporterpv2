-- Material column names can be renamed by a super admin on Products / SKUs
-- (Column setup). Keep them non-empty, short and unique.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_material_slots_label_check') THEN
    ALTER TABLE public.product_material_slots
      ADD CONSTRAINT product_material_slots_label_check
      CHECK (length(btrim(label)) BETWEEN 1 AND 24);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS product_material_slots_label_unique
  ON public.product_material_slots (lower(btrim(label)));
