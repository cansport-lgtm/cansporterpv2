import { z } from "zod";
import { callRpc, guard, json, shortStr, validationError } from "./_lib.js";

const schema = z.object({
  deviceSerial: shortStr(),
  users: z
    .array(
      z.object({
        userId: shortStr(),
        name: z.string().max(200).nullish(),
        cardNo: z.union([z.string().max(40), z.number()]).nullish(),
        privilege: z.number().int().nullish(),
      }),
    )
    .max(5000),
});

export async function POST(req: Request): Promise<Response> {
  const g = await guard(req);
  if (g instanceof Response) return g;
  const parsed = schema.safeParse(g.body);
  if (!parsed.success) return validationError(parsed.error);
  const { deviceSerial, users } = parsed.data;

  const r = await callRpc("bridge_upsert_users", {
    p_key: g.key,
    p_device_serial: deviceSerial,
    p_users: users.map((u) => ({
      user_id: u.userId,
      name: u.name ?? "",
      card_no: u.cardNo == null ? "0" : String(u.cardNo),
      privilege: u.privilege ?? 0,
    })),
  });
  if (r instanceof Response) return r;
  return json({ ok: true, received: r.data?.received ?? users.length });
}
