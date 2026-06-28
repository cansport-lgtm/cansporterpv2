import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Megaphone, Plus, Trash2, Upload, Download } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { formatPKR } from "@/lib/currency";
import * as XLSX from "xlsx";

const PLATFORMS = ["Meta", "Google", "TikTok", "Other"];
function firstOfMonth() { const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().slice(0, 10); }
function today() { return new Date().toISOString().slice(0, 10); }

export default function OnlineMarketingPage() {
  const { user } = useAuth();
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ spend_date: today(), platform: "Meta", campaign: "", amount: "" });
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchData = async () => {
    setLoading(true);
    const { data } = await supabase.from("marketing_spend").select("*")
      .gte("spend_date", from).lte("spend_date", to).order("spend_date", { ascending: false });
    setRows(data || []);
    setLoading(false);
  };
  useEffect(() => { fetchData(); /* eslint-disable-next-line */ }, []);

  const save = async () => {
    const amount = parseFloat(form.amount);
    if (!form.spend_date || isNaN(amount) || amount < 0) { toast.error("Enter a valid date and amount"); return; }
    const { error } = await supabase.from("marketing_spend").insert({
      spend_date: form.spend_date, platform: form.platform, campaign: form.campaign.trim() || null,
      amount, source: "manual", created_by: user?.id || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Ad spend added");
    setOpen(false);
    setForm({ spend_date: today(), platform: "Meta", campaign: "", amount: "" });
    fetchData();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("marketing_spend").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    fetchData();
  };

  // CSV/Excel import: columns date, platform, campaign, amount (header-insensitive).
  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const wb = XLSX.read(await file.arrayBuffer());
      const data: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      const norm = (h: string) => h.toLowerCase().replace(/\s+/g, "");
      let ok = 0, bad = 0;
      for (const r of data) {
        const m: Record<string, any> = {};
        Object.entries(r).forEach(([k, v]) => (m[norm(k)] = v));
        const amount = parseFloat(m.amount ?? m.spend ?? m.cost);
        let d = m.date ?? m.spenddate ?? m.day;
        if (typeof d === "number") { const ex = new Date(Math.round((d - 25569) * 86400 * 1000)); d = ex.toISOString().slice(0, 10); }
        else if (d) { const pd = new Date(d); d = isNaN(pd.getTime()) ? null : pd.toISOString().slice(0, 10); }
        if (!d || isNaN(amount)) { bad++; continue; }
        const { error } = await supabase.from("marketing_spend").insert({
          spend_date: d, platform: String(m.platform || "Meta"), campaign: m.campaign ? String(m.campaign) : null,
          amount, source: "csv", created_by: user?.id || null,
        });
        if (error) bad++; else ok++;
      }
      toast.success(`Imported ${ok} rows${bad ? `, ${bad} skipped` : ""}`);
      fetchData();
    } catch { toast.error("Could not read file"); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  };

  const { total, byPlatform } = useMemo(() => {
    const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
    const map = new Map<string, number>();
    rows.forEach(r => map.set(r.platform, (map.get(r.platform) || 0) + Number(r.amount || 0)));
    return { total, byPlatform: Array.from(map.entries()).sort((a, b) => b[1] - a[1]) };
  }, [rows]);

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Marketing / Ad Spend" description="Ad cost (Meta, Google, etc.) — flows into P&L and Expenses" icon={Megaphone} iconColor="bg-emerald-600 text-white"
          action={{ label: "Add Spend", onClick: () => setOpen(true), icon: Plus }} />

        <Card><CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div><Label>From</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-44" /></div>
          <div><Label>To</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-44" /></div>
          <Button onClick={fetchData} disabled={loading}>{loading ? "Loading…" : "Apply"}</Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()} className="gap-1"><Upload className="h-4 w-4" /> Import CSV</Button>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onImport} />
        </CardContent></Card>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard title="Total Ad Spend" value={formatPKR(total)} icon={Megaphone} iconColor="text-emerald-600" description={`${rows.length} entries`} />
          {byPlatform.slice(0, 3).map(([p, v]) => (
            <MetricCard key={p} title={`${p} Spend`} value={formatPKR(v)} icon={Megaphone} iconColor="text-blue-600" />
          ))}
        </div>

        <Card><CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Date</TableHead><TableHead>Platform</TableHead><TableHead>Campaign</TableHead>
              <TableHead>Source</TableHead><TableHead className="text-right">Amount</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No ad spend recorded in this range</TableCell></TableRow>
              ) : rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell>{format(new Date(r.spend_date), "dd MMM yyyy")}</TableCell>
                  <TableCell>{r.platform}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.campaign || "-"}</TableCell>
                  <TableCell><Badge variant="outline">{r.source}</Badge></TableCell>
                  <TableCell className="text-right font-medium">{Number(r.amount || 0).toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" onClick={() => remove(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            {rows.length > 0 && (
              <TableFooter><TableRow>
                <TableCell colSpan={4} className="font-bold">Total</TableCell>
                <TableCell className="text-right font-bold">{formatPKR(total)}</TableCell><TableCell />
              </TableRow></TableFooter>
            )}
          </Table>
        </CardContent></Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Ad Spend</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Date</Label><Input type="date" value={form.spend_date} onChange={e => setForm(p => ({ ...p, spend_date: e.target.value }))} /></div>
            <div>
              <Label>Platform</Label>
              <Select value={form.platform} onValueChange={v => setForm(p => ({ ...p, platform: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PLATFORMS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Campaign (optional)</Label><Input value={form.campaign} onChange={e => setForm(p => ({ ...p, campaign: e.target.value }))} placeholder="e.g. Summer Sale" /></div>
            <div><Label>Amount (Rs.)</Label><Input type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} placeholder="0.00" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
