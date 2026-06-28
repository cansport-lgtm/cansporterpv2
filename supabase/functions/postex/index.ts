// PostEx courier integration — single Edge Function with multiple actions.
//
// Why server-side: the app's frontend ships a public Supabase key, so the PostEx
// API token must never live in the browser. This function holds the token
// (POSTEX_API_TOKEN secret) and is the only thing that talks to PostEx. It uses
// the service-role key to read/write the online_* tables (bypassing RLS).
//
// Actions (POST JSON { action, ... }):
//   book      { orderId }            -> create the shipment on PostEx, save tracking #
//   track     { orderId? }           -> sync status for one order, or all in-transit orders
//   cancel    { orderId }            -> cancel a booked shipment
//   cities                           -> list PostEx operational cities (for dropdowns)
//   orderTypes                       -> list PostEx order types
//   addresses                        -> list merchant pickup addresses
//
// NOTE: verify_jwt is disabled for this function because the app has no Supabase
// Auth (anon-only). The security win here is that the PostEx token stays
// server-side. Real per-caller auth requires the app-wide auth migration.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Map a raw PostEx order status to our internal online_orders.status enum.
// The raw value is always stored separately in courier_order_status.
function mapStatus(raw: string): string | null {
  const s = (raw || "").toLowerCase();
  if (s.includes("deliver")) return "delivered";
  if (s.includes("return")) return s.includes("await") || s.includes("transit") ? "return_awaited" : "returned";
  if (s.includes("out for delivery") || s.includes("transit") || s.includes("picked") || s.includes("warehouse") || s.includes("dispatch"))
    return "dispatched";
  if (s.includes("book")) return "sent_to_courier";
  if (s.includes("cancel")) return "cancelled";
  return null; // unknown -> leave internal status untouched
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Prefer a real Edge Function secret; fall back to the private
  // integration_secrets table (anon cannot read it; service role bypasses RLS).
  let token = Deno.env.get("POSTEX_API_TOKEN");
  if (!token) {
    const { data: secret } = await supabase
      .from("integration_secrets").select("value").eq("key", "POSTEX_API_TOKEN").single();
    token = secret?.value;
  }
  if (!token) return json({ error: "POSTEX_API_TOKEN not configured" }, 500);

  // Load the PostEx courier config (base URL + endpoint paths).
  const { data: partner, error: partnerErr } = await supabase
    .from("courier_partners").select("*").eq("code", "POSTEX").single();
  if (partnerErr || !partner) return json({ error: "PostEx courier_partners row not found" }, 500);

  const base = (partner.api_base_url || "").replace(/\/$/, "");
  const cfg = partner.config || {};
  const authHeader = cfg.auth_header || "token";
  const headers = { [authHeader]: token, "Content-Type": "application/json" };

  let body: any = {};
  try { body = await req.json(); } catch { /* GET-style actions need no body */ }
  const action = body.action;

  try {
    // --- read-only passthroughs (safe to call any time) ----------------------
    if (action === "cities") {
      const r = await fetch(`${base}${cfg.operational_cities_path}`, { headers });
      return json(await r.json(), r.status);
    }
    if (action === "orderTypes") {
      const r = await fetch(`${base}${cfg.order_types_path}`, { headers });
      return json(await r.json(), r.status);
    }
    if (action === "addresses") {
      const r = await fetch(`${base}${cfg.merchant_address_path}`, { headers });
      return json(await r.json(), r.status);
    }

    // --- book a shipment -----------------------------------------------------
    if (action === "book") {
      const { orderId } = body;
      if (!orderId) return json({ error: "orderId required" }, 400);

      const { data: order, error: oErr } = await supabase
        .from("online_orders").select("*").eq("id", orderId).single();
      if (oErr || !order) return json({ error: "order not found" }, 404);
      if (order.tracking_number) return json({ error: "order already has a tracking number" }, 409);

      const { data: items } = await supabase
        .from("online_order_items").select("item_name, quantity").eq("order_id", orderId);
      const orderDetail = (items && items.length)
        ? items.map((i: any) => `${i.item_name} x${i.quantity}`).join(", ")
        : (order.item_name || "Order items");
      const itemCount = (items && items.length)
        ? items.reduce((s: number, i: any) => s + (i.quantity || 0), 0)
        : (order.quantity || 1);

      const payload = {
        cityName: order.city,
        customerName: order.customer_name,
        customerPhone: order.customer_phone,
        deliveryAddress: order.shipping_address,
        invoicePayment: order.payment_mode === "cod" ? (order.order_value || 0) : 0,
        invoiceDivision: 1,
        items: itemCount,
        orderDetail,
        orderRefNumber: order.platform_order_id || order.order_number,
        orderType: "Normal",
        transactionNotes: order.remarks || "",
        merchantAddressCode: cfg.merchant_address_code || cfg.pickup_address_code || undefined,
        pickupAddressCode: cfg.pickup_address_code || undefined,
      };

      const r = await fetch(`${base}${cfg.create_order_path}`, {
        method: "POST", headers, body: JSON.stringify(payload),
      });
      const result = await r.json();
      const dist = result?.dist || result; // PostEx wraps payload under `dist`
      const trackingNumber = dist?.trackingNumber || dist?.orderTrackingNumber;

      if (!r.ok || !trackingNumber) {
        return json({ error: "PostEx booking failed", detail: result }, 502);
      }

      await supabase.from("online_orders").update({
        tracking_number: trackingNumber,
        courier_partner_id: partner.id,
        courier_order_status: dist?.orderStatus || "Booked",
        status: "sent_to_courier",
        booked_at: new Date().toISOString(),
      }).eq("id", orderId);

      await supabase.from("online_tracking_events").insert({
        order_id: orderId,
        tracking_number: trackingNumber,
        status: "sent_to_courier",
        status_message: dist?.statusMessage || result?.statusMessage || "ORDER HAS BEEN CREATED",
        event_time: new Date().toISOString(),
        raw: result,
      });

      return json({ ok: true, trackingNumber });
    }

    // --- cancel a shipment ---------------------------------------------------
    if (action === "cancel") {
      const { orderId } = body;
      if (!orderId) return json({ error: "orderId required" }, 400);
      const { data: order } = await supabase
        .from("online_orders").select("id, tracking_number").eq("id", orderId).single();
      if (!order?.tracking_number) return json({ error: "order has no tracking number" }, 400);

      const r = await fetch(`${base}${cfg.cancel_order_path}`, {
        method: "PUT", headers, body: JSON.stringify({ trackingNumber: order.tracking_number }),
      });
      const result = await r.json();
      if (!r.ok) return json({ error: "PostEx cancel failed", detail: result }, 502);

      await supabase.from("online_orders").update({ status: "cancelled" }).eq("id", orderId);
      await supabase.from("online_tracking_events").insert({
        order_id: orderId, tracking_number: order.tracking_number,
        status: "cancelled", status_message: result?.statusMessage || "Cancelled",
        event_time: new Date().toISOString(), raw: result,
      });
      return json({ ok: true });
    }

    // --- track (one order, or all in-transit) --------------------------------
    if (action === "track") {
      const { orderId, all } = body;
      let q = supabase.from("online_orders")
        .select("id, tracking_number, status")
        .not("tracking_number", "is", null).neq("tracking_number", "");
      if (orderId) q = q.eq("id", orderId);
      else if (!all) q = q.not("status", "in", "(delivered,returned,cancelled)"); // skip terminal
      const { data: orders } = await q;
      if (!orders || orders.length === 0) return json({ ok: true, tracked: 0 });

      let tracked = 0, updated = 0;
      for (const o of orders) {
        try {
          const r = await fetch(`${base}${cfg.track_order_path}/${o.tracking_number}`, { headers });
          if (!r.ok) continue;
          const result = await r.json();
          const dist = result?.dist || result;
          const rawStatus: string = dist?.transactionStatus || dist?.orderStatus || "";
          tracked++;

          const mapped = mapStatus(rawStatus);
          const patch: Record<string, unknown> = {
            courier_order_status: rawStatus,
            last_tracked_at: new Date().toISOString(),
          };
          if (mapped && mapped !== o.status) patch.status = mapped;
          await supabase.from("online_orders").update(patch).eq("id", o.id);

          await supabase.from("online_tracking_events").insert({
            order_id: o.id, tracking_number: o.tracking_number,
            status: mapped || o.status, status_message: rawStatus,
            event_time: new Date().toISOString(), raw: result,
          });
          if (mapped && mapped !== o.status) updated++;
        } catch { /* skip this parcel, continue the batch */ }
      }
      return json({ ok: true, tracked, updated });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
