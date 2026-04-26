import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { Settings, CheckCircle, XCircle, AlertTriangle, Clock, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";

const STORAGE_KEY = "floor-display-processes";
const REFRESH_INTERVAL = 15000;

export default function FloorInspectionDisplayPage() {
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch { return []; }
  });
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL / 1000);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => {
      setCurrentTime(new Date());
      setCountdown(prev => (prev <= 1 ? REFRESH_INTERVAL / 1000 : prev - 1));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedIds));
  }, [selectedIds]);

  const { data: processes = [] } = useQuery({
    queryKey: ["floor-display-processes"],
    queryFn: async () => {
      const { data } = await supabase
        .from("qa_processes")
        .select("id, code, name")
        .eq("is_active", true)
        .order("sequence_order");
      return data || [];
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  const today = format(new Date(), "yyyy-MM-dd");

  const { data: inspections = [] } = useQuery({
    queryKey: ["floor-display-inspections", selectedIds, today],
    queryFn: async () => {
      if (!selectedIds.length) return [];
      const { data } = await supabase
        .from("qa_inspections")
        .select("id, process_id, result, inspection_date, created_at, inspector_id, shift, app_users:inspector_id(full_name)")
        .in("process_id", selectedIds)
        .eq("inspection_date", today)
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: selectedIds.length > 0,
    refetchInterval: REFRESH_INTERVAL,
  });

  const toggleProcess = useCallback((id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(processes.map((p: any) => p.id));
  }, [processes]);

  // Group inspections by process
  const processMap = new Map<string, any[]>();
  inspections.forEach((ins: any) => {
    const list = processMap.get(ins.process_id) || [];
    list.push(ins);
    processMap.set(ins.process_id, list);
  });

  const selectedProcesses = processes.filter((p: any) => selectedIds.includes(p.id));

  // Summary counts
  const totalInspections = inspections.length;
  const totalPass = inspections.filter((i: any) => i.result === "pass").length;
  const totalFail = inspections.filter((i: any) => i.result === "fail").length;

  const thirtyMinsAgo = new Date(currentTime.getTime() - 30 * 60 * 1000);

  const hasRecentInspection = (pInspections: any[]) =>
    pInspections.some((i: any) => new Date(i.created_at) >= thirtyMinsAgo);

  const getCardStyle = (pInspections: any[]) => {
    if (!pInspections || pInspections.length === 0) {
      return "bg-destructive text-destructive-foreground animate-pulse border-destructive";
    }
    if (!hasRecentInspection(pInspections)) {
      return "bg-orange-500 text-white animate-pulse border-orange-600";
    }
    const results = pInspections.map((i: any) => i.result);
    if (results.some((r: string) => r === "fail")) {
      return "bg-amber-500 text-white border-amber-600";
    }
    if (results.every((r: string) => r === "pass")) {
      return "bg-green-600 text-white border-green-700";
    }
    return "bg-card text-card-foreground border-border";
  };

  const formatCountdown = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="min-h-screen bg-background p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-3xl lg:text-4xl font-bold text-foreground">Production Floor — Inspection Status</h1>
          <p className="text-xl lg:text-2xl text-muted-foreground mt-1">{format(currentTime, "EEEE, dd MMMM yyyy")}</p>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-4xl lg:text-5xl font-mono font-bold text-foreground">{format(currentTime, "HH:mm:ss")}</div>
            <div className="text-sm text-muted-foreground flex items-center gap-1 justify-end mt-1">
              <Clock className="h-4 w-4" />
              Refresh in {formatCountdown(countdown)}
            </div>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon" className="h-12 w-12">
                <Settings className="h-6 w-6" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 max-h-96 overflow-y-auto" align="end">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-lg">Select Processes</h4>
                  <Button variant="ghost" size="sm" onClick={selectAll}>Select All</Button>
                </div>
                {processes.map((p: any) => (
                  <label key={p.id} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={selectedIds.includes(p.id)}
                      onCheckedChange={() => toggleProcess(p.id)}
                    />
                    <span className="font-medium">{p.code}</span>
                    <span className="text-muted-foreground text-sm truncate">— {p.name}</span>
                  </label>
                ))}
                {processes.length === 0 && <p className="text-muted-foreground text-sm">No processes found</p>}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Summary Bar */}
      {selectedIds.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="rounded-xl border-2 border-primary bg-primary/10 p-4 flex flex-col items-center justify-center">
            <Activity className="h-8 w-8 text-primary mb-1" />
            <span className="text-5xl lg:text-6xl font-bold text-primary">{totalInspections}</span>
            <span className="text-lg font-semibold text-primary/80 mt-1">Total Inspections</span>
          </div>
          <div className="rounded-xl border-2 border-green-600 bg-green-600/10 p-4 flex flex-col items-center justify-center">
            <CheckCircle className="h-8 w-8 text-green-600 mb-1" />
            <span className="text-5xl lg:text-6xl font-bold text-green-600">{totalPass}</span>
            <span className="text-lg font-semibold text-green-600/80 mt-1">Passed</span>
          </div>
          <div className="rounded-xl border-2 border-red-600 bg-red-600/10 p-4 flex flex-col items-center justify-center">
            <XCircle className="h-8 w-8 text-red-600 mb-1" />
            <span className="text-5xl lg:text-6xl font-bold text-red-600">{totalFail}</span>
            <span className="text-lg font-semibold text-red-600/80 mt-1">Failed</span>
          </div>
        </div>
      )}

      {/* No selection message */}
      {selectedIds.length === 0 && (
        <div className="flex items-center justify-center h-[60vh]">
          <div className="text-center">
            <Settings className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <p className="text-3xl text-muted-foreground">Click the ⚙️ button to select processes for this display</p>
          </div>
        </div>
      )}

      {/* Process Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {selectedProcesses.map((process: any) => {
          const pInspections = processMap.get(process.id) || [];
          const cardStyle = getCardStyle(pInspections);
          const latest = pInspections[0];
          const isNoToday = pInspections.length === 0;
          const hasRecent = hasRecentInspection(pInspections);
          const passCount = pInspections.filter((i: any) => i.result === "pass").length;
          const failCount = pInspections.filter((i: any) => i.result === "fail").length;

          return (
            <div
              key={process.id}
              className={`rounded-xl border-2 p-5 transition-all ${cardStyle}`}
            >
              {/* Process header */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-2xl lg:text-3xl font-bold">{process.code}</span>
              </div>
              <p className="text-2xl lg:text-3xl font-bold mb-3 truncate">{process.name}</p>

              {/* Big inspection count */}
              <div className="text-center mb-3">
                <span className="text-5xl lg:text-6xl font-bold">{pInspections.length}</span>
                <p className="text-sm font-medium opacity-80 mt-1">Inspections Today</p>
              </div>

              {/* Pass / Fail breakdown */}
              {!isNoToday && (
                <div className="flex items-center justify-center gap-6 mb-3">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle className="h-6 w-6" />
                    <span className="text-2xl font-bold">{passCount}</span>
                    <span className="text-sm opacity-80">Pass</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <XCircle className="h-6 w-6" />
                    <span className="text-2xl font-bold">{failCount}</span>
                    <span className="text-sm opacity-80">Fail</span>
                  </div>
                </div>
              )}

              {isNoToday ? (
                <div className="flex flex-col items-center gap-2 py-2">
                  <AlertTriangle className="h-10 w-10" />
                  <span className="text-2xl font-bold">NO INSPECTION</span>
                  <span className="text-base opacity-80">No inspections recorded today</span>
                </div>
              ) : !hasRecent ? (
                <div className="flex flex-col items-center gap-1 py-2">
                  <AlertTriangle className="h-8 w-8" />
                  <span className="text-lg font-bold">NO INSPECTION IN LAST 30 MIN</span>
                </div>
              ) : (
                <div className="space-y-1 text-sm">
                  <div className="flex items-center gap-2">
                    {latest.result === "pass" ? (
                      <CheckCircle className="h-5 w-5" />
                    ) : latest.result === "fail" ? (
                      <XCircle className="h-5 w-5" />
                    ) : (
                      <AlertTriangle className="h-5 w-5" />
                    )}
                    <span className="font-bold uppercase">{latest.result || "Pending"}</span>
                  </div>
                  <p className="opacity-90">Inspector: {(latest as any).app_users?.full_name || "—"}</p>
                  {latest.shift && <p className="opacity-80">Shift: {latest.shift}</p>}
                  <p className="opacity-70">Last: {format(new Date(latest.created_at), "hh:mm a")}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
