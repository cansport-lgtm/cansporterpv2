import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format, startOfMonth } from "date-fns";
import { LayoutDashboard } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { fmtQty, gpDb, passTypeMeta, statusMeta, todayPk } from "@/lib/gatePass";

type PassRow = {
  id: string; pass_number: string; pass_type: string; status: string; party_name: string;
  vehicle_number: string | null; gate_out_at: string | null; held_at: string | null; hold_note: string | null;
  is_backfill: boolean; created_at: string;
};
type OpenLine = { gate_pass_id: string; pass_number: string; pass_type: string; party_name: string; expected_return_date: string | null; is_overdue: boolean; balance: number; status: string };

export default function GatePassDashboardPage() {
  const monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
  const today = todayPk();

  const { data: recent = [] } = useQuery<PassRow[]>({
    queryKey: ["gate-pass-dashboard", "recent", monthStart],
    queryFn: async () => {
      const { data, error } = await gpDb
        .from("gate_passes")
        .select("id, pass_number, pass_type, status, party_name, vehicle_number, gate_out_at, held_at, hold_note, is_backfill, created_at")
        .or(`gate_out_at.gte.${monthStart}T00:00:00+05:00,status.in.(pending_approval,approved,held)`)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: open = [] } = useQuery<OpenLine[]>({
    queryKey: ["gate-pass-dashboard", "open"],
    queryFn: async () => {
      const { data, error } = await gpDb.from("v_gate_pass_open_lines")
        .select("gate_pass_id, pass_number, pass_type, party_name, expected_return_date, is_overdue, balance, status")
        .in("status", ["out", "partially_returned"]);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: scrapKg = 0 } = useQuery<number>({
    queryKey: ["gate-pass-dashboard", "scrap", monthStart],
    queryFn: async () => {
      const { data, error } = await gpDb.from("gate_pass_scrap_entries").select("quantity").eq("entry_type", "out").gte("entry_date", monthStart);
      if (error) return 0;
      return (data ?? []).reduce((s: number, r: { quantity: number }) => s + Number(r.quantity), 0);
    },
  });

  const outToday = recent.filter((r) => r.gate_out_at && new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date(r.gate_out_at)) === today);
  const pending = recent.filter((r) => r.status === "pending_approval");
  const waiting = recent.filter((r) => r.status === "approved");
  const held = recent.filter((r) => r.status === "held");
  const outside = useMemo(() => {
    const m = new Map<string, OpenLine>();
    open.filter((l) => Number(l.balance) > 0).forEach((l) => m.set(l.gate_pass_id, l));
    return [...m.values()];
  }, [open]);
  const overdue = outside.filter((l) => l.is_overdue);
  const byType = useMemo(() => {
    const m = new Map<string, number>();
    recent.filter((r) => r.gate_out_at && r.gate_out_at >= `${monthStart}`).forEach((r) => m.set(r.pass_type, (m.get(r.pass_type) ?? 0) + 1));
    return m;
  }, [recent, monthStart]);

  const kpis = [
    { label: "Out today", value: outToday.length, tone: "", href: "/gate-pass/passes" },
    { label: "Waiting at gate", value: waiting.length, tone: "text-sky-700", href: "/gate-pass/passes" },
    { label: "Pending approval", value: pending.length, tone: "text-amber-700", href: "/gate-pass/approvals" },
    { label: "Held at gate", value: held.length, tone: held.length ? "text-red-700" : "", href: "/gate-pass/approvals" },
    { label: "Goods outside", value: outside.length, tone: "text-violet-700", href: "/gate-pass/returns" },
    { label: "Overdue returns", value: overdue.length, tone: overdue.length ? "text-red-700" : "", href: "/gate-pass/returns" },
    { label: "Scrap sold this month", value: `${fmtQty(scrapKg)} kg`, tone: "", href: "/gate-pass/scrap-yard" },
  ];

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader title="Gate Pass Dashboard" description="What is at the gate, waiting, held and outside the factory" icon={LayoutDashboard} />

        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
          {kpis.map((k) => (
            <Link key={k.label} to={k.href}>
              <Card className="hover:border-primary/40 transition-colors h-full">
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">{k.label}</div>
                  <div className={cn("text-2xl font-display font-bold mt-1", k.tone)}>{k.value}</div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base text-red-700">Held at gate</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {held.length === 0 && <p className="text-sm text-muted-foreground">No vehicle is held.</p>}
              {held.map((p) => (
                <Link key={p.id} to={`/gate-pass/passes/${p.id}`} className="block rounded-lg border border-red-200 bg-red-50/60 p-2 text-sm hover:bg-red-50">
                  <div className="font-semibold">{p.pass_number} · {passTypeMeta(p.pass_type).label} · {p.party_name}</div>
                  <div className="text-xs text-red-800 truncate">{p.hold_note}</div>
                </Link>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Overdue returns</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {overdue.length === 0 && <p className="text-sm text-muted-foreground">Nothing overdue.</p>}
              {overdue.map((l) => (
                <Link key={l.gate_pass_id} to={`/gate-pass/passes/${l.gate_pass_id}`} className="block rounded-lg border p-2 text-sm hover:bg-muted/50">
                  <div className="font-semibold">{l.pass_number} · {passTypeMeta(l.pass_type).label} · {l.party_name}</div>
                  <div className="text-xs text-red-700">Due {l.expected_return_date ? format(new Date(l.expected_return_date), "dd MMM yyyy") : ""}</div>
                </Link>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Out this month by type</CardTitle></CardHeader>
            <CardContent className="space-y-1.5">
              {[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => (
                <div key={t} className="flex justify-between text-sm">
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset", passTypeMeta(t).badgeClass)}>{passTypeMeta(t).label}</span>
                  <span className="font-semibold tabular-nums">{n}</span>
                </div>
              ))}
              {byType.size === 0 && <p className="text-sm text-muted-foreground">No passes out yet this month.</p>}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Out today</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {outToday.length === 0 && <p className="text-sm text-muted-foreground">Nothing has gone out today.</p>}
            {outToday.map((p) => (
              <Link key={p.id} to={`/gate-pass/passes/${p.id}`} className="flex flex-wrap items-center gap-2 rounded-md p-2 text-sm hover:bg-muted/50">
                <span className="font-mono font-semibold w-24">{p.pass_number}</span>
                <span className="text-muted-foreground w-14">{p.gate_out_at ? format(new Date(p.gate_out_at), "HH:mm") : ""}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset", passTypeMeta(p.pass_type).badgeClass)}>{passTypeMeta(p.pass_type).label}</span>
                <span className="flex-1 min-w-[160px]">{p.party_name}</span>
                <span className="text-muted-foreground">{p.vehicle_number ?? "hand carry"}</span>
                {p.is_backfill && <Badge variant="warning">Backfill</Badge>}
                <Badge variant={statusMeta(p.status).variant}>{statusMeta(p.status).label}</Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
