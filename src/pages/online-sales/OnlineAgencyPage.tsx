import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Building2, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatPKR } from "@/lib/currency";

export default function OnlineAgencyPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", contact: "", monthly_fixed: "", commission_pct: "", is_active: true, notes: "" });

  const fetchData = async () => {
    setLoading(true);
    const { data } = await supabase.from("agencies").select("*").order("name");
    setRows(data || []);
    setLoading(false);
  };
  useEffect(() => { fetchData(); }, []);

  const openCreate = () => { setEditingId(null); setForm({ name: "", contact: "", monthly_fixed: "", commission_pct: "", is_active: true, notes: "" }); setOpen(true); };
  const openEdit = (a: any) => { setEditingId(a.id); setForm({ name: a.name, contact: a.contact || "", monthly_fixed: String(a.monthly_fixed ?? ""), commission_pct: String(a.commission_pct ?? ""), is_active: a.is_active, notes: a.notes || "" }); setOpen(true); };

  const save = async () => {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    const payload = {
      name: form.name.trim(), contact: form.contact.trim() || null,
      monthly_fixed: form.monthly_fixed.trim() === "" ? 0 : Number(form.monthly_fixed),
      commission_pct: form.commission_pct.trim() === "" ? 0 : Number(form.commission_pct),
      is_active: form.is_active, notes: form.notes.trim() || null, updated_at: new Date().toISOString(),
    };
    const { error } = editingId
      ? await supabase.from("agencies").update(payload).eq("id", editingId)
      : await supabase.from("agencies").insert(payload as any);
    if (error) { toast.error(error.message); return; }
    toast.success(editingId ? "Agency updated" : "Agency added");
    setOpen(false); fetchData();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("agencies").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    fetchData();
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Agencies" description="Social-media / ad agencies — monthly fixed fee + commission on net sales" icon={Building2} iconColor="bg-emerald-600 text-white"
          action={{ label: "Add Agency", onClick: openCreate, icon: Plus }} />

        <Card><CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Name</TableHead><TableHead>Contact</TableHead>
              <TableHead className="text-right">Monthly Fixed</TableHead><TableHead className="text-right">Commission %</TableHead>
              <TableHead>Status</TableHead><TableHead>Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No agencies yet</TableCell></TableRow>
              ) : rows.map(a => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{a.contact || "-"}</TableCell>
                  <TableCell className="text-right">{formatPKR(a.monthly_fixed)}</TableCell>
                  <TableCell className="text-right">{Number(a.commission_pct)}%</TableCell>
                  <TableCell><Badge variant={a.is_active ? "default" : "secondary"}>{a.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => openEdit(a)}><Pencil className="h-3 w-3" /></Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild><Button size="sm" variant="outline" className="text-destructive"><Trash2 className="h-3 w-3" /></Button></AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader><AlertDialogTitle>Delete agency</AlertDialogTitle><AlertDialogDescription>Delete "{a.name}"? Its settlements will also be removed.</AlertDialogDescription></AlertDialogHeader>
                          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => remove(a.id)}>Delete</AlertDialogAction></AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
        <p className="text-xs text-muted-foreground">Commission is charged on <b>net sales = gross − returns − shipping</b>. Both the monthly fixed fee and commission flow into the online Profit &amp; Loss, and monthly settlements can be generated on the Agency Settlement page.</p>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingId ? "Edit Agency" : "Add Agency"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. XYZ Media" /></div>
            <div><Label>Contact</Label><Input value={form.contact} onChange={e => setForm(p => ({ ...p, contact: e.target.value }))} placeholder="phone / email" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Monthly Fixed (Rs.)</Label><Input type="number" min="0" value={form.monthly_fixed} onChange={e => setForm(p => ({ ...p, monthly_fixed: e.target.value }))} placeholder="0" /></div>
              <div><Label>Commission % of net sales</Label><Input type="number" min="0" max="100" step="0.01" value={form.commission_pct} onChange={e => setForm(p => ({ ...p, commission_pct: e.target.value }))} placeholder="7" /></div>
            </div>
            <div><Label>Notes</Label><Input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="optional" /></div>
            <div className="flex items-center justify-between"><Label>Active</Label><Switch checked={form.is_active} onCheckedChange={v => setForm(p => ({ ...p, is_active: v }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}>{editingId ? "Update" : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
