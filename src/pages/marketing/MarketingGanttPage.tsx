import { useEffect, useMemo, useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { GanttChartSquare } from "lucide-react";
import { addDays, differenceInDays, format, parseISO, startOfMonth } from "date-fns";

interface Row { id:string; label:string; sub:string; start:string|null; end:string|null; actualStart:string|null; actualEnd:string|null; status:string; kind:"campaign"|"deliverable"|"event"; }

const STATUS_FILL: Record<string,string> = {
  "Draft": "#94a3b8", "In Progress": "#f59e0b", "Pending Approval": "#3b82f6",
  "Approved": "#10b981", "Rejected": "#ef4444", "Published": "#a855f7", "Closed": "#6b7280",
};

export default function MarketingGanttPage() {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [delivs, setDelivs] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [view, setView] = useState<"all"|"campaigns"|"deliverables"|"events">("all");

  useEffect(()=>{
    (async()=>{
      const [c, d, e] = await Promise.all([
        supabase.from("marketing_campaigns").select("*"),
        supabase.from("marketing_deliverables").select("*"),
        supabase.from("marketing_events").select("*"),
      ]);
      setCampaigns(c.data||[]); setDelivs(d.data||[]); setEvents(e.data||[]);
    })();
  }, []);

  const rows: Row[] = useMemo(() => {
    const all: Row[] = [];
    if (view==="all"||view==="campaigns") campaigns.forEach(c => all.push({ id:c.id, label:c.name, sub:c.campaign_number, start:c.planned_start, end:c.planned_end, actualStart:c.actual_start, actualEnd:c.actual_end, status:c.status, kind:"campaign" }));
    if (view==="all"||view==="deliverables") delivs.forEach(d => all.push({ id:d.id, label:d.title, sub:d.deliverable_number, start:d.planned_start, end:d.planned_end, actualStart:d.actual_start, actualEnd:d.actual_end, status:d.status, kind:"deliverable" }));
    if (view==="all"||view==="events") events.forEach(ev => all.push({ id:ev.id, label:ev.name, sub:ev.event_number, start:ev.planned_start, end:ev.planned_end, actualStart:ev.actual_start, actualEnd:ev.actual_end, status:ev.status, kind:"event" }));
    return all.filter(r => r.start && r.end).sort((a,b)=>(a.start||"").localeCompare(b.start||""));
  }, [campaigns, delivs, events, view]);

  const { minDate, totalDays } = useMemo(() => {
    if (rows.length===0) return { minDate: startOfMonth(new Date()), totalDays: 30 };
    const dates = rows.flatMap(r => [r.start, r.end, r.actualStart, r.actualEnd].filter(Boolean) as string[]).map(d=>parseISO(d));
    const minD = new Date(Math.min(...dates.map(d=>d.getTime())));
    const maxD = new Date(Math.max(...dates.map(d=>d.getTime())));
    return { minDate: minD, totalDays: Math.max(30, differenceInDays(maxD, minD) + 7) };
  }, [rows]);

  const dayWidth = 18;
  const rowHeight = 32;
  const headerHeight = 50;
  const labelWidth = 240;
  const svgWidth = labelWidth + totalDays * dayWidth + 20;
  const svgHeight = headerHeight + rows.length * rowHeight + 20;

  const monthMarkers = useMemo(() => {
    const arr: { x:number; label:string }[] = [];
    for (let i=0;i<totalDays;i++){
      const d = addDays(minDate,i);
      if (d.getDate() === 1) arr.push({ x: labelWidth + i*dayWidth, label: format(d,"MMM yy") });
    }
    return arr;
  }, [minDate, totalDays]);

  const today = new Date();
  const todayX = labelWidth + differenceInDays(today, minDate) * dayWidth;

  return (
    <ERPLayout>
      <PageHeader title="Marketing Gantt / Timeline" description="Planned vs actual across campaigns, deliverables and events" icon={GanttChartSquare} iconColor="bg-violet-500 text-white">
        <Select value={view} onValueChange={(v:any)=>setView(v)}>
          <SelectTrigger className="w-[180px]"><SelectValue/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="campaigns">Campaigns only</SelectItem>
            <SelectItem value="deliverables">Deliverables only</SelectItem>
            <SelectItem value="events">Events only</SelectItem>
          </SelectContent>
        </Select>
      </PageHeader>

      <Card>
        <CardContent className="p-4 overflow-x-auto">
          {rows.length === 0 ? <p className="text-sm text-muted-foreground p-6 text-center">No items with planned dates yet.</p> :
          <svg width={svgWidth} height={svgHeight} className="min-w-full">
            {/* Month headers */}
            {monthMarkers.map((m,i) => (
              <g key={i}>
                <line x1={m.x} y1={0} x2={m.x} y2={svgHeight} stroke="#e5e7eb" strokeWidth={1}/>
                <text x={m.x+4} y={20} fontSize={11} fill="#64748b" fontWeight={600}>{m.label}</text>
              </g>
            ))}
            {/* Today line */}
            {todayX >= labelWidth && todayX <= svgWidth && (
              <>
                <line x1={todayX} y1={headerHeight-10} x2={todayX} y2={svgHeight} stroke="#ef4444" strokeWidth={1.5} strokeDasharray="3,3"/>
                <text x={todayX+3} y={headerHeight-2} fontSize={10} fill="#ef4444" fontWeight={700}>TODAY</text>
              </>
            )}
            <line x1={labelWidth} y1={headerHeight} x2={svgWidth} y2={headerHeight} stroke="#cbd5e1" strokeWidth={1}/>

            {rows.map((r, i) => {
              const y = headerHeight + i * rowHeight + 4;
              const sX = labelWidth + differenceInDays(parseISO(r.start!), minDate) * dayWidth;
              const eX = labelWidth + (differenceInDays(parseISO(r.end!), minDate)+1) * dayWidth;
              const aSX = r.actualStart ? labelWidth + differenceInDays(parseISO(r.actualStart), minDate) * dayWidth : null;
              const aEX = r.actualEnd ? labelWidth + (differenceInDays(parseISO(r.actualEnd), minDate)+1) * dayWidth : null;
              const fill = STATUS_FILL[r.status] || "#94a3b8";
              return (
                <g key={r.id}>
                  <rect x={0} y={y-2} width={svgWidth} height={rowHeight-2} fill={i%2===0?"#f8fafc":"transparent"}/>
                  <text x={8} y={y+16} fontSize={11} fill="#0f172a" fontWeight={500}>
                    {r.label.length>28?r.label.slice(0,28)+"…":r.label}
                  </text>
                  <text x={8} y={y+27} fontSize={9} fill="#94a3b8" fontFamily="monospace">{r.sub} • {r.kind}</text>
                  {/* Planned bar (outline) */}
                  <rect x={sX} y={y+4} width={Math.max(2, eX-sX)} height={10} fill={fill} opacity={0.35} rx={2}/>
                  {/* Actual bar (solid, narrower) */}
                  {aSX!==null && aEX!==null && (
                    <rect x={aSX} y={y+15} width={Math.max(2, aEX-aSX)} height={6} fill={fill} rx={2}/>
                  )}
                </g>
              );
            })}
          </svg>
          }
          <div className="mt-4 flex flex-wrap gap-3 text-xs">
            {Object.entries(STATUS_FILL).map(([k,v]) => (
              <div key={k} className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded" style={{background:v}}/>{k}</div>
            ))}
            <div className="flex items-center gap-1.5 ml-3 text-muted-foreground">Planned (light) · Actual (solid)</div>
          </div>
        </CardContent>
      </Card>
    </ERPLayout>
  );
}
