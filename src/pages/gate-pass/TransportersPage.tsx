import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Pencil, Plus, Printer, Truck } from "lucide-react";

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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { errorMessage, gpDb, isSuperAdmin } from "@/lib/gatePass";
import { useTransporters } from "@/components/gate-pass/FreightSection";
import {
  KINDS, MODES, STATEMENT_SELECT, VOUCHER_SELECT, fmtRs, kindLabel, modeLabel, printFreightStatement,
  voucherStatusMeta, type FreightMode, type FreightStatement, type FreightVoucher, type Transporter, type TransporterKind,
} from "@/lib/gatePassFreight";

type Form = { name: string; phone: string; kind: TransporterKind; default_mode: FreightMode; default_rate: string; is_active: boolean; remarks: string };
const emptyForm = (): Form => ({ name: "", phone: "", kind: "contractor", default_mode: "contractor_van", default_rate: "", is_active: true, remarks: "" });
const fmtDate = (s: string | null | undefined) => (s ? format(new Date(s), "dd MMM yyyy") : "—");

export default function TransportersPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { roles, hasModulePermission } = useAuth();
  const canManage = hasModulePermission("gate_pass", "approve");
  const superAdmin = isSuperAdmin(roles);
  const [editing, setEditing] = useState<Transporter | null | "new">(null);
  const [form, setForm] = useState<Form>(emptyForm());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reminder, setReminder] = useState("");

  const { data: transporters = [], isLoading } = useTransporters(false);
  const { data: vouchers = [] } = useQuery<FreightVoucher[]>({
    queryKey: ["gate-pass-freight-vouchers", "transporter", selectedId],
    enabled: Boolean(selectedId),
    queryFn: async () => {
      const { data, error } = await gpDb.from("gate_pass_freight_vouchers").select(VOUCHER_SELECT)
        .eq("transporter_id", selectedId).order("voucher_date", { ascending: false }).limit(300);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: statements = [] } = useQuery<FreightStatement[]>({
    queryKey: ["gate-pass-freight-statements", selectedId],
    enabled: Boolean(selectedId),
    queryFn: async () => {
      const { data, error } = await gpDb.from("gate_pass_freight_statements").select(STATEMENT_SELECT)
        .eq("transporter_id", selectedId).order("paid_date", { ascending: false }).limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: owed = new Map<string, { n: number; rs: number }>() } = useQuery<Map<string, { n: number; rs: number }>>({
    queryKey: ["gate-pass-freight-vouchers", "owed-by-transporter"],
    queryFn: async () => {
      const { data, error } = await gpDb.from("gate_pass_freight_vouchers").select("transporter_id, amount").eq("status", "unpaid");
      if (error) throw error;
      const m = new Map<string, { n: number; rs: number }>();
      (data ?? []).forEach((r: { transporter_id: string | null; amount: number }) => {
        if (!r.transporter_id) return;
        const c = m.get(r.transporter_id) ?? { n: 0, rs: 0 };
        c.n++; c.rs += Number(r.amount); m.set(r.transporter_id, c);
      });
      return m;
    },
  });
  const { data: settings } = useQuery<{ freight_reminder_days: number } | null>({
    queryKey: ["gate-pass-settings", "freight"],
    queryFn: async () => {
      const { data } = await gpDb.from("gate_pass_settings").select("freight_reminder_days").maybeSingle();
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await gpDb.rpc("gate_pass_transporter_save", {
        p_id: editing && editing !== "new" ? editing.id : null,
        p_data: { ...form, default_rate: form.default_rate || null },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Transporter saved" });
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["gate-pass-transporters"] });
    },
    onError: (e) => toast({ title: "Could not save", description: errorMessage(e), variant: "destructive" }),
  });
  const saveSettings = useMutation({
    mutationFn: async () => {
      const { error } = await gpDb.rpc("gate_pass_freight_settings_save", { p_reminder_days: Number(reminder) });
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Setting saved" }); queryClient.invalidateQueries({ queryKey: ["gate-pass-settings"] }); },
    onError: (e) => toast({ title: "Could not save", description: errorMessage(e), variant: "destructive" }),
  });

  const openEdit = (t: Transporter | "new") => {
    setForm(t === "new" ? emptyForm() : {
      name: t.name, phone: t.phone ?? "", kind: t.kind, default_mode: t.default_mode,
      default_rate: t.default_rate === null ? "" : String(t.default_rate), is_active: t.is_active, remarks: t.remarks ?? "",
    });
    setEditing(t);
  };

  const selected = transporters.find((t) => t.id === selectedId) ?? null;
  const monthTotals = useMemo(() => {
    const m = new Map<string, { n: number; rs: number }>();
    vouchers.filter((v) => v.status !== "cancelled").forEach((v) => {
      const k = v.voucher_date.slice(0, 7);
      const c = m.get(k) ?? { n: 0, rs: 0 }; c.n++; c.rs += Number(v.amount); m.set(k, c);
    });
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6);
  }, [vouchers]);

  const printStatement = async (s: FreightStatement) => {
    const { data } = await gpDb.from("gate_pass_freight_vouchers").select(VOUCHER_SELECT).eq("statement_id", s.id);
    printFreightStatement(s, data ?? []);
  };

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader title="Transporters" description="Contractors paid per trip and settled together, and the ride apps. The guard never sees this list." icon={Truck}>
          <div className="flex gap-2">
            <Button variant="outline" asChild><Link to="/gate-pass/freight">Freight Vouchers</Link></Button>
            {canManage && <Button onClick={() => openEdit("new")}><Plus className="h-4 w-4 mr-1" /> New transporter</Button>}
          </div>
        </PageHeader>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.2fr] gap-4">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Usual mode</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Owed now</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
                  ) : transporters.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No transporters yet. They are also created when a new name is typed on a gate pass.</TableCell></TableRow>
                  ) : transporters.map((t) => {
                    const o = owed.get(t.id);
                    return (
                      <TableRow key={t.id} className={cn("cursor-pointer", selectedId === t.id && "bg-muted/50", !t.is_active && "opacity-60")} onClick={() => setSelectedId(t.id)}>
                        <TableCell>
                          <div className="font-medium">{t.name}{!t.is_active && <Badge variant="secondary" className="ml-2">Inactive</Badge>}</div>
                          {t.phone && <div className="text-xs text-muted-foreground">{t.phone}</div>}
                        </TableCell>
                        <TableCell className="text-sm">{kindLabel(t.kind)}</TableCell>
                        <TableCell className="text-sm">{modeLabel(t.default_mode)}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm">{t.default_rate ? fmtRs(t.default_rate) : "—"}</TableCell>
                        <TableCell className={cn("text-right tabular-nums text-sm font-semibold", o && "text-amber-700")}>{o ? `${fmtRs(o.rs)} · ${o.n}` : "—"}</TableCell>
                        <TableCell className="text-right">
                          {canManage && <Button size="sm" variant="ghost" aria-label={`Edit ${t.name}`} onClick={(e) => { e.stopPropagation(); openEdit(t); }}><Pencil className="h-4 w-4" /></Button>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="space-y-4">
            {selected ? (
              <>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{selected.name} — trips</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Owed now: <b className="text-foreground">{fmtRs(owed.get(selected.id)?.rs ?? 0)}</b> ({owed.get(selected.id)?.n ?? 0} unpaid). Pay them together from <Link to={`/gate-pass/freight`} className="text-primary underline">Freight Vouchers</Link>.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {monthTotals.map(([m, c]) => (
                        <div key={m} className="rounded-lg border px-3 py-1.5 text-sm"><span className="text-muted-foreground">{format(new Date(`${m}-01`), "MMM yyyy")}</span> · {c.n} trips · <b>{fmtRs(c.rs)}</b></div>
                      ))}
                    </div>
                    <div className="overflow-x-auto -mx-4">
                      <Table className="min-w-[640px]">
                        <TableHeader>
                          <TableRow><TableHead>Date</TableHead><TableHead>Voucher</TableHead><TableHead>Gate pass</TableHead><TableHead>Dispatches</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead></TableRow>
                        </TableHeader>
                        <TableBody>
                          {vouchers.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-4 text-muted-foreground">No trips yet.</TableCell></TableRow>}
                          {[...vouchers].sort((a, b) => (a.status === "unpaid" ? 0 : 1) - (b.status === "unpaid" ? 0 : 1)).map((v) => (
                            <TableRow key={v.id}>
                              <TableCell className="text-sm whitespace-nowrap">{fmtDate(v.voucher_date)}</TableCell>
                              <TableCell className="font-mono text-sm">{v.voucher_number}</TableCell>
                              <TableCell><Link to={`/gate-pass/passes/${v.gate_pass_id}`} className="font-mono text-sm text-primary hover:underline">{v.gate_passes?.pass_number}</Link></TableCell>
                              <TableCell className="font-mono text-xs">{v.dispatch_numbers}</TableCell>
                              <TableCell className="text-right tabular-nums font-semibold">{fmtRs(v.amount)}</TableCell>
                              <TableCell>
                                <Badge variant={voucherStatusMeta(v.status).variant}>{voucherStatusMeta(v.status).label}</Badge>
                                {v.status === "paid" && <div className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(v.paid_date)}{v.gate_pass_freight_statements?.statement_number ? ` · ${v.gate_pass_freight_statements.statement_number}` : ""}</div>}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-base">Payment statements</CardTitle></CardHeader>
                  <CardContent className="space-y-1">
                    {statements.length === 0 && <p className="text-sm text-muted-foreground">No statements yet.</p>}
                    {statements.map((s) => (
                      <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-md border p-2 text-sm">
                        <span className="font-mono font-semibold">{s.statement_number}</span>
                        <span className="text-muted-foreground">{fmtDate(s.paid_date)}</span>
                        <span>{s.voucher_count} trip{s.voucher_count === 1 ? "" : "s"}</span>
                        <span className="font-semibold tabular-nums">{fmtRs(s.total_amount)}</span>
                        <span className="text-xs text-muted-foreground">{s.payer_user?.full_name}</span>
                        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => printStatement(s)}><Printer className="h-4 w-4 mr-1" /> Print</Button>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card><CardContent className="p-6 text-sm text-muted-foreground">Pick a transporter to see its trips, what is owed and its payment statements.</CardContent></Card>
            )}

            {superAdmin && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Setting</CardTitle></CardHeader>
                <CardContent className="flex flex-wrap items-end gap-3">
                  <div>
                    <Label htmlFor="fr-reminder">Remind cashiers when a voucher is unpaid for more than (days)</Label>
                    <Input id="fr-reminder" type="number" min="1" max="60" className="w-32" value={reminder || String(settings?.freight_reminder_days ?? 3)} onChange={(e) => setReminder(e.target.value)} />
                  </div>
                  <Button variant="outline" disabled={saveSettings.isPending || !reminder} onClick={() => saveSettings.mutate()}>Save</Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "New transporter" : `Edit ${editing?.name ?? ""}`}</DialogTitle>
            <DialogDescription>A contractor is paid per trip and settled together. An app (Bykea, InDrive, Careem) has a different driver every ride.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label htmlFor="tr-name">Name *</Label><Input id="tr-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div>
              <Label htmlFor="tr-kind">Kind</Label>
              <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as TransporterKind, default_mode: v === "app" && form.default_mode === "contractor_van" ? "online_rickshaw" : form.default_mode })}>
                <SelectTrigger id="tr-kind"><SelectValue /></SelectTrigger>
                <SelectContent>{KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="tr-mode">Usual mode</Label>
              <Select value={form.default_mode} onValueChange={(v) => setForm({ ...form, default_mode: v as FreightMode })}>
                <SelectTrigger id="tr-mode"><SelectValue /></SelectTrigger>
                <SelectContent>{MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label htmlFor="tr-phone">Phone</Label><Input id="tr-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><Label htmlFor="tr-rate">Default rate (Rs per trip)</Label><Input id="tr-rate" type="number" min="0" step="1" value={form.default_rate} onChange={(e) => setForm({ ...form, default_rate: e.target.value })} /></div>
            <div className="col-span-2"><Label htmlFor="tr-remarks">Remarks</Label><Textarea id="tr-remarks" rows={2} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></div>
            <div className="col-span-2 flex items-center gap-2">
              <Checkbox id="tr-active" checked={form.is_active} onCheckedChange={(c) => setForm({ ...form, is_active: c === true })} />
              <Label htmlFor="tr-active">Active (can be picked on a gate pass)</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Back</Button>
            <Button disabled={save.isPending} onClick={() => save.mutate()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
