import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Inbox, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  TicketDetailDialog,
  HelpdeskTicket,
  CATEGORY_LABELS,
  STATUS_LABELS,
  statusBadgeVariant,
  priorityBadgeClass,
} from "@/components/helpdesk/TicketDetailDialog";

const HelpDeskAdminPage = () => {
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTicket, setSelectedTicket] = useState<HelpdeskTicket | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ["helpdesk-tickets", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("helpdesk_tickets" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any as HelpdeskTicket[];
    },
  });

  const { data: userNames = {} } = useQuery({
    queryKey: ["helpdesk-user-names"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_users").select("id, full_name");
      if (error) throw error;
      return Object.fromEntries((data || []).map((u: any) => [u.id, u.full_name])) as Record<string, string>;
    },
  });

  const filtered = tickets.filter((t) => {
    const matchesStatus = statusFilter === "all" || t.status === statusFilter;
    const q = searchTerm.toLowerCase();
    const matchesSearch =
      !q ||
      t.ticket_number.toLowerCase().includes(q) ||
      t.title.toLowerCase().includes(q) ||
      (userNames[t.requested_by] || "").toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  const counts = {
    open: tickets.filter((t) => t.status === "open").length,
    in_progress: tickets.filter((t) => t.status === "in_progress").length,
    resolved: tickets.filter((t) => t.status === "resolved").length,
    closed: tickets.filter((t) => t.status === "closed").length,
  };

  return (
    <ERPLayout>
      <PageHeader
        title="Help Desk — Manage Tickets"
        description="Bugs and issues reported by system users"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MetricCard title="Open" value={counts.open.toString()} icon={Inbox} />
        <MetricCard title="In Progress" value={counts.in_progress.toString()} icon={Loader2} />
        <MetricCard title="Resolved" value={counts.resolved.toString()} icon={CheckCircle2} />
        <MetricCard title="Closed" value={counts.closed.toString()} icon={XCircle} />
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <Input
          placeholder="Search by ticket no, title or user..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-[280px]"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ticket #</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Raised By</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  Loading tickets...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No tickets found
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((t) => (
                <TableRow
                  key={t.id}
                  className="cursor-pointer"
                  onClick={() => {
                    setSelectedTicket(t);
                    setDetailOpen(true);
                  }}
                >
                  <TableCell className="font-mono font-medium">{t.ticket_number}</TableCell>
                  <TableCell className="max-w-[280px] truncate">{t.title}</TableCell>
                  <TableCell>{CATEGORY_LABELS[t.category] || t.category}</TableCell>
                  <TableCell>
                    <Badge className={priorityBadgeClass(t.priority)}>{t.priority}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(t.status)}>{STATUS_LABELS[t.status] || t.status}</Badge>
                  </TableCell>
                  <TableCell>{userNames[t.requested_by] || "-"}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {format(new Date(t.created_at), "dd MMM yyyy")}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <TicketDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        ticket={selectedTicket ? tickets.find((t) => t.id === selectedTicket.id) || selectedTicket : null}
        isAdmin={true}
        userNames={userNames}
      />
    </ERPLayout>
  );
};

export default HelpDeskAdminPage;
