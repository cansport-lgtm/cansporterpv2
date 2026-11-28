// Run: npx tsx --test tests/bridge/bridge.test.ts
// Exercises the /api/bridge/* handlers with the database call mocked.
import test from "node:test";
import assert from "node:assert/strict";

process.env.BRIDGE_API_KEY = "cb_live_test_key";

import { POST as ping } from "../../api/bridge/ping.ts";
import { POST as attendance } from "../../api/bridge/attendance.ts";
import { POST as users } from "../../api/bridge/users.ts";
import { POST as heartbeat } from "../../api/bridge/heartbeat.ts";

type Call = { url: string; body: any };
let calls: Call[] = [];
let dbReply: { status: number; body: unknown } = { status: 200, body: null };
globalThis.fetch = (async (url: string, init: any) => {
  calls.push({ url, body: JSON.parse(init.body) });
  return new Response(JSON.stringify(dbReply.body), { status: dbReply.status });
}) as any;

const req = (body: unknown, key: string | null = "cb_live_test_key", method = "POST") =>
  new Request("https://x.test/api/bridge/t", {
    method,
    headers: { "content-type": "application/json", ...(key ? { "x-api-key": key } : {}) },
    body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
const rec = (i: number) => ({
  externalId: `S_${i}_2026-01-01T09:00:00+05:00`, userId: String(i),
  timestamp: "2026-01-01T09:00:00+05:00", verifyMode: "fingerprint", state: "check-in",
});

test.beforeEach(() => { calls = []; dbReply = { status: 200, body: null }; });

test("ping: ok with key, 401 with wrong or missing key, 405 on GET", async () => {
  const ok = await ping(req({ bridgeVersion: "1.0.0", deviceSerial: "S" }));
  assert.equal(ok.status, 200);
  const j = await ok.json(); assert.equal(j.ok, true); assert.ok(Date.parse(j.serverTime));
  assert.equal((await ping(req({}, "wrong"))).status, 401);
  assert.equal((await ping(req({}, null))).status, 401);
  assert.equal((await ping(req({}, "cb_live_test_key", "GET"))).status, 405);
  assert.equal(calls.length, 0, "auth failures must not reach the database");
});

test("attendance: forwards a batch and returns counts", async () => {
  dbReply.body = { received: 2, inserted: 1, duplicates: 1 };
  const res = await attendance(req({ deviceSerial: "S", records: [rec(1), rec(2)] }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, received: 2, inserted: 1, duplicates: 1 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.p_records.length, 2);
  assert.equal(calls[0].body.p_records[0].external_id, rec(1).externalId);
  assert.equal(calls[0].body.p_key, "cb_live_test_key");
});

test("attendance: 500 ok, 501 rejected with 400 before the database", async () => {
  dbReply.body = { received: 500, inserted: 500, duplicates: 0 };
  const many = (n: number) => Array.from({ length: n }, (_, i) => rec(i));
  assert.equal((await attendance(req({ deviceSerial: "S", records: many(500) }))).status, 200);
  calls = [];
  assert.equal((await attendance(req({ deviceSerial: "S", records: many(501) }))).status, 400);
  assert.equal(calls.length, 0);
});

test("attendance: validation errors are 400 with ok:false", async () => {
  for (const bad of [
    { deviceSerial: "S", records: [{ ...rec(1), timestamp: "2026-01-01T09:00:00" }] }, // no offset
    { deviceSerial: "S", records: [{ ...rec(1), timestamp: "2026-13-45T09:00:00+05:00" }] },
    { deviceSerial: "S", records: [{ ...rec(1), userId: 123 }] }, // userId must stay a string
    { deviceSerial: "S" },
    { records: [] },
  ]) {
    const res = await attendance(req(bad));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).ok, false);
  }
  assert.equal((await attendance(req("{not json"))).status, 400);
});

test("attendance: free-form verifyMode/state such as unknown-7 are accepted", async () => {
  dbReply.body = { received: 1, inserted: 1, duplicates: 0 };
  const res = await attendance(req({ deviceSerial: "S", records: [{ ...rec(1), verifyMode: "unknown-9", state: "unknown-7" }] }));
  assert.equal(res.status, 200);
});

test("database errors: 28000 -> 401, 22xxx -> 400, others -> 500 (retryable)", async () => {
  const body = { deviceSerial: "S", records: [rec(1)] };
  dbReply = { status: 400, body: { code: "28000", message: "unauthorized" } };
  assert.equal((await attendance(req(body))).status, 401);
  dbReply = { status: 400, body: { code: "22007", message: "bad timestamp" } };
  assert.equal((await attendance(req(body))).status, 400);
  dbReply = { status: 500, body: { code: "XX000", message: "boom" } };
  assert.equal((await attendance(req(body))).status, 500);
});

test("users: maps fields, blank names and numeric card numbers allowed", async () => {
  dbReply.body = { received: 2 };
  const res = await users(req({ deviceSerial: "S", users: [
    { userId: "123", name: "Ali Khan", cardNo: "0", privilege: 0 },
    { userId: "124", name: "", cardNo: 77, privilege: 14 },
  ] }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, received: 2 });
  assert.equal(calls[0].body.p_users[1].card_no, "77");
  assert.equal(calls[0].body.p_users[1].user_id, "124");
});

test("heartbeat: lastSyncAt may be null; bad types are 400", async () => {
  const good = { deviceSerial: "S", deviceOnline: true, userCount: 740, logCount: 34605, lastSyncAt: null, bridgeVersion: "1.0.0" };
  const res = await heartbeat(req(good));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(calls[0].body.p_last_sync_at, null);
  assert.equal((await heartbeat(req({ ...good, deviceOnline: "yes" }))).status, 400);
  assert.equal((await heartbeat(req({ ...good, lastSyncAt: "yesterday" }))).status, 400);
});

test("missing BRIDGE_API_KEY on the server is a retryable 500, never a 401", async () => {
  const saved = process.env.BRIDGE_API_KEY; delete process.env.BRIDGE_API_KEY;
  assert.equal((await ping(req({}))).status, 500);
  process.env.BRIDGE_API_KEY = saved;
});
