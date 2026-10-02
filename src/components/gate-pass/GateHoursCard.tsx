import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { startOfMonth } from "date-fns";
import { Clock, Siren } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { closedDaysText, errorMessage, fmtClock, gpDb, useGateHours } from "@/lib/gatePass";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Gate hours now (open / closed), after-hours requests this month, and the times (super admin edits). */
export function GateHoursCard() {
  const { roles } = useAuth();
  const isSuperAdmin = roles.some((r) => r.role === "super_admin");
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: hours } = useGateHours();
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({ sc: "", sg: "", oc: "", og: "", days: [] as number[] });

  useEffect(() => {
    if (hours) setForm({ sc: hours.sales_create_until, sg: hours.sales_gate_until, oc: hours.other_create_until, og: hours.other_gate_until, days: hours.closed_weekdays });
  }, [hours]);

  const { data: month = [] } = useQuery<{ emergency_status: string }[]>({
    queryKey: ["gate-pass-emergency-month"],
    queryFn: async () => {
      const { data, error } = await gpDb.from("gate_passes").select("emergency_status")
        .not("emergency_status", "is", null).gte("emergency_requested_at", startOfMonth(new Date()).toISOString());
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await gpDb.rpc("gate_pass_hours_save", {
        p_sales_create: form.sc, p_sales_gate: form.sg, p_other_create: form.oc, p_other_gate: form.og, p_closed_weekdays: form.days,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Gate hours saved" });
      setEdit(false);
      qc.invalidateQueries({ queryKey: ["gate-pass-hours"] });
    },
    onError: (e) => toast({ title: "Could not save", description: errorMessage(e), variant: "destructive" }),
  });

  if (!hours) return null;
  const rows = [
    { label: "Sales", create: hours.sales_create, gate: hours.sales_gate, cu: hours.sales_create_until, gu: hours.sales_gate_until },
    { label: "Other passes", create: hours.other_create, gate: hours.other_gate, cu: hours.other_create_until, gu: hours.other_gate_until },
  ];
  const count = (s: string) => month.filter((m) => m.emergency_status === s).length;

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4" /> Gate hours</CardTitle>
        {isSuperAdmin && !edit && <Button size="sm" variant="outline" onClick={() => setEdit(true)}>Change</Button>}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!edit ? (
          <>
            <div className="grid sm:grid-cols-2 gap-2">
              {rows.map((r) => (
                <div key={r.label} className="rounded-lg border p-3">
                  <div className="font-semibold">{r.label}</div>
                  <div className="text-xs text-muted-foreground">Make pass until {fmtClock(r.cu)} · leave gate until {fmtClock(r.gu)}</div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", r.create ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700")}>
                      {r.create ? "New passes closed" : "New passes open"}
                    </span>
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", r.gate ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700")}>
                      {r.gate ? "Gate closed" : "Gate open"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="text-xs text-muted-foreground">{closedDaysText(hours)} After hours, only a super admin's emergency approval lets a pass be made or leave.</div>
            <div className="flex items-center gap-2 text-xs">
              <Siren className="h-3.5 w-3.5 text-red-700" />
              Emergency requests this month: <b>{month.length}</b> · approved {count("approved")} · rejected {count("rejected")} · waiting {count("requested")}
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {([["sc", "Sales: make until"], ["sg", "Sales: gate until"], ["oc", "Others: make until"], ["og", "Others: gate until"]] as const).map(([k, l]) => (
                <div key={k}>
                  <Label htmlFor={`gh-${k}`} className="text-xs">{l}</Label>
                  <Input id={`gh-${k}`} type="time" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                </div>
              ))}
            </div>
            <div>
              <div className="text-xs font-medium mb-1">Closed days (no passes at all)</div>
              <div className="flex flex-wrap gap-3">
                {DAYS.map((d, i) => (
                  <label key={d} className="flex items-center gap-1.5 text-sm">
                    <Checkbox checked={form.days.includes(i)}
                      onCheckedChange={(c) => setForm({ ...form, days: c ? [...form.days, i].sort() : form.days.filter((x) => x !== i) })} />
                    {d}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEdit(false)}>Back</Button>
              <Button disabled={save.isPending} onClick={() => save.mutate()}>Save gate hours</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
