import { z } from "zod";
import { callRpc, guard, isoWithOffset, json, shortStr, validationError } from "./_lib.js";

const schema = z.object({
  deviceSerial: shortStr(),
  deviceOnline: z.boolean(),
  userCount: z.number().int().nonnegative().nullish(),
  logCount: z.number().int().nonnegative().nullish(),
  lastSyncAt: isoWithOffset.nullish(), // null before the first successful sync
  bridgeVersion: z.string().max(40).nullish(),
});

export async function POST(req: Request): Promise<Response> {
  const g = await guard(req);
  if (g instanceof Response) return g;
  const parsed = schema.safeParse(g.body);
  if (!parsed.success) return validationError(parsed.error);
  const b = parsed.data;

  const r = await callRpc("bridge_heartbeat", {
    p_key: g.key,
    p_device_serial: b.deviceSerial,
    p_device_online: b.deviceOnline,
    p_user_count: b.userCount ?? null,
    p_log_count: b.logCount ?? null,
    p_last_sync_at: b.lastSyncAt ?? null,
    p_bridge_version: b.bridgeVersion ?? null,
  });
  if (r instanceof Response) return r;
  return json({ ok: true });
}
