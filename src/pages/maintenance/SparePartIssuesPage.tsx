import { useState, useEffect } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Search, PackageMinus, CalendarDays, History, ArrowUpDown, CalendarIcon, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";

interface SparePartIssue {
  id: string;
  issue_number: string;
  issue_date: string;
  spare_part_id: string;
  quantity_issued: number;
  issued_to: string | null;
  machine_id: string | null;
  work_order_id: string | null;
  purpose: string | null;
  remarks: string | null;
  unit_cost: number | null;
  total_cost: number | null;
  issued_by: string | null;
  status: string;
  created_at: string;
  spare_parts?: { code: string; name: string; current_stock: number; unit_cost: number | null };
  machines?: { code: string; name: string } | null;
  app_users_issued_to?: { full_name: string } | null;
  app_users_issued_by?: { full_name: string } | null;
  maintenance_work_orders?: { work_order_number: string } | null;
}

interface SparePart {
  id: string;
  code: string;
  name: string;
  current_stock: number;
  unit_cost: number | null;
}

interface Machine {
  id: string;
  code: string;
  name: string;
}

interface AppUser {
  id: string;
  full_name: string;
}

interface WorkOrder {
  id: string;
  work_order_number: string;
  title: string;
}

export default function SparePartIssuesPage() {
  const { user, hasRole } = useAuth();
  const isSuperAdmin = hasRole('super_admin');
  const [issues, setIssues] = useState<SparePartIssue[]>([]);
  const [spareParts, setSpareParts] = useState<SparePart[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"all" | "today" | "month" | "custom">("all");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingIssue, setDeletingIssue] = useState<SparePartIssue | null>(null);

  const [formData, setFormData] = useState({
    spare_part_id: "",
    quantity_issued: 1,
    issued_to: "",
    machine_id: "",
    work_order_id: "",
    purpose: "",
    remarks: "",
    issue_date: new Date().toISOString().split("T")[0],
  });

  const [selectedPart, setSelectedPart] = useState<SparePart | null>(null);

  useEffect(() => {
    fetchData();
  }, [viewMode, selectedDate]);

  const fetchData = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("spare_part_issues")
        .select(`
          *,
          spare_parts(code, name, current_stock, unit_cost),
          machines(code, name),
          app_users_issued_to:app_users!spare_part_issues_issued_to_fkey(full_name),
          app_users_issued_by:app_users!spare_part_issues_issued_by_fkey(full_name),
          maintenance_work_orders(work_order_number)
        `)
        .order("created_at", { ascending: false });

      const today = new Date().toISOString().split("T")[0];
      if (viewMode === "today") {
        query = query.eq("issue_date", today);
      } else if (viewMode === "month") {
        const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
        query = query.gte("issue_date", firstOfMonth);
      } else if (viewMode === "custom" && selectedDate) {
        const dateStr = format(selectedDate, "yyyy-MM-dd");
        query = query.eq("issue_date", dateStr);
      }

      const { data: issuesData, error: issuesError } = await query;
      if (issuesError) throw issuesError;
      if (issuesData) setIssues(issuesData);

      const { data: partsData } = await supabase
        .from("spare_parts")
        .select("id, code, name, current_stock, unit_cost")
        .eq("is_active", true)
        .order("name");
      if (partsData) setSpareParts(partsData);

      const { data: machinesData } = await supabase
        .from("machines")
        .select("id, code, name")
        .eq("is_active", true)
        .order("name");
      if (machinesData) setMachines(machinesData);

      const { data: usersData } = await supabase
        .from("app_users")
        .select("id, full_name")
        .eq("is_active", true)
        .order("full_name");
      if (usersData) setUsers(usersData);

      const { data: workOrdersData } = await supabase
        .from("maintenance_work_orders")
        .select("id, work_order_number, title")
        .in("status", ["draft", "in_progress", "pending_approval"])
        .order("work_order_number", { ascending: false });
      if (workOrdersData) setWorkOrders(workOrdersData);

    } catch (error) {
      console.error("Error fetching data:", error);
      toast.error("Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  const handleSparePartChange = (partId: string) => {
    const part = spareParts.find((p) => p.id === partId);
    setSelectedPart(part || null);
    setFormData({ ...formData, spare_part_id: partId });
  };

  const handleSubmit = async () => {
    if (!formData.spare_part_id || formData.quantity_issued <= 0) {
      toast.error("Please select a spare part and quantity");
      return;
    }

    if (selectedPart && formData.quantity_issued > selectedPart.current_stock) {
      toast.error(`Insufficient stock. Available: ${selectedPart.current_stock}`);
      return;
    }

    try {
      const unitCost = selectedPart?.unit_cost || 0;
      const totalCost = unitCost * formData.quantity_issued;

      const insertData = {
        spare_part_id: formData.spare_part_id,
        quantity_issued: formData.quantity_issued,
        issued_to: formData.issued_to || null,
        machine_id: formData.machine_id || null,
        work_order_id: formData.work_order_id || null,
        purpose: formData.purpose || null,
        remarks: formData.remarks || null,
        unit_cost: unitCost,
        total_cost: totalCost,
        issued_by: user?.id || null,
        issue_date: formData.issue_date,
      };

      const { error } = await supabase
        .from("spare_part_issues")
        .insert(insertData as any);

      if (error) throw error;
      toast.success("Spare part issued successfully");
      setIsDialogOpen(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      console.error("Error issuing spare part:", error);
      toast.error(error.message || "Failed to issue spare part");
    }
  };

  const handleDelete = async () => {
    if (!deletingIssue) return;
    try {
      const { error } = await supabase
        .from("spare_part_issues")
        .delete()
        .eq("id", deletingIssue.id);
      if (error) throw error;
      toast.success("Issue record deleted successfully");
      setDeleteDialogOpen(false);
      setDeletingIssue(null);
      fetchData();
    } catch (error: any) {
      toast.error(error.message || "Failed to delete");
    }
  };

  const resetForm = () => {
    setFormData({
      spare_part_id: "",
      quantity_issued: 1,
      issued_to: "",
      machine_id: "",
      work_order_id: "",
      purpose: "",
      remarks: "",
      issue_date: new Date().toISOString().split("T")[0],
    });
    setSelectedPart(null);
  };

  const filteredIssues = issues.filter(
    (issue) =>
      issue.issue_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      issue.spare_parts?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      issue.spare_parts?.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      issue.machines?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      issue.app_users_issued_to?.full_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const columns = [
    { key: "issue_number", header: "Issue #" },
    {
      key: "issue_date",
      header: "Date",
      render: (row: SparePartIssue) => format(new Date(row.issue_date), "dd MMM yyyy"),
    },
    {
      key: "spare_parts",
      header: "Spare Part",
      render: (row: SparePartIssue) => (
        <div>
          <div className="font-medium">{row.spare_parts?.name}</div>
          <div className="text-xs text-muted-foreground">{row.spare_parts?.code}</div>
        </div>
      ),
    },
    { key: "quantity_issued", header: "Qty" },
    {
      key: "issued_to",
      header: "Issued To",
      render: (row: SparePartIssue) => row.app_users_issued_to?.full_name || "-",
    },
    {
      key: "machine_id",
      header: "Machine",
      render: (row: SparePartIssue) => row.machines ? `${row.machines.code} - ${row.machines.name}` : "-",
    },
    {
      key: "work_order_id",
      header: "Work Order",
      render: (row: SparePartIssue) => row.maintenance_work_orders?.work_order_number || "-",
    },
    { key: "purpose", header: "Purpose", render: (row: SparePartIssue) => row.purpose || "-" },
    {
      key: "total_cost",
      header: "Cost",
      render: (row: SparePartIssue) => row.total_cost ? `Rs. ${row.total_cost.toFixed(2)}` : "-",
    },
    {
      key: "status",
      header: "Status",
      render: (row: SparePartIssue) => (
        <Badge variant={row.status === "issued" ? "default" : "secondary"}>
          {row.status}
        </Badge>
      ),
    },
    ...(isSuperAdmin ? [{
      key: "actions",
      header: "Actions",
      render: (row: SparePartIssue) => (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => { setDeletingIssue(row); setDeleteDialogOpen(true); }}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      ),
    }] : []),
  ];

  const todayIssues = issues.filter((i) => i.issue_date === new Date().toISOString().split("T")[0]).length;
  const totalQuantity = issues.reduce((sum, i) => sum + i.quantity_issued, 0);
  const totalCost = issues.reduce((sum, i) => sum + (i.total_cost || 0), 0);

  return (
    <ERPLayout>
      <PageHeader
        title="Spare Part Issues"
        description="Track spare parts issued for maintenance and repairs"
        action={{
          label: "Issue Spare Part",
          onClick: () => { resetForm(); setIsDialogOpen(true); },
        }}
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-card border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">Today's Issues</div>
          <div className="text-2xl font-bold text-primary">{todayIssues}</div>
        </div>
        <div className="bg-card border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">Total Records</div>
          <div className="text-2xl font-bold">{issues.length}</div>
        </div>
        <div className="bg-card border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">Total Quantity</div>
          <div className="text-2xl font-bold">{totalQuantity}</div>
        </div>
        <div className="bg-card border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">Total Cost</div>
          <div className="text-2xl font-bold text-amber-500">Rs. {totalCost.toFixed(2)}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search issues..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant={viewMode === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => { setViewMode("all"); setSelectedDate(undefined); }}
          >
            <History className="h-4 w-4 mr-1" />
            All
          </Button>
          <Button
            variant={viewMode === "today" ? "default" : "outline"}
            size="sm"
            onClick={() => { setViewMode("today"); setSelectedDate(undefined); }}
          >
            <CalendarDays className="h-4 w-4 mr-1" />
            Today
          </Button>
          <Button
            variant={viewMode === "month" ? "default" : "outline"}
            size="sm"
            onClick={() => { setViewMode("month"); setSelectedDate(undefined); }}
          >
            <ArrowUpDown className="h-4 w-4 mr-1" />
            This Month
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={viewMode === "custom" ? "default" : "outline"}
                size="sm"
              >
                <CalendarIcon className="h-4 w-4 mr-1" />
                {viewMode === "custom" && selectedDate
                  ? format(selectedDate, "dd MMM yyyy")
                  : "Pick Date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(date) => {
                  setSelectedDate(date);
                  if (date) setViewMode("custom");
                }}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Loading...</div>
      ) : (
        <DataTable columns={columns} data={filteredIssues} />
      )}

      {/* Issue Spare Part Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackageMinus className="h-5 w-5 text-primary" />
              Issue Spare Part
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Issue Date */}
            <div>
              <Label>Issue Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !formData.issue_date && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.issue_date
                      ? format(new Date(formData.issue_date + "T00:00:00"), "dd MMM yyyy")
                      : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={formData.issue_date ? new Date(formData.issue_date + "T00:00:00") : undefined}
                    onSelect={(date) => {
                      if (date) {
                        setFormData({ ...formData, issue_date: format(date, "yyyy-MM-dd") });
                      }
                    }}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Spare Part Selection */}
            <div>
              <Label>Spare Part *</Label>
              <Select value={formData.spare_part_id} onValueChange={handleSparePartChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select spare part" />
                </SelectTrigger>
                <SelectContent>
                  {spareParts.map((part) => (
                    <SelectItem key={part.id} value={part.id}>
                      {part.code} - {part.name} (Stock: {part.current_stock})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedPart && (
                <div className="mt-2 p-2 bg-muted rounded text-sm">
                  <div className="flex justify-between">
                    <span>Available Stock:</span>
                    <span className="font-medium">{selectedPart.current_stock}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Unit Cost:</span>
                    <span className="font-medium">Rs. {selectedPart.unit_cost?.toFixed(2) || "0.00"}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Quantity */}
            <div>
              <Label>Quantity *</Label>
              <Input
                type="number"
                value={formData.quantity_issued}
                onChange={(e) => setFormData({ ...formData, quantity_issued: parseInt(e.target.value) || 1 })}
                min={1}
                max={selectedPart?.current_stock || 9999}
              />
              {selectedPart && formData.quantity_issued > 0 && (
                <div className="mt-1 text-sm text-muted-foreground">
                  Total Cost: Rs. {((selectedPart.unit_cost || 0) * formData.quantity_issued).toFixed(2)}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Issued To */}
              <div>
                <Label>Issued To</Label>
                <Select value={formData.issued_to} onValueChange={(v) => setFormData({ ...formData, issued_to: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select user" />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Machine */}
              <div>
                <Label>Machine</Label>
                <Select value={formData.machine_id} onValueChange={(v) => setFormData({ ...formData, machine_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select machine" />
                  </SelectTrigger>
                  <SelectContent>
                    {machines.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.code} - {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Work Order */}
            <div>
              <Label>Work Order (optional)</Label>
              <Select value={formData.work_order_id} onValueChange={(v) => setFormData({ ...formData, work_order_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Link to work order" />
                </SelectTrigger>
                <SelectContent>
                  {workOrders.map((wo) => (
                    <SelectItem key={wo.id} value={wo.id}>
                      {wo.work_order_number} - {wo.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Purpose */}
            <div>
              <Label>Purpose</Label>
              <Input
                value={formData.purpose}
                onChange={(e) => setFormData({ ...formData, purpose: e.target.value })}
                placeholder="e.g., Preventive maintenance, Breakdown repair"
              />
            </div>

            {/* Remarks */}
            <div>
              <Label>Remarks</Label>
              <Textarea
                value={formData.remarks}
                onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                placeholder="Additional notes..."
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>Issue Part</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Issue Record</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete issue "{deletingIssue?.issue_number}"? 
              This will restore the stock quantity. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ERPLayout>
  );
}
