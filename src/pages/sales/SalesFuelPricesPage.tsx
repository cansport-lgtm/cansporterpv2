import { useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { SALES_FUEL_KEYS, factorForDate, fmtMoney, useRateFactors, type RateFactor } from "@/lib/salesFuel";

interface Price { id: string; effective_date: string; price_per_litre: number; remarks: string | null; }

const today = () => new Date().toISOString().slice(0, 10);

/** Super admin: the multiplying factor (rate per km = petrol price × factor), dated so history is kept. */
function RateFactorCard() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: factors, isLoading } = useRateFactors();
  const { data: users } = useQuery({
    queryKey: ["app_users_names"],
    queryFn: async () => {
      const { data } = await supabase.from("app_users").select("id,full_name");
      return Object.fromEntries(((data ?? []) as any[]).map((u) => [u.id, u.full_name])) as Record<string, string>;
    },
  });
  const { data: latestPrice } = useQuery({
    queryKey: [SALES_FUEL_KEYS.prices, "latest"],
    queryFn: async () => {
      const { data } = await supabase.from("sales_fuel_prices" as any).select("price_per_litre").lte("effective_date", today()).order("effective_date", { ascending: false }).limit(1).maybeSingle();
      return (data as any)?.price_per_litre != null ? Number((data as any).price_per_litre) : null;
    },
  });

  const current = factorForDate(factors, today());
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RateFactor | null>(null);
  const [date, setDate] = useState(today());
  const [factor, setFactor] = useState("");
  const [note, setNote] = useState("");

  const reset = () => { setEditing(null); setDate(today()); setFactor(current ? String(current.factor) : ""); setNote(""); };
  const close = () => { setOpen(false); reset(); };
  const edit = (f: RateFactor) => { setEditing(f); setDate(f.effective_date); setFactor(String(f.factor)); setNote(f.note || ""); setOpen(true); };

  const save = useMutation({
    mutationFn: async () => {
      const v = parseFloat(factor);
      if (!v || v <= 0) throw new Error("Factor must be greater than 0");
      const payload = { effective_date: date, factor: Math.round(v * 10000) / 10000, note: note.trim() || null };
      if (editing) {
        const { error } = await supabase.from("sales_fuel_rate_factors" as any).update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("sales_fuel_rate_factors" as any).insert({ ...payload, created_by: user?.id || null });
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [SALES_FUEL_KEYS.factors] }); toast.success(editing ? "Factor updated" : "Factor saved"); close(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sales_fuel_rate_factors" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [SALES_FUEL_KEYS.factors] }); toast.success("Deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const exampleRate = current && latestPrice != null ? Math.round(latestPrice * Number(current.factor) * 100) / 100 : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <div>
          <CardTitle className="text-lg">Multiplying Factor</CardTitle>
          <p className="text-sm text-muted-foreground">Rate per km = petrol price typed by the salesman × this factor. A new factor applies to trips posted from its effective date; posted vouchers keep theirs.</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { if (!o) close(); else { reset(); setOpen(true); } }}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />New Factor</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? "Edit Factor" : "New Multiplying Factor"}</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
              <div className="space-y-2">
                <Label>Effective Date *</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Factor *</Label>
                <Input type="number" step="0.0001" min="0" value={factor} onChange={(e) => setFactor(e.target.value)} required placeholder="e.g. 0.1000" />
                <p className="text-xs text-muted-foreground">
                  Four decimals. A bike doing 10 km per litre is 1 ÷ 10 = 0.1000.
                  {latestPrice != null && factor && parseFloat(factor) > 0 && <> At Rs {fmtMoney(latestPrice)}/L that pays Rs {fmtMoney(latestPrice * parseFloat(factor))} per km.</>}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Note</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Approved by MD" />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={close}>Cancel</Button>
                <Button type="submit" disabled={save.isPending}>{editing ? "Update" : "Save"}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-md border p-3"><div className="text-xs uppercase text-muted-foreground">Current factor</div><div className="text-2xl font-bold">{current ? Number(current.factor).toFixed(4) : "not set"}</div><div className="text-xs text-muted-foreground">{current ? `since ${current.effective_date}` : "salesmen cannot post trips until one is set"}</div></div>
          <div className="rounded-md border p-3"><div className="text-xs uppercase text-muted-foreground">Latest list price</div><div className="text-2xl font-bold">{latestPrice != null ? `Rs ${fmtMoney(latestPrice)}` : "—"}</div><div className="text-xs text-muted-foreground">per litre · default for the salesman's first trip</div></div>
          <div className="rounded-md border p-3 bg-emerald-500/10"><div className="text-xs uppercase text-muted-foreground">Example rate / km</div><div className="text-2xl font-bold text-emerald-700">{exampleRate != null ? `Rs ${fmtMoney(exampleRate)}` : "—"}</div><div className="text-xs text-muted-foreground">list price × factor</div></div>
        </div>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Effective Date</TableHead><TableHead className="text-right">Factor</TableHead><TableHead>Set by</TableHead><TableHead>Note</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center">Loading...</TableCell></TableRow>
            ) : !factors?.length ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No factor yet</TableCell></TableRow>
            ) : factors.map((f) => (
              <TableRow key={f.id}>
                <TableCell className="font-medium">{f.effective_date}</TableCell>
                <TableCell className="text-right font-mono">{Number(f.factor).toFixed(4)} {current?.id === f.id && <Badge variant="outline" className="ml-2 bg-emerald-500/10 text-emerald-700 border-emerald-500/30">current</Badge>}</TableCell>
                <TableCell>{f.created_by ? users?.[f.created_by] || "—" : "—"}</TableCell>
                <TableCell>{f.note || "—"}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => edit(f)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => { if (confirm("Delete this factor? Posted vouchers keep the factor they were posted with.")) del.mutate(f.id); }}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function SalesFuelPricesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Price | null>(null);
  const [date, setDate] = useState(today());
  const [price, setPrice] = useState("");
  const [remarks, setRemarks] = useState("");

  const { data: prices, isLoading } = useQuery({
    queryKey: [SALES_FUEL_KEYS.prices],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_fuel_prices" as any).select("*").order("effective_date", { ascending: false });
      if (error) throw error;
      return data as unknown as Price[];
    },
  });

  const reset = () => { setEditing(null); setDate(today()); setPrice(""); setRemarks(""); };
  const close = () => { setOpen(false); reset(); };
  const edit = (p: Price) => { setEditing(p); setDate(p.effective_date); setPrice(String(p.price_per_litre)); setRemarks(p.remarks || ""); setOpen(true); };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [SALES_FUEL_KEYS.prices] });
    qc.invalidateQueries({ queryKey: [SALES_FUEL_KEYS.lastPrice] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const v = parseFloat(price);
      if (!v || v <= 0) throw new Error("Price must be > 0");
      const payload = { effective_date: date, price_per_litre: v, remarks: remarks.trim() || null };
      if (editing) {
        const { error } = await supabase.from("sales_fuel_prices" as any).update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("sales_fuel_prices" as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { invalidate(); toast.success(editing ? "Updated" : "Added"); close(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sales_fuel_prices" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success("Deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Fuel Prices & Factor" description="The multiplying factor that turns the salesman's petrol price into a rate per km, and the list price that pre-fills a salesman's first trip." />
        <RateFactorCard />
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">Fuel Price List</CardTitle>
              <p className="text-sm text-muted-foreground">Reference price per litre. The salesman types the actual pump price on each trip; this list only pre-fills it the first time.</p>
            </div>
            <Dialog open={open} onOpenChange={(o) => { if (!o) close(); else setOpen(true); }}>
              <DialogTrigger asChild>
                <Button onClick={reset}><Plus className="h-4 w-4 mr-2" />Add Price</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{editing ? "Edit Fuel Price" : "New Fuel Price"}</DialogTitle></DialogHeader>
                <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
                  <div className="space-y-2">
                    <Label>Effective Date *</Label>
                    <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Price per Litre (Rs.) *</Label>
                    <Input type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Remarks</Label>
                    <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={close}>Cancel</Button>
                    <Button type="submit" disabled={save.isPending}>{editing ? "Update" : "Create"}</Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Effective Date</TableHead><TableHead>Price/Litre (Rs.)</TableHead><TableHead>Remarks</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={4} className="text-center">Loading...</TableCell></TableRow>
                ) : !prices?.length ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No prices yet</TableCell></TableRow>
                ) : prices.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.effective_date}</TableCell>
                    <TableCell>Rs. {Number(p.price_per_litre).toFixed(2)}</TableCell>
                    <TableCell>{p.remarks || "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => edit(p)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => { if (confirm("Delete?")) del.mutate(p.id); }}><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
