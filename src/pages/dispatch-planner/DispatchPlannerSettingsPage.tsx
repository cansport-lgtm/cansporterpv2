import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings } from "lucide-react";
import { toast } from "sonner";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { addDaysIso, dpDb, errorMessage, fetchSettings, fetchWorkingDays, fmtDay, todayPk } from "@/lib/dispatchPlanner";

type Form = { horizon_days: string; lead_time_days: string; stale_closing_days: string; sunday_off: boolean; use_public_holidays: boolean };

export default function DispatchPlannerSettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ["dp-settings"], queryFn: fetchSettings });
  const [form, setForm] = useState<Form | null>(null);
  useEffect(() => {
    if (settings && !form) {
      setForm({
        horizon_days: String(settings.horizon_days), lead_time_days: String(settings.lead_time_days),
        stale_closing_days: String(settings.stale_closing_days), sunday_off: settings.sunday_off, use_public_holidays: settings.use_public_holidays,
      });
    }
  }, [settings, form]);

  const today = todayPk();
  const { data: calendar = [] } = useQuery({ queryKey: ["dp-working-days", today, addDaysIso(today, 13)], queryFn: () => fetchWorkingDays(today, addDaysIso(today, 13)) });

  const save = useMutation({
    mutationFn: async (f: Form) => {
      const { error } = await dpDb.rpc("dispatch_planner_settings_save", {
        p_data: {
          horizon_days: Number(f.horizon_days), lead_time_days: Number(f.lead_time_days), stale_closing_days: Number(f.stale_closing_days),
          sunday_off: f.sunday_off, use_public_holidays: f.use_public_holidays,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dp-settings"] });
      queryClient.invalidateQueries({ queryKey: ["dp-working-days"] });
      queryClient.invalidateQueries({ queryKey: ["dp-suggest"] });
      toast.success("Settings saved");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const set = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f));

  return (
    <ERPLayout>
      <div className="w-full max-w-3xl space-y-4">
        <PageHeader title="Dispatch Planner Settings" description="How far ahead the planner looks, how long production needs, and which days count as working days. Super admin only." icon={Settings} />
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Planning rules</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {!form ? <p className="text-sm text-muted-foreground">Loading…</p> : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <Label>Horizon (days)</Label>
                    <Input type="number" min={1} max={90} value={form.horizon_days} onChange={(e) => set({ horizon_days: e.target.value })} />
                    <p className="text-xs text-muted-foreground">How many days ahead the dashboard and pending list look.</p>
                  </div>
                  <div className="space-y-1">
                    <Label>Lead time (working days)</Label>
                    <Input type="number" min={0} max={90} value={form.lead_time_days} onChange={(e) => set({ lead_time_days: e.target.value })} />
                    <p className="text-xs text-muted-foreground">One value for every department: a line with no stock is suggested this many working days from today.</p>
                  </div>
                  <div className="space-y-1">
                    <Label>Stale closing after (working days)</Label>
                    <Input type="number" min={0} max={30} value={form.stale_closing_days} onChange={(e) => set({ stale_closing_days: e.target.value })} />
                    <p className="text-xs text-muted-foreground">A planning item whose latest daily closing is older than this is flagged “stale stock”.</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-6">
                  <div className="flex items-center gap-2"><Switch checked={form.sunday_off} onCheckedChange={(v) => set({ sunday_off: v })} /><Label>Sunday is not a working day</Label></div>
                  <div className="flex items-center gap-2"><Switch checked={form.use_public_holidays} onCheckedChange={(v) => set({ use_public_holidays: v })} /><Label>Skip public holidays (HR → Public Holidays)</Label></div>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Segments: domestic sales orders only in this phase.</p>
                  <Button onClick={() => form && save.mutate(form)} disabled={save.isPending}>Save settings</Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Next 14 days as the planner sees them</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {calendar.map((d) => (
              <div key={d.day} className={cn("rounded-md border px-2 py-1 text-xs min-w-[92px]", d.is_working ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-muted text-muted-foreground")}>
                <div className="font-semibold">{fmtDay(d.day)}</div>
                <div>{d.is_working ? "working" : d.reason ?? "off"}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
