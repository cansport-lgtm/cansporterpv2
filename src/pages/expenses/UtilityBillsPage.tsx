import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, isAfter, differenceInDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { Plus, CalendarIcon, Search, Zap, Droplets, Flame, Wifi, Fuel, AlertCircle, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const UTILITY_ICONS: Record<string, React.ElementType> = {
  ELEC: Zap,
  WATER: Droplets,
  GAS: Flame,
  INTERNET: Wifi,
  FUEL: Fuel,
};

const PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "upi", label: "UPI" },
  { value: "auto_debit", label: "Auto Debit" },
];

export default function UtilityBillsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const [selectedBill, setSelectedBill] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [utilityFilter, setUtilityFilter] = useState("all");

  const [formData, setFormData] = useState({
    utility_type_id: "",
    department_id: "",
    billing_period_start: null as Date | null,
    billing_period_end: null as Date | null,
    bill_date: new Date(),
    due_date: null as Date | null,
    meter_reading_previous: "",
    meter_reading_current: "",
    units_consumed: "",
    unit_rate: "",
    base_amount: "",
    tax_amount: "",
    other_charges: "",
    remarks: "",
  });

  const [paymentData, setPaymentData] = useState({
    payment_mode: "",
    payment_reference: "",
  });

  // Fetch utility bills
  const { data: bills = [], isLoading } = useQuery({
    queryKey: ["utility-bills"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("utility_bills")
        .select(`
          *,
          utility_types(*),
          production_departments(*)
        `)
        .order("due_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch utility types
  const { data: utilityTypes = [] } = useQuery({
    queryKey: ["utility-types"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("utility_types")
        .select("*")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch departments
  const { data: departments = [] } = useQuery({
    queryKey: ["production-departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("*")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const baseAmount = parseFloat(data.base_amount) || 0;
      const taxAmount = parseFloat(data.tax_amount) || 0;
      const otherCharges = parseFloat(data.other_charges) || 0;
      
      const { error } = await supabase.from("utility_bills").insert({
        utility_type_id: data.utility_type_id,
        department_id: data.department_id || null,
        billing_period_start: data.billing_period_start ? format(data.billing_period_start, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd"),
        billing_period_end: data.billing_period_end ? format(data.billing_period_end, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd"),
        bill_date: format(data.bill_date, "yyyy-MM-dd"),
        due_date: data.due_date ? format(data.due_date, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd"),
        meter_reading_previous: parseFloat(data.meter_reading_previous) || null,
        meter_reading_current: parseFloat(data.meter_reading_current) || null,
        units_consumed: parseFloat(data.units_consumed) || null,
        unit_rate: parseFloat(data.unit_rate) || null,
        base_amount: baseAmount,
        tax_amount: taxAmount,
        other_charges: otherCharges,
        total_amount: baseAmount + taxAmount + otherCharges,
        remarks: data.remarks || null,
        created_by: user?.id,
        payment_status: "unpaid",
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Bill added successfully");
      setIsDialogOpen(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["utility-bills"] });
    },
    onError: (error) => toast.error("Failed to add bill: " + error.message),
  });

  // Mark as paid mutation
  const paymentMutation = useMutation({
    mutationFn: async () => {
      if (!selectedBill) return;
      const { error } = await supabase
        .from("utility_bills")
        .update({
          payment_status: "paid",
          payment_date: format(new Date(), "yyyy-MM-dd"),
          payment_mode: paymentData.payment_mode,
          payment_reference: paymentData.payment_reference || null,
        })
        .eq("id", selectedBill.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payment recorded");
      setIsPaymentDialogOpen(false);
      setSelectedBill(null);
      setPaymentData({ payment_mode: "", payment_reference: "" });
      queryClient.invalidateQueries({ queryKey: ["utility-bills"] });
    },
    onError: (error) => toast.error("Failed to record payment: " + error.message),
  });

  const resetForm = () => {
    setFormData({
      utility_type_id: "",
      department_id: "",
      billing_period_start: null,
      billing_period_end: null,
      bill_date: new Date(),
      due_date: null,
      meter_reading_previous: "",
      meter_reading_current: "",
      units_consumed: "",
      unit_rate: "",
      base_amount: "",
      tax_amount: "",
      other_charges: "",
      remarks: "",
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.utility_type_id || !formData.base_amount) {
      toast.error("Please fill required fields");
      return;
    }
    createMutation.mutate(formData);
  };

  // Auto-calculate units consumed
  const handleMeterReadingChange = (field: "meter_reading_previous" | "meter_reading_current", value: string) => {
    const newFormData = { ...formData, [field]: value };
    const prev = parseFloat(newFormData.meter_reading_previous) || 0;
    const curr = parseFloat(newFormData.meter_reading_current) || 0;
    if (prev && curr && curr > prev) {
      newFormData.units_consumed = (curr - prev).toString();
    }
    setFormData(newFormData);
  };

  const filteredBills = bills.filter((bill) => {
    const matchesSearch = bill.bill_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      bill.utility_types?.name?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || bill.payment_status === statusFilter;
    const matchesUtility = utilityFilter === "all" || bill.utility_type_id === utilityFilter;
    return matchesSearch && matchesStatus && matchesUtility;
  });

  const getStatusBadge = (bill: any) => {
    if (bill.payment_status === "paid") {
      return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Paid</Badge>;
    }
    const dueDate = parseISO(bill.due_date);
    const today = new Date();
    if (isAfter(today, dueDate)) {
      const daysOverdue = differenceInDays(today, dueDate);
      return <Badge variant="destructive">{daysOverdue}d Overdue</Badge>;
    }
    const daysUntilDue = differenceInDays(dueDate, today);
    if (daysUntilDue <= 7) {
      return <Badge variant="secondary">Due in {daysUntilDue}d</Badge>;
    }
    return <Badge variant="outline">Unpaid</Badge>;
  };

  const getUtilityIcon = (code: string) => {
    const IconComponent = UTILITY_ICONS[code] || Zap;
    return <IconComponent className="h-4 w-4" />;
  };

  // Summary stats
  const stats = {
    totalUnpaid: bills.filter(b => b.payment_status !== "paid").reduce((sum, b) => sum + Number(b.total_amount), 0),
    totalPaid: bills.filter(b => b.payment_status === "paid").reduce((sum, b) => sum + Number(b.total_amount), 0),
    overdue: bills.filter(b => b.payment_status !== "paid" && isAfter(new Date(), parseISO(b.due_date))).length,
    dueSoon: bills.filter(b => {
      if (b.payment_status === "paid") return false;
      const daysUntil = differenceInDays(parseISO(b.due_date), new Date());
      return daysUntil >= 0 && daysUntil <= 7;
    }).length,
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <PageHeader title="Utility Bills" description="Track recurring utility bills and payments" />
          <Button onClick={() => setIsDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Bill
          </Button>
        </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Unpaid Amount</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-destructive">₹{stats.totalUnpaid.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Paid This Month</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-500">₹{stats.totalPaid.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className={stats.overdue > 0 ? "border-destructive" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-destructive" />
              Overdue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.overdue}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Due This Week</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.dueSoon}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search bills..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={utilityFilter} onValueChange={setUtilityFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Utility" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {utilityTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="unpaid">Unpaid</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Bills Table */}
      <Card>
        <CardContent className="pt-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Utility</TableHead>
                  <TableHead>Bill #</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredBills.map((bill) => (
                  <TableRow key={bill.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getUtilityIcon(bill.utility_types?.code || "")}
                        <span>{bill.utility_types?.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{bill.bill_number}</TableCell>
                    <TableCell className="text-xs">
                      {format(parseISO(bill.billing_period_start), "dd MMM")} - {format(parseISO(bill.billing_period_end), "dd MMM")}
                    </TableCell>
                    <TableCell>{format(parseISO(bill.due_date), "dd MMM yy")}</TableCell>
                    <TableCell className="text-right">{bill.units_consumed || "-"}</TableCell>
                    <TableCell className="text-right font-medium">₹{Number(bill.total_amount).toLocaleString()}</TableCell>
                    <TableCell>{getStatusBadge(bill)}</TableCell>
                    <TableCell>
                      {bill.payment_status !== "paid" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => { setSelectedBill(bill); setIsPaymentDialogOpen(true); }}
                        >
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Pay
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {filteredBills.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      No utility bills found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Add Bill Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Utility Bill</DialogTitle>
            <DialogDescription>Record a new utility bill</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Utility Type *</Label>
                <Select value={formData.utility_type_id} onValueChange={(v) => setFormData({ ...formData, utility_type_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select utility" />
                  </SelectTrigger>
                  <SelectContent>
                    {utilityTypes.map((type) => (
                      <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Department</Label>
                <Select value={formData.department_id} onValueChange={(v) => setFormData({ ...formData, department_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((dept) => (
                      <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Billing Period Start</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {formData.billing_period_start ? format(formData.billing_period_start, "PPP") : "Select date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={formData.billing_period_start || undefined}
                      onSelect={(date) => setFormData({ ...formData, billing_period_start: date || null })}
                      initialFocus
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label>Billing Period End</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {formData.billing_period_end ? format(formData.billing_period_end, "PPP") : "Select date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={formData.billing_period_end || undefined}
                      onSelect={(date) => setFormData({ ...formData, billing_period_end: date || null })}
                      initialFocus
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Bill Date *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(formData.bill_date, "PPP")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={formData.bill_date}
                      onSelect={(date) => date && setFormData({ ...formData, bill_date: date })}
                      initialFocus
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label>Due Date *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {formData.due_date ? format(formData.due_date, "PPP") : "Select date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={formData.due_date || undefined}
                      onSelect={(date) => setFormData({ ...formData, due_date: date || null })}
                      initialFocus
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="border-t pt-4">
              <h4 className="font-medium mb-3">Meter Readings (Optional)</h4>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Previous Reading</Label>
                  <Input
                    type="number"
                    value={formData.meter_reading_previous}
                    onChange={(e) => handleMeterReadingChange("meter_reading_previous", e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Current Reading</Label>
                  <Input
                    type="number"
                    value={formData.meter_reading_current}
                    onChange={(e) => handleMeterReadingChange("meter_reading_current", e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Units Consumed</Label>
                  <Input
                    type="number"
                    value={formData.units_consumed}
                    onChange={(e) => setFormData({ ...formData, units_consumed: e.target.value })}
                    placeholder="0"
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <h4 className="font-medium mb-3">Amount Details</h4>
              <div className="grid grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label>Base Amount (₹) *</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.base_amount}
                    onChange={(e) => setFormData({ ...formData, base_amount: e.target.value })}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Tax (₹)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.tax_amount}
                    onChange={(e) => setFormData({ ...formData, tax_amount: e.target.value })}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Other Charges (₹)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.other_charges}
                    onChange={(e) => setFormData({ ...formData, other_charges: e.target.value })}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Total</Label>
                  <Input
                    readOnly
                    value={`₹${(
                      (parseFloat(formData.base_amount) || 0) +
                      (parseFloat(formData.tax_amount) || 0) +
                      (parseFloat(formData.other_charges) || 0)
                    ).toLocaleString()}`}
                    className="bg-muted font-medium"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Remarks</Label>
              <Textarea
                value={formData.remarks}
                onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                placeholder="Any additional notes"
                rows={2}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setIsDialogOpen(false); resetForm(); }}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                Add Bill
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Payment Dialog */}
      <Dialog open={isPaymentDialogOpen} onOpenChange={setIsPaymentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>
              {selectedBill?.utility_types?.name} - {selectedBill?.bill_number}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">Amount to Pay</p>
              <p className="text-2xl font-bold">₹{Number(selectedBill?.total_amount || 0).toLocaleString()}</p>
            </div>
            <div className="space-y-2">
              <Label>Payment Mode *</Label>
              <Select value={paymentData.payment_mode} onValueChange={(v) => setPaymentData({ ...paymentData, payment_mode: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select mode" />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_MODES.map((mode) => (
                    <SelectItem key={mode.value} value={mode.value}>{mode.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Reference Number</Label>
              <Input
                value={paymentData.payment_reference}
                onChange={(e) => setPaymentData({ ...paymentData, payment_reference: e.target.value })}
                placeholder="Transaction/Cheque number"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsPaymentDialogOpen(false); setSelectedBill(null); }}>
              Cancel
            </Button>
            <Button 
              onClick={() => paymentMutation.mutate()} 
              disabled={!paymentData.payment_mode || paymentMutation.isPending}
            >
              Confirm Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </ERPLayout>
  );
}
