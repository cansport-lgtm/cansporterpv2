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
import { Plus, Edit, Wallet, Landmark } from "lucide-react";

const sb = supabase as any;

const ACCOUNT_TYPES = [
  { value: "asset", label: "Asset", color: "bg-blue-100 text-blue-800" },
  { value: "liability", label: "Liability", color: "bg-red-100 text-red-800" },
  { value: "equity", label: "Equity", color: "bg-purple-100 text-purple-800" },
  { value: "revenue", label: "Revenue", color: "bg-green-100 text-green-800" },
  { value: "expense", label: "Expense", color: "bg-orange-100 text-orange-800" },
];

type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

interface AccountForm {
  code: string;
  name: string;
  account_type: AccountType;
  sub_category: string;
  is_cash_account: boolean;
  is_bank_account: boolean;
  sort_order: number;
}

const defaultForm: AccountForm = {
  code: "",
  name: "",
  account_type: "asset",
  sub_category: "",
  is_cash_account: false,
  is_bank_account: false,
  sort_order: 0,
};

export default function AccountingCoAPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<AccountForm>(defaultForm);
  const [filterType, setFilterType] = useState<string>("all");

  const { data: accounts, isLoading } = useQuery({
    queryKey: ["accounting-coa"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_chart_of_accounts")
        .select("*")
        .order("account_type")
        .order("sort_order")
        .order("code");
      if (error) throw error;
      return data || [];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (formData: AccountForm) => {
      if (editId) {
        const { error } = await sb.from("accounting_chart_of_accounts").update(formData).eq("id", editId);
        if (error) throw error;
      } else {
        const { error } = await sb.from("accounting_chart_of_accounts").insert(formData);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounting-coa"] });
      toast({ title: editId ? "Account updated" : "Account created" });
      setDialogOpen(false);
      setEditId(null);
      setForm(defaultForm);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const openEdit = (acc: any) => {
    setEditId(acc.id);
    setForm({
      code: acc.code,
      name: acc.name,
      account_type: acc.account_type,
      sub_category: acc.sub_category || "",
      is_cash_account: !!acc.is_cash_account,
      is_bank_account: !!acc.is_bank_account,
      sort_order: acc.sort_order || 0,
    });
    setDialogOpen(true);
  };

  const filtered = filterType === "all" ? accounts : accounts?.filter((a: any) => a.account_type === filterType);

  const getTypeBadge = (type: string) => {
    const t = ACCOUNT_TYPES.find((at) => at.value === type);
    return <Badge variant="outline" className={t?.color}>{t?.label || type}</Badge>;
  };

  return (
    <ERPLayout>
      <PageHeader title="Chart of Accounts" description="Standalone accounting module — independent from Finance Reports">
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
                    <Select value={form.account_type} onValueChange={(v: AccountType) => setForm({ ...form, account_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{ACCOUNT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Cash in Hand" /></div>
                <div><Label>Sub-category</Label><Input value={form.sub_category} onChange={(e) => setForm({ ...form, sub_category: e.target.value })} placeholder="Cash / Bank / Receivables ..." /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center justify-between border rounded-md p-3">
                    <Label className="text-sm">Cash Account</Label>
                    <Switch checked={form.is_cash_account} onCheckedChange={(c) => setForm({ ...form, is_cash_account: c, is_bank_account: c ? false : form.is_bank_account })} />
                  </div>
                  <div className="flex items-center justify-between border rounded-md p-3">
                    <Label className="text-sm">Bank Account</Label>
                    <Switch checked={form.is_bank_account} onCheckedChange={(c) => setForm({ ...form, is_bank_account: c, is_cash_account: c ? false : form.is_cash_account })} />
                  </div>
                </div>
                <div><Label>Sort Order</Label><Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })} /></div>
                <Button className="w-full" onClick={() => saveMutation.mutate(form)} disabled={!form.code || !form.name || saveMutation.isPending}>
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
              <TableHead className="w-24">Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Sub-category</TableHead>
              <TableHead>Flags</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>}
            {!isLoading && !filtered?.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No accounts</TableCell></TableRow>}
            {filtered?.map((a: any) => (
              <TableRow key={a.id} className={!a.sub_category ? "bg-muted/30 font-semibold" : ""}>
                <TableCell className="font-mono text-xs">{a.code}</TableCell>
                <TableCell>{a.name}</TableCell>
                <TableCell>{getTypeBadge(a.account_type)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{a.sub_category || "—"}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {a.is_cash_account && <Badge variant="secondary" className="text-xs"><Wallet className="h-3 w-3 mr-1" />Cash</Badge>}
                    {a.is_bank_account && <Badge variant="secondary" className="text-xs"><Landmark className="h-3 w-3 mr-1" />Bank</Badge>}
                    {a.is_control_account && <Badge variant="secondary" className="text-xs">Control</Badge>}
                  </div>
                </TableCell>
                <TableCell><Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(a)}><Edit className="h-3 w-3" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </ERPLayout>
  );
}
