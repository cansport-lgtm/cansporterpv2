import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { addDays, format } from "date-fns";
import { ChevronLeft, ChevronRight, FileSpreadsheet, Printer, Scale, Settings2 } from "lucide-react";
import * as XLSX from "xlsx";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { esc, printDocument } from "@/lib/printDocument";
import { statusMeta as gpStatusMeta } from "@/lib/gatePass";
import {
  SEVERITY_TONE, discrepancyMeta, errorMessage, fmtQty, gateFigure, spDb, todayPk,
  type ReconProductRow, type ReconRow,
} from "@/lib/storePass";

const isDate = (s: string | null) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));
const fmtT = (s: string | null) => (s ? format(new Date(s), "HH:mm") : "—");
const fmtDT = (s: string | null) => (s ? format(new Date(s), "dd MMM, HH:mm") : "—");
const inRange = (d: string | null, from: string, to: string) => Boolean(d && d >= from && d <= to);

export default function StoreGateReconciliationPage() {
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { roles } = useAuth();
  const canResolve = roles.some((r) => ["super_admin", "store_pass_manager", "gate_pass_manager"].includes(r.role));
  const isSuper = roles.some((r) => r.role === "super_admin");
  const today = todayPk();
  const start = isDate(params.get("date")) ? (params.get("date") as string) : today;
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(start);
  const [onlyIssues, setOnlyIssues] = useState(true);
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<{ row: ReconRow; code: string } | null>(null);
  const [note, setNote] = useState("");
  const [gateMode, setGateMode] = useState<string | null>(null);
  const single = from === to;

  const shift = (days: number) => {
    const f = format(addDays(new Date(from), days), "yyyy-MM-dd");
    const t = format(addDays(new Date(to), days), "yyyy-MM-dd");
    setFrom(f);
    setTo(t);
  };

  const { data: rows = [], isLoading } = useQuery<ReconRow[]>({
    queryKey: ["store-gate-recon", from, to],
    enabled: from <= to,
    queryFn: async () => {
      const { data, error } = await spDb.rpc("store_pass_reconcile", { p_from: from, p_to: to });
      if (error) throw error;
      return (data ?? []) as ReconRow[];
    },
  });
  const { data: products = [] } = useQuery<ReconProductRow[]>({
    queryKey: ["store-gate-recon-products", from, to],
    enabled: from <= to,
    queryFn: async () => {
      const { data, error } = await spDb.rpc("store_pass_reconcile_products", { p_from: from, p_to: to });
      if (error) throw error;
      return (data ?? []) as ReconProductRow[];
    },
  });
  const { data: settings } = useQuery<{ required_at_gate: string } | null>({
    queryKey: ["store-pass-settings"],
    queryFn: async () => {
      const { data, error } = await spDb.from("store_pass_settings").select("required_at_gate").maybeSingle();
      if (error) return null;
      return data;
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["store-gate-recon"] });
    queryClient.invalidateQueries({ queryKey: ["store-gate-recon-products"] });
    queryClient.invalidateQueries({ queryKey: ["store-pass-settings"] });
  };
  const call = useMutation({
    mutationFn: async ({ fn, args }: { fn: string; args: Record<string, unknown>; done: string }) => {
      const { error } = await spDb.rpc(fn, args);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast({ title: v.done });
      setDialog(null);
      setNote("");
      refresh();
    },
    onError: (e) => toast({ title: "Could not save", description: errorMessage(e), variant: "destructive" }),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => !onlyIssues || r.codes.length > 0)
      .filter((r) => !q || [r.dispatch_number, r.customer_name ?? "", r.sp_number ?? "", r.gp_number ?? "", r.order_numbers ?? ""].some((v) => v.toLowerCase().includes(q)))
      .sort((a, b) => (b.open_high - a.open_high) || (b.open_medium - a.open_medium) || a.dispatch_number.localeCompare(b.dispatch_number));
  }, [rows, onlyIssues, search]);

  const summary = useMemo(() => {
    const dc = rows.filter((r) => inRange(r.dispatch_date, from, to));
    const sp = rows.filter((r) => inRange(r.sp_date, from, to) && r.sp_status === "issued");
    const out = rows.filter((r) => inRange(r.out_date, from, to));
    const sum = (xs: ReconRow[], f: (r: ReconRow) => number | null) => xs.reduce((s, r) => s + Number(f(r) ?? 0), 0);
    return {
      dc: { n: dc.length, dz: sum(dc, (r) => r.dc_quantity), ctn: sum(dc, (r) => r.dc_packages) },
      sp: { n: new Set(sp.map((r) => r.store_pass_id)).size, dz: sum(sp, (r) => r.sp_quantity), ctn: sum(sp, (r) => r.sp_packages) },
      out: { n: new Set(out.map((r) => r.gate_pass_id)).size, dz: sum(out, (r) => gateFigure(r)?.unit === "dz" ? gateFigure(r)!.value : r.gp_quantity), ctn: sum(out, (r) => gateFigure(r)?.unit === "ctn" ? gateFigure(r)!.value : r.gp_packages) },
      openHigh: sum(rows, (r) => r.open_high),
      openMedium: sum(rows, (r) => r.open_medium),
      explained: rows.reduce((s, r) => s + r.explained.length, 0),
      inside: rows.filter((r) => r.codes.includes("SP_NOT_OUT") && !r.explained.some((e) => e.code === "SP_NOT_OUT")),
    };
  }, [rows, from, to]);

  const label = single ? format(new Date(from), "EEE dd MMM yyyy") : `${format(new Date(from), "dd MMM")} – ${format(new Date(to), "dd MMM yyyy")}`;

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filtered.map((r) => {
      const g = gateFigure(r);
      return {
        Dispatch: r.dispatch_number, "DC date": r.dispatch_date, Customer: r.customer_name ?? "", Orders: r.order_numbers ?? "",
        "DC dz": Number(r.dc_quantity), "DC ctn": Number(r.dc_packages),
        "Store pass": r.sp_number ?? "", "SP status": r.sp_status ?? "", "SP issued": r.sp_issued_at ? format(new Date(r.sp_issued_at), "yyyy-MM-dd HH:mm") : "",
        "SP dz": r.sp_quantity ?? "", "SP ctn": r.sp_packages ?? "",
        "Gate pass": r.gp_number ?? "", "GP status": r.gp_status ?? "", "Gate out": r.gate_out_at ? format(new Date(r.gate_out_at), "yyyy-MM-dd HH:mm") : "",
        "Gate figure": g ? `${fmtQty(g.value)} ${g.unit}${g.counted ? "" : " (printed)"}` : "",
        Discrepancies: r.codes.map((c) => discrepancyMeta(c).label).join("; "),
        "Open high": r.open_high, "Open medium": r.open_medium,
        Explained: r.explained.map((e) => `${discrepancyMeta(e.code).label}: ${e.note} (${e.by ?? ""})`).join(" | "),
      };
    })), "By dispatch");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(products.map((p) => ({
      SKU: p.product_code ?? "", Product: p.product_name ?? "",
      "DC dz": Number(p.dc_quantity), "DC ctn": Number(p.dc_packages),
      "Store dz": Number(p.sp_quantity), "Store ctn": Number(p.sp_packages),
      "Gate dz": Number(p.gp_quantity), "Gate ctn": Number(p.gp_packages),
      "Gate counted ctn": p.gp_counted_packages ?? "", "Gate counted dz": p.gp_counted_quantity ?? "",
      "Store − gate dz": Number(p.sp_quantity) - Number(p.gp_quantity), "Store − gate ctn": Number(p.sp_packages) - Number(p.gp_packages),
    }))), "By product");
    XLSX.writeFile(wb, `Store-Gate-Reconciliation-${from}${single ? "" : `_to_${to}`}.xlsx`);
  };

  const print = () => {
    const body = `
    <style>
      .rc table { width: 100%; border-collapse: collapse; margin-top: 10px; }
      .rc th, .rc td { border: 1px solid #bbb; padding: 4px 6px; font-size: 10.5px; text-align: left; vertical-align: top; }
      .rc th { background: #f1f3f7; } .rc .right { text-align: right; }
      .rc .cards { display: flex; gap: 12px; margin-top: 8px; } .rc .cards div { flex: 1; border: 1px solid #bbb; padding: 6px 8px; font-size: 11px; }
    </style>
    <div class="wrap rc">
      <div class="head"><div><h1>Cansport Global Industries</h1><div class="bold" style="margin-top:6px; letter-spacing:.06em">STORE ↔ GATE RECONCILIATION · ${esc(label)}</div></div>
      <div class="xs muted" style="text-align:right">Printed ${esc(format(new Date(), "dd MMM yyyy, HH:mm"))}</div></div>
      <div class="cards">
        <div><b>Dispatches</b> ${summary.dc.n} · ${esc(fmtQty(summary.dc.dz))} dz · ${summary.dc.ctn} ctn</div>
        <div><b>Store passes issued</b> ${summary.sp.n} · ${esc(fmtQty(summary.sp.dz))} dz · ${summary.sp.ctn} ctn</div>
        <div><b>Gate outs</b> ${summary.out.n} · ${esc(fmtQty(summary.out.dz))} dz · ${summary.out.ctn} ctn</div>
        <div><b>Open discrepancies</b> ${summary.openHigh} high · ${summary.openMedium} medium · ${summary.explained} explained</div>
      </div>
      <table><thead><tr><th>Dispatch</th><th>Customer</th><th class="right">DC dz / ctn</th><th>Store pass</th><th>Gate pass</th><th>Out</th><th>Discrepancies</th></tr></thead>
      <tbody>${filtered.map((r) => {
        const g = gateFigure(r);
        return `<tr><td><b>${esc(r.dispatch_number)}</b></td><td>${esc(r.customer_name ?? "")}</td><td class="right">${esc(fmtQty(r.dc_quantity))} / ${Number(r.dc_packages)}</td>
          <td>${r.sp_number ? `${esc(r.sp_number)} · ${esc(fmtQty(r.sp_quantity))} / ${Number(r.sp_packages ?? 0)} · ${esc(fmtT(r.sp_issued_at))}` : "none"}</td>
          <td>${r.gp_number ? `${esc(r.gp_number)}${g ? ` · ${esc(fmtQty(g.value))} ${g.unit}` : ""}` : "—"}</td><td>${esc(fmtT(r.gate_out_at))}</td>
          <td>${r.codes.map((c) => esc(discrepancyMeta(c).label) + (r.explained.some((e) => e.code === c) ? " (explained)" : "")).join("; ") || "Matches"}</td></tr>`;
      }).join("")}</tbody></table>
      <table><thead><tr><th>SKU</th><th class="right">DC dz / ctn</th><th class="right">Store dz / ctn</th><th class="right">Gate dz / ctn</th><th class="right">Store − gate</th></tr></thead>
      <tbody>${products.map((p) => `<tr><td>${esc(p.product_code ?? "")} · ${esc(p.product_name ?? "")}</td><td class="right">${esc(fmtQty(p.dc_quantity))} / ${Number(p.dc_packages)}</td><td class="right">${esc(fmtQty(p.sp_quantity))} / ${Number(p.sp_packages)}</td><td class="right">${esc(fmtQty(p.gp_quantity))} / ${Number(p.gp_packages)}</td><td class="right">${esc(fmtQty(Number(p.sp_quantity) - Number(p.gp_quantity)))} / ${Number(p.sp_packages) - Number(p.gp_packages)}</td></tr>`).join("")}</tbody></table>
    </div>`;
    printDocument(`Reconciliation ${label}`, body);
  };

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title="Daily Reconciliation · Store ↔ Gate"
          description="What the office dispatched, what the store issued and what left the gate, lined up per dispatch for one day (Pakistan time). Domestic sales only."
          icon={Scale}
        >
          <Button variant="outline" onClick={exportExcel} disabled={rows.length === 0}><FileSpreadsheet className="h-4 w-4 mr-1" /> Export</Button>
          <Button variant="outline" onClick={print} disabled={rows.length === 0}><Printer className="h-4 w-4 mr-1" /> Print</Button>
        </PageHeader>

        <Card>
          <CardContent className="p-3 md:p-4 flex flex-wrap items-end gap-3">
            <div className="flex items-end gap-1">
              <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></Button>
              <div>
                <Label className="text-xs">{single ? "Day" : "From"}</Label>
                <Input type="date" className="w-40" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} />
              </div>
              <div>
                <Label className="text-xs">To</Label>
                <Input type="date" className="w-40" value={to} onChange={(e) => { setTo(e.target.value); if (e.target.value < from) setFrom(e.target.value); }} />
              </div>
              <Button variant="outline" size="icon" aria-label="Next day" onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></Button>
              <Button variant="ghost" onClick={() => { setFrom(today); setTo(today); }}>Today</Button>
            </div>
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs" htmlFor="rc-search">Search</Label>
              <Input id="rc-search" placeholder="DC, SP, GP, customer…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm h-10 cursor-pointer">
              <Checkbox checked={onlyIssues} onCheckedChange={(v) => setOnlyIssues(v === true)} /> Only rows with discrepancies
            </label>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {[
            { label: `Dispatches dated ${single ? "today" : "in range"}`, value: summary.dc.n, sub: `${fmtQty(summary.dc.dz)} dz · ${summary.dc.ctn} ctn`, tone: "" },
            { label: "Store passes issued", value: summary.sp.n, sub: `${fmtQty(summary.sp.dz)} dz · ${summary.sp.ctn} ctn`, tone: "" },
            { label: "Gate outs (sales passes)", value: summary.out.n, sub: `${fmtQty(summary.out.dz)} dz · ${summary.out.ctn} ctn`, tone: "" },
            { label: "Open discrepancies", value: summary.openHigh + summary.openMedium, sub: `${summary.openHigh} high · ${summary.openMedium} medium · ${summary.explained} explained`, tone: summary.openHigh ? "border-red-200 bg-red-50 text-red-800" : "" },
          ].map((k) => (
            <Card key={k.label} className={cn(k.tone)}>
              <CardContent className="p-4">
                <div className="text-xs opacity-80">{k.label}</div>
                <div className="text-2xl font-display font-bold mt-1 tabular-nums">{k.value}</div>
                <div className="text-xs opacity-80 mt-0.5">{k.sub}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {summary.inside.length > 0 && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900">
            <b>{fmtQty(summary.inside.reduce((s, r) => s + Number(r.sp_quantity ?? 0), 0))} dz · {summary.inside.reduce((s, r) => s + Number(r.sp_packages ?? 0), 0)} ctn</b> issued by the store are still inside the factory
            ({summary.inside.map((r) => r.dispatch_number).join(", ")}).{to === today ? " They may still go out today." : ""}
          </div>
        )}

        <Tabs defaultValue="dispatch">
          <TabsList>
            <TabsTrigger value="dispatch">By dispatch</TabsTrigger>
            <TabsTrigger value="product">By product</TabsTrigger>
          </TabsList>

          <TabsContent value="dispatch">
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <Table className="min-w-[1180px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dispatch</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-right">DC<br /><span className="text-[10px] font-normal">dz / ctn</span></TableHead>
                      <TableHead>Store pass<br /><span className="text-[10px] font-normal">issued dz / ctn</span></TableHead>
                      <TableHead>Gate pass<br /><span className="text-[10px] font-normal">counted</span></TableHead>
                      <TableHead>Out</TableHead>
                      <TableHead>Discrepancy</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                    ) : filtered.length === 0 ? (
                      <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        {rows.length === 0 ? "No domestic dispatch, store pass or gate out on this day." : "Everything matches."}
                      </TableCell></TableRow>
                    ) : filtered.map((r) => {
                      const g = gateFigure(r);
                      const openCodes = r.codes.filter((c) => !r.explained.some((e) => e.code === c));
                      return (
                        <TableRow key={r.dispatch_id} className={cn(r.open_high > 0 && "bg-red-50/40")}>
                          <TableCell>
                            <div className="font-mono text-sm font-semibold">{r.dispatch_number}</div>
                            <div className="text-xs text-muted-foreground whitespace-nowrap">{format(new Date(r.dispatch_date), "dd MMM")}{r.order_numbers ? ` · ${r.order_numbers}` : ""}</div>
                          </TableCell>
                          <TableCell className="text-sm max-w-[180px] truncate" title={r.customer_name ?? ""}>{r.customer_name ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm whitespace-nowrap">
                            {fmtQty(r.dc_quantity)} / {Number(r.dc_packages)}
                            {r.codes.includes("DC_CHANGED") && r.sp_dispatch_quantity !== null && (
                              <div className="text-[11px] text-amber-700">was {fmtQty(r.sp_dispatch_quantity)} / {Number(r.sp_dispatch_packages ?? 0)}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {r.store_pass_id && r.sp_status === "issued" ? (
                              <div>
                                <Link to={`/store-pass/passes/${r.store_pass_id}`} className="font-mono text-primary hover:underline">{r.sp_number}</Link>
                                <div className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{fmtQty(r.sp_quantity)} / {Number(r.sp_packages ?? 0)} · {fmtT(r.sp_issued_at)}</div>
                              </div>
                            ) : r.store_pass_id ? (
                              <div><Link to={`/store-pass/passes/${r.store_pass_id}`} className="font-mono text-primary hover:underline">{r.sp_number}</Link><div className="text-xs text-muted-foreground">draft</div></div>
                            ) : r.cancelled_sp_number ? (
                              <span className="text-xs text-red-700">{r.cancelled_sp_number} cancelled</span>
                            ) : (
                              <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset", r.gate_out_at ? SEVERITY_TONE.high : SEVERITY_TONE.info)}>None</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {r.gate_pass_id ? (
                              <div>
                                <Link to={`/gate-pass/passes/${r.gate_pass_id}`} className="font-mono text-primary hover:underline">{r.gp_number}</Link>
                                <div className="text-xs text-muted-foreground whitespace-nowrap">
                                  {r.gp_status === "held" ? <span className="text-amber-700 font-semibold">Held</span> : gpStatusMeta(r.gp_status ?? "").label}
                                  {g ? ` · ${fmtQty(g.value)} ${g.unit}${g.counted ? "" : " (printed)"}` : ""}
                                </div>
                              </div>
                            ) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{r.gate_out_at ? (inRange(r.out_date, from, to) ? fmtT(r.gate_out_at) : fmtDT(r.gate_out_at)) : "—"}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {r.codes.length === 0 && <Badge variant="success">Matches</Badge>}
                              {r.codes.map((c) => {
                                const m = discrepancyMeta(c);
                                const ex = r.explained.find((e) => e.code === c);
                                const soft = c === "SP_NOT_OUT" && to === today;
                                return (
                                  <span key={c} title={m.help} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset whitespace-nowrap",
                                    ex ? "bg-emerald-50 text-emerald-800 ring-emerald-200 line-through decoration-emerald-400" : soft ? SEVERITY_TONE.medium : SEVERITY_TONE[m.severity])}>
                                    {soft && !ex ? "Issued, not out yet" : m.label}
                                  </span>
                                );
                              })}
                            </div>
                            {r.explained.map((e) => (
                              <div key={e.code} className="text-xs text-emerald-800 mt-1">
                                <b>Explained</b> · {e.by ?? "—"} {format(new Date(e.at), "dd MMM HH:mm")}: {e.note}
                                {canResolve && (
                                  <button type="button" className="ml-1 underline text-muted-foreground" disabled={call.isPending}
                                    onClick={() => call.mutate({ fn: "store_pass_recon_reopen", args: { p_dispatch_id: r.dispatch_id, p_code: e.code }, done: "Reopened" })}>reopen</button>
                                )}
                              </div>
                            ))}
                            {r.cancelled_sp_reason && <div className="text-xs text-muted-foreground mt-1">Cancelled: {r.cancelled_sp_reason}</div>}
                          </TableCell>
                          <TableCell className="text-right">
                            {canResolve && openCodes.length > 0 && (
                              <Button size="sm" variant="outline" onClick={() => { setDialog({ row: r, code: openCodes[0] }); setNote(""); }}>Explain</Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  {filtered.length > 0 && (
                    <tfoot>
                      <TableRow className="font-semibold bg-muted/40">
                        <TableCell colSpan={2}>Totals (rows shown)</TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap">{fmtQty(filtered.reduce((s, r) => s + Number(r.dc_quantity), 0))} / {filtered.reduce((s, r) => s + Number(r.dc_packages), 0)}</TableCell>
                        <TableCell className="tabular-nums whitespace-nowrap">{fmtQty(filtered.reduce((s, r) => s + Number(r.sp_status === "issued" ? r.sp_quantity ?? 0 : 0), 0))} / {filtered.reduce((s, r) => s + Number(r.sp_status === "issued" ? r.sp_packages ?? 0 : 0), 0)}</TableCell>
                        <TableCell className="tabular-nums whitespace-nowrap">
                          {fmtQty(filtered.reduce((s, r) => s + Number(gateFigure(r)?.unit === "dz" ? gateFigure(r)!.value : r.gp_quantity ?? 0), 0))} dz · {filtered.reduce((s, r) => s + Number(gateFigure(r)?.unit === "ctn" ? gateFigure(r)!.value : r.gp_packages ?? 0), 0)} ctn
                        </TableCell>
                        <TableCell colSpan={3} className="font-normal text-sm text-muted-foreground">
                          {summary.inside.length > 0 ? `Store − gate: ${fmtQty(summary.inside.reduce((s, r) => s + Number(r.sp_quantity ?? 0), 0))} dz · ${summary.inside.reduce((s, r) => s + Number(r.sp_packages ?? 0), 0)} ctn still inside` : ""}
                        </TableCell>
                      </TableRow>
                    </tfoot>
                  )}
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="product">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">By product · {label}</CardTitle>
                <p className="text-sm text-muted-foreground">For checking the FG store: what each SKU should have lost on the day. Gate figures are the guard's count where a count exists, else the printed pass.</p>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table className="min-w-[900px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Dispatched (DC)</TableHead>
                      <TableHead className="text-right">Store issued (SP)</TableHead>
                      <TableHead className="text-right">Gate (GP)</TableHead>
                      <TableHead className="text-right">Store − gate</TableHead>
                      <TableHead className="text-right">DC − store</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nothing on this day.</TableCell></TableRow>
                    ) : products.map((p) => {
                      const gDz = p.gp_counted_quantity ?? (p.gp_counted_packages !== null ? null : p.gp_quantity);
                      const gCtn = p.gp_counted_packages ?? p.gp_packages;
                      const dDz = Number(p.sp_quantity) - Number(gDz ?? p.gp_quantity);
                      const dCtn = Number(p.sp_packages) - Number(gCtn);
                      return (
                        <TableRow key={p.product_id ?? "none"}>
                          <TableCell className="font-medium">{p.product_code ?? "—"} <span className="text-muted-foreground">· {p.product_name ?? ""}</span></TableCell>
                          <TableCell className="text-right tabular-nums whitespace-nowrap">{fmtQty(p.dc_quantity)} dz / {Number(p.dc_packages)} ctn</TableCell>
                          <TableCell className="text-right tabular-nums whitespace-nowrap">{fmtQty(p.sp_quantity)} dz / {Number(p.sp_packages)} ctn</TableCell>
                          <TableCell className="text-right tabular-nums whitespace-nowrap">{fmtQty(gDz ?? p.gp_quantity)} dz / {Number(gCtn)} ctn</TableCell>
                          <TableCell className={cn("text-right tabular-nums whitespace-nowrap font-semibold", dDz !== 0 || dCtn !== 0 ? "text-red-700" : "text-emerald-700")}>{fmtQty(dDz)} dz / {dCtn} ctn</TableCell>
                          <TableCell className={cn("text-right tabular-nums whitespace-nowrap", Number(p.dc_quantity) !== Number(p.sp_quantity) ? "text-amber-700 font-semibold" : "text-muted-foreground")}>{fmtQty(Number(p.dc_quantity) - Number(p.sp_quantity))} dz / {Number(p.dc_packages) - Number(p.sp_packages)} ctn</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {isSuper && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Settings2 className="h-4 w-4" /> Gate setting (super admin)</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap items-end gap-3">
              <div>
                <Label className="text-xs">When a sales gate pass has a dispatch with no store pass</Label>
                <Select value={gateMode ?? settings?.required_at_gate ?? "warn"} onValueChange={setGateMode}>
                  <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="off">Off — nothing shown at the gate</SelectItem>
                    <SelectItem value="warn">Warn — vehicle may go, store managers told</SelectItem>
                    <SelectItem value="block">Block — vehicle cannot leave</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button disabled={call.isPending || !gateMode || gateMode === settings?.required_at_gate}
                onClick={() => call.mutate({ fn: "store_pass_settings_save", args: { p_required_at_gate: gateMode }, done: "Setting saved" })}>
                Save
              </Button>
              <p className="text-xs text-muted-foreground basis-full">Current: <b>{settings?.required_at_gate ?? "warn"}</b>. Start with warn; switch to block once the store is issuing passes for every vehicle.</p>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={dialog !== null} onOpenChange={(o) => { if (!o) { setDialog(null); setNote(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Explain · {dialog?.row.dispatch_number}</DialogTitle>
            <DialogDescription>The discrepancy stays in the record with your note and your name, and no longer counts as open.</DialogDescription>
          </DialogHeader>
          {dialog && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Which discrepancy</Label>
                <Select value={dialog.code} onValueChange={(c) => setDialog({ ...dialog, code: c })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {dialog.row.codes.filter((c) => !dialog.row.explained.some((e) => e.code === c)).map((c) => (
                      <SelectItem key={c} value={c}>{discrepancyMeta(c).label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">{discrepancyMeta(dialog.code).help}</p>
              </div>
              <div>
                <Label htmlFor="rc-note">What explains it *</Label>
                <Textarea id="rc-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 1 carton damaged and re-packed; DC corrected to 145 dz" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Back</Button>
            <Button disabled={call.isPending || !note.trim()} onClick={() => dialog && call.mutate({ fn: "store_pass_recon_resolve", args: { p_dispatch_id: dialog.row.dispatch_id, p_code: dialog.code, p_note: note }, done: "Marked explained" })}>
              Mark explained
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
