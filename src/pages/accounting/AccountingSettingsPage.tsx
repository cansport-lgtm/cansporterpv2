import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Shield, AlertTriangle, Settings } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { invalidateAppSettingsCache } from "@/lib/accounting/appSettings";
import { format } from "date-fns";

const sb = supabase as any;

interface SettingRow {
  key: string;
  value: any;
  description: string | null;
  updated_at: string;
  updated_by: string | null;
}

const SETTING_KEYS = [
  {
    key: "accounting_autopost_enabled",
    label: "Accounting Auto-Post (master)",
    summary: "Master switch for ALL automatic GL postings — dispatch → AR/Sales, GRN → AP/Inventory, sales/purchase returns, periodic COGS, production output/consumption.",
    danger: "Turning this off halts every auto-posting flow. Manual vouchers still work, but P&L and inventory stop reflecting operations until re-enabled.",
  },
  {
    key: "perpetual_cogs_enabled",
    label: "Perpetual COGS (per-dispatch)",
    summary: "When enabled, every dispatch posts Dr COGS / Cr FG Inventory at qty × product.standard_cost.",
    danger: "Disable if you prefer monthly Periodic COGS instead. The master switch above must be ON for either mode to work.",
  },
];

export default function AccountingSettingsPage() {
  const queryClient = useQueryClient();
  const { user, hasRole } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  const [local, setLocal] = useState<Record<string, boolean>>({});

  const { data: rows, isLoading } = useQuery({
    queryKey: ["app-settings-list"],
    queryFn: async () => {
      const { data, error } = await sb.from("app_settings").select("*").in("key", SETTING_KEYS.map((s) => s.key));
      if (error) throw error;
      return (data || []) as SettingRow[];
    },
  });

  // Hydrate local state once the rows load
  useEffect(() => {
    if (!rows) return;
    const next: Record<string, boolean> = {};
    for (const r of rows) next[r.key] = !!r.value;
    setLocal(next);
  }, [rows]);

  const updateMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: boolean }) => {
      if (!isSuperAdmin) throw new Error("Super-admin role required");
      const { error } = await sb
        .from("app_settings")
        .update({ value: value as any, updated_by: user?.id || null })
        .eq("key", key);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      invalidateAppSettingsCache(vars.key);
      queryClient.invalidateQueries({ queryKey: ["app-settings-list"] });
      queryClient.invalidateQueries({ queryKey: ["app-setting"] });
      toast({ title: "Setting updated", description: `${vars.key} = ${vars.value}` });
    },
    onError: (e: any, vars) => {
      // revert local state on error
      const existing = rows?.find((r) => r.key === vars.key);
      if (existing) setLocal((s) => ({ ...s, [vars.key]: !!existing.value }));
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    },
  });

  const rowMap = new Map<string, SettingRow>();
  (rows || []).forEach((r) => rowMap.set(r.key, r));

  if (!isSuperAdmin) {
    return (
      <ERPLayout>
        <PageHeader title="Accounting Settings" description="Restricted area" />
        <Card>
          <CardContent className="p-6 flex items-center gap-3">
            <Shield className="h-5 w-5 text-amber-600" />
            <div>
              <div className="font-medium">Super-admin only</div>
              <div className="text-sm text-muted-foreground">These switches control system-wide accounting behaviour. Contact a super-admin if you need to change them.</div>
            </div>
          </CardContent>
        </Card>
      </ERPLayout>
    );
  }

  return (
    <ERPLayout>
      <PageHeader title="Accounting Settings" description="System-wide toggles for accounting auto-post. Super-admin only.">
        <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200">
          <Shield className="h-3 w-3 mr-1" />Super-admin
        </Badge>
      </PageHeader>

      <div className="space-y-4">
        {SETTING_KEYS.map((s) => {
          const row = rowMap.get(s.key);
          const currentValue = local[s.key] ?? !!row?.value;
          const updatedAt = row?.updated_at ? format(new Date(row.updated_at), "dd MMM yyyy HH:mm") : "—";
          return (
            <Card key={s.key}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span className="flex items-center gap-2"><Settings className="h-4 w-4" />{s.label}</span>
                  <Badge variant={currentValue ? "default" : "secondary"} className={currentValue ? "bg-green-600" : ""}>
                    {currentValue ? "ENABLED" : "DISABLED"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm text-muted-foreground">{s.summary}</div>

                {row?.description && row.description !== s.summary && (
                  <div className="text-xs text-muted-foreground italic">{row.description}</div>
                )}

                <div className="rounded border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-2 text-xs flex items-start gap-2">
                  <AlertTriangle className="h-3 w-3 mt-0.5 text-amber-600 shrink-0" />
                  <div>{s.danger}</div>
                </div>

                <div className="flex items-center justify-between border-t pt-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={currentValue}
                      disabled={isLoading || updateMutation.isPending}
                      onCheckedChange={(next) => {
                        setLocal((cur) => ({ ...cur, [s.key]: next }));
                        updateMutation.mutate({ key: s.key, value: next });
                      }}
                    />
                    <Label className="text-sm">{currentValue ? "Currently ON" : "Currently OFF"}</Label>
                  </div>
                  <div className="text-xs text-muted-foreground">Last changed: {updatedAt}</div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </ERPLayout>
  );
}
