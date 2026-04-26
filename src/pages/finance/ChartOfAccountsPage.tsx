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
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { Plus, Edit, Trash2 } from "lucide-react";

const ACCOUNT_TYPES = [
  { value: "asset", label: "Asset", color: "bg-blue-100 text-blue-800" },
  { value: "liability", label: "Liability", color: "bg-red-100 text-red-800" },
  { value: "equity", label: "Equity", color: "bg-purple-100 text-purple-800" },
  { value: "revenue", label: "Revenue", color: "bg-green-100 text-green-800" },
  { value: "expense", label: "Expense", color: "bg-orange-100 text-orange-800" },
];

interface AccountForm {
  code: string;
  name: string;
  account_type: "asset" | "liability" | "equity" | "revenue" | "expense";
  sub_category: string;
  is_cash_account: boolean;
  sort_order: number;
}

const defaultForm: AccountForm = { code: "", name: "", account_type: "asset" as const, sub_category: "", is_cash_account: false, sort_order: 0 };

export default function ChartOfAccountsPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<AccountForm>(defaultForm);
  const [filterType, setFilterType] = useState<string>("all");

  const { data: accounts, isLoading } = useQuery({
    queryKey: ["finance-coa"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("finance_chart_of_accounts")
        .select("*")
        .order("account_type")
        .order("sort_order")
        .order("code");
      if (error) throw error;
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (formData: AccountForm) => {
      if (editId) {
        const { error } = await supabase.from("finance_chart_of_accounts").update(formData).eq("id", editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("finance_chart_of_accounts").insert(formData);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finance-coa"] });
      toast({ title: editId ? "Account updated" : "Account created" });
      setDialogOpen(false);
      setEditId(null);
      setForm(defaultForm);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("finance_chart_of_accounts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finance-coa"] });
      toast({ title: "Account deleted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const openEdit = (acc: any) => {
    setEditId(acc.id);
    setForm({ code: acc.code, name: acc.name, account_type: acc.account_type as AccountForm["account_type"], sub_category: acc.sub_category || "", is_cash_account: acc.is_cash_account, sort_order: acc.sort_order || 0 });
    setDialogOpen(true);
  };

  const filtered = filterType === "all" ? accounts : accounts?.filter((a) => a.account_type === filterType);
  const getTypeBadge = (type: string) => {
    const t = ACCOUNT_TYPES.find((at) => at.value === type);
    return <Badge variant="outline" className={t?.color}>{t?.label || type}</Badge>;
  };

  return (
    <ERPLayout>
      <PageHeader title="Chart of Accounts" description="Manage financial accounts">
        <div className="flex gap-2">
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {ACCOUNT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) { setEditId(null); setForm(defaultForm); } }}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" />Add Account</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editId ? "Edit" : "New"} Account</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Code</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="1001" /></div>
                  <div>
                    <Label>Type</Label>
                    <Select value={form.account_type} onValueChange={(v) => setForm({ ...form, account_type: v as AccountForm["account_type"] })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{ACCOUNT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div><Label>Account Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Cash in Hand" /></div>
                <div><Label>Sub Category</Label><Input value={form.sub_category} onChange={(e) => setForm({ ...form, sub_category: e.target.value })} placeholder="Current Assets, Cost of Goods Sold, etc." /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Sort Order</Label><Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })} /></div>
                  <div className="flex items-center gap-2 pt-6"><Switch checked={form.is_cash_account} onCheckedChange={(c) => setForm({ ...form, is_cash_account: c })} /><Label>Cash Account</Label></div>
                </div>
                <Button className="w-full" onClick={() => saveMutation.mutate(form)} disabled={!form.code || !form.name}>
                  {editId ? "Update" : "Create"} Account
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
              <TableHead>Account Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Sub Category</TableHead>
              <TableHead>Cash</TableHead>
              <TableHead className="w-20">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : !filtered?.length ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No accounts found</TableCell></TableRow>
            ) : (
              filtered.map((acc) => (
                <TableRow key={acc.id}>
                  <TableCell className="font-mono font-medium">{acc.code}</TableCell>
                  <TableCell>{acc.name}</TableCell>
                  <TableCell>{getTypeBadge(acc.account_type)}</TableCell>
                  <TableCell className="text-muted-foreground">{acc.sub_category || "-"}</TableCell>
                  <TableCell>{acc.is_cash_account ? <Badge variant="secondary">Yes</Badge> : "-"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(acc)}><Edit className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(acc.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </ERPLayout>
  );
}
