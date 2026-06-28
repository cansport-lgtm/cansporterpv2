-- Phase 3: Courier integration foundation (PostEx + multi-courier ready)
--
-- Purely additive schema. No external calls happen here — the Edge Function
-- (deployed separately) is what talks to PostEx. Writes to these tables are
-- intended to come from the Edge Function using the service-role key (which
-- bypasses RLS); the anon frontend only reads.

-- Courier partners master -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.courier_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  api_base_url text,
  is_active boolean DEFAULT true,
  -- endpoint paths / merchant address code / store code live here so they can be
  -- corrected to match the merchant's PostEx API guide version without a redeploy.
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.courier_partners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "courier_partners_select" ON public.courier_partners FOR SELECT TO anon USING (true);
-- No anon write policies: only the Edge Function (service role) may modify these.

-- Per-parcel tracking event history ------------------------------------------
CREATE TABLE IF NOT EXISTS public.online_tracking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.online_orders(id) ON DELETE CASCADE,
  tracking_number text,
  status text,
  status_message text,
  event_time timestamptz,
  raw jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.online_tracking_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "online_tracking_events_select" ON public.online_tracking_events FOR SELECT TO anon USING (true);
-- No anon write policies: tracking history is written only by the Edge Function.

CREATE INDEX IF NOT EXISTS idx_tracking_events_order ON public.online_tracking_events(order_id);
CREATE INDEX IF NOT EXISTS idx_tracking_events_tracking ON public.online_tracking_events(tracking_number);

-- Courier linkage on orders ---------------------------------------------------
ALTER TABLE public.online_orders
  ADD COLUMN IF NOT EXISTS courier_partner_id uuid REFERENCES public.courier_partners(id),
  ADD COLUMN IF NOT EXISTS courier_order_status text,   -- raw status string from courier
  ADD COLUMN IF NOT EXISTS label_url text,              -- airway-bill / label location
  ADD COLUMN IF NOT EXISTS booked_at timestamptz,       -- when booked on the courier
  ADD COLUMN IF NOT EXISTS last_tracked_at timestamptz; -- last successful tracking sync

CREATE INDEX IF NOT EXISTS idx_online_orders_courier ON public.online_orders(courier_partner_id);
CREATE INDEX IF NOT EXISTS idx_online_orders_status ON public.online_orders(status);

-- Seed PostEx -----------------------------------------------------------------
-- Endpoint paths default to the documented PostEx COD Merchant API; adjust the
-- config JSON if your account's API guide version differs. The API token is NOT
-- stored here — it lives only as the POSTEX_API_TOKEN Edge Function secret.
INSERT INTO public.courier_partners (name, code, api_base_url, config)
VALUES (
  'PostEx',
  'POSTEX',
  'https://api.postex.pk/services/integration/api/order',
  jsonb_build_object(
    'auth_header', 'token',
    'create_order_path', '/v3/create-order',
    'track_order_path', '/v1/track-order',
    'cancel_order_path', '/v1/cancel-order',
    'operational_cities_path', '/v2/get-operational-city',
    'order_types_path', '/v1/get-order-type',
    'merchant_address_path', '/v1/get-merchant-address',
    'merchant_address_code', '',
    'pickup_address_code', ''
  )
)
ON CONFLICT (code) DO NOTHING;
