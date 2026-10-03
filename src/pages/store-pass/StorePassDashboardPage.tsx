import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format, subDays } from "date-fns";
import { LayoutDashboard } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  SEVERITY_TONE, discrepancyMeta, fmtQty, hoursBetween, spDb, spStatusMeta, stageMeta, todayPk,
  type ReconRow, type TrackingRow,
} from "@/lib/storePass";

type PassRow = { id: string; pass_number: string; status: string; vehicle_number: string | null; party_name: string; issued_at: string | null; created_at: string; issuer: { full_name: string | null } | null };

export default function StorePassDashboardPage() {
  const today = todayPk();
  const weekAgo = format(subDays(new Date(), 6), "yyyy-MM-dd");

  // Today's dispatches plus everything still open, whatever its date.
  const { data: tracking = [] } = useQuery<TrackingRow[]>({
    queryKey: ["store-gate-tracking", "dashboard", today],
    queryFn: async () => {
      const [t, open] = await Promise.all([
        spDb.from("v_store_gate_tracking").select("*").eq("dispatch_date", today),
        spDb.from("v_store_gate_tracking").select("*").in("stage", ["no_store_pass", "draft", "issued", "on_gate_pass", "held"]),
      ]);
      if (t.error) throw t.error;
      if (open.error) throw open.error;
      const m = new Map<string, TrackingRow>();
      [...(open.data ?? []), ...(t.data ?? [])].forEach((r: TrackingRow) => m.set(r.dispatch_id, r));
      return [...m.values()];
    },
  });
  const { data: recon = [] } = useQuery<ReconRow[]>({
    queryKey: ["store-gate-recon", weekAgo, today],
    queryFn: async () => {
      const { data, error } = await spDb.rpc("store_pass_reconcile", { p_from: weekAgo, p_to: today });
      if (error) return [];
      return (data ?? []) as ReconRow[];
    },
  });
  const { data: recent = [] } = useQuery<PassRow[]>({
    queryKey: ["store-passes", "dashboard"],
    queryFn: async () => {
      const { data, error } = await spDb
        .from("store_passes")
        .select("id, pass_number, status, vehicle_number, party_name, issued_at, created_at, issuer:app_users!store_passes_issued_by_fkey(full_name)")
        .order("created_at", { ascending: false })
        .limit(12);
      if (error) throw error;
      return data ?? [];
    },
  });

  const pkDay = (s: string | null) => (s ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date(s)) : "");
  const todayDc = tracking.filter((r) => r.dispatch_date === today);
  const issuedToday = tracking.filter((r) => pkDay(r.sp_issued_at) === today && r.sp_status === "issued");
  const outToday = tracking.filter((r) => pkDay(r.gate_out_at) === today);
  const waiting = tracking.filter((r) => r.stage === "issued").sort((a, b) => (a.sp_issued_at ?? "").localeCompare(b.sp_issued_at ?? ""));
  const noPass = tracking.filter((r) => r.stage === "no_store_pass");
  const held = tracking.filter((r) => r.stage === "held");
  const openIssues = recon.filter((r) => r.open_high > 0 || r.open_medium > 0).sort((a, b) => b.open_high - a.open_high);
  const openHigh = recon.reduce((s, r) => s + r.open_high, 0);

  const kpis = [
    { label: "Dispatches made today", value: todayDc.length, sub: `${fmtQty(todayDc.reduce((s, r) => s + Number(r.dc_quantity), 0))} dz`, href: "/store-pass/tracking", tone: "" },
    { label: "Store passes issued today", value: new Set(issuedToday.map((r) => r.store_pass_id)).size, sub: `${fmtQty(issuedToday.reduce((s, r) => s + Number(r.sp_quantity ?? 0), 0))} dz`, href: "/store-pass/passes", tone: "" },
    { label: "Gone out today", value: new Set(outToday.map((r) => r.gate_pass_id)).size, sub: `${outToday.length} dispatch(es)`, href: "/store-pass/tracking", tone: "" },
    { label: "Issued, waiting for gate pass", value: waiting.length, sub: "goods between store and gate", href: "/store-pass/tracking", tone: "text-indigo-700" },
    { label: "Dispatches with no store pass", value: noPass.length, sub: "pending at the office", href: "/store-pass/new", tone: noPass.length ? "text-red-700" : "" },
    { label: "Held at gate", value: held.length, sub: "", href: "/store-pass/tracking", tone: held.length ? "text-amber-700" : "" },
    { label: "Open discrepancies (7 days)", value: openHigh, sub: `${openIssues.length} dispatch(es)`, href: "/store-pass/reconciliation", tone: openHigh ? "text-red-700" : "" },
  ];

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader title="Store Pass Dashboard" description="What the store has handed over today, what is waiting for the gate, and what does not add up" icon={LayoutDashboard} />

        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
          {kpis.map((k) => (
            <Link key={k.label} to={k.href}>
              <Card className="hover:border-primary/40 transition-colors h-full">
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">{k.label}</div>
                  <div className={cn("text-2xl font-display font-bold mt-1 tabular-nums", k.tone)}>{k.value}</div>
                  {k.sub && <div className="text-xs text-muted-foreground mt-0.5">{k.sub}</div>}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base text-indigo-700">Issued, waiting for gate pass</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {waiting.length === 0 && <p className="text-sm text-muted-foreground">Nothing is waiting between store and gate.</p>}
              {waiting.slice(0, 8).map((r) => (
                <Link key={r.dispatch_id} to={`/store-pass/passes/${r.store_pass_id}`} className="block rounded-lg border p-2 text-sm hover:bg-muted/50">
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold">{r.sp_number} · {r.dispatch_number}</span>
                    <span className="text-xs text-indigo-700 font-semibold whitespace-nowrap">waiting {hoursBetween(r.sp_issued_at, new Date().toISOString())}</span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{r.customer_name} · {r.sp_vehicle} · {fmtQty(r.sp_quantity)} dz / {Number(r.sp_packages ?? 0)} ctn</div>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base text-red-700">Open discrepancies · last 7 days</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {openIssues.length === 0 && <p className="text-sm text-muted-foreground">Nothing open. Store and gate agree.</p>}
              {openIssues.slice(0, 8).map((r) => (
                <Link key={r.dispatch_id} to={`/store-pass/reconciliation?date=${r.out_date ?? r.sp_date ?? r.dispatch_date}`} className="block rounded-lg border p-2 text-sm hover:bg-muted/50">
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold">{r.dispatch_number}</span>
                    <span className="text-xs text-muted-foreground">{format(new Date(r.dispatch_date), "dd MMM")}</span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{r.customer_name}</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {r.codes.filter((c) => !r.explained.some((e) => e.code === c)).map((c) => (
                      <span key={c} className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", SEVERITY_TONE[discrepancyMeta(c).severity])}>{discrepancyMeta(c).label}</span>
                    ))}
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Dispatches with no store pass</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {noPass.length === 0 && <p className="text-sm text-muted-foreground">Every pending dispatch has a store pass.</p>}
              {noPass.slice(0, 8).map((r) => (
                <Link key={r.dispatch_id} to="/store-pass/new" className="block rounded-lg border border-red-200 bg-red-50/60 p-2 text-sm hover:bg-red-50">
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold">{r.dispatch_number}</span>
                    <span className={cn("text-[11px] font-semibold rounded-full px-2 py-0.5 ring-1 ring-inset", stageMeta(r.stage).tone)}>{stageMeta(r.stage).label}</span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{r.customer_name} · {fmtQty(r.dc_quantity)} dz / {Number(r.dc_packages)} ctn · DC {format(new Date(r.dispatch_created_at), "dd MMM HH:mm")}</div>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Recent store passes</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {recent.length === 0 && <p className="text-sm text-muted-foreground">No store passes yet.</p>}
            {recent.map((p) => (
              <Link key={p.id} to={`/store-pass/passes/${p.id}`} className="flex flex-wrap items-center gap-2 rounded-md p-2 text-sm hover:bg-muted/50">
                <span className="font-mono font-semibold w-24">{p.pass_number}</span>
                <span className="text-muted-foreground w-28">{p.issued_at ? format(new Date(p.issued_at), "dd MMM HH:mm") : format(new Date(p.created_at), "dd MMM HH:mm")}</span>
                <span className="w-24">{p.vehicle_number ?? "—"}</span>
                <span className="flex-1 min-w-[160px] truncate">{p.party_name}</span>
                <span className="text-muted-foreground text-xs">{p.issuer?.full_name ?? ""}</span>
                <Badge variant={spStatusMeta(p.status).variant}>{spStatusMeta(p.status).label}</Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
