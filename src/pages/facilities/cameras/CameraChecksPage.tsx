import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { addMonths, eachDayOfInterval, endOfMonth, format, getDay, startOfMonth } from "date-fns";
import { Cctv, ChevronLeft, ChevronRight, Play } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { errorMessage, facilitiesCan, fmtDate, todayPk } from "@/lib/facilities";
import { checkDayTone, checkStatusMeta, loadChecks, startCheck, type CameraCheck } from "@/lib/facilitiesCameras";

const TONE: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  faults: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  missed: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  draft: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  none: "bg-muted text-muted-foreground",
};

/** The daily camera checks: this month's calendar and the list. */
export default function CameraChecksPage() {
  const navigate = useNavigate();
  const { roles } = useAuth();
  const { toast } = useToast();
  const canOperate = facilitiesCan(roles, "operate");
  const [month, setMonth] = useState(() => startOfMonth(new Date(todayPk())));
  const today = todayPk();

  const from = format(startOfMonth(month), "yyyy-MM-dd");
  const to = format(endOfMonth(month), "yyyy-MM-dd");
  const { data: checks = [], isLoading } = useQuery({ queryKey: ["facilities-camera-checks", from, to], queryFn: () => loadChecks(from, to) });
  const byDate = useMemo(() => new Map(checks.map((c) => [c.check_date, c])), [checks]);
  const todayCheck = byDate.get(today);

  const start = useMutation({
    mutationFn: () => startCheck(),
    onSuccess: (id) => navigate(`/facilities/cameras/checks/${id}`),
    onError: (e) => toast({ title: "Cannot start the check", description: errorMessage(e), variant: "destructive" }),
  });

  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });
  const lead = (getDay(startOfMonth(month)) + 6) % 7; // Monday first
  const missed = days.filter((d) => { const k = format(d, "yyyy-MM-dd"); return k < today && !byDate.get(k); }).length;

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader title="Camera Daily Check" description="One check a day: every camera and recorder, faults become equipment tickets" icon={Cctv}>
          <div className="flex gap-2">
            <Button variant="outline" asChild><Link to="/facilities/cameras">Cameras & recorders</Link></Button>
            {canOperate && (
              todayCheck ? (
                <Button onClick={() => navigate(`/facilities/cameras/checks/${todayCheck.id}`)}>
                  {todayCheck.status === "draft" ? "Continue today's check" : "Today's check"}
                </Button>
              ) : (
                <Button onClick={() => start.mutate()} disabled={start.isPending}><Play className="h-4 w-4 mr-1" /> Start today's check</Button>
              )
            )}
          </div>
        </PageHeader>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,360px)_1fr] gap-4">
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-base">{format(month, "MMMM yyyy")}</CardTitle>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-1 text-xs">
                {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => <div key={d} className="text-center text-muted-foreground py-1">{d}</div>)}
                {Array.from({ length: lead }).map((_, i) => <div key={`l${i}`} />)}
                {days.map((d) => {
                  const k = format(d, "yyyy-MM-dd");
                  const c = byDate.get(k);
                  const tone = checkDayTone(c, k < today);
                  const cell = (
                    <div className={cn("aspect-square rounded-md flex items-center justify-center tabular-nums", TONE[tone], k === today && "ring-2 ring-primary")}>
                      {format(d, "d")}
                    </div>
                  );
                  return c ? <Link key={k} to={`/facilities/cameras/checks/${c.id}`}>{cell}</Link> : <div key={k}>{cell}</div>;
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-3">Green all ok · amber faults · blue draft · red missed{missed > 0 ? ` (${missed} this month)` : ""}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Checks</CardTitle></CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>No.</TableHead><TableHead>Date</TableHead><TableHead>By</TableHead><TableHead className="text-right">Cameras</TableHead><TableHead className="text-right">Faults</TableHead><TableHead className="text-right">Recorder</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {isLoading ? <TableRow><TableCell colSpan={7} className="text-muted-foreground">Loading…</TableCell></TableRow>
                  : checks.length === 0 ? <TableRow><TableCell colSpan={7} className="text-muted-foreground">No checks this month.</TableCell></TableRow>
                  : checks.map((c: CameraCheck) => {
                    const m = checkStatusMeta(c.status);
                    return (
                      <TableRow key={c.id} className="cursor-pointer" onClick={() => navigate(`/facilities/cameras/checks/${c.id}`)}>
                        <TableCell className="font-mono text-xs">{c.check_number}</TableCell>
                        <TableCell>{fmtDate(c.check_date)}</TableCell>
                        <TableCell>{c.submitter?.full_name ?? c.creator?.full_name ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.camera_count}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.status === "draft" ? "—" : c.fault_count}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.status === "draft" ? "—" : c.recorder_fault_count}</TableCell>
                        <TableCell><Badge variant={m.variant}>{m.label}</Badge></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </ERPLayout>
  );
}
