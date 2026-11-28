import { z } from "zod";
import { guard, json, validationError } from "./_lib.js";

export async function POST(req: Request): Promise<Response> {
  const g = await guard(req);
  if (g instanceof Response) return g;
  const parsed = z
    .object({ bridgeVersion: z.string().max(40).optional(), deviceSerial: z.string().max(64).optional() })
    .passthrough()
    .safeParse(g.body);
  if (!parsed.success) return validationError(parsed.error);
  return json({ ok: true, serverTime: new Date().toISOString() });
}
