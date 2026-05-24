import { useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";

interface City { id: string; name: string; is_active: boolean; }

export default function CitiesMasterPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<City | null>(null);
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);

  const { data: cities, isLoading } = useQuery({
    queryKey: ["sales_cities"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_cities" as any).select("*").order("name");
      if (error) throw error;
      return data as unknown as City[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Name is required");
      const payload = { name: name.trim(), is_active: isActive };
      if (editing) {
        const { error } = await supabase.from("sales_cities" as any).update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("sales_cities" as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales_cities"] });
      toast.success(editing ? "City updated" : "City added");
      close();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sales_cities" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales_cities"] });
      toast.success("City deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const close = () => { setOpen(false); setEditing(null); setName(""); setIsActive(true); };
  const edit = (c: City) => { setEditing(c); setName(c.name); setIsActive(c.is_active); setOpen(true); };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="City Master" description="Manage cities for Private Label Sales" />
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Cities</CardTitle>
            <Dialog open={open} onOpenChange={(o) => { if (!o) close(); else setOpen(true); }}>
              <DialogTrigger asChild>
                <Button onClick={() => { setEditing(null); setName(""); setIsActive(true); }}>
                  <Plus className="h-4 w-4 mr-2" />Add City
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{editing ? "Edit City" : "New City"}</DialogTitle></DialogHeader>
                <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
                  <div className="space-y-2">
                    <Label>City Name *</Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} required />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>Active</Label>
                    <Switch checked={isActive} onCheckedChange={setIsActive} />
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
                <TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={3} className="text-center">Loading...</TableCell></TableRow>
                ) : !cities?.length ? (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No cities yet</TableCell></TableRow>
                ) : cities.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell><Badge variant={c.is_active ? "default" : "secondary"}>{c.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => edit(c)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => { if (confirm(`Delete ${c.name}?`)) del.mutate(c.id); }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
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
