import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { AlertCircle, CheckCircle } from "lucide-react";
import { useAppSetting } from "@/hooks/useAppSetting";
import { Link } from "react-router-dom";

const sb = supabase as any;

// Slots used by the auto-posting helpers. Add new entries here as integrations grow.
const DEFAULT_SLOTS: { key: string; label: string; description: string; usedBy: string[] }[] = [
  // Phase 2A - Sales
  { key: "sales_revenue_domestic", label: "Sales Revenue (Domestic)", description: "Credited when goods leave on credit via Domestic Dispatch", usedBy: ["Phase 2A — Domestic Sales"] },
  { key: "accounts_receivable", label: "Accounts Receivable (Control)", description: "Debited at dispatch, credited on payment receipt", usedBy: ["Phase 2A — Domestic Sales"] },
  { key: "sales_returns", label: "Sales Returns", description: "Debited when a sales return / credit note is recorded", usedBy: ["future — domestic sales returns"] },
  { key: "default_cash", label: "Default Cash in Hand", description: "Default cash account for CRV / Cash Receipt flows", usedBy: ["future — payment receipts"] },
  { key: "default_bank", label: "Default Bank Account", description: "Default bank account for BRV / Bank Receipt flows", usedBy: ["future — payment receipts"] },
  // Phase 2B - Purchase
  { key: "accounts_payable", label: "Accounts Payable (Control)", description: "Credited at GRN, debited on supplier payment", usedBy: ["Phase 2B — Purchase"] },
  { key: "purchase_account_raw_material", label: "Purchase Dr — Raw Material", description: "Debited on GRN when PO category = raw_material", usedBy: ["Phase 2B — Purchase"] },
  { key: "purchase_account_office_supplies", label: "Purchase Dr — Office Supplies", description: "Debited on GRN when PO category = office_supplies", usedBy: ["Phase 2B — Purchase"] },
  { key: "purchase_account_general_supplies", label: "Purchase Dr — General Supplies", description: "Debited on GRN when PO category = general_supplies", usedBy: ["Phase 2B — Purchase"] },
  { key: "purchase_account_spare_maintenance", label: "Purchase Dr — Spare & Maintenance", description: "Debited on GRN when PO category = spare_maintenance", usedBy: ["Phase 2B — Purchase"] },
  { key: "purchase_returns", label: "Purchase Returns", description: "Credited when goods are returned to supplier (debit-note)", usedBy: ["future — purchase returns"] },
  // Phase 3a - Production
  { key: "raw_material_inventory", label: "Raw Material Inventory", description: "Credited when raw materials are consumed in production", usedBy: ["Phase 3a — Production"] },
  { key: "raw_material_consumed", label: "Raw Material Consumed (COGS)", description: "Debited when raw materials are consumed in production", usedBy: ["Phase 3a — Production"] },
  { key: "wip_inventory", label: "Work-in-Progress Inventory", description: "Used in WIP → FG postings", usedBy: ["future — FG receipt"] },
  { key: "finished_goods_inventory", label: "Finished Goods Inventory", description: "Used in WIP → FG postings", usedBy: ["future — FG receipt"] },
  { key: "cogs", label: "Cost of Goods Sold", description: "Used in COGS-at-sale posting", usedBy: ["future — sales COGS"] },
];

export default function DefaultAccountsPage() {
  const queryClient = useQueryClient();

  const { data: mappings } = useQuery({
    queryKey: ["accounting-default-accounts"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_default_accounts")
        .select("key, account_id, description, updated_at");
      if (error) throw error;
      const map: Record<string, any> = {};
      (data || []).forEach((row: any) => { map[row.key] = row; });
      return map;
    },
  });

  const { data: accounts } = useQuery({
    queryKey: ["accounting-default-accounts-coa"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_chart_of_accounts")
        .select("id, code, name, account_type")
        .eq("is_active", true)
        .not("sub_category", "is", null)
        .order("code");
      if (error) throw error;
      return data || [];
    },
  });

  const setMutation = useMutation({
    mutationFn: async ({ key, accountId }: { key: string; accountId: string }) => {
      const { error } = await sb
        .from("accounting_default_accounts")
        .upsert({ key, account_id: accountId, updated_at: new Date().toISOString() }, { onConflict: "key" });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["accounting-default-accounts"] });
      toast({ title: `Default updated: ${vars.key}` });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err?.message, variant: "destructive" }),
  });

  const { value: flagEnabled } = useAppSetting<boolean>("accounting_autopost_enabled", true);

  const missingCount = useMemo(() => {
    if (!mappings) return DEFAULT_SLOTS.length;
    return DEFAULT_SLOTS.filter((s) => !mappings[s.key]?.account_id).length;
  }, [mappings]);

  return (
    <ERPLayout>
      <PageHeader title="Default Accounts (Auto-posting)" description="Map named slots to actual accounts. Required before any auto-voucher fires.">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Auto-post flag:</span>
          {flagEnabled
            ? <Badge variant="default" className="bg-green-600"><CheckCircle className="h-3 w-3 mr-1" />ENABLED</Badge>
            : <Badge variant="secondary"><AlertCircle className="h-3 w-3 mr-1" />DISABLED</Badge>}
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Slots configured</div>
          <div className="text-2xl font-semibold">{DEFAULT_SLOTS.length - missingCount} / {DEFAULT_SLOTS.length}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Missing mappings</div>
          <div className={`text-2xl font-semibold ${missingCount === 0 ? "text-green-600" : "text-amber-600"}`}>{missingCount}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Auto-post master switch</div>
          <div className="text-sm mt-1">{flagEnabled ? "Currently ENABLED" : "Currently DISABLED"}</div>
          <div className="text-xs text-muted-foreground mt-1">
            Toggle from <Link to="/accounting/settings" className="text-primary hover:underline">Accounting Settings</Link> (super-admin).
          </div>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Account Mapping Slots</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slot</TableHead>
                <TableHead>Maps To</TableHead>
                <TableHead>Used By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DEFAULT_SLOTS.map((slot) => {
                const current = mappings?.[slot.key]?.account_id || "";
                return (
                  <TableRow key={slot.key}>
                    <TableCell>
                      <div className="font-medium text-sm">{slot.label}</div>
                      <div className="text-xs text-muted-foreground">{slot.description}</div>
                      <div className="text-[10px] font-mono text-muted-foreground mt-1">{slot.key}</div>
                    </TableCell>
                    <TableCell className="w-[380px]">
                      <Select value={current} onValueChange={(v) => setMutation.mutate({ key: slot.key, accountId: v })}>
                        <SelectTrigger><SelectValue placeholder="— pick an account —" /></SelectTrigger>
                        <SelectContent className="max-h-[400px]">
                          {(accounts || []).map((a: any) => (
                            <SelectItem key={a.id} value={a.id}>
                              <span className="font-mono text-xs mr-2">{a.code}</span>{a.name}
                              <span className="text-xs text-muted-foreground ml-2">({a.account_type})</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {slot.usedBy.map((u) => <Badge key={u} variant="outline" className="text-xs">{u}</Badge>)}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </ERPLayout>
  );
}
