import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Clock, Settings, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const REFRESH_INTERVAL = 15000;
const STORAGE_KEY = "hourly-production-floor-processes";
const DEPT_STORAGE_KEY = "hourly-production-floor-department";
function getHourLabel(h: number) {
  const start = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? "AM" : "PM";
  return `${start}:00 ${ampm}`;
}

export default function HourlyProductionFloorDisplay() {
  const [selectedDepartment, setSelectedDepartment] = useState<string>(() => {
    try { return localStorage.getItem(DEPT_STORAGE_KEY) || "all"; } catch { return "all"; }
  });
  const [selectedProcesses, setSelectedProcesses] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
  });
  const [showSettings, setShowSettings] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedProcesses));
  }, [selectedProcesses]);

  useEffect(() => {
    localStorage.setItem(DEPT_STORAGE_KEY, selectedDepartment);
  }, [selectedDepartment]);

  const today = format(new Date(), "yyyy-MM-dd");
  const currentHour = new Date().getHours();
  const checkHour = currentHour - 1;

  const { data: departments = [] } = useQuery({
    queryKey: ["departments-floor"],
    queryFn: async () => {
      const { data, error } = await supabase.from("production_departments").select("id, name").eq("is_active", true).order("name");
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const { data: processes = [] } = useQuery({
    queryKey: ["qa-processes-hourly", selectedDepartment],
    queryFn: async () => {
      let query = (supabase as any).from("qa_processes").select("id, name, code, department_id").eq("is_active", true).eq("is_hourly_tracked", true);
      if (selectedDepartment !== "all") {
        query = query.eq("department_id", selectedDepartment);
      }
      const { data, error } = await query.order("name");
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  const { data: entries = [] } = useQuery({
    queryKey: ["hourly-production-floor", today],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("hourly_production_entries").select("*").eq("entry_date", today);
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  useEffect(() => {
    if (selectedProcesses.length === 0 && processes.length > 0) {
      setSelectedProcesses(processes.map((p: any) => p.name));
    }
  }, [processes]);

  const displayProcesses = processes.filter((p: any) => selectedProcesses.includes(p.name));
  const totalToday = entries.reduce((s: number, e: any) => s + Number(e.quantity || 0), 0);
  const totalLastHour = entries.filter((e: any) => e.hour_slot === checkHour).reduce((s: number, e: any) => s + Number(e.quantity || 0), 0);

  const toggleProcess = (name: string) => {
    setSelectedProcesses((prev) => prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]);
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Clock className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Hourly Production Monitor</h1>
            <p className="text-muted-foreground text-sm">{format(currentTime, "EEEE, dd MMM yyyy — hh:mm:ss a")}</p>
          </div>
        </div>
        <Dialog open={showSettings} onOpenChange={setShowSettings}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm"><Settings className="h-4 w-4 mr-1" /> Settings</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Display Settings</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-medium mb-2 block">Department</Label>
                <Select value={selectedDepartment} onValueChange={(val) => {
                  setSelectedDepartment(val);
                  setSelectedProcesses([]);
                }}>
                  <SelectTrigger><SelectValue placeholder="All Departments" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Departments</SelectItem>
                    {departments.map((d: any) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium mb-2 block">Processes</Label>
                <div className="space-y-3 max-h-60 overflow-y-auto">
                  {processes.map((p: any) => (
                    <div key={p.id} className="flex items-center gap-2">
                      <Checkbox checked={selectedProcesses.includes(p.name)} onCheckedChange={() => toggleProcess(p.name)} />
                      <Label>{p.name}</Label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-muted rounded-xl p-4 text-center">
          <p className="text-sm text-muted-foreground">Today's Total</p>
          <p className="text-5xl font-bold">{totalToday.toLocaleString()}</p>
        </div>
        <div className="bg-muted rounded-xl p-4 text-center">
          <p className="text-sm text-muted-foreground">Last Hour ({getHourLabel(checkHour)})</p>
          <p className="text-5xl font-bold">{totalLastHour.toLocaleString()}</p>
        </div>
        <div className="bg-muted rounded-xl p-4 text-center">
          <p className="text-sm text-muted-foreground">Processes Active</p>
          <p className="text-5xl font-bold">{displayProcesses.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-4">
        {displayProcesses.map((proc: any) => {
          const procEntries = entries.filter((e: any) => e.process_name === proc.name);
          const todayTotal = procEntries.reduce((s: number, e: any) => s + Number(e.quantity || 0), 0);
          const lastHourEntries = procEntries.filter((e: any) => e.hour_slot === checkHour);
          const lastHourTotal = lastHourEntries.reduce((s: number, e: any) => s + Number(e.quantity || 0), 0);
          const completedHourEntries = procEntries.filter((e: any) => e.hour_slot < currentHour);
          const hasNoEntriesToday = completedHourEntries.length === 0 && checkHour >= 6;
          const hasNoEntriesLastHour = checkHour >= 6 && lastHourEntries.length === 0;

          // Group by worker
          const workerMap: Record<string, { today: number; lastHr: number }> = {};
          procEntries.forEach((e: any) => {
            const name = e.worker_name || "Unassigned";
            if (!workerMap[name]) workerMap[name] = { today: 0, lastHr: 0 };
            workerMap[name].today += Number(e.quantity || 0);
            if (e.hour_slot === checkHour) workerMap[name].lastHr += Number(e.quantity || 0);
          });
          const workers = Object.entries(workerMap)
            .map(([name, vals]) => ({ name, ...vals }))
            .sort((a, b) => b.today - a.today);

          let cardClass = "rounded-xl p-4 border-2 transition-all ";
          if (hasNoEntriesToday) {
            cardClass += "border-destructive bg-destructive/10 animate-pulse";
          } else if (hasNoEntriesLastHour) {
            cardClass += "border-yellow-500 bg-yellow-500/10 animate-pulse";
          } else {
            cardClass += "border-primary bg-primary/10";
          }

          const workerSection = workers.length > 0 && !hasNoEntriesToday && (
            <div className="mt-3 border-t border-border pt-2">
              <div className="flex justify-between text-[10px] text-muted-foreground font-medium mb-1 px-1">
                <span>Worker</span>
                <div className="flex gap-4">
                  <span>Today</span>
                  <span className="w-10 text-right">Last Hr</span>
                </div>
              </div>
              <div className="max-h-40 overflow-y-auto space-y-0.5">
                {workers.map((w) => (
                  <div key={w.name} className="flex justify-between items-center text-xs px-1 py-0.5 rounded hover:bg-muted/50">
                    <span className="truncate max-w-[45%] font-medium">{w.name}</span>
                    <div className="flex gap-4">
                      <span className="font-semibold">{w.today.toLocaleString()}</span>
                      <span className="w-10 text-right text-muted-foreground">{w.lastHr}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );

          return (
            <div key={proc.id} className={cardClass}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-lg truncate">{proc.name}</h3>
              </div>
              {hasNoEntriesToday ? (
                <div className="text-center py-4"><p className="text-3xl font-bold text-destructive">NO ENTRIES TODAY</p></div>
              ) : hasNoEntriesLastHour ? (
                <>
                  <p className="text-4xl font-bold text-center">{todayTotal.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground text-center mt-1">Today's total</p>
                  <div className="mt-2 text-center"><p className="text-sm font-semibold text-yellow-500">NO ENTRY LAST HOUR</p></div>
                  {workerSection}
                </>
              ) : (
                <>
                  <p className="text-4xl font-bold text-center">{todayTotal.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground text-center mt-1">Today's total</p>
                  <div className="mt-2 flex justify-center gap-4 text-sm">
                    <div className="text-center"><p className="font-semibold text-lg">{lastHourTotal}</p><p className="text-xs text-muted-foreground">Last hour</p></div>
                  </div>
                  {workerSection}
                </>
              )}
            </div>
          );
        })}
      </div>

      {displayProcesses.length === 0 && (
        <div className="text-center py-20 text-muted-foreground"><p className="text-xl">No processes configured</p><p>Add processes from the Hourly Entry page first</p></div>
      )}

      <div className="fixed bottom-4 right-4 flex items-center gap-2 text-xs text-muted-foreground bg-muted rounded-full px-3 py-1">
        <RefreshCw className="h-3 w-3 animate-spin" /> Auto-refresh: 15s
      </div>
    </div>
  );
}
