# Biometric attendance bridge

A small program on the office LAN reads the ZKTeco device and **pushes** punches
to this ERP over HTTPS. The ERP never connects to the device.

```
device --(LAN)--> bridge PC --HTTPS POST--> /api/bridge/* (Vercel) --RPC--> Supabase
```

## Pieces

| What | Where |
|------|-------|
| Routes `ping`, `attendance`, `users`, `heartbeat` | `api/bridge/*.ts` (Vercel functions, `_lib.ts` shared) |
| Tables `attendance_logs`, `device_users`, `device_status`, `bridge_config` | `supabase/migrations/20261201130000_biometric_bridge.sql` |
| Screens (HR > Biometric Attendance) | `src/pages/hr/BiometricAttendancePage.tsx` |
| Handler tests | `tests/bridge/bridge.test.ts` (`npx tsx --test tests/bridge/bridge.test.ts`) |
| Rollback | `supabase/rollbacks/20261201130000_biometric_bridge_down.sql` |

## Security

* Auth is the API key only: header `x-api-key`, compared in constant time
  (SHA-256 + `timingSafeEqual`) with the Vercel env var `BRIDGE_API_KEY`.
  The routes are outside the ERP login (the app has no server middleware).
* The Vercel functions talk to Supabase with the public publishable key, so every
  `bridge_*` SQL function **also** checks the key itself against
  `bridge_config.key_hash` (sha256 hex). `bridge_config` has no client access.
  Without the key the functions raise `unauthorized`.
* Rotate the key: set the new `BRIDGE_API_KEY` in Vercel (Production, Preview,
  Development), redeploy, then
  `update public.bridge_config set key_hash = '<sha256 hex of the new key>' where id = 1;`
  (compute the hash locally: `printf '%s' "$KEY" | sha256sum`). Never commit the key.

## Contract (summary)

All `POST`, JSON, header `x-api-key`. 401 bad/missing key; 400 invalid data (the bridge
will not retry); 5xx/429 retried by the bridge; 404/405 keep data queued.

* `/api/bridge/ping` -> `{ok, serverTime}`
* `/api/bridge/attendance` `{deviceSerial, records[<=500]}` -> `{ok, received, inserted, duplicates}`;
  one bulk `INSERT .. ON CONFLICT (external_id) DO NOTHING`, so resends are harmless.
* `/api/bridge/users` `{deviceSerial, users[]}` -> `{ok, received}`; upsert on
  (`device_serial`, `user_id`); employee links are never touched by a device sync.
* `/api/bridge/heartbeat` -> `{ok}`; one row per device. The UI shows **Offline** when the last
  heartbeat is older than 3 minutes regardless of `deviceOnline`.

## Employee mapping

On every users sync (and via the "Auto-match" button) a device user is linked to an
employee when its id equals `employees.employee_code` (exact, trimmed, then
zero-padding-insensitive) and the match is unambiguous. Everything else is listed under
**Device Users** (unmatched first) for manual linking (HR manager / officer, super admin).
Manual links are never overwritten.

## Daily summary

First punch of the day = in, last punch = out (the device button is unreliable); days are
grouped in `Asia/Karachi`. A day with a single punch shows no out time / hours.

## curl examples

```bash
KEY='<your key>'; BASE='https://cansporterpv2.vercel.app'
curl -i -X POST "$BASE/api/bridge/ping" -H "content-type: application/json" -H "x-api-key: $KEY" \
  -d '{"bridgeVersion":"1.0.0","deviceSerial":"AF6P210960074"}'
curl -i -X POST "$BASE/api/bridge/attendance" -H "content-type: application/json" -H "x-api-key: $KEY" \
  -d '{"deviceSerial":"AF6P210960074","records":[{"externalId":"AF6P210960074_TEST1_2026-01-01T09:00:00+05:00","userId":"TEST1","timestamp":"2026-01-01T09:00:00+05:00","verifyMode":"fingerprint","state":"check-in"}]}'
curl -i -X POST "$BASE/api/bridge/ping" -H "content-type: application/json" -H "x-api-key: wrong" -d '{}'   # 401
```

Remove test rows afterwards: `delete from attendance_logs where user_id = 'TEST1'; delete from device_users where user_id = 'TEST1';`
