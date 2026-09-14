import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Plus, LifeBuoy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import {
  TicketDetailDialog,
  HelpdeskTicket,
  CATEGORY_LABELS,
  STATUS_LABELS,
  statusBadgeVariant,
  priorityBadgeClass,
} from "@/components/helpdesk/TicketDetailDialog";

const emptyForm = {
  title: "",
  description: "",
  category: "bug",
  priority: "medium",
  page_or_module: "",
};

const HelpDeskPage = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [selectedTicket, setSelectedTicket] = useState<HelpdeskTicket | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ["helpdesk-tickets", "mine", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("helpdesk_tickets" as any)
        .select("*")
        .eq("requested_by", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any as HelpdeskTicket[];
    },
    enabled: !!user?.id,
  });

  const { data: userNames = {} } = useQuery({
    queryKey: ["helpdesk-user-names"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_users").select("id, full_name");
      if (error) throw error;
      return Object.fromEntries((data || []).map((u: any) => [u.id, u.full_name])) as Record<string, string>;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("helpdesk_tickets" as any).insert({
        title: form.title.trim(),
        description: form.description.trim(),
        category: form.category,
        priority: form.priority,
        page_or_module: form.page_or_module.trim() || null,
        requested_by: user!.id,
        ticket_number: "",
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ticket submitted — the admin has been notified");
      setIsDialogOpen(false);
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ["helpdesk-tickets"] });
    },
    onError: (e: any) => toast.error(e.message || "Failed to submit ticket"),
  });

  return (
    <ERPLayout>
      <PageHeader
        title="Help Desk"
        description="Report system bugs and issues to the admin"
      />

      <div className="mb-4 flex justify-end">
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New Ticket
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Report a Bug or Issue</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="hd-title">Title *</Label>
                <Input
                  id="hd-title"
                  value={form.title}
                  onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                  placeholder="Short summary of the problem"
                  maxLength={200}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Category</Label>
                  <Select value={form.category} onValueChange={(v) => setForm((p) => ({ ...p, category: v }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bug">Bug</SelectItem>
                      <SelectItem value="issue">Issue</SelectItem>
                      <SelectItem value="feature_request">Feature Request</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Priority</Label>
                  <Select value={form.priority} onValueChange={(v) => setForm((p) => ({ ...p, priority: v }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hd-page">Page / module where it happens (optional)</Label>
                <Input
                  id="hd-page"
                  value={form.page_or_module}
                  onChange={(e) => setForm((p) => ({ ...p, page_or_module: e.target.value }))}
                  placeholder="e.g. HR > Salary Sheet"
                  maxLength={120}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hd-desc">Description *</Label>
                <Textarea
                  id="hd-desc"
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="What happened? What did you expect? Steps to reproduce help a lot."
                  rows={5}
                />
              </div>
              <Button
                className="w-full"
                disabled={!form.title.trim() || !form.description.trim() || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? "Submitting..." : "Submit Ticket"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground text-center py-8">Loading your tickets...</p>
      ) : tickets.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <LifeBuoy className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>No tickets yet. Found a bug or facing an issue? Click "New Ticket" to report it.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {tickets.map((t) => (
            <Card
              key={t.id}
              className="cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => {
                setSelectedTicket(t);
                setDetailOpen(true);
              }}
            >
              <CardContent className="py-3 px-4 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-sm font-medium">{t.ticket_number}</span>
                <span className="flex-1 min-w-[200px] font-medium truncate">{t.title}</span>
                <Badge variant="outline">{CATEGORY_LABELS[t.category] || t.category}</Badge>
                <Badge className={priorityBadgeClass(t.priority)}>{t.priority}</Badge>
                <Badge variant={statusBadgeVariant(t.status)}>{STATUS_LABELS[t.status] || t.status}</Badge>
                <span className="text-xs text-muted-foreground">
                  {format(new Date(t.created_at), "dd MMM yyyy")}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <TicketDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        ticket={selectedTicket ? tickets.find((t) => t.id === selectedTicket.id) || selectedTicket : null}
        isAdmin={false}
        userNames={userNames}
      />
    </ERPLayout>
  );
};

export default HelpDeskPage;
