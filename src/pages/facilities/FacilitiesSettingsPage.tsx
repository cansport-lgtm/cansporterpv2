import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, loadSettings, rpc } from "@/lib/facilities";

/** Super admin: the module's few numbers (alarm time, alert windows). */
export default function FacilitiesSettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["facilities-settings"], queryFn: loadSettings });
  const [form, setForm] = useState({ camera_check_alarm_time: "11:00", amc_alert_days: "30", ticket_escalation_days: "3", sim_bill_due_day: "10" });
  useEffect(() => {
    if (!data) return;
    setForm({
      camera_check_alarm_time: data.camera_check_alarm_time.slice(0, 5),
      amc_alert_days: String(data.amc_alert_days),
      ticket_escalation_days: String(data.ticket_escalation_days),
      sim_bill_due_day: String(data.sim_bill_due_day),
    });
  }, [data]);

  const save = useMutation({
    mutationFn: () => rpc("facilities_settings_save", { p_data: form }),
    onSuccess: () => { toast({ title: "Settings saved" }); queryClient.invalidateQueries({ queryKey: ["facilities-settings"] }); },
    onError: (e) => toast({ title: "Not saved", description: errorMessage(e), variant: "destructive" }),
  });

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader title="Admin & Facilities Settings" description="Alarm time and alert windows" icon={Settings} />
        <Card className="max-w-xl">
          <CardHeader className="pb-2"><CardTitle className="text-base">Alerts</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="fs-alarm">Camera check alarm time (Pakistan time)</Label>
              <Input id="fs-alarm" type="time" value={form.camera_check_alarm_time} onChange={(e) => setForm({ ...form, camera_check_alarm_time: e.target.value })} />
              <p className="text-xs text-muted-foreground mt-1">If no check is submitted by this time, the facilities managers and officers are told.</p>
            </div>
            <div>
              <Label htmlFor="fs-amc">AMC / contract expiry alert (days before)</Label>
              <Input id="fs-amc" type="number" min={0} max={365} value={form.amc_alert_days} onChange={(e) => setForm({ ...form, amc_alert_days: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="fs-esc">Escalate a high-priority equipment ticket open longer than (days)</Label>
              <Input id="fs-esc" type="number" min={0} max={60} value={form.ticket_escalation_days} onChange={(e) => setForm({ ...form, ticket_escalation_days: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="fs-sim">SIM bill should be entered by (day of month)</Label>
              <Input id="fs-sim" type="number" min={1} max={28} value={form.sim_bill_due_day} onChange={(e) => setForm({ ...form, sim_bill_due_day: e.target.value })} />
            </div>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
