import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, startOfDay } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter } from "@/components/ui/drawer";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Plus, CalendarIcon, Check, X, Lock, Wallet, ArrowUpRight, ArrowDownLeft, RefreshCw, Pencil, Printer } from "lucide-react";
import { cn } from "@/lib/utils";

// Check if a date is today
const isToday = (date: Date | string) => {
  const today = startOfDay(new Date());
  const checkDate = startOfDay(typeof date === 'string' ? parseISO(date) : date);
  return today.getTime() === checkDate.getTime();
};

const APPROVAL_THRESHOLDS = [
  { maxAmount: 500, approverLevel: "supervisor" },
  { maxAmount: 2000, approverLevel: "manager" },
  { maxAmount: 5000, approverLevel: "head" },
  { maxAmount: Infinity, approverLevel: "director" },
];

export default function PettyCashPage() {
  const { user, hasRole } = useAuth();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isClosingDialogOpen, setIsClosingDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<any>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  const [formData, setFormData] = useState({
    entry_type: "expense" as "expense" | "receipt" | "replenishment",
    category_id: "",
    description: "",
    amount: "",
    paid_to: "",
    receipt_number: "",
    entry_date: new Date(),
  });

  // Fetch previous closed fund's closing balance
  const { data: previousClosedFund } = useQuery({
    queryKey: ["petty-cash-prev-closed-fund", format(selectedDate, "yyyy-MM-dd")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("petty_cash_fund")
        .select("closing_balance, fund_date")
        .lt("fund_date", format(selectedDate, "yyyy-MM-dd"))
        .eq("status", "closed")
        .order("fund_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Fetch today's fund
  const { data: todayFund, refetch: refetchFund } = useQuery({
    queryKey: ["petty-cash-fund", format(selectedDate, "yyyy-MM-dd")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("petty_cash_fund")
        .select("*")
        .eq("fund_date", format(selectedDate, "yyyy-MM-dd"))
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Get effective opening balance - always prioritize previous closed fund's closing balance
  const effectiveOpeningBalance = useMemo(() => {
    // Always use the previous closed fund's closing balance if available (for both open and closed funds)
    if (previousClosedFund?.closing_balance !== null && previousClosedFund?.closing_balance !== undefined) {
      return Number(previousClosedFund.closing_balance);
    }
    // Fallback to stored opening balance only if no previous closed fund exists
    return Number(todayFund?.opening_balance || 0);
  }, [todayFund, previousClosedFund]);

  // Fetch entries for selected date
  const { data: entries = [], refetch: refetchEntries } = useQuery({
    queryKey: ["petty-cash-entries", format(selectedDate, "yyyy-MM-dd")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("petty_cash_entries")
        .select("*, expense_categories(*), approved_by_user:app_users!petty_cash_entries_approved_by_fkey(full_name), created_by_user:app_users!petty_cash_entries_created_by_fkey(full_name)")
        .eq("entry_date", format(selectedDate, "yyyy-MM-dd"))
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch categories
  const { data: categories = [] } = useQuery({
    queryKey: ["expense-categories-petty-cash"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expense_categories")
        .select("*")
        .eq("category_type", "petty_cash")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  // Calculate running balance using effective opening balance
  const runningBalance = useMemo(() => {
    let balance = effectiveOpeningBalance;
    
    entries.forEach((entry) => {
      if (entry.entry_type === "expense") {
        balance -= Number(entry.amount);
      } else {
        balance += Number(entry.amount);
      }
    });
    
    return balance;
  }, [effectiveOpeningBalance, entries]);

  // Open fund mutation
  const openFundMutation = useMutation({
    mutationFn: async (openingBalance: number) => {
      // Get previous day's closing balance (only from closed funds)
      const { data: prevFund } = await supabase
        .from("petty_cash_fund")
        .select("closing_balance")
        .lt("fund_date", format(selectedDate, "yyyy-MM-dd"))
        .eq("status", "closed")
        .order("fund_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Use previous closing balance as opening balance for new day
      const effectiveOpeningBalance = prevFund?.closing_balance ?? openingBalance ?? 0;

      const { error } = await supabase.from("petty_cash_fund").insert({
        fund_date: format(selectedDate, "yyyy-MM-dd"),
        opening_balance: effectiveOpeningBalance,
        status: "open",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Petty cash fund opened");
      refetchFund();
    },
    onError: (error) => toast.error("Failed to open fund: " + error.message),
  });

  // Close fund mutation
  const closeFundMutation = useMutation({
    mutationFn: async () => {
      if (!todayFund) return;
      
      const totalExpenses = entries
        .filter(e => e.entry_type === "expense")
        .reduce((sum, e) => sum + Number(e.amount), 0);
      
      const totalReceipts = entries
        .filter(e => e.entry_type !== "expense")
        .reduce((sum, e) => sum + Number(e.amount), 0);

      const { error } = await supabase
        .from("petty_cash_fund")
        .update({
          opening_balance: effectiveOpeningBalance, // Store the effective opening balance
          closing_balance: runningBalance,
          total_expenses: totalExpenses,
          total_receipts: totalReceipts,
          status: "closed",
          closed_by: user?.id,
          closed_at: new Date().toISOString(),
        })
        .eq("id", todayFund.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Fund closed for the day");
      setIsClosingDialogOpen(false);
      refetchFund();
    },
    onError: (error) => toast.error("Failed to close fund: " + error.message),
  });

  const createEntryMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      if (!todayFund) throw new Error("Fund not open");
      
      const { error } = await supabase.from("petty_cash_entries").insert({
        fund_id: todayFund.id,
        entry_date: format(data.entry_date, "yyyy-MM-dd"),
        entry_type: data.entry_type,
        category_id: data.category_id || null,
        description: data.description,
        amount: parseFloat(data.amount),
        paid_to: data.paid_to || null,
        receipt_number: data.receipt_number || null,
        created_by: user?.id,
        approval_status: data.entry_type === "expense" ? "pending" : "approved",
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(editingEntry ? "Entry updated successfully" : "Entry added successfully");
      setIsDialogOpen(false);
      setEditingEntry(null);
      setFormData({ entry_type: "expense", category_id: "", description: "", amount: "", paid_to: "", receipt_number: "", entry_date: new Date() });
      refetchEntries();
    },
    onError: (error) => toast.error("Failed to add entry: " + error.message),
  });

  // Approve/Reject mutation
  const updateApprovalMutation = useMutation({
    mutationFn: async ({ id, status, remarks }: { id: string; status: "approved" | "rejected"; remarks?: string }) => {
      const { error } = await supabase
        .from("petty_cash_entries")
        .update({
          approval_status: status,
          approved_by: user?.id,
          approved_at: new Date().toISOString(),
          approval_remarks: remarks,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Approval updated");
      refetchEntries();
    },
    onError: (error) => toast.error("Failed to update approval: " + error.message),
  });

  // Update entry mutation
  const updateEntryMutation = useMutation({
    mutationFn: async (data: typeof formData & { id: string }) => {
      const { error } = await supabase
        .from("petty_cash_entries")
        .update({
          entry_date: format(data.entry_date, "yyyy-MM-dd"),
          entry_type: data.entry_type,
          category_id: data.category_id || null,
          description: data.description,
          amount: parseFloat(data.amount),
          paid_to: data.paid_to || null,
          receipt_number: data.receipt_number || null,
        })
        .eq("id", data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Entry updated successfully");
      setIsDialogOpen(false);
      setEditingEntry(null);
      setFormData({ entry_type: "expense", category_id: "", description: "", amount: "", paid_to: "", receipt_number: "", entry_date: new Date() });
      refetchEntries();
    },
    onError: (error: Error) => toast.error("Failed to update entry: " + error.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.description || !formData.amount) {
      toast.error("Please fill required fields");
      return;
    }
    if (formData.entry_type === "expense" && !formData.category_id) {
      toast.error("Please select a category for expense entries");
      return;
    }
    if (editingEntry) {
      updateEntryMutation.mutate({ ...formData, id: editingEntry.id });
    } else {
      createEntryMutation.mutate(formData);
    }
  };

  const handleEditEntry = (entry: any) => {
    setEditingEntry(entry);
    setFormData({
      entry_type: entry.entry_type,
      category_id: entry.category_id || "",
      description: entry.description || "",
      amount: String(entry.amount),
      paid_to: entry.paid_to || "",
      receipt_number: entry.receipt_number || "",
      entry_date: entry.entry_date ? new Date(entry.entry_date) : new Date(),
    });
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingEntry(null);
    setFormData({ entry_type: "expense", category_id: "", description: "", amount: "", paid_to: "", receipt_number: "", entry_date: new Date() });
  };

  const getEntryTypeIcon = (type: string) => {
    switch (type) {
      case "expense": return <ArrowUpRight className="h-4 w-4 text-destructive" />;
      case "receipt": return <ArrowDownLeft className="h-4 w-4 text-green-500" />;
      case "replenishment": return <RefreshCw className="h-4 w-4 text-blue-500" />;
      default: return null;
    }
  };

  const getApprovalBadge = (status: string) => {
    switch (status) {
      case "approved": return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Approved</Badge>;
      case "rejected": return <Badge variant="destructive">Rejected</Badge>;
      default: return <Badge variant="secondary">Pending</Badge>;
    }
  };

  // Check if user is pettycash_handler role
  const isPettycashHandler = hasRole('pettycash_handler');

  const isFundClosed = todayFund?.status === "closed";
  const isTodayOrPast = startOfDay(selectedDate) <= startOfDay(new Date());

  // Check if entry can be edited by current user
  const canEditEntry = (entry: any) => {
    // If pettycash_handler, can only edit same-day entries
    if (isPettycashHandler) {
      return isToday(entry.entry_date);
    }
    // Other users can edit pending expenses or receipts/replenishments
    return true;
  };

  // Check if user can approve entries
  const canApprove = !isPettycashHandler;

  // Group expenses by category for print report
  const getCategorizedExpenses = () => {
    const expenseEntries = entries.filter(e => e.entry_type === "expense");
    const grouped: Record<string, { name: string; entries: typeof expenseEntries; total: number }> = {};
    
    expenseEntries.forEach(entry => {
      const categoryName = entry.expense_categories?.name || "Uncategorized";
      if (!grouped[categoryName]) {
        grouped[categoryName] = { name: categoryName, entries: [], total: 0 };
      }
      grouped[categoryName].entries.push(entry);
      grouped[categoryName].total += Number(entry.amount);
    });
    
    return Object.values(grouped).sort((a, b) => a.name.localeCompare(b.name));
  };

  const handlePrintReport = () => {
    const openingBalance = effectiveOpeningBalance;
    const totalExpenses = entries.filter(e => e.entry_type === "expense").reduce((sum, e) => sum + Number(e.amount), 0);
    const totalReceipts = entries.filter(e => e.entry_type !== "expense").reduce((sum, e) => sum + Number(e.amount), 0);
    const closingBalance = runningBalance;
    const categorizedExpenses = getCategorizedExpenses();
    const receiptEntries = entries.filter(e => e.entry_type !== "expense");
    
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error("Please allow popups to print the report");
      return;
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Petty Cash Report - ${format(selectedDate, "dd MMM yyyy")}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; padding: 20px; font-size: 12px; }
          .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 10px; }
          .header h1 { font-size: 18px; margin-bottom: 5px; }
          .header p { color: #666; }
          .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
          .summary-card { border: 1px solid #ddd; padding: 10px; text-align: center; }
          .summary-card .label { font-size: 10px; color: #666; margin-bottom: 5px; }
          .summary-card .value { font-size: 16px; font-weight: bold; }
          .summary-card .value.expense { color: #dc2626; }
          .summary-card .value.receipt { color: #16a34a; }
          .section { margin-bottom: 20px; }
          .section h2 { font-size: 14px; background: #f3f4f6; padding: 8px; margin-bottom: 10px; }
          .category-section { margin-bottom: 15px; }
          .category-header { font-weight: bold; background: #e5e7eb; padding: 5px 8px; display: flex; justify-content: space-between; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
          th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
          th { background: #f9fafb; font-weight: 600; }
          .text-right { text-align: right; }
          .total-row { font-weight: bold; background: #f3f4f6; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; }
          .signature-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 40px; }
          .signature-box { text-align: center; }
          .signature-line { border-top: 1px solid #333; margin-top: 40px; padding-top: 5px; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>PETTY CASH EXPENSE REPORT</h1>
          <p>Date: ${format(selectedDate, "EEEE, dd MMMM yyyy")}</p>
        </div>

        <div class="summary-grid">
          <div class="summary-card">
            <div class="label">Opening Balance</div>
            <div class="value">₹${openingBalance.toLocaleString()}</div>
          </div>
          <div class="summary-card">
            <div class="label">Total Receipts</div>
            <div class="value receipt">+₹${totalReceipts.toLocaleString()}</div>
          </div>
          <div class="summary-card">
            <div class="label">Total Expenses</div>
            <div class="value expense">-₹${totalExpenses.toLocaleString()}</div>
          </div>
          <div class="summary-card">
            <div class="label">Closing Balance</div>
            <div class="value">₹${closingBalance.toLocaleString()}</div>
          </div>
        </div>

        ${receiptEntries.length > 0 ? `
        <div class="section">
          <h2>RECEIPTS / REPLENISHMENTS</h2>
          <table>
            <thead>
              <tr>
                <th>Entry #</th>
                <th>Type</th>
                <th>Description</th>
                <th class="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${receiptEntries.map(entry => `
                <tr>
                  <td>${entry.entry_number}</td>
                  <td style="text-transform: capitalize;">${entry.entry_type}</td>
                  <td>${entry.description}</td>
                  <td class="text-right">₹${Number(entry.amount).toLocaleString()}</td>
                </tr>
              `).join('')}
              <tr class="total-row">
                <td colspan="3">Total Receipts</td>
                <td class="text-right">₹${totalReceipts.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        </div>
        ` : ''}

        <div class="section">
          <h2>EXPENSES BY CATEGORY</h2>
          ${categorizedExpenses.length > 0 ? categorizedExpenses.map(category => `
            <div class="category-section">
              <div class="category-header">
                <span>${category.name}</span>
                <span>₹${category.total.toLocaleString()}</span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Entry #</th>
                    <th>Description</th>
                    <th>Paid To</th>
                    <th>Status</th>
                    <th class="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  ${category.entries.map(entry => `
                    <tr>
                      <td>${entry.entry_number}</td>
                      <td>${entry.description}</td>
                      <td>${entry.paid_to || '-'}</td>
                      <td style="text-transform: capitalize;">${entry.approval_status}</td>
                      <td class="text-right">₹${Number(entry.amount).toLocaleString()}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `).join('') : '<p>No expenses recorded for this day.</p>'}
          
          ${categorizedExpenses.length > 0 ? `
          <table>
            <tr class="total-row">
              <td colspan="4">Grand Total Expenses</td>
              <td class="text-right">₹${totalExpenses.toLocaleString()}</td>
            </tr>
          </table>
          ` : ''}
        </div>

        <div class="footer">
          <div class="signature-grid">
            <div class="signature-box">
              <div class="signature-line">Prepared By</div>
            </div>
            <div class="signature-box">
              <div class="signature-line">Checked By</div>
            </div>
            <div class="signature-box">
              <div class="signature-line">Approved By</div>
            </div>
          </div>
        </div>

        <script>
          window.onload = function() { window.print(); }
        </script>
      </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
      <PageHeader 
        title="Petty Cash" 
        description="Daily small expense tracking with running balance"
      />

      {/* Date Selector & Fund Status */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex items-center gap-4">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-[200px] justify-start">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(selectedDate, "PPP")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(date) => date && setSelectedDate(date)}
                initialFocus
                className="pointer-events-auto"
              />
            </PopoverContent>
          </Popover>

          {todayFund ? (
            <Badge variant={isFundClosed ? "secondary" : "default"} className="text-sm py-1 px-3">
              {isFundClosed ? <Lock className="h-3 w-3 mr-1" /> : <Wallet className="h-3 w-3 mr-1" />}
              {isFundClosed ? "Fund Closed" : "Fund Open"}
            </Badge>
          ) : (
            <Button 
              size="sm" 
              onClick={() => openFundMutation.mutate(0)}
              disabled={!isTodayOrPast}
            >
              Open Fund
            </Button>
          )}
        </div>

        <div className="flex gap-2">
          {todayFund && entries.length > 0 && (
            <Button variant="outline" onClick={handlePrintReport}>
              <Printer className="mr-2 h-4 w-4" />
              Print Report
            </Button>
          )}
          {todayFund && !isFundClosed && (
            <>
              <Button onClick={() => setIsDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add Entry
              </Button>
              <Button variant="outline" onClick={() => setIsClosingDialogOpen(true)}>
                Close Day
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Opening Balance</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">₹{effectiveOpeningBalance.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Total Expenses</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-destructive">
              ₹{entries.filter(e => e.entry_type === "expense").reduce((sum, e) => sum + Number(e.amount), 0).toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Total Receipts</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-500">
              ₹{entries.filter(e => e.entry_type !== "expense").reduce((sum, e) => sum + Number(e.amount), 0).toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card className="border-primary">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Running Balance</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">₹{runningBalance.toLocaleString()}</p>
          </CardContent>
        </Card>
      </div>

      {/* Entries Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Entries for {format(selectedDate, "PPP")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">Type</TableHead>
                  <TableHead>Entry #</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Paid To</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {getEntryTypeIcon(entry.entry_type)}
                        <span className="text-xs capitalize">{entry.entry_type}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{entry.entry_number}</TableCell>
                    <TableCell>{entry.expense_categories?.name || "-"}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{entry.description}</TableCell>
                    <TableCell>{entry.paid_to || "-"}</TableCell>
                    <TableCell className={cn(
                      "text-right font-medium",
                      entry.entry_type === "expense" ? "text-destructive" : "text-green-500"
                    )}>
                      {entry.entry_type === "expense" ? "-" : "+"}₹{Number(entry.amount).toLocaleString()}
                    </TableCell>
                    <TableCell>{getApprovalBadge(entry.approval_status)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {/* Edit button - show for pending expenses OR for receipts/replenishments */}
                        {(entry.approval_status === "pending" || entry.entry_type !== "expense") && canEditEntry(entry) && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => handleEditEntry(entry)}
                            title="Edit entry"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {/* Approve/Reject buttons - only for pending expenses */}
                        {entry.approval_status === "pending" && entry.entry_type === "expense" && canApprove && (
                          <>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-green-500"
                            onClick={() => updateApprovalMutation.mutate({ id: entry.id, status: "approved" })}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive"
                            onClick={() => updateApprovalMutation.mutate({ id: entry.id, status: "rejected" })}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {entries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      {todayFund ? "No entries for this date" : "Open the fund to start adding entries"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Add Entry Dialog/Drawer - Responsive */}
      {isMobile ? (
        <Drawer open={isDialogOpen} onOpenChange={(open) => { if (!open) handleCloseDialog(); else setIsDialogOpen(true); }}>
          <DrawerContent>
            <DrawerHeader className="text-left">
              <DrawerTitle>{editingEntry ? "Edit Petty Cash Entry" : "Add Petty Cash Entry"}</DrawerTitle>
              <DrawerDescription>{editingEntry ? "Update existing transaction" : "Record a new petty cash transaction"}</DrawerDescription>
            </DrawerHeader>
            <ScrollArea className="max-h-[60vh] px-4">
              <form id="petty-cash-form-mobile" onSubmit={handleSubmit} className="space-y-4 pb-4">
                <div className="space-y-2">
                  <Label>Entry Date *</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start">
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {format(formData.entry_date, "PPP")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={formData.entry_date}
                        onSelect={(date) => date && setFormData({ ...formData, entry_date: date })}
                        initialFocus
                        className="pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-2">
                  <Label>Entry Type</Label>
                  <Select
                    value={formData.entry_type}
                    onValueChange={(v) => setFormData({ ...formData, entry_type: v as any })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="expense">Expense</SelectItem>
                      <SelectItem value="receipt">Receipt</SelectItem>
                      <SelectItem value="replenishment">Replenishment</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {formData.entry_type === "expense" && (
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select
                      value={formData.category_id}
                      onValueChange={(v) => setFormData({ ...formData, category_id: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Description *</Label>
                  <Textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Enter description"
                    rows={2}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Amount (₹) *</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    placeholder="0.00"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Receipt #</Label>
                  <Input
                    value={formData.receipt_number}
                    onChange={(e) => setFormData({ ...formData, receipt_number: e.target.value })}
                    placeholder="Receipt number"
                  />
                </div>

                {formData.entry_type === "expense" && (
                  <div className="space-y-2">
                    <Label>Paid To</Label>
                    <Input
                      value={formData.paid_to}
                      onChange={(e) => setFormData({ ...formData, paid_to: e.target.value })}
                      placeholder="Vendor/Person name"
                    />
                  </div>
                )}
              </form>
            </ScrollArea>
            <DrawerFooter className="pt-2">
              <Button form="petty-cash-form-mobile" type="submit" disabled={createEntryMutation.isPending || updateEntryMutation.isPending}>
                {editingEntry ? "Update Entry" : "Add Entry"}
              </Button>
              <Button type="button" variant="outline" onClick={handleCloseDialog}>
                Cancel
              </Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={isDialogOpen} onOpenChange={(open) => { if (!open) handleCloseDialog(); else setIsDialogOpen(true); }}>
          <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col">
            <DialogHeader className="flex-shrink-0">
              <DialogTitle>{editingEntry ? "Edit Petty Cash Entry" : "Add Petty Cash Entry"}</DialogTitle>
              <DialogDescription>{editingEntry ? "Update existing transaction" : "Record a new petty cash transaction"}</DialogDescription>
            </DialogHeader>
            <ScrollArea className="flex-1 overflow-auto">
              <form id="petty-cash-form-desktop" onSubmit={handleSubmit} className="space-y-4 pr-4">
                <div className="space-y-2">
                  <Label>Entry Date *</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start">
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {format(formData.entry_date, "PPP")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={formData.entry_date}
                        onSelect={(date) => date && setFormData({ ...formData, entry_date: date })}
                        initialFocus
                        className="pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-2">
                  <Label>Entry Type</Label>
                  <Select
                    value={formData.entry_type}
                    onValueChange={(v) => setFormData({ ...formData, entry_type: v as any })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="expense">Expense</SelectItem>
                      <SelectItem value="receipt">Receipt</SelectItem>
                      <SelectItem value="replenishment">Replenishment</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {formData.entry_type === "expense" && (
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select
                      value={formData.category_id}
                      onValueChange={(v) => setFormData({ ...formData, category_id: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Description *</Label>
                  <Textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Enter description"
                    rows={2}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Amount (₹) *</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={formData.amount}
                      onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Receipt #</Label>
                    <Input
                      value={formData.receipt_number}
                      onChange={(e) => setFormData({ ...formData, receipt_number: e.target.value })}
                      placeholder="Receipt number"
                    />
                  </div>
                </div>

                {formData.entry_type === "expense" && (
                  <div className="space-y-2">
                    <Label>Paid To</Label>
                    <Input
                      value={formData.paid_to}
                      onChange={(e) => setFormData({ ...formData, paid_to: e.target.value })}
                      placeholder="Vendor/Person name"
                    />
                  </div>
                )}
              </form>
            </ScrollArea>
            <DialogFooter className="flex-shrink-0 flex-col sm:flex-row gap-2 pt-4">
              <Button type="button" variant="outline" onClick={handleCloseDialog}>
                Cancel
              </Button>
              <Button form="petty-cash-form-desktop" type="submit" disabled={createEntryMutation.isPending || updateEntryMutation.isPending}>
                {editingEntry ? "Update Entry" : "Add Entry"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Close Day Dialog */}
      <Dialog open={isClosingDialogOpen} onOpenChange={setIsClosingDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close Petty Cash for {format(selectedDate, "PPP")}</DialogTitle>
            <DialogDescription>This will lock all entries for today. Are you sure?</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <div className="flex justify-between">
              <span>Opening Balance:</span>
              <span className="font-medium">₹{effectiveOpeningBalance.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-destructive">
              <span>Total Expenses:</span>
              <span>-₹{entries.filter(e => e.entry_type === "expense").reduce((sum, e) => sum + Number(e.amount), 0).toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-green-500">
              <span>Total Receipts:</span>
              <span>+₹{entries.filter(e => e.entry_type !== "expense").reduce((sum, e) => sum + Number(e.amount), 0).toLocaleString()}</span>
            </div>
            <div className="border-t pt-2 flex justify-between font-bold">
              <span>Closing Balance:</span>
              <span>₹{runningBalance.toLocaleString()}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsClosingDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => closeFundMutation.mutate()} disabled={closeFundMutation.isPending}>
              Confirm Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </ERPLayout>
  );
}
