import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { Plus, Edit } from "lucide-react";

const sb = supabase as any;

const PARTY_TYPES = [
  { value: "customer", label: "Customer", color: "bg-green-100 text-green-800" },
  { value: "supplier", label: "Supplier", color: "bg-blue-100 text-blue-800" },
  { value: "employee", label: "Employee", color: "bg-amber-100 text-amber-800" },
  { value: "other", label: "Other", color: "bg-gray-100 text-gray-800" },
];

type PartyType = "customer" | "supplier" | "employee" | "other";

interface PartyForm {
  code: string;
  name: string;
  party_type: PartyType;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  ntn: string;
}

const defaultForm: PartyForm = {
  code: "",
  name: "",
  party_type: "customer",
  contact_person: "",
  phone: "",
  email: "",
  address: "",
  ntn: "",
};

export default function AccountingPartiesPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<PartyForm>(defaultForm);
  const [filterType, setFilterType] = useState<string>("all");

  const { data: parties, isLoading } = useQuery({
    queryKey: ["accounting-parties"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_parties")
        .select("*")
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (formData: PartyForm) => {
      const payload = { ...formData, code: formData.code || null };
      if (editId) {
        const { error } = await sb.from("accounting_parties").update(payload).eq("id", editId);
        if (error) throw error;
      } else {
        const { error } = await sb.from("accounting_parties").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounting-parties"] });
      toast({ title: editId ? "Party updated" : "Party created" });
      setDialogOpen(false);
      setEditId(null);
      setForm(defaultForm);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const openEdit = (p: any) => {
    setEditId(p.id);
    setForm({
      code: p.code || "",
      name: p.name,
      party_type: p.party_type,
      contact_person: p.contact_person || "",
      phone: p.phone || "",
      email: p.email || "",
      address: p.address || "",
      ntn: p.ntn || "",
    });
    setDialogOpen(true);
  };

  const filtered = filterType === "all" ? parties : parties?.filter((p: any) => p.party_type === filterType);

  const getTypeBadge = (type: string) => {
    const t = PARTY_TYPES.find((pt) => pt.value === type);
    return <Badge variant="outline" className={t?.color}>{t?.label || type}</Badge>;
  };

  return (
    <ERPLayout>
      <PageHeader title="Parties" description="Customers, suppliers, employees & other ledgers">
        <div className="flex gap-2">
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {PARTY_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) { setEditId(null); setForm(defaultForm); } }}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" />Add Party</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>{editId ? "Edit" : "New"} Party</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div><Label>Code</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="Optional" /></div>
                  <div className="col-span-2">
                    <Label>Type</Label>
                    <Select value={form.party_type} onValueChange={(v: PartyType) => setForm({ ...form, party_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{PARTY_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ABC Traders" /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Contact Person</Label><Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></div>
                  <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                  <div><Label>NTN</Label><Input value={form.ntn} onChange={(e) => setForm({ ...form, ntn: e.target.value })} placeholder="National Tax Number" /></div>
                </div>
                <div><Label>Address</Label><Textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
                <Button className="w-full" onClick={() => saveMutation.mutate(form)} disabled={!form.name || saveMutation.isPending}>
                  {editId ? "Update" : "Create"} Party
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </PageHeader>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>NTN</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>}
            {!isLoading && !filtered?.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No parties. Add a customer to use in vouchers.</TableCell></TableRow>}
            {filtered?.map((p: any) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs">{p.code || "—"}</TableCell>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>{getTypeBadge(p.party_type)}</TableCell>
                <TableCell className="text-xs">{p.contact_person || "—"}</TableCell>
                <TableCell className="text-xs">{p.phone || "—"}</TableCell>
                <TableCell className="text-xs">{p.ntn || "—"}</TableCell>
                <TableCell><Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(p)}><Edit className="h-3 w-3" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </ERPLayout>
  );
}
