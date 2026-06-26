import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { DistributorOrderMenu } from "@/components/distributor/DistributorOrderMenu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ShoppingCart, Pencil, Trash2, Send, Eye } from "lucide-react";
import { toast } from "sonner";

export const ORDER_STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-500/10 text-gray-600 border-gray-300",
  submitted: "bg-blue-500/10 text-blue-600 border-blue-300",
  approved: "bg-emerald-500/10 text-emerald-600 border-emerald-300",
  rejected: "bg-red-500/10 text-red-600 border-red-300",
  dispatched: "bg-violet-500/10 text-violet-600 border-violet-300",
  delivered: "bg-teal-500/10 text-teal-600 border-teal-300",
  cancelled: "bg-gray-500/10 text-gray-500 border-gray-300",
};

export function OrderStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={ORDER_STATUS_BADGE[status] ?? ""}>
      {status}
    </Badge>
  );
}

interface OrderRow {
  id: string;
  order_number: string | null;
  status: string;
  order_date: string;
  required_date: string | null;
  total_amount: number;
  customer_id: string;
  distributor_customers: { name: string; code: string | null } | null;
}

const STATUS_FILTERS = ["all", "draft", "submitted", "approved", "rejected", "dispatched"];

export default function DistributorOrdersPage() {
  const queryClient = useQueryClient();
  const { canViewPrices, getDistributorScope } = useAuth();
  const { isCompany, distributorId } = getDistributorScope();
  const showPrices = canViewPrices();

  const [selectedDistributor, setSelectedDistributor] = useState<string | null>(distributorId);
  const activeDistributorId = isCompany ? selectedDistributor : distributorId;

  const [statusFilter, setStatusFilter] = useState("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorOrderId, setEditorOrderId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OrderRow | null>(null);

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
    queryKey: ["distributor_orders", activeDistributorId, statusFilter],
    enabled: !!activeDistributorId,
    queryFn: async () => {
      let q = supabase
        .from("distributor_orders")
        .select("id, order_number, status, order_date, required_date, total_amount, customer_id, distributor_customers(name, code)")
        .eq("distributor_id", activeDistributorId as string)
        .order("created_at", { ascending: false });
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as OrderRow[];
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (order: OrderRow) => {
      const { error } = await supabase
        .from("distributor_orders")
        .update({ status: "submitted", submitted_at: new Date().toISOString() })
        .eq("id", order.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distributor_orders"] });
      toast.success("Order submitted for approval");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to submit order"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("distributor_orders").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distributor_orders"] });
      toast.success("Order deleted");
      setDeleteTarget(null);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to delete order"),
  });

  const openNew = () => {
    setEditorOrderId(null);
    setEditorOpen(true);
  };
  const openEdit = (id: string) => {
    setEditorOrderId(id);
    setEditorOpen(true);
  };

  const columns = [
    { key: "order_number", header: "Order #", render: (o: OrderRow) => o.order_number ?? "—" },
    {
      key: "customer",
      header: "Customer",
      render: (o: OrderRow) => o.distributor_customers?.name ?? "—",
    },
    { key: "order_date", header: "Date" },
    {
      key: "status",
      header: "Status",
      render: (o: OrderRow) => <OrderStatusBadge status={o.status} />,
    },
    ...(showPrices
      ? [{
          key: "total_amount",
          header: "Total",
          render: (o: OrderRow) => Number(o.total_amount ?? 0).toLocaleString(),
        }]
      : []),
    {
      key: "actions",
      header: "Actions",
      render: (o: OrderRow) => {
        const editable = o.status === "draft" || o.status === "rejected";
        return (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => openEdit(o.id)}>
              {editable ? <Pencil className="h-3 w-3 mr-1" /> : <Eye className="h-3 w-3 mr-1" />}
              {editable ? "Edit" : "View"}
            </Button>
            {editable && (
              <Button variant="outline" size="sm" onClick={() => submitMutation.mutate(o)}>
                <Send className="h-3 w-3 mr-1" /> Submit
              </Button>
            )}
            {o.status === "draft" && (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setDeleteTarget(o)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <ERPLayout>
      <PageHeader
        title="Orders"
        description="Create orders for your customers and submit them for manager approval."
        icon={ShoppingCart}
        action={activeDistributorId ? { label: "New Order", onClick: openNew } : undefined}
      />

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-4 justify-between">
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
          <div className="w-full sm:w-48">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((s) => (
                  <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {!activeDistributorId ? (
          <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
            {isCompany
              ? "Select a distributor to view their orders."
              : "Your account is not linked to a distributor. Contact your administrator."}
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={orders}
            emptyMessage={isLoading ? "Loading..." : "No orders yet"}
          />
        )}
      </div>

      {activeDistributorId && (
        <DistributorOrderMenu
          open={editorOpen}
          onOpenChange={setEditorOpen}
          distributorId={activeDistributorId}
          orderId={editorOrderId}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Order</AlertDialogTitle>
            <AlertDialogDescription>
              Delete draft order <strong>{deleteTarget?.order_number}</strong>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ERPLayout>
  );
}
