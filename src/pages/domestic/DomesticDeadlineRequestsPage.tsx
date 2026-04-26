import { useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";

export default function DomesticDeadlineRequestsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [rejectDialog, setRejectDialog] = useState<any>(null);
  const [rejectNotes, setRejectNotes] = useState("");

  const { data: requests, isLoading } = useQuery({
    queryKey: ["deadline-change-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deadline_change_requests" as any)
        .select(`
          *,
          order:sales_orders!deadline_change_requests_order_id_fkey(order_number, customers(name, code)),
          requester:app_users!deadline_change_requests_requested_by_fkey(full_name),
          reviewer:app_users!deadline_change_requests_reviewed_by_fkey(full_name)
        `)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (request: any) => {
      // Update request status
      const { error: reqError } = await supabase
        .from("deadline_change_requests" as any)
        .update({
          status: "approved",
          reviewed_by: user?.id,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", request.id);
      if (reqError) throw reqError;

      // Update sales order deadline
      const { error: orderError } = await supabase
        .from("sales_orders")
        .update({ expected_dispatch_date: request.requested_deadline })
        .eq("id", request.order_id);
      if (orderError) throw orderError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deadline-change-requests"] });
      queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
      toast.success("Request approved — deadline updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      const { error } = await supabase
        .from("deadline_change_requests" as any)
        .update({
          status: "rejected",
          reviewed_by: user?.id,
          review_notes: notes || null,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deadline-change-requests"] });
      toast.success("Request rejected");
      setRejectDialog(null);
      setRejectNotes("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pendingRequests = requests?.filter((r: any) => r.status === "pending") || [];
  const historyRequests = requests?.filter((r: any) => r.status !== "pending") || [];

  const renderTable = (items: any[], showActions: boolean) => (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Order #</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Current Deadline</TableHead>
            <TableHead>Requested Deadline</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Requested By</TableHead>
            <TableHead>Date</TableHead>
            {showActions ? <TableHead>Actions</TableHead> : <TableHead>Status</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                No requests found
              </TableCell>
            </TableRow>
          ) : (
            items.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono">{r.order?.order_number || "-"}</TableCell>
                <TableCell>{r.order?.customers?.name || "-"}</TableCell>
                <TableCell>{format(new Date(r.current_deadline), "dd MMM yyyy")}</TableCell>
                <TableCell className="font-semibold">{format(new Date(r.requested_deadline), "dd MMM yyyy")}</TableCell>
                <TableCell className="max-w-[200px] truncate" title={r.reason}>{r.reason}</TableCell>
                <TableCell>{r.requester?.full_name || "-"}</TableCell>
                <TableCell>{format(new Date(r.created_at), "dd MMM yyyy")}</TableCell>
                {showActions ? (
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => approveMutation.mutate(r)}
                        disabled={approveMutation.isPending}
                      >
                        <Check className="h-4 w-4 mr-1" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setRejectDialog(r)}
                      >
                        <X className="h-4 w-4 mr-1" /> Reject
                      </Button>
                    </div>
                  </TableCell>
                ) : (
                  <TableCell>
                    <Badge className={r.status === "approved" ? "bg-green-500" : "bg-red-500"}>
                      {r.status}
                    </Badge>
                    {r.review_notes && (
                      <p className="text-xs text-muted-foreground mt-1">{r.review_notes}</p>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Deadline Change Requests"
          description="Review and manage dispatch deadline change requests"
        />

        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">
              Pending {pendingRequests.length > 0 && (
                <Badge className="ml-2 bg-amber-500">{pendingRequests.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
          <TabsContent value="pending" className="mt-4">
            {renderTable(pendingRequests, true)}
          </TabsContent>
          <TabsContent value="history" className="mt-4">
            {renderTable(historyRequests, false)}
          </TabsContent>
        </Tabs>
      </div>

      {/* Reject Dialog */}
      <Dialog open={!!rejectDialog} onOpenChange={() => { setRejectDialog(null); setRejectNotes(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Rejection Notes (optional)</Label>
              <Textarea
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                placeholder="Reason for rejection..."
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setRejectDialog(null); setRejectNotes(""); }}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => rejectMutation.mutate({ id: rejectDialog.id, notes: rejectNotes })}
                disabled={rejectMutation.isPending}
              >
                Reject
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
