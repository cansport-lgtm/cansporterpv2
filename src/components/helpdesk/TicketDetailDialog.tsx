import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

export interface HelpdeskTicket {
  id: string;
  ticket_number: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  page_or_module: string | null;
  requested_by: string;
  assigned_to: string | null;
  resolution_notes: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  requester_name?: string;
}

export const CATEGORY_LABELS: Record<string, string> = {
  bug: "Bug",
  issue: "Issue",
  feature_request: "Feature Request",
  other: "Other",
};

export const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
};

export const statusBadgeVariant = (status: string) =>
  status === "open" ? "destructive" : status === "in_progress" ? "default" : status === "resolved" ? "secondary" : "outline";

export const priorityBadgeClass = (priority: string) =>
  priority === "critical"
    ? "bg-red-600 text-white"
    : priority === "high"
    ? "bg-orange-500 text-white"
    : priority === "medium"
    ? "bg-yellow-500 text-black"
    : "bg-muted text-muted-foreground";

interface TicketDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: HelpdeskTicket | null;
  isAdmin: boolean;
  userNames: Record<string, string>;
}

export const TicketDetailDialog = ({ open, onOpenChange, ticket, isAdmin, userNames }: TicketDetailDialogProps) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [newComment, setNewComment] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");

  const { data: comments = [] } = useQuery({
    queryKey: ["helpdesk-comments", ticket?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("helpdesk_ticket_comments" as any)
        .select("*")
        .eq("ticket_id", ticket!.id)
        .order("created_at");
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: open && !!ticket?.id,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["helpdesk-tickets"] });
    queryClient.invalidateQueries({ queryKey: ["helpdesk-comments", ticket?.id] });
  };

  const addCommentMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("helpdesk_ticket_comments" as any).insert({
        ticket_id: ticket!.id,
        comment_text: newComment.trim(),
        created_by: user!.id,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      setNewComment("");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message || "Failed to add comment"),
  });

  const updateTicketMutation = useMutation({
    mutationFn: async (fields: Record<string, any>) => {
      const { error } = await supabase
        .from("helpdesk_tickets" as any)
        .update(fields as any)
        .eq("id", ticket!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ticket updated");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message || "Failed to update ticket"),
  });

  if (!ticket) return null;

  const handleStatusChange = (status: string) => {
    const fields: Record<string, any> = { status };
    if (status === "resolved" || status === "closed") {
      fields.resolved_at = new Date().toISOString();
      if (resolutionNotes.trim()) fields.resolution_notes = resolutionNotes.trim();
    }
    updateTicketMutation.mutate(fields);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{ticket.ticket_number}</span>
            <Badge variant={statusBadgeVariant(ticket.status)}>{STATUS_LABELS[ticket.status] || ticket.status}</Badge>
            <Badge className={priorityBadgeClass(ticket.priority)}>{ticket.priority}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <h3 className="font-semibold">{ticket.title}</h3>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap mt-1">{ticket.description}</p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">Category: </span>
              {CATEGORY_LABELS[ticket.category] || ticket.category}
            </div>
            <div>
              <span className="text-muted-foreground">Raised by: </span>
              {userNames[ticket.requested_by] || "-"}
            </div>
            {ticket.page_or_module && (
              <div>
                <span className="text-muted-foreground">Page/Module: </span>
                {ticket.page_or_module}
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Created: </span>
              {format(new Date(ticket.created_at), "dd MMM yyyy HH:mm")}
            </div>
          </div>

          {ticket.resolution_notes && (
            <div className="rounded-md border bg-muted/50 p-3 text-sm">
              <p className="font-medium mb-1">Resolution Notes</p>
              <p className="whitespace-pre-wrap">{ticket.resolution_notes}</p>
            </div>
          )}

          {isAdmin && ticket.status !== "closed" && (
            <div className="rounded-md border p-3 space-y-3">
              <p className="text-sm font-medium">Admin Actions</p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Status</Label>
                  <Select value={ticket.status} onValueChange={handleStatusChange}>
                    <SelectTrigger className="w-[150px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Priority</Label>
                  <Select value={ticket.priority} onValueChange={(v) => updateTicketMutation.mutate({ priority: v })}>
                    <SelectTrigger className="w-[130px]">
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
              <div className="space-y-1">
                <Label className="text-xs">Resolution notes (saved when marking resolved/closed)</Label>
                <Textarea
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  placeholder="What was done to fix this?"
                  rows={2}
                />
              </div>
            </div>
          )}

          <Separator />

          <div className="space-y-3">
            <p className="text-sm font-medium">Comments ({comments.length})</p>
            {comments.map((c: any) => (
              <div key={c.id} className="rounded-md border p-2.5 text-sm">
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span className="font-medium">{userNames[c.created_by] || "User"}</span>
                  <span>{format(new Date(c.created_at), "dd MMM yyyy HH:mm")}</span>
                </div>
                <p className="whitespace-pre-wrap">{c.comment_text}</p>
              </div>
            ))}
            <div className="flex gap-2">
              <Textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Write a comment..."
                rows={2}
                className="flex-1"
              />
              <Button
                size="sm"
                className="self-end"
                disabled={!newComment.trim() || addCommentMutation.isPending}
                onClick={() => addCommentMutation.mutate()}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
