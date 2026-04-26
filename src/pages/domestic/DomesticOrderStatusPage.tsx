import { useState, useEffect } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, differenceInDays } from "date-fns";
import { AlertTriangle, Package, Clock, CheckCircle, TrendingUp, Calendar, Printer, ChevronDown, ChevronRight } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  confirmed: 'bg-blue-500',
  in_production: 'bg-amber-500',
  ready: 'bg-cyan-500',
  partially_dispatched: 'bg-purple-500',
  dispatched: 'bg-green-500',
  delivered: 'bg-emerald-600',
  cancelled: 'bg-red-500',
};

const ACTIVE_STATUSES = ['confirmed', 'in_production', 'ready', 'partially_dispatched'];

export default function DomesticOrderStatusPage() {
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();

  // Realtime subscription to refresh on order status changes
  useEffect(() => {
    const channel = supabase
      .channel('order-status-board')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sales_orders' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['domestic-orders-status'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  // Fetch all domestic orders
  const { data: orders, isLoading: ordersLoading } = useQuery({
    queryKey: ['domestic-orders-status'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_orders')
        .select(`*, customers(name, code)`)
        .eq('sales_segment', 'domestic')
        .order('expected_dispatch_date', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data;
    },
  });

  // Fetch all order items with products
  const allOrderIds = orders?.map(o => o.id) || [];
  const { data: allItems } = useQuery({
    queryKey: ['domestic-order-items-status', allOrderIds.join(',')],
    queryFn: async () => {
      if (allOrderIds.length === 0) return [];
      const { data, error } = await supabase
        .from('sales_order_items')
        .select(`*, products(code, name)`)
        .in('order_id', allOrderIds);
      if (error) throw error;
      return data;
    },
    enabled: allOrderIds.length > 0,
  });

  // Active orders only
  const activeOrders = orders?.filter(o => ACTIVE_STATUSES.includes(o.status)) || [];
  const filteredOrders = statusFilter === 'active'
    ? activeOrders
    : statusFilter === 'all'
      ? orders || []
      : orders?.filter(o => o.status === statusFilter) || [];

  // Item-wise demand accumulation (only active orders)
  const demandMap = new Map<string, { code: string; name: string; totalDozens: number; orderCount: number; pendingDozens: number; orders: { orderNumber: string; customerName: string; qty: number; pending: number }[] }>();
  const activeOrderIds = new Set(activeOrders.map(o => o.id));

  allItems?.forEach((item: any) => {
    if (!activeOrderIds.has(item.order_id)) return;
    const key = item.product_id;
    const existing = demandMap.get(key);
    const dispatched = item.quantity_dispatched || 0;
    const pending = Math.max(0, (item.quantity_dozens || 0) - dispatched);
    const parentOrder = orders?.find(o => o.id === item.order_id);
    const orderDetail = { orderNumber: parentOrder?.order_number || '', customerName: (parentOrder?.customers as any)?.name || '', qty: item.quantity_dozens || 0, pending };
    if (existing) {
      existing.totalDozens += item.quantity_dozens || 0;
      existing.pendingDozens += pending;
      existing.orderCount += 1;
      existing.orders.push(orderDetail);
    } else {
      demandMap.set(key, {
        code: item.products?.code || '',
        name: item.products?.name || '',
        totalDozens: item.quantity_dozens || 0,
        pendingDozens: pending,
        orderCount: 1,
        orders: [orderDetail],
      });
    }
  });

  const demandList = Array.from(demandMap.entries()).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.pendingDozens - a.pendingDozens);

  const toggleProduct = (id: string) => {
    setExpandedProducts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Upcoming deadlines (active orders with dispatch deadline)
  const today = new Date();
  const upcomingDeadlines = activeOrders
    .filter(o => o.expected_dispatch_date)
    .map(o => ({
      ...o,
      daysLeft: differenceInDays(new Date(o.expected_dispatch_date!), today),
      itemCount: allItems?.filter((i: any) => i.order_id === o.id).length || 0,
      totalDozens: allItems?.filter((i: any) => i.order_id === o.id).reduce((s: number, i: any) => s + (i.quantity_dozens || 0), 0) || 0,
    }))
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const overdueCount = upcomingDeadlines.filter(d => d.daysLeft < 0).length;
  const dueSoonCount = upcomingDeadlines.filter(d => d.daysLeft >= 0 && d.daysLeft <= 3).length;

  // Status summary
  const statusSummary = {
    confirmed: orders?.filter(o => o.status === 'confirmed').length || 0,
    in_production: orders?.filter(o => o.status === 'in_production').length || 0,
    ready: orders?.filter(o => o.status === 'ready').length || 0,
    partially_dispatched: orders?.filter(o => o.status === 'partially_dispatched').length || 0,
    dispatched: orders?.filter(o => o.status === 'dispatched').length || 0,
  };

  const totalActiveDozens = demandList.reduce((s, d) => s + d.totalDozens, 0);
  const totalPendingDozens = demandList.reduce((s, d) => s + d.pendingDozens, 0);

  const handlePrint = () => {
    const printContent = `
      <html>
      <head>
        <title>Order Status Board - ${format(today, 'dd MMM yyyy')}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; font-size: 12px; }
          h1 { font-size: 18px; margin-bottom: 4px; }
          h2 { font-size: 14px; margin: 16px 0 8px; border-bottom: 2px solid #333; padding-bottom: 4px; }
          .subtitle { color: #666; font-size: 11px; margin-bottom: 16px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
          th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
          th { background: #f0f0f0; font-weight: bold; font-size: 11px; }
          .text-right { text-align: right; }
          .text-center { text-align: center; }
          .summary-row { background: #f5f5f5; font-weight: bold; }
          .overdue { color: #dc2626; font-weight: bold; }
          .due-soon { color: #ea580c; }
          .stats { display: flex; gap: 20px; margin-bottom: 16px; flex-wrap: wrap; }
          .stat-box { border: 1px solid #ccc; padding: 8px 16px; text-align: center; border-radius: 4px; }
          .stat-box .value { font-size: 20px; font-weight: bold; }
          .stat-box .label { font-size: 10px; color: #666; }
          .badge { padding: 2px 8px; border-radius: 4px; font-size: 10px; color: white; display: inline-block; }
          .badge-blue { background: #3b82f6; }
          .badge-amber { background: #f59e0b; }
          .badge-purple { background: #a855f7; }
          .badge-green { background: #22c55e; }
          .badge-red { background: #ef4444; }
          .badge-cyan { background: #06b6d4; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <h1>CANSPORT - Order Status Board</h1>
        <div class="subtitle">Printed on ${format(today, 'dd MMM yyyy, hh:mm a')}</div>

        <div class="stats">
          <div class="stat-box"><div class="value">${activeOrders.length}</div><div class="label">Active Orders</div></div>
          <div class="stat-box"><div class="value">${totalActiveDozens.toLocaleString()}</div><div class="label">Total Demand (Dz)</div></div>
          <div class="stat-box"><div class="value">${totalPendingDozens.toLocaleString()}</div><div class="label">Pending (Dz)</div></div>
          <div class="stat-box"><div class="value" style="color:#dc2626">${overdueCount}</div><div class="label">Overdue</div></div>
          <div class="stat-box"><div class="value" style="color:#ea580c">${dueSoonCount}</div><div class="label">Due in 3 Days</div></div>
        </div>

        <h2>Item-wise Demand (Active Orders)</h2>
        <table>
          <thead><tr><th>Product Code</th><th>Product Name</th><th class="text-right">Orders</th><th class="text-right">Total (Dz)</th><th class="text-right">Pending (Dz)</th></tr></thead>
          <tbody>
            ${demandList.map(item => `
              <tr>
                <td>${item.code}</td>
                <td>${item.name}</td>
                <td class="text-right">${item.orderCount}</td>
                <td class="text-right">${item.totalDozens.toLocaleString()}</td>
                <td class="text-right" style="${item.pendingDozens > 0 ? 'color:#d97706;font-weight:bold' : 'color:#16a34a'}">${item.pendingDozens.toLocaleString()}</td>
              </tr>
               ${item.orders.map((so, idx) => `
                 <tr style="background:#f9fafb;font-size:11px">
                   <td style="padding-left:24px;color:#666">${idx === item.orders.length - 1 ? '└─' : '├─'} ${so.orderNumber}</td>
                   <td style="color:#666">${so.customerName}</td>
                  <td class="text-right">${so.qty.toLocaleString()}</td>
                  <td class="text-right" style="${so.pending > 0 ? 'color:#d97706' : 'color:#16a34a'}">${so.pending.toLocaleString()}</td>
                </tr>
              `).join('')}
            `).join('')}
            <tr class="summary-row">
              <td colspan="2">TOTAL</td>
              <td class="text-right">${demandList.reduce((s, d) => s + d.orderCount, 0)}</td>
              <td class="text-right">${totalActiveDozens.toLocaleString()}</td>
              <td class="text-right">${totalPendingDozens.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>

        <h2>Upcoming Deadlines</h2>
        <table>
          <thead><tr><th>Order #</th><th>Customer</th><th>Deadline</th><th class="text-right">Qty (Dz)</th><th>Urgency</th></tr></thead>
          <tbody>
            ${upcomingDeadlines.map(order => `
              <tr style="${order.daysLeft < 0 ? 'background:#fef2f2' : order.daysLeft <= 3 ? 'background:#fff7ed' : ''}">
                <td>${order.order_number}</td>
                <td>${order.customers?.name || ''}</td>
                <td>${format(new Date(order.expected_dispatch_date!), 'dd MMM yyyy')}</td>
                <td class="text-right">${order.totalDozens}</td>
                <td>${order.daysLeft < 0 ? `<span class="overdue">${Math.abs(order.daysLeft)}d overdue</span>` : order.daysLeft === 0 ? '<span class="overdue">Today</span>' : order.daysLeft <= 3 ? `<span class="due-soon">${order.daysLeft}d left</span>` : `${order.daysLeft}d left`}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <h2>Order Pipeline (${statusFilter === 'active' ? 'Active' : statusFilter === 'all' ? 'All' : statusFilter.replace(/_/g, ' ')})</h2>
        <table>
          <thead><tr><th>Order #</th><th>Customer</th><th>Date</th><th>Deadline</th><th>Status</th><th class="text-right">Items</th><th class="text-right">Qty (Dz)</th></tr></thead>
          <tbody>
            ${filteredOrders.map(order => {
              const items = allItems?.filter((i: any) => i.order_id === order.id) || [];
              const totalQty = items.reduce((s: number, i: any) => s + (i.quantity_dozens || 0), 0);
              return `
                <tr>
                  <td>${order.order_number}</td>
                  <td>${order.customers?.name || ''}</td>
                  <td>${format(new Date(order.order_date), 'dd MMM yyyy')}</td>
                  <td>${order.expected_dispatch_date ? format(new Date(order.expected_dispatch_date), 'dd MMM yyyy') : '-'}</td>
                  <td>${order.status.replace(/_/g, ' ')}</td>
                  <td class="text-right">${items.length}</td>
                  <td class="text-right">${totalQty.toLocaleString()}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </body>
      </html>
    `;
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.print();
    }
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <PageHeader title="Order Status Board" description="Item-wise demand, deadlines & order tracking" />
          <Button variant="outline" size="sm" onClick={() => handlePrint()} className="print:hidden">
            <Printer className="h-4 w-4 mr-2" /> Print
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <Card>
            <CardContent className="p-4 text-center">
              <Package className="h-5 w-5 mx-auto mb-1 text-blue-500" />
              <p className="text-2xl font-bold">{activeOrders.length}</p>
              <p className="text-xs text-muted-foreground">Active Orders</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <TrendingUp className="h-5 w-5 mx-auto mb-1 text-amber-500" />
              <p className="text-2xl font-bold">{totalActiveDozens.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Total Demand (Dz)</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <Clock className="h-5 w-5 mx-auto mb-1 text-purple-500" />
              <p className="text-2xl font-bold">{totalPendingDozens.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Pending (Dz)</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <AlertTriangle className="h-5 w-5 mx-auto mb-1 text-destructive" />
              <p className="text-2xl font-bold text-destructive">{overdueCount}</p>
              <p className="text-xs text-muted-foreground">Overdue</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <Calendar className="h-5 w-5 mx-auto mb-1 text-orange-500" />
              <p className="text-2xl font-bold text-orange-500">{dueSoonCount}</p>
              <p className="text-xs text-muted-foreground">Due in 3 Days</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <CheckCircle className="h-5 w-5 mx-auto mb-1 text-green-500" />
              <p className="text-2xl font-bold">{statusSummary.ready}</p>
              <p className="text-xs text-muted-foreground">Ready</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Item-wise Demand Accumulation */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="h-4 w-4" /> Item-wise Demand (Active Orders)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {demandList.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No active demand</p>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">Orders</TableHead>
                        <TableHead className="text-right">Total (Dz)</TableHead>
                        <TableHead className="text-right">Pending (Dz)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {demandList.map((item) => (
                        <>
                          <TableRow key={item.id} className="cursor-pointer hover:bg-muted/50" onClick={() => toggleProduct(item.id)}>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                {expandedProducts.has(item.id) ? (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                                )}
                                <span className="font-mono text-xs text-muted-foreground">{item.code}</span>
                                <span className="ml-1 text-sm font-medium">{item.name}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">{item.orderCount}</TableCell>
                            <TableCell className="text-right font-semibold">{item.totalDozens.toLocaleString()}</TableCell>
                            <TableCell className="text-right">
                              <span className={item.pendingDozens > 0 ? 'text-amber-600 font-semibold' : 'text-green-600'}>
                                {item.pendingDozens.toLocaleString()}
                              </span>
                            </TableCell>
                          </TableRow>
                          {expandedProducts.has(item.id) && item.orders.map((so, idx) => (
                            <TableRow key={`${item.id}-${idx}`} className="bg-muted/30 hover:bg-muted/40">
                               <TableCell className="pl-10 text-xs text-muted-foreground font-mono">
                                 {idx === item.orders.length - 1 ? '└─' : '├─'} {so.orderNumber}
                                 <span className="ml-2 font-sans text-muted-foreground">{so.customerName}</span>
                               </TableCell>
                              <TableCell className="text-right text-xs">{so.qty.toLocaleString()}</TableCell>
                              <TableCell className="text-right text-xs">
                                <span className={so.pending > 0 ? 'text-amber-600' : 'text-green-600'}>
                                  {so.pending.toLocaleString()}
                                </span>
                              </TableCell>
                            </TableRow>
                          ))}
                        </>
                      ))}
                      <TableRow className="bg-muted/50 font-bold">
                        <TableCell>TOTAL</TableCell>
                        <TableCell className="text-right">{demandList.reduce((s, d) => s + d.orderCount, 0)}</TableCell>
                        <TableCell className="text-right">{totalActiveDozens.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{totalPendingDozens.toLocaleString()}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Upcoming Deadlines */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4" /> Upcoming Deadlines
              </CardTitle>
            </CardHeader>
            <CardContent>
              {upcomingDeadlines.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No upcoming deadlines</p>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Order</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Deadline</TableHead>
                        <TableHead className="text-right">Qty (Dz)</TableHead>
                        <TableHead>Urgency</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {upcomingDeadlines.map((order) => (
                        <TableRow key={order.id} className={order.daysLeft < 0 ? 'bg-destructive/5' : order.daysLeft <= 3 ? 'bg-orange-50 dark:bg-orange-950/20' : ''}>
                          <TableCell className="font-mono text-sm">{order.order_number}</TableCell>
                          <TableCell className="text-sm">{order.customers?.name}</TableCell>
                          <TableCell className="text-sm">
                            {format(new Date(order.expected_dispatch_date!), 'dd MMM')}
                          </TableCell>
                          <TableCell className="text-right text-sm font-semibold">{order.totalDozens}</TableCell>
                          <TableCell>
                            {order.daysLeft < 0 ? (
                              <Badge variant="destructive" className="text-xs">
                                {Math.abs(order.daysLeft)}d overdue
                              </Badge>
                            ) : order.daysLeft === 0 ? (
                              <Badge className="bg-red-500 text-xs">Today</Badge>
                            ) : order.daysLeft <= 3 ? (
                              <Badge className="bg-orange-500 text-xs">{order.daysLeft}d left</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs">{order.daysLeft}d left</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Status-wise Pipeline */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Order Pipeline</CardTitle>
              <div className="flex gap-2 text-xs">
                {Object.entries(statusSummary).map(([status, count]) => (
                  <Badge key={status} className={`${STATUS_COLORS[status]} cursor-pointer`} onClick={() => setStatusFilter(status)}>
                    {status.replace(/_/g, ' ')} ({count})
                  </Badge>
                ))}
                <Badge variant="outline" className="cursor-pointer" onClick={() => setStatusFilter('active')}>
                  Active ({activeOrders.length})
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Deadline</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Qty (Dz)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ordersLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8">Loading...</TableCell>
                    </TableRow>
                  ) : filteredOrders.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No orders</TableCell>
                    </TableRow>
                  ) : (
                    filteredOrders.map((order) => {
                      const items = allItems?.filter((i: any) => i.order_id === order.id) || [];
                      const totalQty = items.reduce((s: number, i: any) => s + (i.quantity_dozens || 0), 0);
                      const daysLeft = order.expected_dispatch_date
                        ? differenceInDays(new Date(order.expected_dispatch_date), today)
                        : null;
                      return (
                        <TableRow key={order.id}>
                          <TableCell className="font-mono text-sm">{order.order_number}</TableCell>
                          <TableCell>
                            <div className="text-sm font-medium">{order.customers?.name}</div>
                            <div className="text-xs text-muted-foreground">{order.customers?.code}</div>
                          </TableCell>
                          <TableCell className="text-sm">{format(new Date(order.order_date), 'dd MMM')}</TableCell>
                          <TableCell className="text-sm">
                            {order.expected_dispatch_date ? (
                              <span className={daysLeft !== null && daysLeft < 0 ? 'text-destructive font-semibold' : ''}>
                                {format(new Date(order.expected_dispatch_date), 'dd MMM')}
                                {daysLeft !== null && daysLeft < 0 && <span className="text-xs block">⚠ Late</span>}
                              </span>
                            ) : '-'}
                          </TableCell>
                          <TableCell>
                            <Badge className={STATUS_COLORS[order.status]}>{order.status.replace(/_/g, ' ')}</Badge>
                          </TableCell>
                          <TableCell className="text-right text-sm">{items.length}</TableCell>
                          <TableCell className="text-right text-sm font-semibold">{totalQty.toLocaleString()}</TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
