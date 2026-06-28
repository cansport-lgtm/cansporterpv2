# PostEx courier integration — Edge Function

Single function (`postex`) that brokers all calls to the PostEx COD Merchant API.
The PostEx token stays server-side; the browser never sees it.

## Go-live checklist (do in order)

1. **Rotate the PostEx API token.** The previous token was shared in plaintext —
   ask your PostEx account manager to reissue it before going live.

2. **Set the secret** (do NOT commit the token anywhere):
   ```
   supabase secrets set POSTEX_API_TOKEN='<new token>' --project-ref ojejlhnthhdvgbgpsgvi
   ```
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

3. **Fill in your pickup/merchant address code.** Call the `addresses` action once
   (or read it from your PostEx portal) and set it on the courier row:
   ```sql
   UPDATE public.courier_partners
   SET config = config || jsonb_build_object('merchant_address_code','<CODE>','pickup_address_code','<CODE>')
   WHERE code = 'POSTEX';
   ```

4. **Deploy** with JWT verification disabled (the app has no Supabase Auth):
   ```
   supabase functions deploy postex --no-verify-jwt --project-ref ojejlhnthhdvgbgpsgvi
   ```

5. **Test read-only first**, then one parcel, before enabling bulk booking:
   ```
   curl -X POST <FUNCTION_URL>/postex -H 'Content-Type: application/json' -d '{"action":"cities"}'
   curl -X POST <FUNCTION_URL>/postex -H 'Content-Type: application/json' -d '{"action":"track","orderId":"<id>"}'
   ```

6. **Schedule tracking sync** (pg_cron) once tracking is verified — e.g. every 3h:
   ```sql
   select cron.schedule('postex-track','0 */3 * * *', $$
     select net.http_post(
       url := '<FUNCTION_URL>/postex',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{"action":"track"}'::jsonb
     );
   $$);
   ```

## Actions
`book {orderId}` · `track {orderId?}` · `cancel {orderId}` · `cities` · `orderTypes` · `addresses`

## Notes
- Endpoint paths/versions live in `courier_partners.config` so they can be corrected
  without redeploying if your account's API guide version differs.
- Raw courier status is always saved to `online_orders.courier_order_status`; the
  internal `status` is only changed when it maps to a known value (see `mapStatus`).
- Verify the `create-order` payload field names against your PostEx API guide before
  enabling booking — fields are based on the documented COD API.
