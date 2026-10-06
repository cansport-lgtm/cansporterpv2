import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { endOfMonth, format, startOfMonth, subDays } from "date-fns";
import { QRCodeSVG } from "qrcode.react";
import { Banknote, Download, Printer, Wallet } from "lucide-react";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { PhotoInput } from "@/components/gate-pass/PhotoInput";
import { errorMessage, gpDb, photoUrl, todayPk } from "@/lib/gatePass";
import {
  FREIGHT_EVENT_LABEL, MODES, STATEMENT_SELECT, VOUCHER_SELECT, fmtRs, modeLabel, printFreightStatement,
  printFreightVoucher, voucherStatusMeta,
  type FreightLogRow, type FreightStatement, type FreightVoucher,
} from "@/lib/gatePassFreight";

type Tab = "unpaid" | "paid" | "all";
type EventRow = { id: string; event: string; message: string | null; created_at: string; actor: { full_name: string | null } | null };

const fmtDate = (s: string | null | undefined) => (s ? format(new Date(s), "dd MMM yyyy") : "—");
const fmtDT = (s: string | null | undefined) => (s ? format(new Date(s), "dd MMM yyyy, HH:mm") : "—");
const sum = (rows: { amount: number }[]) => rows.reduce((s, r) => s + Number(r.amount), 0);

