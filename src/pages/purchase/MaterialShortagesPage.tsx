import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { MaterialCheckPanel, ResultBadge } from "@/components/materials/MaterialCheckPanel";
import {
  type CheckLine,
  type CheckResult,
  db,
  fmtQty,
  type MaterialCheck,
  type PurchaseStatus,
  PURCHASE_STATUS_LABEL,
  sortLines,
} from "@/lib/productMaterials";

interface SummaryRow {
  item_id: string;
  item_name: string;
  unit: string;
  slots: string | null;
  orders: { number: string | null; label: string | null; source_type: string; source_id: string }[];
  total_needed: number;
  stock_now: number | null;
  last_count_date: string | null;
  count_is_old: boolean;
  min_stock: number;
  max_stock: number;
  result: CheckResult;
  suggest_qty: number | null;
  purchase_status: PurchaseStatus;
  po_reference: string | null;
  status_updated_at: string | null;
}

type Filter = "problems" | "short" | "below_min" | "unknown" | "all";

const STATUSES: PurchaseStatus[] = ["seen", "po_raised", "received"];

export default function MaterialShortagesPage() {
  const qc = useQueryClient();
  const { user, hasRole } = useAuth();
  const [params, setParams] = useSearchParams();
  const checkId = params.get("check");
  const [filter, setFilter] = useState<Filter>("problems");
  const [orderType, setOrderType] = useState("all");
  const [poDraft, setPoDraft] = useState<Record<string, string>>({});

  // Purchase follow-up is for Purchase and Admin; Store can view.
  const canUpdate = ["super_admin", "admin", "purchase_manager", "purchase_officer"].some((r) =>
    hasRole(r as Parameters<typeof hasRole>[0]),
  );

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["material-shortage-summary"],
    queryFn: async () => {
      const { data, error } = await db.rpc("material_shortage_summary");
      if (error) throw error;
      return data as SummaryRow[];
    },
  });

  const { data: focus } = useQuery({
    queryKey: ["material-check-detail", checkId],
    enabled: !!checkId,
    queryFn: async () => {
      const { data: c, error } = await db.from("material_checks").select("*").eq("id", checkId).maybeSingle();
      if (error) throw error;
      if (!c) return null;
      // A newer re-check may have replaced this one: show the latest for the order.
      const { data: latest } = await db
        .from("material_checks")
        .select("*")
        .eq("source_type", c.source_type)
        .eq("source_id", c.source_id)
        .order("created_at", { ascending: false })
        .limit(1);
      const check = (latest?.[0] ?? c) as MaterialCheck;
      const { data: lines, error: lErr } = await db.from("material_check_lines").select("*").eq("check_id", check.id);
      if (lErr) throw lErr;
      return { check, lines: sortLines(lines as CheckLine[]) };
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ itemId, status }: { itemId: string; status: PurchaseStatus }) => {
      const { error } = await db.rpc("material_set_purchase_status", {
        p_item_id: itemId,
        p_status: status,
        p_po_reference: poDraft[itemId] ?? null,
        p_actor: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["material-shortage-summary"] });
      qc.invalidateQueries({ queryKey: ["material-check-detail"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const visible = useMemo(() => {
    return rows
      .filter((r) => {
        if (filter === "problems") return r.result !== "ok" || r.count_is_old;
        if (filter === "all") return true;
        return r.result === filter;
      })
      .filter((r) => orderType === "all" || r.orders.some((o) => o.label === orderType))
      .sort((a, b) => {
        const rank: Record<CheckResult, number> = { short: 1, unknown: 2, below_min: 3, not_set: 4, ok: 5 };
        return rank[a.result] - rank[b.result] || a.item_name.localeCompare(b.item_name);
      });
  }, [rows, filter, orderType]);

  const counts = useMemo(() => {
    const c = { short: 0, below_min: 0, unknown: 0 };
    const orders = new Set<string>();
    for (const r of rows) {
      if (r.result === "short" || r.result === "below_min" || r.result === "unknown") {
        c[r.result]++;
        r.orders.forEach((o) => orders.add(o.source_id));
      }
    }
    return { ...c, orders: orders.size };
  }, [rows]);

  const orderTypes = useMemo(
    () => Array.from(new Set(rows.flatMap((r) => r.orders.map((o) => o.label).filter(Boolean)))) as string[],
    [rows],
  );

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Shortage Summary"
          description="Raw materials needed by confirmed and approved orders. Suggestions only — Purchase creates the PO by hand."
          icon={AlertTriangle}
          iconColor="bg-red-500/10 text-red-600"
        />

        {checkId && focus && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">
                {focus.check.order_label} order {focus.check.order_number ?? ""}
                {focus.check.reason === "updated" && <span className="ml-2 text-sm font-normal text-muted-foreground">(re-checked after edit)</span>}
              </h2>
              <Button variant="ghost" size="sm" onClick={() => { params.delete("check"); setParams(params); }}>
                Show all
              </Button>
            </div>
            <MaterialCheckPanel
              lines={focus.lines}
              mode="saved"
              savedAt={focus.check.created_at}
              closedReason={focus.check.status === "closed" ? "order cancelled" : null}
              showPurchaseStatus
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi value={counts.short} label="materials short" tone="solid" />
          <Kpi value={counts.below_min} label="below min stock" tone="soft" />
          <Kpi value={counts.unknown} label="stock unknown" tone="outline" />
          <Kpi value={counts.orders} label="orders affected" tone="plain" />
        </div>

        <div className="flex flex-wrap gap-2">
          {([
            ["problems", "Needs attention"],
            ["short", "Short"],
            ["below_min", "Below min"],
            ["unknown", "Stock unknown"],
            ["all", "All"],
          ] as [Filter, string][]).map(([k, l]) => (
            <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} onClick={() => setFilter(k)}>
              {l}
            </Button>
          ))}
          <Select value={orderType} onValueChange={setOrderType}>
            <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All order types</SelectItem>
              {orderTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[1150px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">Material</th>
                <th className="px-3 py-3">Orders</th>
                <th className="px-3 py-3 text-right">Total needed</th>
                <th className="px-3 py-3 text-right">Stock now</th>
                <th className="px-3 py-3">Result</th>
                <th className="px-3 py-3 text-right">Min / Max</th>
                <th className="px-3 py-3 text-right">Suggest buying</th>
                <th className="px-4 py-3">Purchase status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!isLoading && visible.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">Nothing to show — no open shortages.</td></tr>
              )}
              {visible.map((r) => (
                <tr key={r.item_id} className={cn("border-t", r.result === "short" && "bg-red-50/60 dark:bg-red-950/20")}>
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.item_name}</div>
                    {r.slots && <div className="text-xs text-muted-foreground">{r.slots}</div>}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {r.orders.map((o) => (
                      <div key={o.source_id}>{o.number ?? "—"} <span className="text-muted-foreground">· {o.label}</span></div>
                    ))}
                  </td>
                  <td className="px-3 py-3 text-right">{fmtQty(r.total_needed, r.unit)}</td>
                  <td className="px-3 py-3 text-right">
                    {fmtQty(r.stock_now, r.unit)}
                    <div className="text-xs text-muted-foreground">
                      {r.last_count_date ? `count ${r.last_count_date} + GRN` : "never counted"}
                      {r.count_is_old && <span className="ml-1 text-amber-700">· old count</span>}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <ResultBadge line={{ result: r.result, unit: r.unit, stock_after: r.stock_now != null ? r.stock_now - r.total_needed : null }} />
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    {fmtQty(r.min_stock)} / {r.max_stock ? fmtQty(r.max_stock) : "—"}
                  </td>
                  <td className="px-3 py-3 text-right font-semibold whitespace-nowrap">
                    {r.result === "unknown" ? "Count first" : r.suggest_qty ? fmtQty(r.suggest_qty, r.unit) : "—"}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="inline-flex overflow-hidden rounded-md border text-xs" role="group" aria-label={`Purchase status for ${r.item_name}`}>
                        {STATUSES.map((st, i) => (
                          <button
                            key={st}
                            type="button"
                            disabled={!canUpdate || setStatus.isPending}
                            onClick={() => setStatus.mutate({ itemId: r.item_id, status: st })}
                            className={cn(
                              "px-2.5 py-1.5",
                              i > 0 && "border-l",
                              r.purchase_status === st ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
                              !canUpdate && "cursor-not-allowed opacity-70",
                            )}
                          >
                            {PURCHASE_STATUS_LABEL[st]}
                          </button>
                        ))}
                      </div>
                      {canUpdate && (
                        <Input
                          className="h-8 w-28 text-xs"
                          placeholder="PO / GRN no."
                          value={poDraft[r.item_id] ?? r.po_reference ?? ""}
                          onChange={(e) => setPoDraft({ ...poDraft, [r.item_id]: e.target.value })}
                        />
                      )}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {r.purchase_status === "new" ? "Not seen yet" : PURCHASE_STATUS_LABEL[r.purchase_status]}
                      {r.po_reference ? ` · ${r.po_reference}` : ""}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Stock now = last stock count + GRN received since that count. Suggest buying = total needed − stock now + min stock,
          never above max stock. The status buttons only record follow-up — no purchase order is created by the system.
        </p>
      </div>
    </ERPLayout>
  );
}

function Kpi({ value, label, tone }: { value: number; label: string; tone: "solid" | "soft" | "outline" | "plain" }) {
  return (
    <div
      className={cn(
        "rounded-xl p-4",
        tone === "solid" && "bg-red-600 text-white",
        tone === "soft" && "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200",
        tone === "outline" && "border bg-card text-red-700 dark:text-red-300",
        tone === "plain" && "border bg-card",
      )}
    >
      <div className="text-3xl font-bold font-display">{value}</div>
      <div className="text-sm">{label}</div>
    </div>
  );
}
