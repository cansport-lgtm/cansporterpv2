// Scheduled full-database backup to Google Drive.
//
// This is the automated sibling of the manual `db-backup` function. It produces
// the same restorable dumps (schema DDL + data), but instead of streaming them
// to a browser it uploads them straight to a Google Drive folder and then prunes
// backups older than the retention window. It is meant to be invoked once a day
// by pg_cron (see the schedule_db_backup_drive migration).
//
// Auth: this function is deployed with verify_jwt = false. It is protected by a
// shared secret — the caller must send header `x-backup-secret` matching the
// `backup_cron_secret` row in `integration_secrets`. The cron job reads that same
// value from the table at run time, so the secret never appears in git.
//
// All Google + Supabase config lives in `integration_secrets` (service-role only,
// RLS-locked). Required keys:
//   google_oauth_client_id       - OAuth 2.0 client id
//   google_oauth_client_secret   - OAuth 2.0 client secret
//   google_oauth_refresh_token   - long-lived refresh token (scope drive.file)
//   google_drive_folder_id       - target Drive folder id
//   backup_cron_secret           - shared secret guarding this function
// Optional:
//   backup_retention_days        - integer, default 30

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-backup-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PAGE = 1000;
const FILE_PREFIX = "cansport_backup_";

function quote(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}
function sqlVal(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "object") return quote(JSON.stringify(v));
  return quote(String(v));
}

// Build a complete dump as a single string. Mirrors the paging/ordering logic of
// the `db-backup` function so the two stay byte-compatible.
async function generateDump(
  svc: SupabaseClient,
  fmt: "sql" | "json",
  schemaSql: string,
  tableList: string[],
): Promise<string> {
  const parts: string[] = [];

  if (fmt === "sql") {
    parts.push(schemaSql || "");
    parts.push("\n\n-- ============ DATA ============\n");
    parts.push("SET session_replication_role = replica;\n\n");
  } else {
    parts.push("{\n");
    parts.push('"generated_at": ' + JSON.stringify(new Date().toISOString()) + ",\n");
    parts.push('"schema_sql": ' + JSON.stringify(schemaSql || "") + ",\n");
    parts.push('"tables": {\n');
  }

  for (let ti = 0; ti < tableList.length; ti++) {
    const table = tableList[ti];

    // Probe for a stable pagination key.
    const probe = await svc.from(table).select("*").limit(1);
    const sample = probe.data && probe.data[0];
    const cols = sample ? Object.keys(sample) : [];
    const orderCol = cols.includes("id") ? "id" : cols.includes("created_at") ? "created_at" : null;

    if (fmt === "json") parts.push((ti > 0 ? ",\n" : "") + JSON.stringify(table) + ": [");

    let from = 0;
    let firstRow = true;
    let headerWritten = false;
    for (;;) {
      let q = svc.from(table).select("*").range(from, from + PAGE - 1);
      if (orderCol) q = q.order(orderCol, { ascending: true });
      const { data, error } = await q;
      if (error) {
        if (fmt === "sql") parts.push(`-- ERROR dumping ${table}: ${error.message}\n`);
        break;
      }
      if (!data || data.length === 0) break;
      for (const row of data) {
        if (fmt === "sql") {
          const keys = Object.keys(row as Record<string, unknown>);
          const colList = keys.map((k) => '"' + k + '"').join(", ");
          const valList = keys.map((k) => sqlVal((row as Record<string, unknown>)[k])).join(", ");
          if (!headerWritten) {
            parts.push(`\n-- ${table}\n`);
            headerWritten = true;
          }
          parts.push(`INSERT INTO public."${table}" (${colList}) VALUES (${valList});\n`);
        } else {
          parts.push((firstRow ? "" : ",") + JSON.stringify(row));
          firstRow = false;
        }
      }
      if (data.length < PAGE) break;
      from += PAGE;
      // Without a stable order key we cannot safely page; stop after one page.
      if (!orderCol) break;
    }

    if (fmt === "json") parts.push("]");
  }

  if (fmt === "sql") {
    parts.push("\nSET session_replication_role = DEFAULT;\n");
  } else {
    parts.push("\n}\n}");
  }

  return parts.join("");
}

// Exchange a stored refresh token for a short-lived access token.
async function getGoogleAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(
      "Google token exchange failed: " + (body.error_description || body.error || res.status),
    );
  }
  return body.access_token as string;
}

