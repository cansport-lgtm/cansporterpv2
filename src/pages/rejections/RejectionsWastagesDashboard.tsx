import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertOctagon, Recycle, Coins, Plus, BarChart3, ListChecks, Droplets, CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format, startOfMonth, startOfWeek, endOfWeek } from "date-fns";

export default function RejectionsWastagesDashboard() {
  const today = format(new Date(), "yyyy-MM-dd");
  const [periodMode, setPeriodMode] = useState<"today" | "week" | "month" | "custom">("month");
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);

  const { fromDate, toDate, label } = useMemo(() => {
    const now = new Date();
    switch (periodMode) {
      case "today":
        return { fromDate: today, toDate: today, label: "Today" };
      case "week": {
        const s = format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd");
        const e = format(endOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd");
        return { fromDate: s, toDate: e, label: "This Week" };
      }
      case "month": {
        const s = format(startOfMonth(now), "yyyy-MM-dd");
        return { fromDate: s, toDate: today, label: "Month to Date" };
      }
      case "custom":
        return { fromDate: customFrom, toDate: customTo, label: `${customFrom} – ${customTo}` };
    }
  }, [periodMode, today, customFrom, customTo]);

  const { data: rejData = [] } = useQuery({
    queryKey: ["dash-rej", fromDate, toDate],
    queryFn: async () => (await supabase.from("rw_rejections").select("rejected_qty,total_cost").gte("entry_date", fromDate).lte("entry_date", toDate)).data || [],
  });
  const { data: wstData = [] } = useQuery({
    queryKey: ["dash-wst", fromDate, toDate],
    queryFn: async () => (await supabase.from("rw_wastages").select("wasted_qty,total_cost").gte("entry_date", fromDate).lte("entry_date", toDate)).data || [],
  });
  const { data: lkgData = [] } = useQuery({
    queryKey: ["dash-lkg", fromDate, toDate],
    queryFn: async () => (await (supabase as any).from("rw_leakages").select("leaked_qty,total_cost").gte("entry_date", fromDate).lte("entry_date", toDate)).data || [],
  });
  const { data: reworkPending = [] } = useQuery({
    queryKey: ["dash-rework-pending"],
    queryFn: async () => (await supabase.from("rw_rejections").select("id").eq("disposition", "rework").neq("rework_status", "completed")).data || [],
  });

  const sum = (arr: any[], k: string) => arr.reduce((s, r) => s + Number(r[k] || 0), 0);

  const presets = [
    { key: "today" as const, label: "Today" },
    { key: "week" as const, label: "This Week" },
    { key: "month" as const, label: "Month" },
    { key: "custom" as const, label: "Custom" },
  ];

  return (
    <ERPLayout>
      <div className="w-full space-y-4">
        <PageHeader
          title="Rejections & Wastages"
          description="Live overview of factory rejections and material wastages"
          icon={AlertOctagon}
          iconColor="bg-amber-500 text-white"
        />

        <div className="flex flex-wrap gap-2">
          <Button asChild><Link to="/rejections/entry"><Plus className="h-4 w-4 mr-2" />New Entry</Link></Button>
          <Button variant="outline" asChild><Link to="/rejections/rework"><Recycle className="h-4 w-4 mr-2" />Rework ({reworkPending.length})</Link></Button>
          <Button variant="outline" asChild><Link to="/rejections/analytics"><BarChart3 className="h-4 w-4 mr-2" />Analytics</Link></Button>
          <Button variant="outline" asChild><Link to="/rejections/reasons"><ListChecks className="h-4 w-4 mr-2" />Reasons</Link></Button>
        </div>

        <Card>
          <CardContent className="p-3 md:p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CalendarDays className="h-4 w-4" />
              <span>Period</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {presets.map((p) => (
                <Button
                  key={p.key}
                  variant={periodMode === p.key ? "default" : "outline"}
                  size="sm"
                  onClick={() => setPeriodMode(p.key)}
                  className="text-xs h-9"
                >
                  {p.label}
                </Button>
              ))}
            </div>
            {periodMode === "custom" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">From</Label>
                  <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-10" />
                </div>
                <div>
                  <Label className="text-xs">To</Label>
                  <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-10" />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div>
          <h3 className="text-sm font-semibold mb-2 text-muted-foreground">{label}</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <MetricCard title="Rejected Qty" value={sum(rejData, "rejected_qty").toLocaleString()} icon={AlertOctagon} />
            <MetricCard title="Rejection Cost" value={`Rs. ${sum(rejData, "total_cost").toLocaleString()}`} icon={Coins} />
            <MetricCard title="Wasted Qty" value={sum(wstData, "wasted_qty").toLocaleString()} icon={Recycle} />
            <MetricCard title="Wastage Cost" value={`Rs. ${sum(wstData, "total_cost").toLocaleString()}`} icon={Coins} />
            <MetricCard title="Leakage Qty" value={sum(lkgData, "leaked_qty").toLocaleString()} icon={Droplets} />
            <MetricCard title="Leakage Cost" value={`Rs. ${sum(lkgData, "total_cost").toLocaleString()}`} icon={Coins} />
          </div>
        </div>
      </div>
    </ERPLayout>
  );
}
