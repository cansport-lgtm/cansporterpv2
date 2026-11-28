// Shared helpers for the biometric bridge routes (/api/bridge/*).
// Files starting with "_" are not deployed as routes by Vercel.
// Auth is the bridge API key only (header x-api-key vs env BRIDGE_API_KEY);
// these routes deliberately sit outside the ERP's own login. Never import this
// from client (src/) code.

import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export const fail = (status: number, error: string): Response => json({ ok: false, error }, status);

const sha256 = (s: string) => createHash("sha256").update(s).digest();

/** Constant-time comparison of the supplied key with BRIDGE_API_KEY. */
export function keyMatches(supplied: string | null, expected: string): boolean {
  if (!supplied) return false;
  return timingSafeEqual(sha256(supplied), sha256(expected));
}

/**
 * Method + API-key gate shared by every route. Returns either a Response to
 * send straight back, or the validated key and parsed JSON body.
 */
export async function guard(req: Request): Promise<Response | { key: string; body: unknown }> {
  if (req.method !== "POST") return fail(405, "method_not_allowed");
  const expected = process.env.BRIDGE_API_KEY;
  if (!expected) return fail(500, "server_not_configured"); // 5xx: the bridge retries later
  const key = req.headers.get("x-api-key");
  if (!keyMatches(key, expected)) return fail(401, "unauthorized");
  let body: unknown = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return fail(400, "invalid_json");
  }
  return { key: key as string, body };
}

export function validationError(err: z.ZodError): Response {
  const issue = err.issues[0];
  return fail(400, `${issue.path.join(".") || "body"}: ${issue.message}`);
}

const DEFAULT_URL = "https://ojejlhnthhdvgbgpsgvi.supabase.co";
const DEFAULT_KEY = "sb_publishable_maHf4XFU4sbsRHv1Z-8jgw_5qoDvpYq";

// Env values can carry stray whitespace/quotes/newlines (pasted in the Vercel
// UI), which makes fetch throw before any request is sent. Clean them and fall
// back to the project's public defaults when they are unusable.
const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();
const pickUrl = () => {
  for (const c of [process.env.SUPABASE_URL, process.env.VITE_SUPABASE_URL]) {
    const v = clean(c).replace(/\/+$/, "");
    if (/^https:\/\/[a-z0-9.-]+\.supabase\.co$/i.test(v)) return v;
  }
  return DEFAULT_URL;
};
// The publishable (anon) key is public by design; every bridge_* database
// function re-checks the bridge API key itself.
const pickKey = () => {
  for (const c of [process.env.SUPABASE_PUBLISHABLE_KEY, process.env.VITE_SUPABASE_PUBLISHABLE_KEY]) {
    const v = clean(c);
    if (/^[A-Za-z0-9._-]{20,}$/.test(v)) return v;
  }
  return DEFAULT_KEY;
};

/** Call a bridge_* database function. Maps database errors to HTTP statuses. */
export async function callRpc(fn: string, args: Record<string, unknown>): Promise<Response | { data: any }> {
  let res: globalThis.Response;
  try {
    const key = pickKey();
    res = await fetch(`${pickUrl()}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: key,
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(args),
    });
  } catch (e) {
    console.error("bridge rpc fetch failed", fn, e instanceof Error ? `${e.message} / ${String((e as any).cause ?? "")}` : e);
    return fail(503, "database_unreachable");
  }
  if (res.ok) {
    const text = await res.text();
    return { data: text ? JSON.parse(text) : null };
  }
  let err: { code?: string; message?: string } = {};
  try {
    err = await res.json();
  } catch {
    /* ignore */
  }
  if (err.code === "28000") return fail(401, "unauthorized");
  // 22xxx = invalid data (bad timestamp, too many records...): do not retry.
  if (err.code && err.code.startsWith("22")) return fail(400, err.message || "invalid_data");
  console.error("bridge rpc failed", fn, res.status, err.code, err.message);
  return fail(res.status === 429 ? 429 : 500, "database_error");
}

// ISO-8601 with an explicit offset, e.g. 2026-11-28T09:02:11+05:00 or ...Z
export const isoWithOffset = z
  .string()
  .max(40)
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/, "must be ISO-8601 with an explicit offset")
  .refine((s) => !Number.isNaN(Date.parse(s)), "invalid date");

export const shortStr = (max = 64) => z.string().min(1).max(max);
export const looseEnum = z.string().max(40); // not a strict enum: unknown-<n> etc.
