import { useEffect, useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addMonths, eachDayOfInterval, endOfMonth, format, isSameDay, isSameMonth, parseISO, startOfMonth, startOfWeek, endOfWeek } from "date-fns";
import { STATUS_COLORS } from "./constants";

export default function MarketingCalendarPage() {
  const [delivs, setDelivs] = useState<any[]>([]);
  const [channels, setChannels] = useState<{id:string;name:string}[]>([]);
  const [cursor, setCursor] = useState(new Date());

  useEffect(()=>{
    (async()=>{
      const [d, c] = await Promise.all([
        supabase.from("marketing_deliverables").select("id,title,publish_date,planned_end,channel_id,status"),
        supabase.from("marketing_channels").select("id,name"),
      ]);
      setDelivs(d.data||[]); setChannels(c.data||[]);
    })();
  },[]);

  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const days = eachDayOfInterval({ start: startOfWeek(monthStart), end: endOfWeek(monthEnd) });

  const itemsFor = (day: Date) =>
    delivs.filter(d => {
      const dt = d.publish_date || d.planned_end;
      return dt && isSameDay(parseISO(dt), day);
    });

  return (
    <ERPLayout>
      <PageHeader title="Content Calendar" description="Scheduled deliverables by date" icon={CalendarIcon} iconColor="bg-emerald-500 text-white">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={()=>setCursor(addMonths(cursor,-1))}><ChevronLeft className="h-4 w-4"/></Button>
          <span className="font-semibold w-32 text-center">{format(cursor,"MMMM yyyy")}</span>
          <Button variant="outline" size="icon" onClick={()=>setCursor(addMonths(cursor,1))}><ChevronRight className="h-4 w-4"/></Button>
          <Button variant="outline" size="sm" onClick={()=>setCursor(new Date())}>Today</Button>
        </div>
      </PageHeader>

      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-7 gap-1 mb-1 text-xs font-semibold text-muted-foreground uppercase">
            {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=><div key={d} className="p-2 text-center">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map((day,i) => {
              const dayItems = itemsFor(day);
              const inMonth = isSameMonth(day, cursor);
              const isToday = isSameDay(day, new Date());
              return (
                <div key={i} className={`border rounded-md p-1.5 min-h-[100px] ${inMonth?"bg-card":"bg-muted/30"} ${isToday?"ring-2 ring-primary":""}`}>
                  <div className={`text-xs font-semibold mb-1 ${inMonth?"":"text-muted-foreground"}`}>{format(day,"d")}</div>
                  <div className="space-y-0.5">
                    {dayItems.slice(0,3).map(d => (
                      <div key={d.id} className={`text-[10px] px-1.5 py-0.5 rounded border truncate ${STATUS_COLORS[d.status]}`} title={d.title}>
                        {d.title}
                      </div>
                    ))}
                    {dayItems.length>3 && <div className="text-[10px] text-muted-foreground pl-1.5">+{dayItems.length-3} more</div>}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            {Object.entries(STATUS_COLORS).map(([k,v])=>(
              <Badge key={k} variant="outline" className={v}>{k}</Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </ERPLayout>
  );
}
