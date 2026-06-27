// Full database + schema backup for super admins.
//
// Custom-authenticated (the app does not use Supabase Auth): the caller must
// pass a valid app user id + password (verified via verify_user_password) and
// that user must hold the super_admin role. Runs with the service role so it can
// read every table (bypassing RLS) and the schema-introspection helpers.
//
// Streams the response so server memory stays bounded even for large tables.
//   format = "sql"  -> schema DDL + data as INSERT statements (restorable)
//   format = "json" -> { generated_at, schema_sql, tables: { name: rows[] } }
//
// Deployed with verify_jwt = false because auth is implemented here.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PAGE = 1000;

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { userId, password, format } = await req.json().catch(() => ({}));
    if (!userId || !password) return json({ error: "Missing credentials" }, 400);

    // 1) Verify the password against the app's own auth.
    const { data: verify, error: vErr } = await svc.rpc("verify_user_password", {
      p_user_id: userId,
      p_password: password,
    });
    if (vErr || !verify || !verify.length || !verify[0].is_valid) {
      return json({ error: "Invalid user id or password" }, 401);
    }
    const userUuid = verify[0].user_uuid;

    // 2) Require the super_admin role.
    const { data: roleRow } = await svc
      .from("user_roles")
      .select("role")
      .eq("user_id", userUuid)
      .eq("role", "super_admin")
      .maybeSingle();
    if (!roleRow) return json({ error: "Forbidden: super admin only" }, 403);

    // 3) Gather schema + table list.
    const { data: schemaSql } = await svc.rpc("backup_schema_sql");
    const { data: tables } = await svc.rpc("backup_list_tables");
    const tableList: string[] = tables || [];
    const fmt = format === "json" ? "json" : "sql";

    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const push = (s: string) => controller.enqueue(enc.encode(s));
        try {
          if (fmt === "sql") {
            push(typeof schemaSql === "string" ? schemaSql : "");
            push("\n\n-- ============ DATA ============\n");
            push("SET session_replication_role = replica;\n\n");
          } else {
            push("{\n");
            push('"generated_at": ' + JSON.stringify(new Date().toISOString()) + ",\n");
            push('"schema_sql": ' + JSON.stringify(schemaSql || "") + ",\n");
            push('"tables": {\n');
          }

          for (let ti = 0; ti < tableList.length; ti++) {
            const table = tableList[ti];

            // Probe for a stable pagination key.
            const probe = await svc.from(table).select("*").limit(1);
            const sample = probe.data && probe.data[0];
            const cols = sample ? Object.keys(sample) : [];
            const orderCol = cols.includes("id")
              ? "id"
              : cols.includes("created_at")
              ? "created_at"
              : null;

            if (fmt === "json") push((ti > 0 ? ",\n" : "") + JSON.stringify(table) + ": [");

            let from = 0;
            let firstRow = true;
            let headerWritten = false;
            for (;;) {
              let q = svc.from(table).select("*").range(from, from + PAGE - 1);
              if (orderCol) q = q.order(orderCol, { ascending: true });
              const { data, error } = await q;
              if (error) {
                if (fmt === "sql") push(`-- ERROR dumping ${table}: ${error.message}\n`);
                break;
              }
              if (!data || data.length === 0) break;
              for (const row of data) {
                if (fmt === "sql") {
                  const keys = Object.keys(row as Record<string, unknown>);
                  const colList = keys.map((k) => '"' + k + '"').join(", ");
                  const valList = keys.map((k) => sqlVal((row as Record<string, unknown>)[k])).join(", ");
                  if (!headerWritten) {
                    push(`\n-- ${table}\n`);
                    headerWritten = true;
                  }
                  push(`INSERT INTO public."${table}" (${colList}) VALUES (${valList});\n`);
                } else {
                  push((firstRow ? "" : ",") + JSON.stringify(row));
                  firstRow = false;
                }
              }
              if (data.length < PAGE) break;
              from += PAGE;
              // Without a stable order key we cannot safely page; stop after one page.
              if (!orderCol) break;
            }

            if (fmt === "json") push("]");
          }

          if (fmt === "sql") {
            push("\nSET session_replication_role = DEFAULT;\n");
          } else {
            push("\n}\n}");
          }
          controller.close();
        } catch (e) {
          push(`\n-- BACKUP ERROR: ${(e as Error).message}\n`);
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
