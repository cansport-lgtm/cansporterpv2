import { useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";

interface Price { id: string; effective_date: string; price_per_litre: number; remarks: string | null; }

export default function SalesFuelPricesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Price | null>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [price, setPrice] = useState("");
  const [remarks, setRemarks] = useState("");

  const { data: prices, isLoading } = useQuery({
    queryKey: ["sales_fuel_prices"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_fuel_prices" as any).select("*").order("effective_date", { ascending: false });
      if (error) throw error;
      return data as unknown as Price[];
    },
  });

  const reset = () => { setEditing(null); setDate(new Date().toISOString().slice(0, 10)); setPrice(""); setRemarks(""); };
  const close = () => { setOpen(false); reset(); };
  const edit = (p: Price) => { setEditing(p); setDate(p.effective_date); setPrice(String(p.price_per_litre)); setRemarks(p.remarks || ""); setOpen(true); };

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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sales_fuel_prices"] }); toast.success(editing ? "Updated" : "Added"); close(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sales_fuel_prices" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sales_fuel_prices"] }); toast.success("Deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Fuel Prices" description="Record fuel price per litre with the effective date — used for sales trip calculations" />
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Fuel Price History</CardTitle>
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
