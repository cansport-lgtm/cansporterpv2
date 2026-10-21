import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ClipboardList, Loader2, Plus } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { facilitiesCan, fcDb, fmtDate } from "@/lib/facilities";
import {
  OPEN_STATUSES, TICKET_SELECT, ageLabel, categoryLabel, priorityMeta, ticketStatusMeta, ticketWhere, type Ticket,
} from "@/lib/facilitiesEquipment";

type Tab = "open" | "mine" | "done" | "all";

/** Admin & Facilities → equipment tickets. Technicians see only what is assigned to them. */
export default function EquipmentTicketsPage() {
  const navigate = useNavigate();
  const { user, roles } = useAuth();
  const canOperate = facilitiesCan(roles, "operate");
  const technicianOnly = !canOperate && roles.some((r) => (r.role as string) === "facilities_technician");

  const [tab, setTab] = useState<Tab>(technicianOnly ? "mine" : "open");
  const [priority, setPriority] = useState("all");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");

  const { data: tickets = [], isLoading } = useQuery<Ticket[]>({
    queryKey: ["facilities-tickets", "list", user?.id, technicianOnly],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      let q = fcDb.from("facilities_tickets").select(TICKET_SELECT);
      if (technicianOnly) q = q.eq("assigned_to", user?.id);
      const { data, error } = await q.order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter((t) => {
      if (tab === "open" && !OPEN_STATUSES.includes(t.status)) return false;
      if (tab === "mine" && t.assigned_to !== user?.id) return false;
      if (tab === "done" && !(t.status === "done" || t.status === "closed")) return false;
      if (priority !== "all" && t.priority !== priority) return false;
      if (category !== "all" && t.category !== category) return false;
      if (!q) return true;
      return [t.ticket_number, t.title, t.description, t.location_text, t.equipment?.code, t.equipment?.name, t.assignee?.full_name, t.vendor_name]
        .some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [tickets, tab, priority, category, search, user?.id]);

  const openCount = tickets.filter((t) => OPEN_STATUSES.includes(t.status)).length;
  const mineCount = tickets.filter((t) => t.assigned_to === user?.id && OPEN_STATUSES.includes(t.status)).length;

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader title="Equipment Tickets" description="Faults and periodic service on office equipment, cameras and the building" icon={ClipboardList}>
          {canOperate && <Button variant="outline" onClick={() => navigate("/facilities/equipment")}>Equipment register</Button>}
          <Button onClick={() => navigate("/facilities/equipment/tickets/new")}><Plus className="h-4 w-4 mr-1" /> New ticket</Button>
        </PageHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            {!technicianOnly && <TabsTrigger value="open">Open{openCount ? ` (${openCount})` : ""}</TabsTrigger>}
            <TabsTrigger value="mine">Assigned to me{mineCount ? ` (${mineCount})` : ""}</TabsTrigger>
            <TabsTrigger value="done">Done</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-col sm:flex-row gap-2">
          <Input placeholder="Search number, title, equipment, assignee" value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-xs" />
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger className="sm:w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any priority</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any type</SelectItem>
              <SelectItem value="breakdown">Breakdown</SelectItem>
              <SelectItem value="preventive">Preventive service</SelectItem>
              <SelectItem value="cctv">CCTV</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No.</TableHead>
                  <TableHead>Equipment / where</TableHead>
                  <TableHead>Fault</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin inline" /></TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No tickets here.</TableCell></TableRow>
                ) : rows.map((t) => {
                  const s = ticketStatusMeta(t.status);
                  const p = priorityMeta(t.priority);
                  return (
                    <TableRow key={t.id} className="cursor-pointer" onClick={() => navigate(`/facilities/equipment/tickets/${t.id}`)}>
                      <TableCell className="font-mono text-sm whitespace-nowrap">{t.ticket_number}</TableCell>
                      <TableCell>
                        <div>{ticketWhere(t)}</div>
                        <div className="text-xs text-muted-foreground">{categoryLabel(t.category)}</div>
                      </TableCell>
                      <TableCell className="max-w-[320px]">
                        <div className="truncate">{t.title}</div>
                        <div className="text-xs text-muted-foreground">by {t.reporter?.full_name ?? "—"} · {fmtDate(t.created_at)}</div>
                      </TableCell>
                      <TableCell><Badge variant={p.variant}>{p.label}</Badge></TableCell>
                      <TableCell className="text-sm">{t.assignee?.full_name ?? t.vendor_name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-sm tabular-nums">{ageLabel(t.created_at, t.done_at)}</TableCell>
                      <TableCell><Badge variant={s.variant}>{s.label}</Badge></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
