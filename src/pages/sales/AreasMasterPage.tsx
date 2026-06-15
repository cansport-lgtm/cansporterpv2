import { useState, useMemo } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";

interface City { id: string; name: string; }
interface Area { id: string; name: string; city_id: string | null; is_active: boolean; }

export default function AreasMasterPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Area | null>(null);
  const [name, setName] = useState("");
  const [cityId, setCityId] = useState<string>("none");
  const [isActive, setIsActive] = useState(true);
  const [cityFilter, setCityFilter] = useState("all");

  const { data: cities } = useQuery({
    queryKey: ["sales_cities"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_cities" as any).select("id,name").eq("is_active", true).order("name");
      if (error) throw error;
      return data as unknown as City[];
    },
  });

  const { data: areas, isLoading } = useQuery({
    queryKey: ["sales_areas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_areas" as any).select("*").order("name");
      if (error) throw error;
      return data as unknown as Area[];
    },
  });

  const cityMap = useMemo(() => Object.fromEntries((cities || []).map(c => [c.id, c.name])), [cities]);

  const filtered = useMemo(() => {
    if (!areas) return [];
    if (cityFilter === "all") return areas;
    return areas.filter(a => a.city_id === cityFilter);
  }, [areas, cityFilter]);

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Name is required");
      const payload = { name: name.trim(), city_id: cityId === "none" ? null : cityId, is_active: isActive };
      if (editing) {
        const { error } = await supabase.from("sales_areas" as any).update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("sales_areas" as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales_areas"] });
      toast.success(editing ? "Area updated" : "Area added");
      close();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sales_areas" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales_areas"] });
      toast.success("Area deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const close = () => { setOpen(false); setEditing(null); setName(""); setCityId("none"); setIsActive(true); };
  const edit = (a: Area) => { setEditing(a); setName(a.name); setCityId(a.city_id || "none"); setIsActive(a.is_active); setOpen(true); };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Area Master" description="Manage areas for Private Label Sales" />
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Areas</CardTitle>
            <div className="flex items-center gap-3">
              <Select value={cityFilter} onValueChange={setCityFilter}>
                <SelectTrigger className="w-44 bg-background"><SelectValue placeholder="All cities" /></SelectTrigger>
                <SelectContent className="bg-background z-50">
                  <SelectItem value="all">All Cities</SelectItem>
                  {cities?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Dialog open={open} onOpenChange={(o) => { if (!o) close(); else setOpen(true); }}>
                <DialogTrigger asChild>
                  <Button onClick={() => { setEditing(null); setName(""); setCityId("none"); setIsActive(true); }}>
                    <Plus className="h-4 w-4 mr-2" />Add Area
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>{editing ? "Edit Area" : "New Area"}</DialogTitle></DialogHeader>
                  <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
                    <div className="space-y-2">
                      <Label>Area Name *</Label>
                      <Input value={name} onChange={(e) => setName(e.target.value)} required />
                    </div>
                    <div className="space-y-2">
                      <Label>City</Label>
                      <Select value={cityId} onValueChange={setCityId}>
                        <SelectTrigger className="bg-background"><SelectValue placeholder="Select city" /></SelectTrigger>
                        <SelectContent className="bg-background z-50">
                          <SelectItem value="none">No city</SelectItem>
                          {cities?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
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
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Name</TableHead><TableHead>City</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={4} className="text-center">Loading...</TableCell></TableRow>
                ) : !filtered.length ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No areas yet</TableCell></TableRow>
                ) : filtered.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.name}</TableCell>
                    <TableCell>{a.city_id ? cityMap[a.city_id] || "-" : "-"}</TableCell>
                    <TableCell><Badge variant={a.is_active ? "default" : "secondary"}>{a.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => edit(a)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => { if (confirm(`Delete ${a.name}?`)) del.mutate(a.id); }}>
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
