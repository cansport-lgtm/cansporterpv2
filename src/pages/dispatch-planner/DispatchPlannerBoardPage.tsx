import { useMemo, useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { CalendarRange, GripVertical, Pin, Printer, RefreshCw, Save, Search, Zap } from "lucide-react";
import { toast } from "sonner";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  SEVERITY_TONE, STATUS_META, addDaysIso, dayTotals, dpDb, errorMessage, fetchSettings, fetchSuggest, fetchVehicles,
  fetchWorkingDays, flagMeta, fmtDay, fmtQty, groupByDay, groupLoads, printLoadingSuggestions, statusMeta, suggestErrorHint, sum, todayPk,
  type SuggestRow,
} from "@/lib/dispatchPlanner";

const DAY_OPTIONS = [7, 10, 14, 21];

export default function DispatchPlannerBoardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasRole } = useAuth();
  const canPlan = hasRole("super_admin") || hasRole("dispatch_planner_manager") || hasRole("dispatch_planner_officer");

  const today = todayPk();
  const [from, setFrom] = useState(today);
  const [days, setDays] = useState(7);
  const to = addDaysIso(from, days - 1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<SuggestRow | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);

  const { data: settings } = useQuery({ queryKey: ["dp-settings"], queryFn: fetchSettings });
  const { data: vehicles = [] } = useQuery({ queryKey: ["dp-vehicles", "active"], queryFn: () => fetchVehicles(true) });
  const { data: calendar = [] } = useQuery({ queryKey: ["dp-working-days", from, to], queryFn: () => fetchWorkingDays(from, to) });
  const { data: rows = [], isLoading, isFetching, isError, error, refetch } = useQuery<SuggestRow[]>({
    queryKey: ["dp-suggest", from, to],
    queryFn: () => fetchSuggest(from, to),
    retry: false,
  });

  const fleet = sum(vehicles.map((v) => v.carton_capacity));
  const q = search.trim().toLowerCase();
  const visible = useMemo(
    () => rows.filter((r) =>
      (statusFilter === "all" || r.status === statusFilter) &&
      (!q || [r.order_number, r.customer_name, r.city, r.product_code, r.product_name, r.grade_name, r.vehicle_reg]
        .some((x) => (x ?? "").toLowerCase().includes(q)))),
    [rows, q, statusFilter],
  );
  const byDay = useMemo(() => groupByDay(visible), [visible]);
  const later = visible.filter((r) => r.suggested_date > to);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["dp-suggest"] });
  };

  const pin = useMutation({
    mutationFn: async (p: { order_item_id: string; date: string | null; urgent: boolean; note: string | null }) => {
      const { error } = await dpDb.rpc("dispatch_planner_pin_save", {
        p_order_item_id: p.order_item_id, p_pinned_date: p.date, p_urgent: p.urgent, p_note: p.note,
      });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); setSelected(null); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const clearPin = useMutation({
    mutationFn: async (orderItemId: string) => {
      const { error } = await dpDb.rpc("dispatch_planner_pin_clear", { p_order_item_id: orderItemId });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); setSelected(null); toast.success("Pin removed"); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const resuggest = useMutation({
    mutationFn: async () => {
      if (canPlan) await dpDb.rpc("dispatch_planner_pins_cleanup");
      await refetch();
    },
    onSuccess: () => toast.success("Suggestion refreshed"),
  });
  const saveVersion = useMutation({
    mutationFn: async () => {
      const { data, error } = await dpDb.rpc("dispatch_planner_version_save", {
        p_from: from, p_to: to, p_label: label || null, p_lines: rows,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["dp-versions"] });
      toast.success("Plan version saved");
      setSaveOpen(false);
      navigate(`/dispatch-planner/versions/${id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  // Drag a stock-covered line onto another day = pin it there (the server moves a
  // non-working day to the next working one). Needs-production parts cannot be pinned.
  const onDragStart = (e: DragEvent, r: SuggestRow) => {
    if (!canPlan || r.status === "needs_production") { e.preventDefault(); return; }
    setDragKey(r.line_key);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDrop = (e: DragEvent, day: string) => {
    e.preventDefault();
    setOverDay(null);
    const r = rows.find((x) => x.line_key === dragKey);
    setDragKey(null);
    if (!r || r.suggested_date === day) return;
    pin.mutate({ order_item_id: r.order_item_id, date: day, urgent: r.urgent, note: r.pin_note });
  };

  const columns = calendar.length
    ? calendar
    : Array.from({ length: days }, (_, i) => ({ day: addDaysIso(from, i), is_working: true, reason: null }));

  return (
    <ERPLayout>
      <div className="w-full max-w-full space-y-4">
        <PageHeader
          title="Suggested Dispatch Plan"
          description="Pending domestic order lines placed on days and loads from stock, deadlines and the fleet. Drag a line to another day to pin it. Nothing is booked."
          icon={CalendarRange}
        >
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value || today)} className="h-9 w-[150px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Days</Label>
              <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
                <SelectTrigger className="h-9 w-[90px]"><SelectValue /></SelectTrigger>
                <SelectContent>{DAY_OPTIONS.map((d) => <SelectItem key={d} value={String(d)}>{d}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" className="h-9" onClick={() => resuggest.mutate()} disabled={isFetching}>
              <RefreshCw className={cn("h-4 w-4 mr-1", isFetching && "animate-spin")} /> Re-suggest
            </Button>
            {canPlan && (
              <Button size="sm" className="h-9" onClick={() => setSaveOpen(true)} disabled={rows.length === 0}>
                <Save className="h-4 w-4 mr-1" /> Save as version
              </Button>
            )}
          </div>
        </PageHeader>

        <Card>
          <CardContent className="p-3 flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Order, customer, city, product, vehicle…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9 w-[280px]" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All lines</SelectItem>
                {Object.entries(STATUS_META).map(([k, m]) => <SelectItem key={k} value={k}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground ml-auto">
              {Object.entries(STATUS_META).map(([k, m]) => (
                <span key={k} className="inline-flex items-center gap-1"><span className={cn("h-2 w-2 rounded-full", m.dot)} />{m.label}</span>
              ))}
              <span>· fleet {fleet ? `${fleet} ctn/day` : "not set"} · lead time {settings?.lead_time_days ?? "…"} working days</span>
            </div>
          </CardContent>
        </Card>

        {isError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{suggestErrorHint(error)}</div>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Working out the suggestion…</p>
        ) : rows.length === 0 ? (
          <Card><CardContent className="p-6 text-center text-muted-foreground">No pending domestic order lines. Nothing to plan.</CardContent></Card>
        ) : (
          <div className="overflow-x-auto pb-2">
            <div className="flex gap-3 min-w-max items-start">
              {columns.map((c) => {
                const dayRows = byDay.get(c.day) ?? [];
                const t = dayTotals(dayRows);
                const fill = fleet ? Math.min(100, Math.round((t.cartons / fleet) * 100)) : 0;
                const over = fleet > 0 && t.cartons > fleet;
                return (
                  <div
                    key={c.day}
                    onDragOver={(e) => { if (dragKey) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOverDay(c.day); } }}
                    onDragLeave={() => setOverDay((d) => (d === c.day ? null : d))}
                    onDrop={(e) => onDrop(e, c.day)}
                    className={cn(
                      "rounded-lg border bg-muted/30 flex flex-col",
                      c.is_working ? "w-[300px]" : "w-[120px] opacity-70",
                      c.day === today && "border-primary/60",
                      overDay === c.day && "ring-2 ring-primary/50 bg-primary/5",
                    )}
                  >
                    <div className="p-2 border-b">
                      <div className="flex items-center justify-between gap-1">
                        <div>
                          <div className={cn("text-sm font-semibold", c.day === today && "text-primary")}>{fmtDay(c.day)}</div>
                          {!c.is_working && <div className="text-[11px] text-muted-foreground">{c.reason ?? "Non-working"}</div>}
                        </div>
                        {dayRows.length > 0 && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Print loading suggestion" onClick={() => printLoadingSuggestions(c.day, dayRows)}>
                            <Printer className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                      {c.is_working && (
                        <>
                          <div className="text-xs text-muted-foreground mt-1 tabular-nums">{t.lines} line(s) · {fmtQty(t.dozens)} dz · {t.cartons} ctn · {t.loads} load(s)</div>
                          {fleet > 0 && (
                            <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden" title={`${t.cartons} of ${fleet} fleet cartons`}>
                              <div className={cn("h-full rounded-full", over ? "bg-red-500" : fill > 85 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${fill}%` }} />
                            </div>
                          )}
                          {t.highFlags > 0 && <div className="text-[11px] text-red-700 font-semibold mt-1">{t.highFlags} line(s) overdue / late / over fleet</div>}
                        </>
                      )}
                    </div>
                    <div className="p-2 space-y-2 min-h-[120px]">
                      {groupLoads(dayRows).map((g) => {
                        const cap = vehicles.find((v) => v.id === g.vehicle_id)?.carton_capacity ?? null;
                        return (
                          <div key={g.load_no ?? 0} className="rounded-md border bg-background/60">
                            <div className="px-2 py-1 text-[11px] font-semibold flex items-center justify-between border-b bg-muted/40">
                              <span>Load {g.load_no ?? "—"} · {g.vehicle_reg ?? "no vehicle"}</span>
                              <span className={cn("tabular-nums", cap && g.cartons > cap && "text-red-700")}>{g.cartons}{cap ? `/${cap}` : ""} ctn</span>
                            </div>
                            <div className="p-1.5 space-y-1.5">
                              {g.rows.map((r) => <LineCard key={r.line_key} r={r} canDrag={canPlan && r.status !== "needs_production"} dragging={dragKey === r.line_key} onDragStart={onDragStart} onClick={() => setSelected(r)} />)}
                            </div>
                          </div>
                        );
                      })}
                      {dayRows.length === 0 && c.is_working && <p className="text-xs text-muted-foreground text-center pt-6">{dragKey ? "Drop here to pin" : "Nothing suggested"}</p>}
                    </div>
                  </div>
                );
              })}
              {later.length > 0 && (
                <div className="w-[300px] rounded-lg border border-dashed bg-muted/20 flex flex-col">
                  <div className="p-2 border-b">
                    <div className="text-sm font-semibold">After {fmtDay(to, "dd MMM")}</div>
                    <div className="text-xs text-muted-foreground mt-1">{later.length} line(s) · {fmtQty(sum(later.map((r) => r.suggested_dozens)))} dz — mostly waiting for production</div>
                  </div>
                  <div className="p-2 space-y-1.5">
                    {later.map((r) => <LineCard key={r.line_key} r={r} canDrag={canPlan && r.status !== "needs_production"} dragging={dragKey === r.line_key} onDragStart={onDragStart} onClick={() => setSelected(r)} showDate />)}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <LineDialog row={selected} canPlan={canPlan} onClose={() => setSelected(null)}
          onPin={(date, urgent, note) => selected && pin.mutate({ order_item_id: selected.order_item_id, date, urgent, note })}
          onClear={() => selected && clearPin.mutate(selected.order_item_id)}
          busy={pin.isPending || clearPin.isPending} />

        <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Save this suggestion as a version</DialogTitle>
              <DialogDescription>Keeps a copy of the board as it is now ({rows.length} lines, {fmtDay(from, "dd MMM")} – {fmtDay(to, "dd MMM")}) so it can be printed and later compared with what was actually dispatched. Nothing else happens.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1">
              <Label>Label (optional)</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Monday planning meeting" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSaveOpen(false)}>Cancel</Button>
              <Button onClick={() => saveVersion.mutate()} disabled={saveVersion.isPending}>Save version</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}

function LineCard({ r, canDrag, dragging, onDragStart, onClick, showDate }: {
  r: SuggestRow; canDrag: boolean; dragging: boolean; showDate?: boolean;
  onDragStart: (e: DragEvent, r: SuggestRow) => void; onClick: () => void;
}) {
  const m = statusMeta(r.status);
  const strong = r.flags.filter((f) => flagMeta(f).severity !== "info");
  const dl = r.deadline ? Math.round((new Date(r.deadline).getTime() - new Date(r.suggested_date).getTime()) / 86_400_000) : null;
  return (
    <div
      draggable={canDrag}
      onDragStart={(e) => onDragStart(e, r)}
      onClick={onClick}
      className={cn(
        "rounded-md border bg-background p-2 text-xs shadow-sm hover:shadow transition-shadow cursor-pointer",
        canDrag && "cursor-grab",
        dragging && "opacity-50",
        r.status === "needs_production" && "border-red-200",
        r.status === "partial" && "border-amber-200",
      )}
      title={r.reason ?? ""}
    >
      <div className="flex items-start gap-1.5">
        {canDrag ? <GripVertical className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" /> : <span className={cn("mt-1 h-2 w-2 rounded-full shrink-0", m.dot)} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <span className="font-semibold truncate">{r.customer_name}</span>
            <span className="tabular-nums whitespace-nowrap font-semibold">{fmtQty(r.suggested_dozens)} dz · {r.cartons} ctn</span>
          </div>
          <div className="text-muted-foreground truncate">{r.order_number}{r.part > 1 ? " · part 2" : ""} · {r.product_code} {r.product_name}{r.grade_name ? ` · ${r.grade_name}` : ""}</div>
          <div className="flex flex-wrap items-center gap-1 mt-1">
            <span className={cn("inline-flex rounded-full px-1.5 py-0 text-[10px] font-semibold ring-1 ring-inset", m.tone)}>{m.short}</span>
            {r.pinned && <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 text-[10px] font-semibold ring-1 ring-inset bg-violet-50 text-violet-700 ring-violet-200"><Pin className="h-2.5 w-2.5" />pinned</span>}
            {r.urgent && <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 text-[10px] font-semibold ring-1 ring-inset bg-sky-50 text-sky-700 ring-sky-200"><Zap className="h-2.5 w-2.5" />urgent</span>}
            {strong.map((f) => <span key={f} className={cn("inline-flex rounded-full px-1.5 text-[10px] font-semibold ring-1 ring-inset", SEVERITY_TONE[flagMeta(f).severity])}>{flagMeta(f).label}</span>)}
            <span className={cn("ml-auto text-[10px] whitespace-nowrap", dl !== null && dl < 0 ? "text-red-700 font-semibold" : "text-muted-foreground")}>
              {showDate ? `${fmtDay(r.suggested_date, "dd MMM")} · ` : ""}{r.deadline ? `due ${fmtDay(r.deadline, "dd MMM")}` : "no deadline"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function LineDialog({ row, canPlan, onClose, onPin, onClear, busy }: {
  row: SuggestRow | null; canPlan: boolean; busy: boolean; onClose: () => void;
  onPin: (date: string | null, urgent: boolean, note: string | null) => void; onClear: () => void;
}) {
  const [date, setDate] = useState<string>("");
  const [urgent, setUrgent] = useState(false);
  const [note, setNote] = useState("");
  const [key, setKey] = useState<string | null>(null);
  if (row && key !== row.line_key) {
    setKey(row.line_key);
    setDate(row.pinned_date ?? "");
    setUrgent(row.urgent);
    setNote(row.pin_note ?? "");
  }
  if (!row) return null;
  const m = statusMeta(row.status);
  const canPinDate = row.status !== "needs_production";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{row.order_number} · {row.customer_name}
            <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", m.tone)}>{m.label}</span>
          </DialogTitle>
          <DialogDescription>{row.product_code} {row.product_name}{row.grade_name ? ` · ${row.grade_name}` : ""} · {row.packing_type ?? "packing?"} · {fmtQty(row.suggested_dozens)} of {fmtQty(row.pending_dozens)} pending dz · {row.cartons} ctn</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><div className="text-xs text-muted-foreground">Suggested day</div><div className="font-semibold">{fmtDay(row.suggested_date, "EEE dd MMM yyyy")}</div></div>
          <div><div className="text-xs text-muted-foreground">Deadline</div><div className="font-semibold">{fmtDay(row.deadline, "EEE dd MMM yyyy")}</div></div>
          <div><div className="text-xs text-muted-foreground">Load / vehicle</div><div className="font-semibold">Load {row.load_no ?? "—"} · {row.vehicle_reg ?? "—"}</div></div>
          <div><div className="text-xs text-muted-foreground">Stock closing ({row.planning_item_name ?? "no planning item"})</div><div className="font-semibold">{row.stock_closing !== null ? `${fmtQty(row.stock_closing)} dz on ${fmtDay(row.stock_closing_date, "dd MMM")}` : "—"}</div></div>
          <div className="col-span-2 rounded-md bg-muted/50 p-2 text-xs"><span className="font-semibold">Why here: </span>{row.reason}</div>
          {row.flags.length > 0 && (
            <div className="col-span-2 space-y-1">
              {row.flags.map((f) => (
                <div key={f} className="flex items-start gap-2 text-xs">
                  <span className={cn("inline-flex rounded-full px-2 py-0.5 font-semibold ring-1 ring-inset whitespace-nowrap", SEVERITY_TONE[flagMeta(f).severity])}>{flagMeta(f).label}</span>
                  <span className="text-muted-foreground">{flagMeta(f).help}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {canPlan && (
          <div className="space-y-3 border-t pt-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Pin to a day</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!canPinDate} />
                {!canPinDate && <p className="text-[11px] text-muted-foreground">A part that needs production follows the lead time and cannot be pinned.</p>}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Urgent</Label>
                <div className="flex items-center gap-2 h-10"><Switch checked={urgent} onCheckedChange={setUrgent} /><span className="text-xs text-muted-foreground">Plan ahead of every deadline</span></div>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Note</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Why this line is pinned or urgent" />
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          {canPlan && (row.pinned || row.urgent || row.pin_note) && <Button variant="outline" onClick={onClear} disabled={busy}>Clear pin</Button>}
          <Button variant="outline" onClick={onClose}>Close</Button>
          {canPlan && <Button onClick={() => onPin(canPinDate && date ? date : null, urgent, note || null)} disabled={busy}>Save</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