export default function FreightVouchersPage() {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { roles, hasModulePermission } = useAuth();
  const inGatePass = location.pathname.startsWith("/gate-pass");
  const canPay = roles.some((r) => ["super_admin", "gate_pass_manager", "pettycash_handler", "accounting_poster", "accounting_officer", "accounting_manager"].includes(r.role));
  const canManage = hasModulePermission("gate_pass", "approve");
  const today = todayPk();
  const monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(new Date()), "yyyy-MM-dd");

  const [tab, setTab] = useState<Tab>("unpaid");
  const [fromDate, setFromDate] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(today);
  const [search, setSearch] = useState("");
  const [transporterFilter, setTransporterFilter] = useState("all");
  const [modeFilter, setModeFilter] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [payOne, setPayOne] = useState<FreightVoucher | null>(null);
  const [paySelectedOpen, setPaySelectedOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<FreightVoucher | null>(null);
  const [detail, setDetail] = useState<FreightVoucher | null>(null);
  const [statement, setStatement] = useState<FreightStatement | null>(null);
  const [pay, setPay] = useState({ date: today, amount: "", photo: "", remark: "" });
  const [reason, setReason] = useState("");
  const qrRef = useRef<HTMLDivElement>(null);
  const [qrFor, setQrFor] = useState<FreightVoucher | null>(null);

  // Every unpaid voucher, whatever its date, plus paid / cancelled ones in the date range.
  const { data: unpaid = [], isLoading } = useQuery<FreightVoucher[]>({
    queryKey: ["gate-pass-freight-vouchers", "unpaid"],
    queryFn: async () => {
      const { data, error } = await gpDb.from("gate_pass_freight_vouchers").select(VOUCHER_SELECT)
        .eq("status", "unpaid").order("voucher_date").order("voucher_number");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: settled = [] } = useQuery<FreightVoucher[]>({
    queryKey: ["gate-pass-freight-vouchers", "settled", fromDate, toDate],
    enabled: tab !== "unpaid",
    queryFn: async () => {
      const { data, error } = await gpDb.from("gate_pass_freight_vouchers").select(VOUCHER_SELECT)
        .neq("status", "unpaid").gte("voucher_date", fromDate).lte("voucher_date", toDate)
        .order("voucher_date", { ascending: false }).order("voucher_number", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: monthRows = [] } = useQuery<FreightLogRow[]>({
    queryKey: ["gate-pass-freight-log", "month", monthStart],
    queryFn: async () => {
      const { data, error } = await gpDb.from("v_gate_pass_freight_log").select("*")
        .gte("out_date", monthStart).lte("out_date", monthEnd);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: paidToday = [] } = useQuery<{ paid_amount: number | null; amount: number }[]>({
    queryKey: ["gate-pass-freight-vouchers", "paid-today", today],
    queryFn: async () => {
      const { data, error } = await gpDb.from("gate_pass_freight_vouchers").select("paid_amount, amount")
        .eq("status", "paid").eq("paid_date", today);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: reminderDays = 3 } = useQuery<number>({
    queryKey: ["gate-pass-settings", "freight_reminder_days"],
    queryFn: async () => {
      const { data } = await gpDb.from("gate_pass_settings").select("freight_reminder_days").maybeSingle();
      return data?.freight_reminder_days ?? 3;
    },
  });
  const { data: events = [] } = useQuery<EventRow[]>({
    queryKey: ["gate-pass-freight-voucher-events", detail?.id],
    enabled: Boolean(detail),
    queryFn: async () => {
      const { data, error } = await gpDb.from("gate_pass_freight_voucher_events")
        .select("id, event, message, created_at, actor:app_users!gate_pass_freight_voucher_events_created_by_fkey(full_name)")
        .eq("voucher_id", detail!.id).order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: statementVouchers = [] } = useQuery<FreightVoucher[]>({
    queryKey: ["gate-pass-freight-vouchers", "statement", statement?.id],
    enabled: Boolean(statement),
    queryFn: async () => {
      const { data, error } = await gpDb.from("gate_pass_freight_vouchers").select(VOUCHER_SELECT).eq("statement_id", statement!.id);
      if (error) throw error;
      return data ?? [];
    },
  });
  useEffect(() => {
    if (statement && statementVouchers.length === statement.voucher_count) {
      printFreightStatement(statement, statementVouchers);
      setStatement(null);
    }
  }, [statement, statementVouchers]);

  // ?voucher=<id> from a notification opens that voucher.
  const wanted = params.get("voucher");
  useEffect(() => {
    if (!wanted) return;
    const v = [...unpaid, ...settled].find((x) => x.id === wanted);
    if (v) {
      setDetail(v);
      setParams((p) => { p.delete("voucher"); return p; }, { replace: true });
    } else if (!isLoading && unpaid.length >= 0 && tab === "unpaid") {
      setTab("all");
    }
  }, [wanted, unpaid, settled, isLoading, tab, setParams]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["gate-pass-freight-vouchers"] });
    queryClient.invalidateQueries({ queryKey: ["gate-pass-freight-log"] });
    queryClient.invalidateQueries({ queryKey: ["gate-pass-freight-voucher-events"] });
    queryClient.invalidateQueries({ queryKey: ["gate-pass-freight-by-pass"] });
  };

  const run = useMutation({
    mutationFn: async ({ fn, args }: { fn: string; args: Record<string, unknown>; done: string }) => {
      const { data, error } = await gpDb.rpc(fn, args);
      if (error) throw error;
      return data;
    },
    onSuccess: (data, v) => {
      toast({ title: v.done });
      setPayOne(null); setPaySelectedOpen(false); setCancelTarget(null); setDetail(null);
      setPay({ date: today, amount: "", photo: "", remark: "" }); setReason("");
      refresh();
      if (v.fn === "gate_pass_freight_pay_selected" && data?.id) {
        setSelected([]);
        gpDb.from("gate_pass_freight_statements").select(STATEMENT_SELECT).eq("id", data.id).maybeSingle()
          .then(({ data: st }: { data: FreightStatement | null }) => { if (st) setStatement(st); });
      }
    },
    onError: (e) => toast({ title: "Could not complete", description: errorMessage(e), variant: "destructive" }),
  });

  const rows = useMemo(() => {
    const base = tab === "unpaid" ? unpaid : tab === "paid" ? settled.filter((v) => v.status === "paid") : [...unpaid, ...settled];
    const q = search.trim().toLowerCase();
    return base.filter((v) =>
      (transporterFilter === "all" || v.transporter_name === transporterFilter) &&
      (modeFilter === "all" || v.mode === modeFilter) &&
      (!q || [v.voucher_number, v.gate_passes?.pass_number, v.dispatch_numbers, v.vehicle_number, v.driver_name, v.transporter_name, v.customer_names, v.booking_ref]
        .some((x) => (x ?? "").toLowerCase().includes(q))));
  }, [tab, unpaid, settled, search, transporterFilter, modeFilter]);

  const transporterNames = useMemo(() => [...new Set([...unpaid, ...settled].map((v) => v.transporter_name))].sort(), [unpaid, settled]);
  const selectedRows = unpaid.filter((v) => selected.includes(v.id));
  const selectedTransporters = new Set(selectedRows.map((v) => v.transporter_id ?? v.transporter_name.toLowerCase()));
  const overdue = unpaid.filter((v) => v.voucher_date < format(subDays(new Date(), reminderDays), "yyyy-MM-dd"));
  const owedByTransporter = useMemo(() => {
    const m = new Map<string, number>();
    unpaid.forEach((v) => m.set(v.transporter_name, (m.get(v.transporter_name) ?? 0) + Number(v.amount)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [unpaid]);
  const monthCompany = monthRows.filter((r) => r.payer === "company" && r.voucher_status && r.voucher_status !== "cancelled");
  const monthByMode = useMemo(() => {
    const m = new Map<string, { n: number; rs: number }>();
    monthCompany.forEach((r) => { const c = m.get(r.mode ?? "") ?? { n: 0, rs: 0 }; c.n++; c.rs += Number(r.amount); m.set(r.mode ?? "", c); });
    return [...m.entries()].sort((a, b) => b[1].rs - a[1].rs);
  }, [monthCompany]);
  const monthByTransporter = useMemo(() => {
    const m = new Map<string, { n: number; rs: number }>();
    monthCompany.forEach((r) => { const k = r.transporter_name ?? ""; const c = m.get(k) ?? { n: 0, rs: 0 }; c.n++; c.rs += Number(r.amount); m.set(k, c); });
    return [...m.entries()].sort((a, b) => b[1].rs - a[1].rs).slice(0, 8);
  }, [monthCompany]);
  const customerPaid = monthRows.filter((r) => r.payer !== "company" && r.gate_out_at).length;

  const kpis = [
    { label: "Unpaid now", value: `${unpaid.length} · ${fmtRs(sum(unpaid))}`, tone: unpaid.length ? "text-amber-700" : "" },
    { label: `Unpaid over ${reminderDays} days`, value: `${overdue.length} · ${fmtRs(sum(overdue))}`, tone: overdue.length ? "text-red-700" : "" },
    { label: "Paid today", value: fmtRs(paidToday.reduce((s, r) => s + Number(r.paid_amount ?? r.amount), 0)), tone: "text-emerald-700" },
    { label: "This month (company pays)", value: `${monthCompany.length} · ${fmtRs(sum(monthCompany.map((r) => ({ amount: Number(r.amount) }))))}`, tone: "" },
    { label: "Customer-paid loads this month", value: customerPaid, tone: "text-muted-foreground" },
    { label: "Average per load", value: monthCompany.length ? fmtRs(sum(monthCompany.map((r) => ({ amount: Number(r.amount) }))) / monthCompany.length) : "—", tone: "" },
  ];

  const print = (v: FreightVoucher) => {
    setQrFor(v);
    // The QR renders on the next frame; print once it is in the DOM.
    setTimeout(() => printFreightVoucher(v, qrRef.current?.querySelector("svg")?.outerHTML ?? ""), 50);
  };

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(rows.map((v) => ({
      Voucher: v.voucher_number, Date: v.voucher_date, "Gate pass": v.gate_passes?.pass_number ?? "", Dispatches: v.dispatch_numbers ?? "",
      Customers: v.customer_names ?? "", Vehicle: v.vehicle_number ?? "", Mode: modeLabel(v.mode), Transporter: v.transporter_name,
      Driver: [v.driver_name, v.driver_contact].filter(Boolean).join(" "), "Ride ref": v.booking_ref ?? "",
      Amount: Number(v.amount), Status: voucherStatusMeta(v.status).label, "Paid date": v.paid_date ?? "",
      "Paid amount": v.paid_amount ?? "", "Paid by": v.payer_user?.full_name ?? "", Statement: v.gate_pass_freight_statements?.statement_number ?? "",
      Remark: v.paid_remark ?? v.cancel_reason ?? "",
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Freight vouchers");
    XLSX.writeFile(wb, `Freight-Vouchers-${tab}-${today}.xlsx`);
  };

  const passLink = (v: FreightVoucher) =>
    inGatePass
      ? <Link to={`/gate-pass/passes/${v.gate_pass_id}`} className="font-mono text-primary hover:underline">{v.gate_passes?.pass_number}</Link>
      : <span className="font-mono">{v.gate_passes?.pass_number}</span>;

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader title="Freight Vouchers" description="Cash owed to drivers and contractors for dispatches that left the gate. Reconciled by hand with the cash book." icon={Wallet}>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportExcel} disabled={rows.length === 0}><Download className="h-4 w-4 mr-1" /> Excel</Button>
            {inGatePass && canManage && <Button variant="outline" asChild><Link to="/gate-pass/transporters">Transporters</Link></Button>}
          </div>
        </PageHeader>

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {kpis.map((k) => (
            <Card key={k.label}><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{k.label}</div>
              <div className={cn("text-lg font-display font-bold mt-1 tabular-nums", k.tone)}>{k.value}</div>
            </CardContent></Card>
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Owed per transporter (unpaid)</CardTitle></CardHeader>
            <CardContent className="space-y-1.5">
              {owedByTransporter.length === 0 && <p className="text-sm text-muted-foreground">Nothing owed.</p>}
              {owedByTransporter.map(([name, rs]) => (
                <button key={name} type="button" className="flex w-full justify-between text-sm hover:underline"
                  onClick={() => { setTab("unpaid"); setTransporterFilter(name); }}>
                  <span>{name}</span><span className="font-semibold tabular-nums">{fmtRs(rs)}</span>
                </button>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">This month by transporter</CardTitle></CardHeader>
            <CardContent className="space-y-1.5">
              {monthByTransporter.length === 0 && <p className="text-sm text-muted-foreground">No company-paid loads yet this month.</p>}
              {monthByTransporter.map(([name, c]) => (
                <div key={name} className="flex justify-between text-sm"><span>{name} <span className="text-muted-foreground">· {c.n} trip{c.n === 1 ? "" : "s"}</span></span><span className="font-semibold tabular-nums">{fmtRs(c.rs)}</span></div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">This month by mode</CardTitle></CardHeader>
            <CardContent className="space-y-1.5">
              {monthByMode.length === 0 && <p className="text-sm text-muted-foreground">No company-paid loads yet this month.</p>}
              {monthByMode.map(([mode, c]) => (
                <div key={mode} className="flex justify-between text-sm"><span>{modeLabel(mode)} <span className="text-muted-foreground">· {c.n}</span></span><span className="font-semibold tabular-nums">{fmtRs(c.rs)}</span></div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <Tabs value={tab} onValueChange={(v) => { setTab(v as Tab); setSelected([]); }}>
                <TabsList>
                  <TabsTrigger value="unpaid">Unpaid ({unpaid.length})</TabsTrigger>
                  <TabsTrigger value="paid">Paid</TabsTrigger>
                  <TabsTrigger value="all">All</TabsTrigger>
                </TabsList>
              </Tabs>
              {tab !== "unpaid" && (
                <>
                  <div><Label htmlFor="fv-from" className="text-xs">From</Label><Input id="fv-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
                  <div><Label htmlFor="fv-to" className="text-xs">To</Label><Input id="fv-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
                </>
              )}
              <div className="min-w-[180px]">
                <Label className="text-xs">Transporter</Label>
                <Select value={transporterFilter} onValueChange={setTransporterFilter}>
                  <SelectTrigger aria-label="Transporter"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All transporters</SelectItem>
                    {transporterNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-[150px]">
                <Label className="text-xs">Mode</Label>
                <Select value={modeFilter} onValueChange={setModeFilter}>
                  <SelectTrigger aria-label="Mode"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All modes</SelectItem>
                    {MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 min-w-[200px]">
                <Label htmlFor="fv-search" className="text-xs">Search</Label>
                <Input id="fv-search" placeholder="FV, GP, DC, vehicle, driver, ride ref…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              {tab === "unpaid" && canPay && selected.length > 0 && (
                <Button disabled={selectedTransporters.size !== 1} onClick={() => setPaySelectedOpen(true)}>
                  <Banknote className="h-4 w-4 mr-1" /> Pay selected ({selected.length}) · {fmtRs(sum(selectedRows))}
                </Button>
              )}
            </div>
            {tab === "unpaid" && selected.length > 0 && selectedTransporters.size > 1 && (
              <p className="text-xs text-red-700">A statement pays one transporter: tick the trips of one transporter only.</p>
            )}

            <div className="overflow-x-auto -mx-4">
              <Table className="min-w-[1100px]">
                <TableHeader>
                  <TableRow>
                    {tab === "unpaid" && canPay && (
                      <TableHead className="w-10">
                        <Checkbox aria-label="Select all" checked={rows.length > 0 && rows.every((v) => selected.includes(v.id))}
                          onCheckedChange={(c) => setSelected(c === true ? rows.map((v) => v.id) : [])} />
                      </TableHead>
                    )}
                    <TableHead>Voucher</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Gate pass</TableHead>
                    <TableHead>Dispatches · customer</TableHead>
                    <TableHead>Vehicle · driver</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Transporter</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                  ) : rows.length === 0 ? (
                    <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">{tab === "unpaid" ? "Nothing to pay." : "No vouchers in this range."}</TableCell></TableRow>
                  ) : rows.map((v) => {
                    const st = voucherStatusMeta(v.status);
                    const old = v.status === "unpaid" && overdue.some((o) => o.id === v.id);
                    return (
                      <TableRow key={v.id} className={cn(old && "bg-red-50/40")}>
                        {tab === "unpaid" && canPay && (
                          <TableCell>
                            <Checkbox aria-label={`Select ${v.voucher_number}`} checked={selected.includes(v.id)}
                              onCheckedChange={(c) => setSelected((s) => (c === true ? [...s, v.id] : s.filter((x) => x !== v.id)))} />
                          </TableCell>
                        )}
                        <TableCell>
                          <button type="button" className="font-mono font-semibold text-primary hover:underline" onClick={() => setDetail(v)}>{v.voucher_number}</button>
                        </TableCell>
                        <TableCell className={cn("text-sm whitespace-nowrap", old && "text-red-700 font-medium")}>{fmtDate(v.voucher_date)}</TableCell>
                        <TableCell>{passLink(v)}</TableCell>
                        <TableCell className="text-sm max-w-[260px]">
                          <div className="font-mono text-xs">{v.dispatch_numbers}</div>
                          <div className="text-muted-foreground truncate">{v.customer_names}</div>
                        </TableCell>
                        <TableCell className="text-sm">
                          <div>{v.vehicle_number ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{[v.driver_name, v.driver_contact].filter(Boolean).join(" · ")}</div>
                        </TableCell>
                        <TableCell className="text-sm">{modeLabel(v.mode)}{v.booking_ref ? <div className="text-xs text-muted-foreground">{v.booking_ref}</div> : null}</TableCell>
                        <TableCell className="text-sm">{v.transporter_name}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold whitespace-nowrap">{fmtRs(v.amount)}</TableCell>
                        <TableCell>
                          <Badge variant={st.variant}>{st.label}</Badge>
                          {v.status === "paid" && <div className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(v.paid_date)}{v.gate_pass_freight_statements?.statement_number ? ` · ${v.gate_pass_freight_statements.statement_number}` : ""}</div>}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <Button size="sm" variant="ghost" onClick={() => print(v)} aria-label={`Print ${v.voucher_number}`}><Printer className="h-4 w-4" /></Button>
                          {canPay && v.status === "unpaid" && (
                            <Button size="sm" onClick={() => { setPay({ date: today, amount: String(v.amount), photo: "", remark: "" }); setPayOne(v); }}>Mark paid</Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {rows.length > 0 && (
              <div className="text-sm text-right text-muted-foreground">{rows.length} voucher{rows.length === 1 ? "" : "s"} · <b className="text-foreground">{fmtRs(sum(rows))}</b></div>
            )}
          </CardContent>
        </Card>

        <div ref={qrRef} className="hidden" aria-hidden="true">
          {qrFor && <QRCodeSVG value={qrFor.voucher_number} size={80} level="M" />}
        </div>
      </div>

      {/* Mark one paid */}
      <Dialog open={Boolean(payOne)} onOpenChange={(o) => { if (!o) setPayOne(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark {payOne?.voucher_number} paid</DialogTitle>
            <DialogDescription>{payOne && `${fmtRs(payOne.amount)} to ${payOne.transporter_name} for ${payOne.gate_passes?.pass_number}. The signed voucher is the cash proof.`}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="pay-date">Paid on</Label><Input id="pay-date" type="date" max={today} value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></div>
            <div><Label htmlFor="pay-amount">Cash paid (Rs)</Label><Input id="pay-amount" type="number" min="0" step="1" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></div>
            <div className="col-span-2"><Label htmlFor="pay-remark">Remark{payOne && Number(pay.amount) !== Number(payOne.amount) ? " * (amount differs)" : ""}</Label><Textarea id="pay-remark" rows={2} value={pay.remark} onChange={(e) => setPay({ ...pay, remark: e.target.value })} /></div>
            <div className="col-span-2"><PhotoInput id="pay-photo" label="Photo of the signed voucher (optional)" folder="freight" value={pay.photo} onChange={(p) => setPay({ ...pay, photo: p })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOne(null)}>Back</Button>
            <Button disabled={run.isPending} onClick={() => payOne && run.mutate({
              fn: "gate_pass_freight_voucher_pay",
              args: { p_id: payOne.id, p_data: { paid_date: pay.date, paid_amount: pay.amount, photo_path: pay.photo, remark: pay.remark } },
              done: `${payOne.voucher_number} marked paid`,
            })}>Mark paid</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pay several trips of one contractor */}
      <Dialog open={paySelectedOpen} onOpenChange={setPaySelectedOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pay {selected.length} trip{selected.length === 1 ? "" : "s"} to {selectedRows[0]?.transporter_name}</DialogTitle>
            <DialogDescription>Total {fmtRs(sum(selectedRows))}. One payment statement is made listing every trip; each voucher is marked paid on it.</DialogDescription>
          </DialogHeader>
          <ul className="max-h-40 overflow-y-auto text-sm space-y-0.5 rounded-md border p-2">
            {selectedRows.map((v) => <li key={v.id} className="flex justify-between"><span className="font-mono">{v.voucher_number} · {fmtDate(v.voucher_date)} · {v.gate_passes?.pass_number}</span><span className="tabular-nums">{fmtRs(v.amount)}</span></li>)}
          </ul>
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="ps-date">Paid on</Label><Input id="ps-date" type="date" max={today} value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></div>
            <div><Label htmlFor="ps-remark">Remark</Label><Input id="ps-remark" value={pay.remark} onChange={(e) => setPay({ ...pay, remark: e.target.value })} /></div>
            <div className="col-span-2"><PhotoInput id="ps-photo" label="Photo of the signed statement (optional)" folder="freight" value={pay.photo} onChange={(p) => setPay({ ...pay, photo: p })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaySelectedOpen(false)}>Back</Button>
            <Button disabled={run.isPending} onClick={() => run.mutate({
              fn: "gate_pass_freight_pay_selected",
              args: { p_ids: selected, p_data: { paid_date: pay.date, photo_path: pay.photo, remark: pay.remark } },
              done: "Paid — printing the statement",
            })}>Pay and print statement</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel */}
      <Dialog open={Boolean(cancelTarget)} onOpenChange={(o) => { if (!o) setCancelTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel {cancelTarget?.voucher_number}</DialogTitle>
            <DialogDescription>{cancelTarget?.status === "paid" ? "This voucher was already paid. Cancelling keeps the payment in the log and marks the voucher cancelled." : "The pass keeps its freight; a manager can make a new voucher from the pass (Change freight)."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1"><Label htmlFor="fv-cancel-reason">Reason *</Label><Textarea id="fv-cancel-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>Back</Button>
            <Button variant="destructive" disabled={run.isPending} onClick={() => cancelTarget && run.mutate({
              fn: "gate_pass_freight_voucher_cancel", args: { p_id: cancelTarget.id, p_reason: reason }, done: `${cancelTarget.voucher_number} cancelled`,
            })}>Cancel voucher</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail */}
      <Dialog open={Boolean(detail)} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <DialogContent className="max-w-2xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">{detail.voucher_number} <Badge variant={voucherStatusMeta(detail.status).variant}>{voucherStatusMeta(detail.status).label}</Badge></DialogTitle>
                <DialogDescription>{fmtDate(detail.voucher_date)} · {detail.gate_passes?.pass_number} · {detail.dispatch_numbers}</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                {[
                  ["Customer(s)", detail.customer_names ?? "—"],
                  ["Vehicle", detail.vehicle_number ?? "—"],
                  ["Driver", [detail.driver_name, detail.driver_contact].filter(Boolean).join(" · ") || "—"],
                  ["Mode", modeLabel(detail.mode)],
                  ["Transporter", detail.transporter_name],
                  ["Ride ref", detail.booking_ref ?? "—"],
                  ["Amount", fmtRs(detail.amount)],
                  ...(detail.note ? [["Note", detail.note]] : []),
                  ...(detail.status === "paid" ? [
                    ["Paid", `${fmtRs(detail.paid_amount ?? detail.amount)} on ${fmtDate(detail.paid_date)}`],
                    ["Paid by", detail.payer_user?.full_name ?? "—"],
                    ...(detail.gate_pass_freight_statements?.statement_number ? [["Statement", detail.gate_pass_freight_statements.statement_number]] : []),
                    ...(detail.paid_remark ? [["Remark", detail.paid_remark]] : []),
                  ] : []),
                  ...(detail.status === "cancelled" ? [["Cancelled", `${fmtDT(detail.cancelled_at)} · ${detail.cancel_reason ?? ""}`]] : []),
                ].map(([k, v]) => (
                  <div key={k} className="contents"><span className="text-muted-foreground">{k}</span><span className="font-medium">{v}</span></div>
                ))}
              </div>
              {detail.paid_photo_path && (
                <a href={photoUrl(detail.paid_photo_path) ?? "#"} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">Signed voucher photo</a>
              )}
              <div>
                <div className="text-sm font-semibold mb-1">History</div>
                <ol className="space-y-1.5 text-sm">
                  {events.map((e) => (
                    <li key={e.id}>
                      <span className="font-medium">{FREIGHT_EVENT_LABEL[e.event] ?? e.event}</span>
                      <span className="text-xs text-muted-foreground"> · {e.actor?.full_name ?? "System"} · {fmtDT(e.created_at)}</span>
                      {e.message && <div className="text-xs">{e.message}</div>}
                    </li>
                  ))}
                </ol>
              </div>
              <DialogFooter className="flex-wrap gap-2">
                {canManage && detail.status !== "cancelled" && (
                  <Button variant="ghost" className="text-destructive mr-auto" onClick={() => { setCancelTarget(detail); setDetail(null); }}>Cancel voucher</Button>
                )}
                <Button variant="outline" onClick={() => print(detail)}><Printer className="h-4 w-4 mr-1" /> Print</Button>
                {canPay && detail.status === "unpaid" && (
                  <Button onClick={() => { setPay({ date: today, amount: String(detail.amount), photo: "", remark: "" }); setPayOne(detail); setDetail(null); }}>Mark paid</Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
