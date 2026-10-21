import { useMemo, useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { printDocument, esc } from "@/lib/printDocument";
import { addDays, format, parseISO } from "date-fns";
import * as XLSX from "xlsx";
import {
  ClipboardList,
  Store,
  MapPin,
  AlertTriangle,
  Fuel,
  ShoppingCart,
  Clock,
  ChevronLeft,
  ChevronRight,
  Printer,
  FileSpreadsheet,
} from "lucide-react";

// Roles that may view any salesman's day. Everyone else only sees their own activity.
const ALL_SALESMEN_ROLES = ["super_admin", "admin", "manager", "private_label_manager", "private_label_viewer"];

// A day's orders count once confirmed, including those that have since moved further
// along (production, dispatch), so a past day's report doesn't lose them.
const CONFIRMED_ORDER_STATUSES = ["confirmed", "in_production", "ready", "partially_dispatched", "dispatched", "delivered"];

const VISIT_TYPE_LABELS: Record<string, string> = {
  regular: "Regular",
  follow_up: "Follow-up",
  complaint: "Complaint",
  new_business: "New business",
  collection: "Collection",
};

const VISIT_TYPE_COLORS: Record<string, string> = {
  regular: "bg-blue-500/10 text-blue-700 border-blue-500/30",
  follow_up: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  complaint: "bg-red-500/10 text-red-700 border-red-500/30",
  new_business: "bg-violet-500/10 text-violet-700 border-violet-500/30",
  collection: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
};

const FUEL_STATUS_COLORS: Record<string, string> = {
  Submitted: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  Approved: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  Rejected: "bg-red-500/10 text-red-700 border-red-500/30",
  Paid: "bg-blue-500/10 text-blue-700 border-blue-500/30",
};

interface Visit {
  id: string;
  visit_number: string;
  visit_type: string;
  purpose: string | null;
  outcome: string | null;
  next_action: string | null;
  feedback: string | null;
  order_taken: boolean | null;
  order_value: number | null;
  check_in_time: string | null;
  check_out_time: string | null;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  customers: { id: string; code: string; name: string; area: string | null; city: string | null } | null;
}

interface Trip {
  id: string;
  from_location: string | null;
  to_location: string | null;
  purpose: string | null;
  start_odometer: number;
  end_odometer: number;
  km: number;
  litres: number | null;
  fuel_price_snapshot: number | null;
  amount: number | null;
  status: string;
}

interface Order {
  id: string;
  order_number: string;
  status: string;
  net_amount: number | null;
  total_amount: number | null;
  customers: { name: string; code: string; area: string | null; city: string | null } | null;
  sales_order_items: { quantity_dozens: number }[];
}

const money = (n: number) => `Rs ${Math.round(n).toLocaleString("en-PK")}`;
const qty = (n: number) => n.toLocaleString("en-PK", { maximumFractionDigits: 2 });
const time = (iso: string | null) => (iso ? format(parseISO(iso), "HH:mm") : "");
const statusLabel = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function visitTime(v: Visit) {
  const inT = time(v.check_in_time);
  const outT = time(v.check_out_time);
  if (inT && outT) return `${inT}–${outT}`;
  return inT || outT || "—";
}

function areaOf(c: { area: string | null; city: string | null } | null) {
  const area = c?.area?.trim();
  return area || "Unassigned";
}

export default function SalesmanActivityReportPage() {
  const { user, roles } = useAuth();
  const canViewAll = roles.some((r) => ALL_SALESMEN_ROLES.includes(r.role));

  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [pickedSalesman, setPickedSalesman] = useState<string>("");
  const salesmanId = canViewAll ? pickedSalesman || user?.id || "" : user?.id || "";

  const { data: salesmen } = useQuery({
    queryKey: ["salesmen"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_users")
        .select("id, full_name")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return data || [];
    },
    enabled: canViewAll,
  });

  const { data: visits, isLoading: visitsLoading } = useQuery({
    queryKey: ["salesman-activity", "visits", salesmanId, date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_visits")
        .select(
          "id, visit_number, visit_type, purpose, outcome, next_action, feedback, order_taken, order_value, check_in_time, check_out_time, latitude, longitude, created_at, customers:customer_id (id, code, name, area, city)"
        )
        .eq("salesman_id", salesmanId)
        .eq("visit_date", date);
      if (error) throw error;
      const rows = (data as unknown as Visit[]) || [];
      return rows.sort((a, b) =>
        (a.check_in_time || a.created_at).localeCompare(b.check_in_time || b.created_at)
      );
    },
    enabled: !!salesmanId,
  });

  const { data: trips, isLoading: tripsLoading } = useQuery({
    queryKey: ["salesman-activity", "fuel", salesmanId, date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_fuel_trips" as any)
        .select("id, from_location, to_location, purpose, start_odometer, end_odometer, km, litres, fuel_price_snapshot, amount, status")
        .eq("user_id", salesmanId)
        .eq("trip_date", date)
        .order("start_odometer");
      if (error) throw error;
      return (data as unknown as Trip[]) || [];
    },
    enabled: !!salesmanId,
  });

  const { data: orders, isLoading: ordersLoading } = useQuery({
    queryKey: ["salesman-activity", "orders", salesmanId, date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_orders")
        .select("id, order_number, status, net_amount, total_amount, customers(name, code, area, city), sales_order_items(quantity_dozens)")
        .eq("sales_segment", "private_label")
        .eq("created_by", salesmanId)
        .eq("order_date", date)
        .in("status", CONFIRMED_ORDER_STATUSES)
        .order("order_number");
      if (error) throw error;
      return (data as unknown as Order[]) || [];
    },
    enabled: !!salesmanId,
  });

  const salesmanName =
    (canViewAll ? salesmen?.find((s) => s.id === salesmanId)?.full_name : user?.full_name) || "";

  const areas = useMemo(() => {
    const map = new Map<string, { area: string; city: string; shops: Set<string> }>();
    for (const v of visits || []) {
      const area = areaOf(v.customers);
      const city = v.customers?.city?.trim() || "";
      const key = `${area.toLowerCase()}|${city.toLowerCase()}`;
      if (!map.has(key)) map.set(key, { area, city, shops: new Set() });
      if (v.customers) map.get(key)!.shops.add(v.customers.id);
    }
    return Array.from(map.values())
      .map((a) => ({ area: a.area, city: a.city, shops: a.shops.size }))
      .sort((a, b) => b.shops - a.shops || a.area.localeCompare(b.area));
  }, [visits]);

  // Market issues come from complaint visits and any free-text feedback on a visit.
  const issues = useMemo(
    () =>
      (visits || [])
        .filter((v) => v.visit_type === "complaint" || v.feedback?.trim())
        .map((v) => ({
          id: v.id,
          shop: v.customers?.name || "—",
          area: areaOf(v.customers),
          kind: v.visit_type === "complaint" ? "Complaint" : "Feedback",
          issue: v.feedback?.trim() || v.outcome?.trim() || v.purpose?.trim() || "—",
          action: v.next_action?.trim() || "",
        })),
    [visits]
  );

  const shopCount = new Set((visits || []).map((v) => v.customers?.id).filter(Boolean)).size;
  const countedTrips = (trips || []).filter((t) => t.status !== "Rejected");
  const fuelKm = countedTrips.reduce((s, t) => s + Number(t.km || 0), 0);
  const fuelLitres = countedTrips.reduce((s, t) => s + Number(t.litres || 0), 0);
  const fuelAmount = countedTrips.reduce((s, t) => s + Number(t.amount || 0), 0);
  const orderQty = (o: Order) => o.sales_order_items.reduce((s, i) => s + Number(i.quantity_dozens || 0), 0);
  const orderAmount = (o: Order) => Number(o.net_amount ?? o.total_amount ?? 0);
  const ordersTotal = (orders || []).reduce((s, o) => s + orderAmount(o), 0);
  const ordersQtyTotal = (orders || []).reduce((s, o) => s + orderQty(o), 0);
  const distributorCount = new Set((orders || []).map((o) => o.customers?.name)).size;

  const firstIn = (visits || []).map((v) => v.check_in_time).filter(Boolean).sort()[0] || null;
  const lastOut = (visits || []).map((v) => v.check_out_time).filter(Boolean).sort().pop() || null;
  const marketMinutes =
    firstIn && lastOut ? Math.max(0, Math.round((parseISO(lastOut).getTime() - parseISO(firstIn).getTime()) / 60000)) : 0;
  const marketTime = marketMinutes ? `${Math.floor(marketMinutes / 60)}h ${marketMinutes % 60}m` : "—";

  const visitTypeSummary = Object.entries(
    (visits || []).reduce<Record<string, number>>((acc, v) => {
      acc[v.visit_type] = (acc[v.visit_type] || 0) + 1;
      return acc;
    }, {})
  )
    .map(([t, n]) => `${n} ${(VISIT_TYPE_LABELS[t] || t).toLowerCase()}`)
    .join(" · ");

  const isLoading = visitsLoading || tripsLoading || ordersLoading;
  const shiftDate = (days: number) => setDate(format(addDays(parseISO(date), days), "yyyy-MM-dd"));
  const prettyDate = format(parseISO(date), "dd-MMM-yyyy");

  const handleExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        { Metric: "Salesman", Value: salesmanName },
        { Metric: "Date", Value: prettyDate },
        { Metric: "Shops visited", Value: shopCount },
        { Metric: "Areas covered", Value: areas.length },
        { Metric: "Market issues", Value: issues.length },
        { Metric: "Fuel KM", Value: fuelKm },
        { Metric: "Fuel litres", Value: Number(fuelLitres.toFixed(2)) },
        { Metric: "Fuel amount", Value: Math.round(fuelAmount) },
        { Metric: "Confirmed orders", Value: orders?.length || 0 },
        { Metric: "Confirmed order value", Value: Math.round(ordersTotal) },
        { Metric: "Time in market", Value: marketTime },
      ]),
      "Summary"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        (visits || []).map((v) => ({
          Time: visitTime(v),
          "Visit #": v.visit_number,
          "Shop Code": v.customers?.code || "",
          Shop: v.customers?.name || "",
          Area: areaOf(v.customers),
          City: v.customers?.city || "",
          Type: VISIT_TYPE_LABELS[v.visit_type] || v.visit_type,
          Outcome: v.outcome || "",
          "Order Value": v.order_taken ? Number(v.order_value || 0) : "",
        }))
      ),
      "Visits"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(areas.map((a) => ({ Area: a.area, City: a.city, Shops: a.shops }))),
      "Areas"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        issues.map((i) => ({ Shop: i.shop, Area: i.area, Type: i.kind, Issue: i.issue, Action: i.action }))
      ),
      "Market Issues"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        (trips || []).map((t) => ({
          From: t.from_location || "",
          To: t.to_location || "",
          Purpose: t.purpose || "",
          "Start Odo": Number(t.start_odometer),
          "End Odo": Number(t.end_odometer),
          KM: Number(t.km || 0),
          Litres: Number(t.litres || 0),
          Rate: Number(t.fuel_price_snapshot || 0),
          Amount: Number(t.amount || 0),
          Status: t.status,
        }))
      ),
      "Fuel"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        (orders || []).map((o) => ({
          "Order #": o.order_number,
          Distributor: o.customers?.name || "",
          Area: areaOf(o.customers),
          Items: o.sales_order_items.length,
          "Qty (Dzn)": orderQty(o),
          "Net Amount": orderAmount(o),
          Status: statusLabel(o.status),
        }))
      ),
      "Orders"
    );
    XLSX.writeFile(wb, `Salesman_Activity_${salesmanName.replace(/\s+/g, "_") || "report"}_${date}.xlsx`);
  };

  const handlePrint = () => {
    const table = (head: string[], rows: string[][], numCols: number[] = [], foot?: string[]) =>
      `<table><thead><tr>${head
        .map((h, i) => `<th class="${numCols.includes(i) ? "num" : ""}">${esc(h)}</th>`)
        .join("")}</tr></thead><tbody>${
        rows.length
          ? rows
              .map(
                (r) =>
                  `<tr>${r.map((c, i) => `<td class="${numCols.includes(i) ? "num" : ""}">${esc(c)}</td>`).join("")}</tr>`
              )
              .join("")
          : `<tr><td colspan="${head.length}" class="muted">None</td></tr>`
      }</tbody>${
        foot && rows.length
          ? `<tfoot><tr>${foot.map((c, i) => `<td class="${numCols.includes(i) ? "num" : ""}">${esc(c)}</td>`).join("")}</tr></tfoot>`
          : ""
      }</table>`;

    // Compact one-page A4 layout: secondary sections sit side by side, and the script at
    // the end scales the whole sheet down (widening it to keep the full page width) when
    // a busy day would otherwise spill onto a second page.
    const body = `<style>
        @page { size: A4 portrait; margin: 8mm; }
        body { padding: 0; font-size: 9.5px; }
        .wrap { max-width: none; width: 194mm; margin: 0; }
        .head { padding-bottom: 6px; margin-bottom: 8px; }
        .head h1 { font-size: 15px; }
        .kpis { display: flex; border: 1px solid #ccc; border-radius: 4px; margin-bottom: 8px; }
        .kpis > div { flex: 1; padding: 4px 6px; border-left: 1px solid #ddd; }
        .kpis > div:first-child { border-left: none; }
        .kpis .v { font-size: 12px; font-weight: 700; }
        .kpis .s { font-size: 8.5px; color: #666; }
        .cols { display: flex; gap: 10px; align-items: flex-start; }
        .cols > div { flex: 1; min-width: 0; }
        .section-title { margin: 8px 0 3px; font-size: 9px; }
        th { padding: 3px 4px; font-size: 9px; }
        td { padding: 2.5px 4px; }
        .sign { margin-top: 28px; }
      </style>
      <div class="wrap" id="sheet">
      <div class="head"><div><h1>Salesman Daily Activity</h1><div class="muted">Private Label Sales</div></div>
        <div class="right"><div class="bold">${esc(salesmanName)}</div><div>${esc(prettyDate)}</div></div></div>
      <div class="kpis">
        <div><div class="label">Shops visited</div><div class="v">${shopCount}</div><div class="s">${esc(visitTypeSummary)}</div></div>
        <div><div class="label">Areas covered</div><div class="v">${areas.length}</div></div>
        <div><div class="label">Market issues</div><div class="v">${issues.length}</div></div>
        <div><div class="label">Fuel</div><div class="v">${esc(money(fuelAmount))}</div><div class="s">${qty(fuelKm)} km · ${qty(fuelLitres)} L</div></div>
        <div><div class="label">Confirmed orders</div><div class="v">${esc(money(ordersTotal))}</div><div class="s">${orders?.length || 0} orders</div></div>
        <div><div class="label">Time in market</div><div class="v">${esc(marketTime)}</div><div class="s">${firstIn && lastOut ? `${time(firstIn)} → ${time(lastOut)}` : ""}</div></div>
      </div>
      <div class="section-title">Shops visited</div>
      ${table(
        ["Time", "Shop", "Area", "Type", "Outcome", "Order"],
        (visits || []).map((v) => [
          visitTime(v),
          v.customers?.name || "",
          areaOf(v.customers),
          VISIT_TYPE_LABELS[v.visit_type] || v.visit_type,
          v.outcome || "",
          v.order_taken ? money(Number(v.order_value || 0)) : "",
        ]),
        [5]
      )}
      <div class="cols">
        <div style="flex:0 0 32%">
          <div class="section-title">Areas visited</div>
          ${table(["Area", "City", "Shops"], areas.map((a) => [a.area, a.city, String(a.shops)]), [2])}
        </div>
        <div>
          <div class="section-title">Market issues</div>
          ${table(["Shop", "Type", "Issue", "Action"], issues.map((i) => [i.shop, i.kind, i.issue, i.action]))}
        </div>
      </div>
      <div class="cols">
        <div>
          <div class="section-title">Fuel expenses</div>
          ${table(
            ["Route", "KM", "Litres", "Amount", "Status"],
            (trips || []).map((t) => [
              `${t.from_location || "—"} → ${t.to_location || "—"}`,
              qty(Number(t.km || 0)),
              qty(Number(t.litres || 0)),
              money(Number(t.amount || 0)),
              t.status,
            ]),
            [1, 2, 3],
            ["Total (excl. rejected)", qty(fuelKm), qty(fuelLitres), money(fuelAmount), ""]
          )}
        </div>
        <div>
          <div class="section-title">Confirmed distributor orders</div>
          ${table(
            ["Order #", "Distributor", "Qty (Dzn)", "Amount", "Status"],
            (orders || []).map((o) => [
              o.order_number,
              o.customers?.name || "",
              qty(orderQty(o)),
              money(orderAmount(o)),
              statusLabel(o.status),
            ]),
            [2, 3],
            ["Total", "", qty(ordersQtyTotal), money(ordersTotal), ""]
          )}
        </div>
      </div>
      <div class="sign"><div>Salesman</div><div>Sales Manager</div></div>
    </div>
    <script>
      (function () {
        var sheet = document.getElementById("sheet");
        var mm = 96 / 25.4;
        var pageW = 194 * mm, pageH = 281 * mm * 0.98;
        var zoom = 1;
        for (var i = 0; i < 4; i++) {
          sheet.style.width = pageW / zoom + "px";
          var next = Math.min(1, pageH / sheet.offsetHeight);
          if (Math.abs(next - zoom) < 0.005) break;
          zoom = next;
        }
        sheet.style.width = pageW / zoom + "px";
        sheet.style.zoom = String(zoom);
      })();
    </script>`;
    printDocument(`Salesman Activity ${salesmanName} ${prettyDate}`, body);
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Salesman Daily Activity"
          description="Shops, areas, market issues, fuel and confirmed orders for one salesman on one day"
          icon={ClipboardList}
        />

        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5 min-w-[220px]">
                <Label>Salesman</Label>
                {canViewAll ? (
                  <Select value={salesmanId} onValueChange={setPickedSalesman}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select salesman" />
                    </SelectTrigger>
                    <SelectContent>
                      {(salesmen || []).map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={user?.full_name || ""} disabled />
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Date</Label>
                <div className="flex gap-1.5">
                  <Button variant="outline" size="icon" onClick={() => shiftDate(-1)} aria-label="Previous day">
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Input
                    type="date"
                    value={date}
                    onChange={(e) => e.target.value && setDate(e.target.value)}
                    className="w-[160px]"
                  />
                  <Button variant="outline" size="icon" onClick={() => shiftDate(1)} aria-label="Next day">
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="flex-1" />
              <Button variant="outline" onClick={handleExcel} disabled={!salesmanId || isLoading}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Excel
              </Button>
              <Button onClick={handlePrint} disabled={!salesmanId || isLoading}>
                <Printer className="h-4 w-4 mr-2" />
                Print / PDF
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          <MetricCard title="Shops Visited" value={shopCount} icon={Store} description={visitTypeSummary || undefined} />
          <MetricCard
            title="Areas Covered"
            value={areas.length}
            icon={MapPin}
            description={Array.from(new Set(areas.map((a) => a.city).filter(Boolean))).join(", ") || undefined}
          />
          <MetricCard title="Market Issues" value={issues.length} icon={AlertTriangle} iconColor="text-red-500" />
          <MetricCard
            title="Fuel Expense"
            value={money(fuelAmount)}
            icon={Fuel}
            description={`${qty(fuelKm)} km · ${qty(fuelLitres)} L · ${countedTrips.length} trips`}
          />
          <MetricCard
            title="Confirmed Orders"
            value={money(ordersTotal)}
            icon={ShoppingCart}
            iconColor="text-emerald-500"
            description={`${orders?.length || 0} orders · ${distributorCount} distributors`}
          />
          <MetricCard
            title="Time in Market"
            value={marketTime}
            icon={Clock}
            description={firstIn && lastOut ? `${time(firstIn)} → ${time(lastOut)}` : undefined}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Shops Visited ({visits?.length || 0})</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Shop</TableHead>
                    <TableHead>Area</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead className="text-right">Order</TableHead>
                    <TableHead>Map</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visitsLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">Loading...</TableCell>
                    </TableRow>
                  ) : !visits?.length ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">No visits recorded</TableCell>
                    </TableRow>
                  ) : (
                    visits.map((v) => (
                      <TableRow key={v.id}>
                        <TableCell className="whitespace-nowrap">{visitTime(v)}</TableCell>
                        <TableCell>
                          <div className="font-medium">{v.customers?.name}</div>
                          <div className="text-xs text-muted-foreground">{v.customers?.code}</div>
                        </TableCell>
                        <TableCell>{areaOf(v.customers)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={VISIT_TYPE_COLORS[v.visit_type] || ""}>
                            {VISIT_TYPE_LABELS[v.visit_type] || v.visit_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[220px]">{v.outcome || "—"}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {v.order_taken ? money(Number(v.order_value || 0)) : "—"}
                        </TableCell>
                        <TableCell>
                          {v.latitude != null && v.longitude != null ? (
                            <a
                              href={`https://www.google.com/maps?q=${v.latitude},${v.longitude}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary"
                              aria-label="Open in Google Maps"
                            >
                              <MapPin className="h-4 w-4" />
                            </a>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Areas Visited ({areas.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {!areas.length ? (
                <p className="text-sm text-muted-foreground">No areas</p>
              ) : (
                <div className="divide-y">
                  {areas.map((a) => (
                    <div key={`${a.area}|${a.city}`} className="flex justify-between py-2 text-sm">
                      <span>
                        {a.area}
                        {a.city && <span className="text-muted-foreground"> · {a.city}</span>}
                      </span>
                      <span className="font-medium">{a.shops} {a.shops === 1 ? "shop" : "shops"}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-3">Area is taken from each shop's customer record.</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Market Issues ({issues.length})</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Shop / Area</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Issue</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!issues.length ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">No market issues reported</TableCell>
                  </TableRow>
                ) : (
                  issues.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>
                        <div className="font-medium">{i.shop}</div>
                        <div className="text-xs text-muted-foreground">{i.area}</div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={i.kind === "Complaint" ? VISIT_TYPE_COLORS.complaint : VISIT_TYPE_COLORS.new_business}
                        >
                          {i.kind}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[420px] whitespace-pre-wrap">{i.issue}</TableCell>
                      <TableCell>{i.action || "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Fuel Expenses ({trips?.length || 0} trips)</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>From → To</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead className="text-right">Odometer</TableHead>
                  <TableHead className="text-right">KM</TableHead>
                  <TableHead className="text-right">Litres</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!trips?.length ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground">No fuel trips</TableCell>
                  </TableRow>
                ) : (
                  trips.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>{t.from_location || "—"} → {t.to_location || "—"}</TableCell>
                      <TableCell>{t.purpose || "—"}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {qty(Number(t.start_odometer))} → {qty(Number(t.end_odometer))}
                      </TableCell>
                      <TableCell className="text-right">{qty(Number(t.km || 0))}</TableCell>
                      <TableCell className="text-right">{qty(Number(t.litres || 0))}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {t.fuel_price_snapshot ? money(Number(t.fuel_price_snapshot)) : "—"}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">{money(Number(t.amount || 0))}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={FUEL_STATUS_COLORS[t.status] || ""}>{t.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
              {!!trips?.length && (
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={3}>Total (excl. rejected)</TableCell>
                    <TableCell className="text-right">{qty(fuelKm)}</TableCell>
                    <TableCell className="text-right">{qty(fuelLitres)}</TableCell>
                    <TableCell />
                    <TableCell className="text-right whitespace-nowrap">{money(fuelAmount)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Confirmed Distributor Orders ({orders?.length || 0})</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order #</TableHead>
                  <TableHead>Distributor</TableHead>
                  <TableHead>Area</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Qty (Dzn)</TableHead>
                  <TableHead className="text-right">Net Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!orders?.length ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">No confirmed orders</TableCell>
                  </TableRow>
                ) : (
                  orders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium">{o.order_number}</TableCell>
                      <TableCell>{o.customers?.name}</TableCell>
                      <TableCell>{areaOf(o.customers)}</TableCell>
                      <TableCell className="text-right">{o.sales_order_items.length}</TableCell>
                      <TableCell className="text-right">{qty(orderQty(o))}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{money(orderAmount(o))}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/30">
                          {statusLabel(o.status)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
              {!!orders?.length && (
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={4}>Total</TableCell>
                    <TableCell className="text-right">{qty(ordersQtyTotal)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{money(ordersTotal)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
