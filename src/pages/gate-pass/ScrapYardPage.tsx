import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format, startOfMonth } from "date-fns";
import { Plus, Recycle, Settings2 } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
import { errorMessage, fmtQty, gpDb, todayPk } from "@/lib/gatePass";
import { useScrapYard, type YardRow } from "@/lib/gatePassForms";

type Entry = {
  id: string;
  category_id: string;
  entry_type: "opening" | "in" | "out";
  entry_date: string;
  quantity: number;
  gate_pass_id: string | null;
  remarks: string | null;
  created_at: string;
  creator: { full_name: string | null } | null;
};

type Sale = {
  id: string;
  pass_number: string;
  party_name: string;
  gate_out_at: string;
  is_backfill: boolean;
  gate_pass_items: { scrap_category_id: string; description: string; quantity: number; uom: string }[];
};

type DialogKind = null | { kind: "in" } | { kind: "opening"; cat: YardRow } | { kind: "category"; cat?: YardRow };

export default function ScrapYardPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { roles, hasModulePermission } = useAuth();
  const isSuperAdmin = roles.some((r) => r.role === "super_admin");
  const canAdd = hasModulePermission("gate_pass", "create");
  const [from, setFrom] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [to, setTo] = useState(todayPk());
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [form, setForm] = useState({ category: "", qty: "", date: todayPk(), remarks: "", name: "", uom: "kg", active: true });

  const { data: yard = [] } = useScrapYard();
  const catName = (id: string) => yard.find((c) => c.category_id === id)?.name ?? "";

  const { data: entries = [] } = useQuery<Entry[]>({
    queryKey: ["scrap-yard-entries", from, to],
    queryFn: async () => {
      const { data, error } = await gpDb
        .from("gate_pass_scrap_entries")
        .select("*, creator:app_users!gate_pass_scrap_entries_created_by_fkey(full_name)")
        .gte("entry_date", from).lte("entry_date", to)
        .order("entry_date", { ascending: false }).order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: sales = [] } = useQuery<Sale[]>({
    queryKey: ["scrap-sales", from, to],
    queryFn: async () => {
      const { data, error } = await gpDb
        .from("gate_passes")
        .select("id, pass_number, party_name, gate_out_at, is_backfill, gate_pass_items(scrap_category_id, description, quantity, uom)")
        .eq("pass_type", "scrap").eq("status", "out")
        .gte("gate_out_at", `${from}T00:00:00+05:00`).lte("gate_out_at", `${to}T23:59:59+05:00`)
        .order("gate_out_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const saleIds = sales.map((s) => s.id);
  const { data: rates = [] } = useQuery<{ gate_pass_id: string; scrap_category_id: string; rate: number }[]>({
    queryKey: ["scrap-sale-rates", saleIds],
    enabled: saleIds.length > 0,
    queryFn: async () => {
      const { data, error } = await gpDb.from("gate_pass_scrap_rates").select("*").in("gate_pass_id", saleIds);
      if (error) throw error;
      return data ?? [];
    },
  });
  const rateMap = useMemo(() => new Map(rates.map((r) => [`${r.gate_pass_id}|${r.scrap_category_id}`, Number(r.rate)])), [rates]);
  const rateOf = (pass: string, cat: string) => rateMap.get(`${pass}|${cat}`);
  const salesTotals = useMemo(() => {
    let kg = 0; let value = 0;
    sales.forEach((s) => s.gate_pass_items.forEach((i) => {
      kg += Number(i.quantity);
      value += Number(i.quantity) * (rateMap.get(`${s.id}|${i.scrap_category_id}`) ?? 0);
    }));
    return { kg, value };
  }, [sales, rateMap]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["scrap-yard-balance"] });
    qc.invalidateQueries({ queryKey: ["scrap-yard-entries"] });
  };
  const save = useMutation({
    mutationFn: async () => {
      if (!dialog) return;
      let res;
      if (dialog.kind === "in") {
        res = await gpDb.rpc("gate_pass_scrap_in", { p_category: form.category, p_quantity: form.qty, p_date: form.date, p_remarks: form.remarks });
      } else if (dialog.kind === "opening") {
        res = await gpDb.rpc("gate_pass_scrap_set_opening", { p_category: dialog.cat.category_id, p_quantity: form.qty, p_date: form.date });
      } else {
        res = await gpDb.rpc("gate_pass_scrap_category_save", { p_id: dialog.cat?.category_id ?? null, p_name: form.name, p_uom: form.uom, p_active: form.active });
      }
      if (res.error) throw res.error;
    },
    onSuccess: () => { toast({ title: "Saved" }); setDialog(null); refresh(); },
    onError: (e) => toast({ title: "Could not save", description: errorMessage(e), variant: "destructive" }),
  });

  const open = (d: DialogKind) => {
    setForm({
      category: "", qty: d?.kind === "opening" ? String(d.cat.opening || "") : "", date: todayPk(), remarks: "",
      name: d?.kind === "category" ? d.cat?.name ?? "" : "", uom: d?.kind === "category" ? d.cat?.uom ?? "kg" : "kg",
      active: d?.kind === "category" ? d.cat?.is_active ?? true : true,
    });
    setDialog(d);
  };

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader title="Scrap Yard" description="Scrap stock: opening balance + Scrap In entries − scrap sold on gate passes" icon={Recycle}>
          <div className="flex gap-2">
            {isSuperAdmin && <Button variant="outline" onClick={() => open({ kind: "category" })}><Settings2 className="h-4 w-4 mr-1" /> New category</Button>}
            {canAdd && <Button onClick={() => open({ kind: "in" })}><Plus className="h-4 w-4 mr-1" /> Scrap In</Button>}
          </div>
        </PageHeader>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Stock by category</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Opening</TableHead>
                  <TableHead className="text-right">Scrap In</TableHead>
                  <TableHead className="text-right">Sold</TableHead>
                  <TableHead className="text-right">In yard</TableHead>
                  {isSuperAdmin && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {yard.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
                    No scrap categories yet.{isSuperAdmin ? " Add one with “New category”." : " A super admin sets them up."}
                  </TableCell></TableRow>
                ) : yard.map((c) => (
                  <TableRow key={c.category_id} className={cn(!c.is_active && "opacity-50")}>
                    <TableCell className="font-medium">{c.name}{!c.is_active && " (inactive)"}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtQty(c.opening)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtQty(c.scrap_in)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtQty(c.scrap_out)}</TableCell>
                    <TableCell className="text-right tabular-nums font-bold">{fmtQty(c.balance)} {c.uom}</TableCell>
                    {isSuperAdmin && (
                      <TableCell className="text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => open({ kind: "opening", cat: c })}>Opening</Button>
                        <Button size="sm" variant="ghost" onClick={() => open({ kind: "category", cat: c })}>Edit</Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 md:p-4 flex flex-wrap items-end gap-3">
            <div><Label className="text-xs">From</Label><Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><Label className="text-xs">To</Label><Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <div className="text-sm ml-auto">
              Sold in this range: <b>{fmtQty(salesTotals.kg)} kg</b> · <b>Rs {fmtQty(salesTotals.value)}</b>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Scrap sales</CardTitle></CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pass</TableHead>
                    <TableHead>Out</TableHead>
                    <TableHead>Buyer</TableHead>
                    <TableHead className="text-right">Weight</TableHead>
                    <TableHead className="text-right">Value (Rs)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sales.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No scrap sold in this range.</TableCell></TableRow>
                  ) : sales.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell><Link to={`/gate-pass/passes/${s.id}`} className="text-primary hover:underline font-mono text-sm">{s.pass_number}</Link>{s.is_backfill && <span className="ml-1 text-xs text-amber-700">(backfill)</span>}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{format(new Date(s.gate_out_at), "dd MMM")}</TableCell>
                      <TableCell className="text-sm">{s.party_name}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {s.gate_pass_items.map((i) => `${i.description} ${fmtQty(i.quantity)}`).join(", ")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtQty(s.gate_pass_items.reduce((v, i) => v + Number(i.quantity) * Number(rateOf(s.id, i.scrap_category_id) ?? 0), 0))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Movements</CardTitle></CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Weight</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No movements in this range.</TableCell></TableRow>
                  ) : entries.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{format(new Date(e.entry_date), "dd MMM")}</TableCell>
                      <TableCell className="text-sm">{catName(e.category_id)}</TableCell>
                      <TableCell className="text-sm">{e.entry_type === "opening" ? "Opening" : e.entry_type === "in" ? "Scrap In" : "Sold"}</TableCell>
                      <TableCell className={cn("text-right tabular-nums text-sm font-medium", e.entry_type === "out" ? "text-red-700" : "text-emerald-700")}>
                        {e.entry_type === "out" ? "−" : "+"}{fmtQty(e.quantity)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[220px]">
                        {e.gate_pass_id ? <Link className="text-primary hover:underline" to={`/gate-pass/passes/${e.gate_pass_id}`}>{e.remarks}</Link> : e.remarks}
                        {e.creator?.full_name ? ` · ${e.creator.full_name}` : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={dialog !== null} onOpenChange={(o) => { if (!o) setDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.kind === "in" ? "Scrap In" : dialog?.kind === "opening" ? `Opening balance — ${dialog.cat.name}` : dialog?.cat ? `Edit ${dialog.cat.name}` : "New scrap category"}
            </DialogTitle>
            <DialogDescription>
              {dialog?.kind === "in" ? "Scrap added to the yard (e.g. collected from the floor)."
                : dialog?.kind === "opening" ? "Can be changed until the category has any Scrap In or sale."
                : "Scrap categories are sold by weight."}
            </DialogDescription>
          </DialogHeader>
          {dialog?.kind === "category" ? (
            <div className="space-y-3">
              <div><Label htmlFor="sc-name">Name</Label><Input id="sc-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label htmlFor="sc-uom">Unit</Label><Input id="sc-uom" value={form.uom} onChange={(e) => setForm({ ...form, uom: e.target.value })} /></div>
              <div className="flex items-center gap-2">
                <Checkbox id="sc-active" checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v === true })} />
                <Label htmlFor="sc-active">Active</Label>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {dialog?.kind === "in" && (
                <div>
                  <Label>Category</Label>
                  <Select value={form.category || undefined} onValueChange={(v) => setForm({ ...form, category: v })}>
                    <SelectTrigger aria-label="Category"><SelectValue placeholder="Select category" /></SelectTrigger>
                    <SelectContent>
                      {yard.filter((c) => c.is_active).map((c) => <SelectItem key={c.category_id} value={c.category_id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><Label htmlFor="sc-qty">Weight (kg)</Label><Input id="sc-qty" type="number" min="0" step="any" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} /></div>
                <div><Label htmlFor="sc-date">Date</Label><Input id="sc-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
              </div>
              {dialog?.kind === "in" && (
                <div><Label htmlFor="sc-rem">Where it came from *</Label><Textarea id="sc-rem" rows={2} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Back</Button>
            <Button disabled={save.isPending} onClick={() => save.mutate()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
