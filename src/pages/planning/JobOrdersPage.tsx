import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {
  Plus,
  Pencil,
  Trash2,
  ClipboardList,
  Send,
  Lock,
  Printer,
  Eye,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { format, startOfMonth, endOfMonth } from "date-fns";

interface JobOrderItem {
  id?: string;
  planning_item_id: string;
  quantity: number | string;
  unit: string;
  item_detail: string;
  remarks: string;
  sort_order: number;
}

interface JobOrderForm {
  id?: string;
  order_date: string;
  required_by_date: string;
  department_id: string;
  sub_department_id: string;
  priority: string;
  remarks: string;
  items: JobOrderItem[];
}

const SUB_DEPT_NONE = "none";

const blankItem = (sort_order = 0): JobOrderItem => ({
  planning_item_id: "",
  quantity: "",
  unit: "",
  item_detail: "",
  remarks: "",
  sort_order,
});

const blankForm = (): JobOrderForm => ({
  order_date: new Date().toISOString().split("T")[0],
  required_by_date: "",
  department_id: "",
  sub_department_id: SUB_DEPT_NONE,
  priority: "medium",
  remarks: "",
  items: [blankItem(0)],
});

const statusVariant = (s: string) => {
  if (s === "Draft") return "secondary" as const;
  if (s === "Issued") return "default" as const;
  return "outline" as const;
};

const priorityColor = (p: string) => {
  switch (p) {
    case "critical":
      return "bg-red-100 text-red-800 border-red-200";
    case "high":
      return "bg-orange-100 text-orange-800 border-orange-200";
    case "medium":
      return "bg-blue-100 text-blue-800 border-blue-200";
    default:
      return "bg-slate-100 text-slate-700 border-slate-200";
  }
};

export default function JobOrdersPage() {
  const qc = useQueryClient();
  const { user, hasRole } = useAuth();
  const isSuperAdmin = hasRole('super_admin');
  const printRef = useRef<HTMLDivElement>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");
  const today = new Date();
  const [fromDate, setFromDate] = useState(format(startOfMonth(today), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(endOfMonth(today), "yyyy-MM-dd"));

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [form, setForm] = useState<JobOrderForm>(blankForm());

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [printOrder, setPrintOrder] = useState<any | null>(null);

  // Master data
  const { data: departments = [] } = useQuery({
    queryKey: ["jo-departments"],
    queryFn: async () => {
      const { data } = await supabase
        .from("production_departments")
        .select("*")
        .eq("is_active", true)
        .order("sequence_order");
      return data || [];
    },
  });

  const { data: subDepartments = [] } = useQuery({
    queryKey: ["jo-sub-departments"],
    queryFn: async () => {
      const { data } = await supabase
        .from("production_sub_departments")
        .select("*")
        .order("name");
      return data || [];
    },
  });

  const { data: eligibleDeptRows = [] } = useQuery({
    queryKey: ["jo-eligible-departments"],
    queryFn: async () => {
      const { data } = await supabase
        .from("job_order_eligible_departments")
        .select("department_id");
      return data || [];
    },
  });
  const eligibleDeptIds = useMemo(
    () => new Set(eligibleDeptRows.map((r: any) => r.department_id)),
    [eligibleDeptRows]
  );
  const eligibleDepartments = useMemo(
    () => departments.filter((d: any) => eligibleDeptIds.has(d.id)),
    [departments, eligibleDeptIds]
  );

  const { data: planningItems = [] } = useQuery({
    queryKey: ["jo-planning-items"],
    queryFn: async () => {
      const { data } = await supabase
        .from("planning_items")
        .select("*")
        .eq("is_active", true)
        .order("code");
      return data || [];
    },
  });

  const deptMap = useMemo(
    () => Object.fromEntries(departments.map((d: any) => [d.id, d])),
    [departments]
  );
  const subDeptMap = useMemo(
    () => Object.fromEntries(subDepartments.map((s: any) => [s.id, s])),
    [subDepartments]
  );
  const piMap = useMemo(
    () => Object.fromEntries(planningItems.map((p: any) => [p.id, p])),
    [planningItems]
  );

  // Job orders
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["job-orders", statusFilter, deptFilter, fromDate, toDate],
    queryFn: async () => {
      let q = supabase
        .from("job_orders")
        .select("*")
        .gte("order_date", fromDate)
        .lte("order_date", toDate)
        .order("order_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      if (deptFilter !== "all") q = q.eq("department_id", deptFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  const orderIds = orders.map((o: any) => o.id);
  const { data: allItems = [] } = useQuery({
    queryKey: ["job-order-items", orderIds.join(",")],
    enabled: orderIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("job_order_items")
        .select("*")
        .in("job_order_id", orderIds)
        .order("sort_order");
      return data || [];
    },
  });

  const itemsByOrder = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const it of allItems) {
      if (!m[it.job_order_id]) m[it.job_order_id] = [];
      m[it.job_order_id].push(it);
    }
    return m;
  }, [allItems]);

  const filteredOrders = useMemo(() => {
    const t = search.trim().toLowerCase();
    if (!t) return orders;
    return orders.filter((o: any) =>
      [o.job_order_number, o.remarks, deptMap[o.department_id]?.name]
        .filter(Boolean)
        .some((s: string) => s.toLowerCase().includes(t))
    );
  }, [orders, search, deptMap]);

  // Same-required-date continuation series: group by required_by_date + department,
  // assign sequence numbers in chronological order (1 = first issued for that required date).
  const seriesMap = useMemo(() => {
    const groups: Record<string, any[]> = {};
    for (const o of orders) {
      if (!o.required_by_date) continue;
      const k = `${o.required_by_date}::${o.department_id}`;
      (groups[k] = groups[k] || []).push(o);
    }
    const map: Record<string, { seq: number; total: number; firstNo: string }> = {};
    for (const k of Object.keys(groups)) {
      const sorted = [...groups[k]].sort((a, b) =>
        String(a.created_at).localeCompare(String(b.created_at))
      );
      const firstNo = sorted[0]?.job_order_number || "";
      sorted.forEach((o, i) => {
        map[o.id] = { seq: i + 1, total: sorted.length, firstNo };
      });
    }
    return map;
  }, [orders]);

  // Save (insert or update) — optionally mark as Issued
  const saveMutation = useMutation({
    mutationFn: async ({
      f,
      issue,
    }: {
      f: JobOrderForm;
      issue: boolean;
    }) => {
      // Validate items
      const cleanItems = f.items
        .filter((it) => it.planning_item_id && Number(it.quantity) > 0)
        .map((it, idx) => ({
          planning_item_id: it.planning_item_id,
          quantity: Number(it.quantity),
          unit: it.unit || piMap[it.planning_item_id]?.unit || null,
          item_detail: it.item_detail?.trim() ? it.item_detail.trim() : null,
          remarks: it.remarks || null,
          sort_order: idx,
        }));
      if (cleanItems.length === 0) throw new Error("Add at least one line item");
      if (!f.department_id) throw new Error("Select a department");

      const header: any = {
        order_date: f.order_date,
        required_by_date: f.required_by_date || null,
        department_id: f.department_id,
        sub_department_id:
          f.sub_department_id && f.sub_department_id !== SUB_DEPT_NONE
            ? f.sub_department_id
            : null,
        priority: f.priority,
        remarks: f.remarks || null,
      };

      let orderId = f.id;
      if (f.id) {
        const { error } = await supabase
          .from("job_orders")
          .update(header)
          .eq("id", f.id);
        if (error) throw error;
        await supabase.from("job_order_items").delete().eq("job_order_id", f.id);
      } else {
        const { data, error } = await supabase
          .from("job_orders")
          .insert({ ...header, created_by: user?.id ?? null })
          .select()
          .single();
        if (error) throw error;
        orderId = data.id;
      }

      const itemsPayload = cleanItems.map((it) => ({
        ...it,
        job_order_id: orderId!,
      }));
      const { error: itErr } = await supabase
        .from("job_order_items")
        .insert(itemsPayload);
      if (itErr) throw itErr;

      if (issue) {
        const { error: issErr } = await supabase
          .from("job_orders")
          .update({
            status: "Issued",
            issued_at: new Date().toISOString(),
            issued_by: user?.id ?? null,
          })
          .eq("id", orderId!);
        if (issErr) throw issErr;
      }
      return orderId;
    },
    onSuccess: (_id, vars) => {
      qc.invalidateQueries({ queryKey: ["job-orders"] });
      qc.invalidateQueries({ queryKey: ["job-order-items"] });
      toast.success(vars.issue ? "Job order issued" : "Job order saved");
      setDialogOpen(false);
    },
    onError: (e: any) => toast.error(e.message || "Save failed"),
  });

  const statusMutation = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: "Issued" | "Closed";
    }) => {
      const patch: any = { status };
      if (status === "Issued") {
        patch.issued_at = new Date().toISOString();
        patch.issued_by = user?.id ?? null;
      } else {
        patch.closed_at = new Date().toISOString();
        patch.closed_by = user?.id ?? null;
      }
      const { error } = await supabase
        .from("job_orders")
        .update(patch)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["job-orders"] });
      toast.success(`Marked ${vars.status}`);
    },
    onError: (e: any) => toast.error(e.message || "Update failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("job_orders").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job-orders"] });
      toast.success("Deleted");
      setDeleteId(null);
    },
    onError: (e: any) => toast.error(e.message || "Delete failed"),
  });

  // Dialog actions
  const openNew = () => {
    setEditing(null);
    setReadOnly(false);
    setForm(blankForm());
    setDialogOpen(true);
  };

  const openEdit = (o: any, viewOnly = false) => {
    setEditing(o);
    setReadOnly(viewOnly || o.status === "Closed");
    const its = (itemsByOrder[o.id] || []).map((it: any, idx: number) => ({
      id: it.id,
      planning_item_id: it.planning_item_id,
      quantity: Number(it.quantity),
      unit: it.unit || "",
      item_detail: it.item_detail || "",
      remarks: it.remarks || "",
      sort_order: idx,
    }));
    setForm({
      id: o.id,
      order_date: o.order_date,
      required_by_date: o.required_by_date || "",
      department_id: o.department_id,
      sub_department_id: o.sub_department_id || SUB_DEPT_NONE,
      priority: o.priority || "medium",
      remarks: o.remarks || "",
      items: its.length > 0 ? its : [blankItem(0)],
    });
    setDialogOpen(true);
  };

  const updateItem = (idx: number, patch: Partial<JobOrderItem>) => {
    setForm((f) => {
      const items = [...f.items];
      items[idx] = { ...items[idx], ...patch };
      // Auto-fill unit when planning item changes
      if (patch.planning_item_id) {
        const pi = piMap[patch.planning_item_id];
        if (pi) items[idx].unit = pi.unit || "";
      }
      // Auto-add new row when last row gets an item
      const last = items[items.length - 1];
      if (last.planning_item_id) {
        items.push(blankItem(items.length));
      }
      return { ...f, items };
    });
  };

  const removeItem = (idx: number) => {
    setForm((f) => {
      const items = f.items.filter((_, i) => i !== idx);
      return { ...f, items: items.length > 0 ? items : [blankItem(0)] };
    });
  };

  // Filter planning items by selected department
  const formDeptPlanningItems = useMemo(() => {
    if (!form.department_id) return planningItems;
    return planningItems.filter(
      (p: any) => p.department_id === form.department_id
    );
  }, [planningItems, form.department_id]);

  const handlePrint = (o: any) => {
    setPrintOrder(o);
    setTimeout(() => {
      window.print();
    }, 100);
  };

  return (
    <ERPLayout>
      <div className="space-y-6 print:hidden">
        <PageHeader
          title="Job Orders"
          description="Issue job orders to production departments"
          icon={ClipboardList}
          iconColor="bg-amber-600 text-white"
        >
          <Button onClick={openNew}>
            <Plus className="h-4 w-4 mr-2" />
            New Job Order
          </Button>
        </PageHeader>

        <Card>
          <CardContent className="py-4 flex flex-wrap items-end gap-3">
            <Input
              placeholder="Search by JO #, remarks, dept..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-64"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="Draft">Draft</SelectItem>
                <SelectItem value="Issued">Issued</SelectItem>
                <SelectItem value="Closed">Closed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={deptFilter} onValueChange={setDeptFilter}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="All Departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">From Date <span className="text-red-500">*</span></Label>
              <Input
                type="date"
                required
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">To Date <span className="text-red-500">*</span></Label>
              <Input
                type="date"
                required
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-40"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>JO #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Required By</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Sub-Dept</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Total Qty</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : filteredOrders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                      No job orders yet
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredOrders.map((o: any) => {
                    const its = itemsByOrder[o.id] || [];
                    const totalQty = its.reduce(
                      (s, it) => s + Number(it.quantity || 0),
                      0
                    );
                    return (
                      <TableRow key={o.id}>
                        <TableCell className="font-mono font-medium">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span>{o.job_order_number}</span>
                            {seriesMap[o.id] && seriesMap[o.id].total > 1 && (
                              <Badge
                                variant="outline"
                                className={
                                  seriesMap[o.id].seq === 1
                                    ? "border-slate-400 text-slate-700 bg-slate-50 font-normal"
                                    : "border-amber-500 text-amber-800 bg-amber-50 font-normal"
                                }
                                title={
                                  seriesMap[o.id].seq === 1
                                    ? `First of ${seriesMap[o.id].total} job orders for required date ${o.required_by_date} (${deptMap[o.department_id]?.name || "this department"})`
                                    : `Continuation of ${seriesMap[o.id].firstNo} for required date ${o.required_by_date} (${deptMap[o.department_id]?.name || "this department"})`
                                }
                              >
                                {seriesMap[o.id].seq === 1
                                  ? `Part 1 of ${seriesMap[o.id].total}`
                                  : `Continuation • Part ${seriesMap[o.id].seq} of ${seriesMap[o.id].total}`}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{o.order_date}</TableCell>
                        <TableCell>{o.required_by_date || "-"}</TableCell>
                        <TableCell>{deptMap[o.department_id]?.name || "-"}</TableCell>
                        <TableCell>
                          {o.sub_department_id
                            ? subDeptMap[o.sub_department_id]?.name || "-"
                            : "-"}
                        </TableCell>
                        <TableCell className="text-right">{its.length}</TableCell>
                        <TableCell className="text-right">
                          {totalQty.toLocaleString("en-IN")}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={priorityColor(o.priority)}>
                            {o.priority}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(o.status)}>{o.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              title="View"
                              onClick={() => openEdit(o, true)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {o.status !== "Closed" && (
                              <Button
                                size="icon"
                                variant="ghost"
                                title="Edit"
                                onClick={() => openEdit(o)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                            {o.status === "Draft" && (
                              <Button
                                size="icon"
                                variant="ghost"
                                title="Issue"
                                onClick={() =>
                                  statusMutation.mutate({ id: o.id, status: "Issued" })
                                }
                              >
                                <Send className="h-4 w-4 text-blue-600" />
                              </Button>
                            )}
                            {o.status === "Issued" && (
                              <Button
                                size="icon"
                                variant="ghost"
                                title="Close"
                                onClick={() =>
                                  statusMutation.mutate({ id: o.id, status: "Closed" })
                                }
                              >
                                <Lock className="h-4 w-4 text-slate-600" />
                              </Button>
                            )}
                            {isSuperAdmin && (
                              <Button
                                size="icon"
                                variant="ghost"
                                title="Delete"
                                onClick={() => setDeleteId(o.id)}
                              >
                                <Trash2 className="h-4 w-4 text-red-600" />
                              </Button>
                            )}
                            {o.status !== "Draft" && (
                              <Button
                                size="icon"
                                variant="ghost"
                                title="Print"
                                onClick={() => handlePrint(o)}
                              >
                                <Printer className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Form dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {readOnly
                ? `View Job Order ${editing?.job_order_number || ""}`
                : editing
                ? `Edit Job Order ${editing.job_order_number}`
                : "New Job Order"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>Order Date *</Label>
                <Input
                  type="date"
                  value={form.order_date}
                  onChange={(e) => setForm({ ...form, order_date: e.target.value })}
                  disabled={readOnly}
                />
              </div>
              <div>
                <Label>Required By</Label>
                <Input
                  type="date"
                  value={form.required_by_date}
                  onChange={(e) =>
                    setForm({ ...form, required_by_date: e.target.value })
                  }
                  disabled={readOnly}
                />
              </div>
              <div>
                <Label>Priority</Label>
                <Select
                  value={form.priority}
                  onValueChange={(v) => setForm({ ...form, priority: v })}
                  disabled={readOnly}
                >
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
              <div>
                <Label>Department *</Label>
                <Select
                  value={form.department_id}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      department_id: v,
                      sub_department_id: SUB_DEPT_NONE,
                      items: [blankItem(0)],
                    })
                  }
                  disabled={readOnly}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleDepartments.length === 0 && (
                      <div className="px-2 py-3 text-xs text-muted-foreground">
                        No departments enabled. Super admin can enable them in Planning → Job Order Departments.
                      </div>
                    )}
                    {eligibleDepartments.map((d: any) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Sub-Department</Label>
                <Select
                  value={form.sub_department_id}
                  onValueChange={(v) => setForm({ ...form, sub_department_id: v })}
                  disabled={readOnly || !form.department_id}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SUB_DEPT_NONE}>None</SelectItem>
                    {subDepartments
                      .filter(
                        (s: any) => s.department_id === form.department_id
                      )
                      .map((s: any) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Remarks</Label>
              <Textarea
                value={form.remarks}
                onChange={(e) => setForm({ ...form, remarks: e.target.value })}
                rows={2}
                disabled={readOnly}
              />
            </div>

            <div>
              <Label className="text-base font-semibold">Line Items</Label>
              <div className="border rounded-md mt-2 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Planning Item *</TableHead>
                      <TableHead className="w-32">Quantity *</TableHead>
                      <TableHead className="w-24">Unit</TableHead>
                      <TableHead>Item Detail</TableHead>
                      <TableHead>Remarks</TableHead>
                      {!readOnly && <TableHead className="w-12"></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {form.items.map((it, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="text-muted-foreground">
                          {idx + 1}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={it.planning_item_id || undefined}
                            onValueChange={(v) =>
                              updateItem(idx, { planning_item_id: v })
                            }
                            disabled={readOnly || !form.department_id}
                          >
                            <SelectTrigger>
                              <SelectValue
                                placeholder={
                                  form.department_id
                                    ? "Select item"
                                    : "Select dept first"
                                }
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {formDeptPlanningItems.map((p: any) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.code} — {p.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            value={it.quantity}
                            onChange={(e) =>
                              updateItem(idx, { quantity: e.target.value })
                            }
                            disabled={readOnly}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={it.unit}
                            onChange={(e) => updateItem(idx, { unit: e.target.value })}
                            disabled={readOnly}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={it.item_detail}
                            onChange={(e) =>
                              updateItem(idx, { item_detail: e.target.value })
                            }
                            placeholder="Optional"
                            disabled={readOnly}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={it.remarks}
                            onChange={(e) =>
                              updateItem(idx, { remarks: e.target.value })
                            }
                            disabled={readOnly}
                          />
                        </TableCell>
                        {!readOnly && (
                          <TableCell>
                            {form.items.length > 1 && (
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => removeItem(idx)}
                              >
                                <X className="h-4 w-4 text-red-600" />
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {readOnly ? "Close" : "Cancel"}
            </Button>
            {!readOnly && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => saveMutation.mutate({ f: form, issue: false })}
                  disabled={saveMutation.isPending}
                >
                  Save Draft
                </Button>
                <Button
                  onClick={() => saveMutation.mutate({ f: form, issue: true })}
                  disabled={saveMutation.isPending}
                >
                  <Send className="h-4 w-4 mr-2" />
                  Save & Issue
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Job Order?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the job order and its line items.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Print view */}
      {printOrder && (
        <div ref={printRef} className="hidden print:block p-8 text-black">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold">CANSPORT GLOBAL INDUSTRIES</h1>
            <h2 className="text-xl font-semibold mt-2">JOB ORDER</h2>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-4 text-sm">
            <div>
              <strong>JO Number:</strong> {printOrder.job_order_number}
            </div>
            <div className="text-right">
              <strong>Date:</strong> {printOrder.order_date}
            </div>
            <div>
              <strong>Department:</strong> {deptMap[printOrder.department_id]?.name}
            </div>
            <div className="text-right">
              <strong>Sub-Department:</strong>{" "}
              {printOrder.sub_department_id
                ? subDeptMap[printOrder.sub_department_id]?.name
                : "—"}
            </div>
            <div>
              <strong>Required By:</strong> {printOrder.required_by_date || "—"}
            </div>
            <div className="text-right">
              <strong>Priority:</strong> {printOrder.priority}
            </div>
          </div>
          {seriesMap[printOrder.id] && seriesMap[printOrder.id].total > 1 && (
            <div className="mb-4 text-sm border border-black p-2 bg-gray-100">
              <strong>
                Part {seriesMap[printOrder.id].seq} of {seriesMap[printOrder.id].total}
              </strong>{" "}
              for required date {printOrder.required_by_date} —{" "}
              {deptMap[printOrder.department_id]?.name}
              {seriesMap[printOrder.id].seq > 1 && (
                <> — continuation of {seriesMap[printOrder.id].firstNo}</>
              )}
            </div>
          )}
          {(() => {
            const printItems = itemsByOrder[printOrder.id] || [];
            const showItemDetail = printItems.some((it: any) => it.item_detail && String(it.item_detail).trim());
            return (
          <table className="w-full border-collapse border border-black text-sm">
            <thead>
              <tr className="bg-gray-200">
                <th className="border border-black p-2 text-left">#</th>
                <th className="border border-black p-2 text-left">Code</th>
                <th className="border border-black p-2 text-left">Item</th>
                {showItemDetail && <th className="border border-black p-2 text-left">Item Detail</th>}
                <th className="border border-black p-2 text-right">Ordered Qty</th>
                <th className="border border-black p-2 text-right w-24">Material Issued Qty</th>
                <th className="border border-black p-2 text-left">Unit</th>
                <th className="border border-black p-2 text-left">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {printItems.map((it: any, idx: number) => {
                const pi = piMap[it.planning_item_id];
                return (
                  <tr key={it.id}>
                    <td className="border border-black p-2">{idx + 1}</td>
                    <td className="border border-black p-2">{pi?.code || "-"}</td>
                    <td className="border border-black p-2">{pi?.name || "-"}</td>
                    {showItemDetail && <td className="border border-black p-2">{it.item_detail || ""}</td>}
                    <td className="border border-black p-2 text-right">
                      {Number(it.quantity).toLocaleString("en-IN")}
                    </td>
                    <td className="border border-black p-2">&nbsp;</td>
                    <td className="border border-black p-2">{it.unit || pi?.unit}</td>
                    <td className="border border-black p-2">{it.remarks || ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
            );
          })()}
          {printOrder.remarks && (
            <div className="mt-4 text-sm">
              <strong>Remarks:</strong> {printOrder.remarks}
            </div>
          )}
          <div className="grid grid-cols-3 gap-6 mt-16 text-sm">
            <div className="border-t border-black pt-2 text-center">
              Issued By<br />(Store Keeper)
            </div>
            <div className="border-t border-black pt-2 text-center">
              QA Executive
            </div>
            <div className="border-t border-black pt-2 text-center">
              Received By
            </div>
          </div>

        </div>
      )}
    </ERPLayout>
  );
}
