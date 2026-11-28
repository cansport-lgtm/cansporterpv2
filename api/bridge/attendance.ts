import { z } from "zod";
import { callRpc, fail, guard, isoWithOffset, json, looseEnum, shortStr, validationError } from "./_lib.js";

const MAX_RECORDS = 500;

const schema = z.object({
  deviceSerial: shortStr(),
  records: z.array(
    z.object({
      externalId: shortStr(200),
      userId: shortStr(),
      timestamp: isoWithOffset,
      verifyMode: looseEnum.default("unknown"),
      state: looseEnum.default("unknown"),
    }),
  ),
});

export async function POST(req: Request): Promise<Response> {
  const g = await guard(req);
  if (g instanceof Response) return g;
  const parsed = schema.safeParse(g.body);
  if (!parsed.success) return validationError(parsed.error);
  const { deviceSerial, records } = parsed.data;
  if (records.length > MAX_RECORDS) return fail(400, `too many records (max ${MAX_RECORDS})`);

  // One bulk INSERT ... ON CONFLICT DO NOTHING inside the database function.
  const r = await callRpc("bridge_ingest_attendance", {
    p_key: g.key,
    p_device_serial: deviceSerial,
    p_records: records.map((x) => ({
      external_id: x.externalId,
      user_id: x.userId,
      ts: x.timestamp,
      verify_mode: x.verifyMode,
      state: x.state,
    })),
  });
  if (r instanceof Response) return r;
  return json({ ok: true, ...r.data });
}
