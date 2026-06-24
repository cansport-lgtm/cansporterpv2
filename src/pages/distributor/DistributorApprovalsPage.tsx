import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { OrderEditorDialog } from "@/components/distributor/OrderEditorDialog";
import { OrderStatusBadge } from "./DistributorOrdersPage";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ClipboardCheck, Check, X, Pencil } from "lucide-react";
import { toast } from "sonner";

interface PendingOrder {
  id: string;
  order_number: string | null;
  status: string;
  order_date: string;
  required_date: string | null;
  total_amount: number;
  notes: string | null;
  distributor_customers: { name: string; code: string | null } | null;
}

function OrderItemsExpand({ orderId, showPrices }: { orderId: string; showPrices: boolean }) {
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["distributor_order_items_view", orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributor_order_items")
        .select("id, product_name, quantity, unit, price, amount, remarks")
        .eq("order_id", orderId)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">Loading lines…</div>;
  if (!items.length) return <div className="p-4 text-sm text-muted-foreground">No lines.</div>;

  return (
    <div className="p-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-muted-foreground">
            <th className="py-1">Product</th>
            <th className="py-1">Qty</th>
            <th className="py-1">Unit</th>
            {showPrices && <th className="py-1">Price</th>}
            {showPrices && <th className="py-1">Amount</th>}
            <th className="py-1">Remarks</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-t">
              <td className="py-1">{it.product_name}</td>
              <td className="py-1">{Number(it.quantity ?? 0).toLocaleString()}</td>
              <td className="py-1">{it.unit ?? "—"}</td>
              {showPrices && <td className="py-1">{Number(it.price ?? 0).toLocaleString()}</td>}
              {showPrices && <td className="py-1">{Number(it.amount ?? 0).toLocaleString()}</td>}
              <td className="py-1">{it.remarks ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DistributorApprovalsPage() {
  const queryClient = useQueryClient();
  const { user, canViewPrices, getDistributorScope } = useAuth();
  const { isCompany, distributorId } = getDistributorScope();
  const showPrices = canViewPrices();

  const [selectedDistributor, setSelectedDistributor] = useState<string | null>(distributorId);
  const activeDistributorId = isCompany ? selectedDistributor : distributorId;

  const [rejectTarget, setRejectTarget] = useState<PendingOrder | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorOrderId, setEditorOrderId] = useState<string | null>(null);

  const { data: distributors = [] } = useQuery({
    queryKey: ["distributors-active"],
    enabled: isCompany,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributors")
        .select("id, name, code")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["distributor_orders", activeDistributorId, "submitted"],
    enabled: !!activeDistributorId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributor_orders")
        .select("id, order_number, status, order_date, required_date, total_amount, notes, distributor_customers(name, code)")
        .eq("distributor_id", activeDistributorId as string)
        .eq("status", "submitted")
        .order("submitted_at", { ascending: true });
      if (error) throw error;
      return data as unknown as PendingOrder[];
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (order: PendingOrder) => {
      const { error } = await supabase
        .from("distributor_orders")
        .update({
          status: "approved",
          approved_by: user?.id ?? null,
          approved_at: new Date().toISOString(),
        })
        .eq("id", order.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distributor_orders"] });
      toast.success("Order approved");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to approve order"),
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      if (!rejectTarget) return;
      if (!rejectReason.trim()) throw new Error("Please enter a reason");
      const { error } = await supabase
        .from("distributor_orders")
        .update({
          status: "rejected",
          rejected_by: user?.id ?? null,
          rejected_at: new Date().toISOString(),
          rejection_reason: rejectReason.trim(),
        })
        .eq("id", rejectTarget.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distributor_orders"] });
      toast.success("Order rejected");
      setRejectTarget(null);
      setRejectReason("");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to reject order"),
  });

  const columns = [
    { key: "order_number", header: "Order #", render: (o: PendingOrder) => o.order_number ?? "—" },
    { key: "customer", header: "Customer", render: (o: PendingOrder) => o.distributor_customers?.name ?? "—" },
    { key: "order_date", header: "Date" },
    { key: "status", header: "Status", render: (o: PendingOrder) => <OrderStatusBadge status={o.status} /> },
    ...(showPrices
      ? [{ key: "total_amount", header: "Total", render: (o: PendingOrder) => Number(o.total_amount ?? 0).toLocaleString() }]
      : []),
    {
      key: "actions",
      header: "Actions",
      render: (o: PendingOrder) => (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() => approveMutation.mutate(o)}
          >
            <Check className="h-3 w-3 mr-1" /> Approve
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => { setRejectTarget(o); setRejectReason(""); }}
          >
            <X className="h-3 w-3 mr-1" /> Reject
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setEditorOrderId(o.id); setEditorOpen(true); }}>
            <Pencil className="h-3 w-3 mr-1" /> Edit
          </Button>
        </div>
      ),
    },
  ];

  return (
    <ERPLayout>
      <PageHeader
        title="Approvals"
        description="Review submitted orders. Approve, reject with a reason, or edit before approving."
        icon={ClipboardCheck}
      />

      <div className="space-y-4">
        {isCompany && (
          <div className="w-full sm:w-72">
            <Select value={selectedDistributor ?? ""} onValueChange={(v) => setSelectedDistributor(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select a distributor..." />
              </SelectTrigger>
              <SelectContent>
                {distributors.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name} ({d.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {!activeDistributorId ? (
          <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
            {isCompany
              ? "Select a distributor to review their pending orders."
              : "Your account is not linked to a distributor. Contact your administrator."}
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={orders}
            emptyMessage={isLoading ? "Loading..." : "No orders awaiting approval"}
            expandedRowRender={(o) => <OrderItemsExpand orderId={o.id} showPrices={showPrices} />}
          />
        )}
      </div>

      {activeDistributorId && (
        <OrderEditorDialog
          open={editorOpen}
          onOpenChange={setEditorOpen}
          distributorId={activeDistributorId}
          orderId={editorOrderId}
          managerEdit
        />
      )}

      <Dialog open={!!rejectTarget} onOpenChange={(o) => { if (!o) { setRejectTarget(null); setRejectReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Order</DialogTitle>
            <DialogDescription>
              Reject order <strong>{rejectTarget?.order_number}</strong>? The sales rep can fix and resubmit it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="reason">Reason</Label>
            <Textarea id="reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} placeholder="Why is this order being rejected?" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectTarget(null); setRejectReason(""); }}>Cancel</Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => rejectMutation.mutate()}
              disabled={rejectMutation.isPending}
            >
              Reject Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
