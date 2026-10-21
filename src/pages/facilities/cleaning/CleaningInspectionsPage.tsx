import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { format, subDays } from "date-fns";
import { ClipboardCheck, ListChecks, Plus, Settings2 } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, facilitiesCan, fcDb, fmtDate, fmtDateTime, todayPk } from "@/lib/facilities";
import {
  DUE_META, INSPECTION_SELECT, dueShifts, dueState, frequencyLabel, inspectionStatusMeta,
  loadAreas, startInspection, type Area, type Inspection, type InspectionShift,
} from "@/lib/facilitiesCleaning";

type Tab = "due" | "inspections";

export default function CleaningInspectionsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { roles } = useAuth();
  const canOperate = facilitiesCan(roles, "operate");
  const canManage = facilitiesCan(roles, "manage");
  const [tab, setTab] = useState<Tab>("due");
  const today = todayPk();
  const [from, setFrom] = useState(format(subDays(new Date(), 14), "yyyy-MM-dd"));
  const [to, setTo] = useState(today);

  const { data: areas = [] } = useQuery<Area[]>({ queryKey: ["facilities-areas", "active"], queryFn: () => loadAreas(true) });

  const { data: todays = [] } = useQuery<Inspection[]>({
    queryKey: ["facilities-inspections", "today", today],
    queryFn: async () => {
      const { data, error } = await fcDb.from("facilities_inspections").select(INSPECTION_SELECT).eq("inspection_date", today);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: list = [], isLoading } = useQuery<Inspection[]>({
    queryKey: ["facilities-inspections", "range", from, to],
    enabled: tab === "inspections",
    queryFn: async () => {
      const { data, error } = await fcDb.from("facilities_inspections").select(INSPECTION_SELECT)
        .gte("inspection_date", from).lte("inspection_date", to)
        .order("inspection_date", { ascending: false }).order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: openActions = 0 } = useQuery<number>({
    queryKey: ["facilities-cleaning-actions", "open-count"],
    queryFn: async () => {
      const { count, error } = await fcDb.from("facilities_cleaning_actions").select("id", { count: "exact", head: true }).eq("status", "open");
      if (error) throw error;
      return count ?? 0;
    },
  });

  const rows = useMemo(() => {
    const now = new Date();
    return areas.map((a) => {
    const needed = dueShifts(a, now);
    const mine = todays.filter((i) => i.area_id === a.id);
    const done = mine.filter((i) => i.status === "submitted").map((i) => i.shift);
    const draft = mine.find((i) => i.status === "draft");
    const state = dueState(needed, done, now);
    const nextShift: InspectionShift | null = needed.find((s) => !done.includes(s)) ?? null;
    const last = mine.filter((i) => i.status === "submitted").sort((x, y) => (y.submitted_at ?? "").localeCompare(x.submitted_at ?? ""))[0];
    return { area: a, state, nextShift, draft, last };
  });
  }, [areas, todays]);

  const counts = {
    done: rows.filter((r) => r.state === "done").length,
    due: rows.filter((r) => r.state === "due" || r.state === "partly").length,
    overdue: rows.filter((r) => r.state === "overdue").length,
  };

  const start = useMutation({
    mutationFn: ({ areaId, shift }: { areaId: string; shift: InspectionShift }) => startInspection(areaId, today, shift),
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["facilities-inspections"] });
      navigate(`/facilities/cleaning/${id}`);
    },
    onError: (e) => toast({ title: "Could not start", description: errorMessage(e), variant: "destructive" }),
  });

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader title="Office Cleaning Inspections" description="Areas inspected on their frequency; failed points become action items for the cleaning supervisor" icon={ClipboardCheck}>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate("/facilities/cleaning/actions")}>
              <ListChecks className="h-4 w-4 mr-1" /> Action items{openActions > 0 ? ` (${openActions})` : ""}
            </Button>
            {canManage && (
              <Button variant="outline" onClick={() => navigate("/facilities/cleaning/setup")}>
                <Settings2 className="h-4 w-4 mr-1" /> Areas &amp; checklists
              </Button>
            )}
            {canOperate && (
              <Button onClick={() => navigate("/facilities/cleaning/new")}>
                <Plus className="h-4 w-4 mr-1" /> New inspection
              </Button>
            )}
          </div>
        </PageHeader>

        <div className="grid grid-cols-3 gap-2 sm:max-w-md">
          <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Done today</div><div className="text-xl font-semibold tabular-nums">{counts.done}</div></CardContent></Card>
          <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Due</div><div className="text-xl font-semibold tabular-nums text-amber-700">{counts.due}</div></CardContent></Card>
          <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Overdue</div><div className="text-xl font-semibold tabular-nums text-red-700">{counts.overdue}</div></CardContent></Card>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            <TabsTrigger value="due">Due today</TabsTrigger>
            <TabsTrigger value="inspections">Inspections</TabsTrigger>
          </TabsList>
        </Tabs>

        {tab === "due" ? (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Area</TableHead>
                    <TableHead>Frequency</TableHead>
                    <TableHead>Last today</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead>Today</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No active areas yet.{canManage && <> Add them on <Link className="underline text-primary" to="/facilities/cleaning/setup">Areas &amp; checklists</Link>.</>}
                    </TableCell></TableRow>
                  )}
                  {rows.map(({ area, state, nextShift, draft, last }) => (
                    <TableRow key={area.id}>
                      <TableCell>
                        <div className="font-medium">{area.name}</div>
                        <div className="text-xs text-muted-foreground">{area.code}{area.location ? ` · ${area.location}` : ""}</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{frequencyLabel(area)}</TableCell>
                      <TableCell className="whitespace-nowrap">{last ? fmtDateTime(last.submitted_at) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{last?.score != null ? `${last.score}%` : "—"}</TableCell>
                      <TableCell><Badge variant={DUE_META[state].variant}>{DUE_META[state].label}</Badge></TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {draft ? (
                          <Button size="sm" variant="outline" asChild><Link to={`/facilities/cleaning/${draft.id}`}>Continue draft</Link></Button>
                        ) : canOperate && nextShift ? (
                          <Button size="sm" disabled={start.isPending} onClick={() => start.mutate({ areaId: area.id, shift: nextShift })}>
                            Inspect{area.frequency === "twice_daily" ? ` (${nextShift})` : ""}
                          </Button>
                        ) : last ? (
                          <Button size="sm" variant="ghost" asChild><Link to={`/facilities/cleaning/${last.id}`}>Open</Link></Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <div><Label htmlFor="cln-from">From</Label><Input id="cln-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
                <div><Label htmlFor="cln-to">To</Label><Input id="cln-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
              </div>
              <div className="overflow-x-auto -mx-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>No.</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Area</TableHead>
                      <TableHead>Inspector</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                      <TableHead className="text-right">Not OK</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>}
                    {!isLoading && list.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No inspections in this range.</TableCell></TableRow>}
                    {list.map((i) => {
                      const m = inspectionStatusMeta(i.status);
                      return (
                        <TableRow key={i.id} className="cursor-pointer" onClick={() => navigate(`/facilities/cleaning/${i.id}`)}>
                          <TableCell className="font-mono text-xs">{i.inspection_number}</TableCell>
                          <TableCell className="whitespace-nowrap">{fmtDate(i.inspection_date)}{i.area?.frequency === "twice_daily" ? ` · ${i.shift}` : ""}</TableCell>
                          <TableCell>{i.area?.name ?? "—"}</TableCell>
                          <TableCell>{i.inspector?.full_name ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{i.score != null ? `${i.score}%` : "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{i.not_ok_count}</TableCell>
                          <TableCell><Badge variant={m.variant}>{m.label}</Badge></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ERPLayout>
  );
}
