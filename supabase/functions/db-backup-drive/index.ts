// Scheduled full-database backup to Google Drive.
//
// This is the automated sibling of the manual `db-backup` function. It produces
// the same restorable dumps (schema DDL + data), but instead of streaming them
// to a browser it streams them straight into a Google Drive folder (resumable
// upload) and then prunes backups older than the retention window. It is meant
// to be invoked once a day by pg_cron (see the schedule_db_backup_drive migration).
//
// Memory: the dump is NEVER held whole in memory. Rows are paged from Postgres
// and pushed to Drive in fixed 8 MB chunks, so peak memory stays ~one chunk
// regardless of database size (a 95 MB DB previously OOM'd the worker when built
// as a single string).
//
// Auth: this function is deployed with verify_jwt = false. It is protected by a
// shared secret — the caller must send header `x-backup-secret` matching the
// `backup_cron_secret` row in `integration_secrets`. The cron job reads that same
// value from the table at run time, so the secret never appears in git.
//
// All Google + Supabase config lives in `integration_secrets` (service-role only,
// RLS-locked). Required keys:
//   google_oauth_client_id, google_oauth_client_secret, google_oauth_refresh_token,
//   google_drive_folder_id, backup_cron_secret
// Optional: backup_retention_days (default 30)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-backup-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PAGE = 5000;
const FILE_PREFIX = "cansport_backup_";
// Resumable-upload chunk size. Must be a multiple of 256 KiB (Google requirement
// for all but the final chunk). 8 MiB = 32 * 256 KiB.
const CHUNK = 8 * 1024 * 1024;

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

// Streams bytes to a Google Drive resumable-upload session in 8 MiB chunks so
// the whole file never sits in memory. Call write() repeatedly, then finish().
class DriveChunkedUploader {
  private uri: string;
  private parts: Uint8Array[] = [];
  private pendingLen = 0;
  private uploaded = 0;
  private enc = new TextEncoder();
  result: { id?: string; name?: string; size?: string } | null = null;

  private constructor(uri: string) {
    this.uri = uri;
  }

  static async open(
    accessToken: string,
    folderId: string,
    name: string,
    mimeType: string,
  ): Promise<DriveChunkedUploader> {
    const res = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": mimeType,
        },
        body: JSON.stringify({ name, parents: [folderId] }),
      },
    );
    if (!res.ok) {
      throw new Error(`Drive resumable init failed for ${name}: ${res.status} ${await res.text()}`);
    }
    const loc = res.headers.get("location") || res.headers.get("Location");
    if (!loc) throw new Error(`Drive resumable init returned no session URI for ${name}`);
    return new DriveChunkedUploader(loc);
  }

  async write(text: string): Promise<void> {
    if (!text) return;
    const bytes = this.enc.encode(text);
    this.parts.push(bytes);
    this.pendingLen += bytes.length;
    if (this.pendingLen >= CHUNK) await this.flush(false);
  }

  private merge(): Uint8Array {
    const buf = new Uint8Array(this.pendingLen);
    let o = 0;
    for (const p of this.parts) {
      buf.set(p, o);
      o += p.length;
    }
    this.parts = [];
    this.pendingLen = 0;
    return buf;
  }

  private async put(chunk: Uint8Array, start: number, totalOrStar: string): Promise<Response> {
    const end = start + chunk.length - 1;
    const res = await fetch(this.uri, {
      method: "PUT",
      headers: { "Content-Range": `bytes ${start}-${end}/${totalOrStar}` },
      body: chunk,
    });
    return res;
  }

  private async flush(final: boolean): Promise<void> {
    let buf = this.merge();
    let offset = 0;
    // Send full 8 MiB chunks with unknown total ("*"). On the final flush, keep
    // the last piece back to send with the real total so Drive finalizes.
    const keepLast = final;
    while (buf.length - offset > CHUNK || (!keepLast && buf.length - offset >= CHUNK)) {
      const chunk = buf.subarray(offset, offset + CHUNK);
      const res = await this.put(chunk, this.uploaded, "*");
      if (res.status !== 308 && !(res.status >= 200 && res.status < 300)) {
        throw new Error(`Drive chunk upload failed: ${res.status} ${await res.text()}`);
      }
      this.uploaded += CHUNK;
      offset += CHUNK;
    }
    const remainder = buf.slice(offset);
    if (!final) {
      if (remainder.length) {
        this.parts = [remainder];
        this.pendingLen = remainder.length;
      }
      return;
    }
    // Final piece with the true total length.
    const total = this.uploaded + remainder.length;
    let res: Response;
    if (remainder.length === 0) {
      // Everything already sent; ask Drive to finalize at `total`.
      res = await fetch(this.uri, {
        method: "PUT",
        headers: { "Content-Range": `bytes */${total}` },
      });
    } else {
      res = await this.put(remainder, this.uploaded, String(total));
    }
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`Drive final upload failed: ${res.status} ${await res.text()}`);
    }
    this.uploaded = total;
    this.result = await res.json().catch(() => ({}));
  }

  async finish(): Promise<{ id: string; name: string; size: number }> {
    await this.flush(true);
    return {
      id: this.result?.id || "",
      name: this.result?.name || "",
      size: this.uploaded,
    };
  }
}

