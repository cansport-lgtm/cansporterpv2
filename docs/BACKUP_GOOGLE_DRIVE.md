# Automatic daily database backup to Google Drive

Every day the entire Supabase database (schema + all data) is dumped and uploaded
to a Google Drive folder as a restorable `.sql` file and a `.json` file. Backups
older than the retention window (default **30 days**) are deleted automatically.

## How it works

```
pg_cron (daily, 20:00 UTC / 01:00 PKT)
        │  net.http_post  (apikey + x-backup-secret read from integration_secrets)
        ▼
Edge Function: db-backup-drive
        │  1. dump schema (backup_schema_sql) + every table (backup_list_tables)
        │  2. exchange Google refresh token → access token
        │  3. upload cansport_backup_<timestamp>.sql and .json to the Drive folder
        │  4. delete backups older than retention days
        ▼
backup_log table  ← status of each run (shown on the CEO Dashboard backup dialog)
```

Nothing secret is stored in git. All credentials live in the `integration_secrets`
table (RLS-locked; only the service role / Edge Functions can read it).

## One-time setup

### 1. Create a Google OAuth client

1. Go to <https://console.cloud.google.com/> → create/select a project.
2. **APIs & Services → Library →** enable **Google Drive API**.
3. **APIs & Services → OAuth consent screen:** choose **External**, add your
   email (`umairateeqsaeed@gmail.com`) as a **Test user**, and add the scope
   `.../auth/drive.file`. (Test mode is fine — the refresh token keeps working.)
4. **APIs & Services → Credentials → Create credentials → OAuth client ID →**
   Application type **Web application**. Add
   `https://developers.google.com/oauthplayground` as an **Authorized redirect
   URI**. Save the **Client ID** and **Client secret**.

### 2. Get a refresh token

Use the OAuth 2.0 Playground:

1. Open <https://developers.google.com/oauthplayground>.
2. Click the **gear icon** (top right) → check **Use your own OAuth
   credentials** → paste your Client ID and Client secret.
3. On the left, under **Step 1**, paste the scope
   `https://www.googleapis.com/auth/drive.file` and click **Authorize APIs**.
   Sign in as the account that owns the target Drive and allow access.
4. **Step 2 → Exchange authorization code for tokens.** Copy the **Refresh
   token** — this is long-lived.

### 3. Get the Drive folder id

Create a folder in Google Drive (e.g. "Cansport ERP Backups"). Open it; the id is
the last path segment of the URL:
`https://drive.google.com/drive/folders/`**`<THIS_IS_THE_FOLDER_ID>`**.

Because the backup uses the least-privilege `drive.file` scope, the function can
only see and manage files **it created** — it never touches anything else in your
Drive, and retention only prunes its own backups.

### 4. Generate a cron guard secret

Any random string (this protects the Edge Function endpoint). For example:

```bash
openssl rand -hex 24
```

### 5. Store everything in `integration_secrets`

Run this once in the **Supabase SQL editor** (values are never committed to git):

```sql
insert into public.integration_secrets (key, value) values
  ('supabase_publishable_key', 'sb_publishable_...'),   -- your project's publishable key
  ('backup_cron_secret',       '<random-from-step-4>'),
  ('google_oauth_client_id',     '<client id>'),
  ('google_oauth_client_secret', '<client secret>'),
  ('google_oauth_refresh_token', '<refresh token>'),
  ('google_drive_folder_id',     '<folder id>'),
  ('backup_retention_days',      '30')                   -- optional, defaults to 30
on conflict (key) do update set value = excluded.value, updated_at = now();
```

### 6. Deploy the function and apply the migrations

```bash
supabase functions deploy db-backup-drive --no-verify-jwt
supabase db push
```

`--no-verify-jwt` is required: the function does its own auth via `x-backup-secret`.
The migrations create the `backup_log` table and schedule the daily cron job.

## Verifying

- **Trigger a manual run** (replace the secret with your `backup_cron_secret`):

  ```bash
  curl -X POST \
    -H "x-backup-secret: <backup_cron_secret>" \
    -H "apikey: <supabase_publishable_key>" \
    https://ojejlhnthhdvgbgpsgvi.supabase.co/functions/v1/db-backup-drive
  ```

  A success response looks like `{"ok":true,"files":[...],"pruned":0,"tables":N}`.
- **Check the Drive folder** — two new `cansport_backup_...` files appear.
- **CEO Dashboard → ⋯ menu → Full Database Backup** shows the last automatic run
  (time, status, size) in the dialog.
- **Inspect the cron job / logs in SQL:**

  ```sql
  select * from cron.job where jobname = 'db-backup-drive-daily';
  select * from public.backup_log order by created_at desc limit 5;
  ```

## Changing the schedule or retention

- **Time:** edit the cron expression `'0 20 * * *'` in
  `supabase/migrations/20260707130000_schedule_db_backup_drive.sql` (UTC), or run
  `select cron.schedule('db-backup-drive-daily', '<expr>', $$ ... $$);` again.
- **Retention:** update the `backup_retention_days` row in `integration_secrets`.

## Restoring from a backup

1. Download the desired `cansport_backup_<timestamp>.sql` from Drive.
2. Restore into a database (ideally a fresh/empty project first to validate):

   ```bash
   psql "<postgres-connection-string>" -f cansport_backup_<timestamp>.sql
   ```

   The dump sets `session_replication_role = replica` around the data inserts so
   foreign keys and triggers don't block the load, then restores it.

The `.json` file contains the same data as `{ generated_at, schema_sql, tables }`
and is handy for programmatic inspection or partial restores.

## Notes / limits

- The dump is generated in memory in the Edge Function. This is fine for typical
  ERP sizes; for a very large database (hundreds of MB), consider Supabase's
  native scheduled backups (Pro plan) or a `pg_dump`-based job in addition.
- The `drive.file` scope means backups are owned by, and count against the storage
  of, the Google account that authorized in step 2.