// Multipart upload of one file into the target folder. Returns { id, name }.
async function uploadToDrive(
  accessToken: string,
  folderId: string,
  name: string,
  mimeType: string,
  content: string,
): Promise<{ id: string; name: string; size: number }> {
  const boundary = "-------cansportbackup" + name.length + content.length;
  const meta = JSON.stringify({ name, parents: [folderId] });
  const body =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    meta +
    `\r\n--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n` +
    content +
    `\r\n--${boundary}--`;

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.id) {
    throw new Error("Drive upload failed for " + name + ": " + (out.error?.message || res.status));
  }
  return { id: out.id, name: out.name, size: new TextEncoder().encode(content).length };
}

// Delete backup files older than `retentionDays`. Only the app's own files are
// visible under the drive.file scope, so this never touches unrelated files.
async function pruneOldBackups(
  accessToken: string,
  folderId: string,
  retentionDays: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 86400_000).toISOString();
  const q = encodeURIComponent(
    `'${folderId}' in parents and name contains '${FILE_PREFIX}' and trashed = false and createdTime < '${cutoff}'`,
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1000`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("Drive list failed: " + (out.error?.message || res.status));
  const files: Array<{ id: string; name: string }> = out.files || [];
  let deleted = 0;
  for (const f of files) {
    const del = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (del.ok || del.status === 204) deleted++;
  }
  return deleted;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Load config (service role bypasses RLS on integration_secrets).
  const { data: secretRows, error: secErr } = await svc
    .from("integration_secrets")
    .select("key,value");
  if (secErr) return json({ error: "Cannot read integration_secrets: " + secErr.message }, 500);
  const cfg: Record<string, string> = {};
  for (const row of secretRows || []) cfg[row.key] = row.value;

  // Verify the shared secret.
  const provided = req.headers.get("x-backup-secret") || "";
  const expected = cfg["backup_cron_secret"] || "";
  if (!expected || provided !== expected) {
    return json({ error: "Unauthorized" }, 401);
  }

  const clientId = cfg["google_oauth_client_id"];
  const clientSecret = cfg["google_oauth_client_secret"];
  const refreshToken = cfg["google_oauth_refresh_token"];
  const folderId = cfg["google_drive_folder_id"];
  const retentionDays = Number(cfg["backup_retention_days"]) || 30;

  if (!clientId || !clientSecret || !refreshToken || !folderId) {
    const err = "Missing Google Drive configuration in integration_secrets";
    await svc.from("backup_log").insert({ status: "error", error: err });
    return json({ error: err }, 400);
  }

  const started = Date.now();
  try {
    // 1) Gather schema + table list once, reuse for both formats.
    const { data: schemaSql } = await svc.rpc("backup_schema_sql");
    const { data: tables } = await svc.rpc("backup_list_tables");
    const tableList: string[] = tables || [];
    const schema = typeof schemaSql === "string" ? schemaSql : "";

    // 2) Access token for Drive.
    const accessToken = await getGoogleAccessToken(clientId, clientSecret, refreshToken);

    // 3) Generate + upload both formats. Each dump is built, uploaded, and then
    // released before the next one so peak memory stays close to one file's size.
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const uploaded: Array<{ id: string; name: string; size: number }> = [];

    for (const [fmt, ext, mime] of [
      ["sql", "sql", "application/sql"],
      ["json", "json", "application/json"],
    ] as const) {
      const dump = await generateDump(svc, fmt, schema, tableList);
      uploaded.push(
        await uploadToDrive(accessToken, folderId, `${FILE_PREFIX}${ts}.${ext}`, mime, dump),
      );
      // `dump` goes out of scope on the next iteration, freeing it for GC.
    }

    // 4) Prune old backups (best-effort; a failure here doesn't fail the backup).
    let pruned = 0;
    try {
      pruned = await pruneOldBackups(accessToken, folderId, retentionDays);
    } catch (_e) {
      // ignore prune errors
    }

    const totalBytes = uploaded.reduce((n, f) => n + f.size, 0);
    await svc.from("backup_log").insert({
      status: "success",
      tables_count: tableList.length,
      total_bytes: totalBytes,
      pruned_count: pruned,
      duration_ms: Date.now() - started,
      files: uploaded.map((f) => ({ id: f.id, name: f.name, size: f.size })),
    });

    return json({
      ok: true,
      files: uploaded.map((f) => ({ name: f.name, size: f.size })),
      pruned,
      tables: tableList.length,
      duration_ms: Date.now() - started,
    });
  } catch (e) {
    const msg = (e as Error).message;
    await svc.from("backup_log").insert({
      status: "error",
      error: msg,
      duration_ms: Date.now() - started,
    });
    return json({ error: msg }, 500);
  }
});