// Stream a full dump for one format into the uploader.
async function streamDump(
  svc: SupabaseClient,
  fmt: "sql" | "json",
  schemaSql: string,
  tableList: string[],
  u: DriveChunkedUploader,
): Promise<void> {
  if (fmt === "sql") {
    await u.write(schemaSql || "");
    await u.write("\n\n-- ============ DATA ============\n");
    await u.write("SET session_replication_role = replica;\n\n");
  } else {
    await u.write("{\n");
    await u.write('"generated_at": ' + JSON.stringify(new Date().toISOString()) + ",\n");
    await u.write('"schema_sql": ' + JSON.stringify(schemaSql || "") + ",\n");
    await u.write('"tables": {\n');
  }

  for (let ti = 0; ti < tableList.length; ti++) {
    const table = tableList[ti];

    const probe = await svc.from(table).select("*").limit(1);
    const sample = probe.data && probe.data[0];
    const cols = sample ? Object.keys(sample) : [];
    const orderCol = cols.includes("id") ? "id" : cols.includes("created_at") ? "created_at" : null;

    if (fmt === "json") await u.write((ti > 0 ? ",\n" : "") + JSON.stringify(table) + ": [");

    // Column list is identical for every row of a table — build it once.
    const colList = cols.map((k) => '"' + k + '"').join(", ");
    const insertPrefix = `INSERT INTO public."${table}" (${colList}) VALUES (`;

    let from = 0;
    let firstRow = true;
    let headerWritten = false;
    for (;;) {
      let q = svc.from(table).select("*").range(from, from + PAGE - 1);
      if (orderCol) q = q.order(orderCol, { ascending: true });
      const { data, error } = await q;
      if (error) {
        if (fmt === "sql") await u.write(`-- ERROR dumping ${table}: ${error.message}\n`);
        break;
      }
      if (!data || data.length === 0) break;
      // Build the whole page's text once, then a single write() — this avoids an
      // await + text-encode per row (the dominant overhead at ~400k rows).
      const buf: string[] = [];
      if (fmt === "sql") {
        if (!headerWritten) {
          buf.push(`\n-- ${table}\n`);
          headerWritten = true;
        }
        for (const row of data) {
          const valList = cols.map((k) => sqlVal((row as Record<string, unknown>)[k])).join(", ");
          buf.push(insertPrefix, valList, ");\n");
        }
      } else {
        for (const row of data) {
          buf.push(firstRow ? "" : ",", JSON.stringify(row));
          firstRow = false;
        }
      }
      await u.write(buf.join(""));
      if (data.length < PAGE) break;
      from += PAGE;
      if (!orderCol) break; // no stable page key; one page only
    }

    if (fmt === "json") await u.write("]");
  }

  if (fmt === "sql") {
    await u.write("\nSET session_replication_role = DEFAULT;\n");
  } else {
    await u.write("\n}\n}");
  }
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
    const { data: schemaSql } = await svc.rpc("backup_schema_sql");
    const { data: tables } = await svc.rpc("backup_list_tables");
    const tableList: string[] = tables || [];
    const schema = typeof schemaSql === "string" ? schemaSql : "";

    const accessToken = await getGoogleAccessToken(clientId, clientSecret, refreshToken);

    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const uploaded: Array<{ id: string; name: string; size: number }> = [];

    for (const [fmt, ext, mime] of [
      ["sql", "sql", "application/sql"],
      ["json", "json", "application/json"],
    ] as const) {
      const uploader = await DriveChunkedUploader.open(
        accessToken,
        folderId,
        `${FILE_PREFIX}${ts}.${ext}`,
        mime,
      );
      await streamDump(svc, fmt, schema, tableList, uploader);
      uploaded.push(await uploader.finish());
    }

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
