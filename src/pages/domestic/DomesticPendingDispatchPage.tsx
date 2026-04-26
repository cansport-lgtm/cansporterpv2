import { useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Search, PackageX } from "lucide-react";
import { format } from "date-fns";

export default function DomesticPendingDispatchPage() {
  const [searchTerm, setSearchTerm] = useState("");

  // Fetch all domestic sales orders that are eligible for dispatch
  const { data: orders, isLoading } = useQuery({
    queryKey: ["domestic-orders-pending-dispatch"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_orders")
        .select(`
          id, order_number, order_date, status, shipping_address,
          customers(name, code),
          sales_order_items(id, quantity_dozens, quantity_dispatched, rate, products(code, name))
        `)
        .eq("sales_segment", "domestic")
        .in("status", ["confirmed", "in_production", "ready", "partially_dispatched"])
        .order("order_date", { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  // Fetch all dispatch_order links to know which orders have dispatches
  const { data: dispatchedOrderIds } = useQuery({
    queryKey: ["domestic-dispatched-order-ids"],
    queryFn: async () => {
      // Get order IDs from sales_dispatch_orders (multi-order dispatches)
      const { data: linkData, error: linkError } = await supabase
        .from("sales_dispatch_orders")
        .select("order_id");
      if (linkError) throw linkError;

      // Get order IDs from sales_dispatches.order_id (single-order dispatches)
      const { data: directData, error: directError } = await supabase
        .from("sales_dispatches")
        .select("order_id")
        .eq("sales_segment", "domestic")
        .not("order_id", "is", null);
      if (directError) throw directError;

      const ids = new Set<string>();
      linkData?.forEach((r) => { if (r.order_id) ids.add(r.order_id); });
      directData?.forEach((r) => { if (r.order_id) ids.add(r.order_id); });
      return ids;
    },
  });

  // Filter orders that have NO dispatch at all
  const pendingOrders = orders?.filter((o) => !dispatchedOrderIds?.has(o.id)) || [];

  const filtered = pendingOrders.filter((o) => {
    const term = searchTerm.toLowerCase();
    if (!term) return true;
    return (
      o.order_number?.toLowerCase().includes(term) ||
      (o.customers as any)?.name?.toLowerCase().includes(term) ||
      (o.customers as any)?.code?.toLowerCase().includes(term)
    );
  });

  const STATUS_COLORS: Record<string, string> = {
    confirmed: "bg-blue-500",
    in_production: "bg-purple-500",
    ready: "bg-green-500",
    partially_dispatched: "bg-amber-500",
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Orders Pending Dispatch"
          description="Domestic sales orders with no dispatch order created"
          icon={PackageX}
          iconColor="bg-orange-500 text-white"
        />

        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by order #, customer..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          <Badge variant="secondary" className="text-sm">
            {filtered.length} order{filtered.length !== 1 ? "s" : ""}
          </Badge>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <p className="text-sm text-muted-foreground text-center py-10">Loading...</p>
            ) : filtered.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Total Dzn</TableHead>
                    <TableHead className="text-right">Value (Rs.)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((order) => {
                    const items = (order.sales_order_items as any[]) || [];
                    const totalDzn = items.reduce((s, i) => s + (i.quantity_dozens || 0), 0);
                    const totalValue = items.reduce((s, i) => s + (i.quantity_dozens || 0) * (i.rate || 0), 0);
                    return (
                      <TableRow key={order.id}>
                        <TableCell className="font-medium">{order.order_number}</TableCell>
                        <TableCell>{format(new Date(order.order_date), "dd MMM yyyy")}</TableCell>
                        <TableCell>
                          <div>{(order.customers as any)?.name || "-"}</div>
                          <div className="text-xs text-muted-foreground">{(order.customers as any)?.code}</div>
                        </TableCell>
                        <TableCell>
                          <Badge className={`${STATUS_COLORS[order.status] || "bg-muted"} text-white`}>
                            {order.status?.replace(/_/g, " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{items.length}</TableCell>
                        <TableCell className="text-right">{totalDzn.toLocaleString()}</TableCell>
                        <TableCell className="text-right">Rs. {totalValue.toLocaleString()}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-10">
                All orders have dispatch orders created 🎉
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
