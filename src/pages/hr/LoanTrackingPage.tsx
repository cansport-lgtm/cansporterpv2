import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { MetricCard } from "@/components/shared/MetricCard";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { DollarSign, Wallet, TrendingDown, Users, Search } from "lucide-react";
import { format } from "date-fns";

interface Loan {
  id: string;
  employee_id: string;
  loan_amount: number;
  monthly_installment: number;
  total_installments: number;
  paid_installments: number | null;
  remaining_amount: number;
  loan_date: string;
  status: string | null;
  purpose: string | null;
  employees: { employee_code: string; full_name: string } | null;
}

interface LoanPayment {
  id: string;
  loan_id: string;
  employee_id: string;
  payment_month: number;
  payment_year: number;
  amount: number;
  created_at: string;
}

interface EmployeeLoanSummary {
  id: string;
  name: string;
  code: string;
  totalLoaned: number;
  totalRepaid: number;
  outstanding: number;
  monthlyEmi: number;
  paidInstallments: number;
  totalInstallments: number;
  loans: Loan[];
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const formatRs = (value: number) => `Rs. ${Math.round(value).toLocaleString()}`;

const LoanTrackingPage = () => {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("outstanding");

  // Disbursed loans only — pending/rejected requests are not money owed
  const { data: loans = [], isLoading } = useQuery({
    queryKey: ["loan-tracking-loans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_loans")
        .select("id, employee_id, loan_amount, monthly_installment, total_installments, paid_installments, remaining_amount, loan_date, status, purpose, employees(employee_code, full_name)")
        .in("status", ["approved", "active", "completed"])
        .order("loan_date", { ascending: false });
      if (error) throw error;
      return data as Loan[];
    },
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["loan-tracking-payments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("loan_payment_history")
        .select("id, loan_id, employee_id, payment_month, payment_year, amount, created_at")
        .order("payment_year", { ascending: false })
        .order("payment_month", { ascending: false });
      if (error) throw error;
      return data as LoanPayment[];
    },
  });

  const summaries = useMemo(() => {
    const byEmployee = new Map<string, EmployeeLoanSummary>();
    for (const loan of loans) {
      let summary = byEmployee.get(loan.employee_id);
      if (!summary) {
        summary = {
          id: loan.employee_id,
          name: loan.employees?.full_name || "Unknown",
          code: loan.employees?.employee_code || "",
          totalLoaned: 0,
          totalRepaid: 0,
          outstanding: 0,
          monthlyEmi: 0,
          paidInstallments: 0,
          totalInstallments: 0,
          loans: [],
        };
        byEmployee.set(loan.employee_id, summary);
      }
      const amount = Number(loan.loan_amount);
      const remaining = Number(loan.remaining_amount);
      summary.totalLoaned += amount;
      summary.outstanding += remaining;
      summary.totalRepaid += Math.max(0, amount - remaining);
      summary.paidInstallments += loan.paid_installments || 0;
      summary.totalInstallments += loan.total_installments;
      if (remaining > 0) {
        summary.monthlyEmi += Number(loan.monthly_installment);
      }
      summary.loans.push(loan);
    }
    return Array.from(byEmployee.values()).sort((a, b) => b.outstanding - a.outstanding);
  }, [loans]);

  const filteredSummaries = useMemo(() => {
    const term = search.trim().toLowerCase();
    return summaries.filter((s) => {
      if (filter === "outstanding" && s.outstanding <= 0) return false;
      if (filter === "completed" && s.outstanding > 0) return false;
      if (term && !s.name.toLowerCase().includes(term) && !s.code.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [summaries, search, filter]);

  const stats = useMemo(() => {
    const totalLoaned = summaries.reduce((sum, s) => sum + s.totalLoaned, 0);
    const totalOutstanding = summaries.reduce((sum, s) => sum + s.outstanding, 0);
    return {
      totalLoaned,
      totalOutstanding,
      totalRecovered: totalLoaned - totalOutstanding,
      employeesWithOutstanding: summaries.filter((s) => s.outstanding > 0).length,
    };
  }, [summaries]);

  const paymentsByEmployee = useMemo(() => {
    const map = new Map<string, LoanPayment[]>();
    for (const payment of payments) {
      const list = map.get(payment.employee_id) || [];
      list.push(payment);
      map.set(payment.employee_id, list);
    }
    return map;
  }, [payments]);

  const columns = [
    {
      header: "Employee",
      key: "name",
      render: (s: EmployeeLoanSummary) => (
        <div>
          <div className="font-medium">{s.name}</div>
          <div className="text-xs text-muted-foreground">{s.code}</div>
        </div>
      ),
    },
    {
      header: "Total Loaned",
      key: "totalLoaned",
      className: "text-right",
      render: (s: EmployeeLoanSummary) => <span className="tabular-nums">{formatRs(s.totalLoaned)}</span>,
    },
    {
      header: "Repaid",
      key: "totalRepaid",
      className: "text-right",
      render: (s: EmployeeLoanSummary) => (
        <span className="tabular-nums text-green-600 dark:text-green-400">{formatRs(s.totalRepaid)}</span>
      ),
    },
    {
      header: "Outstanding",
      key: "outstanding",
      className: "text-right",
      render: (s: EmployeeLoanSummary) => (
        <span className={cn("tabular-nums font-semibold", s.outstanding > 0 ? "text-destructive" : "text-muted-foreground")}>
          {formatRs(s.outstanding)}
        </span>
      ),
    },
    {
      header: "Monthly EMI",
      key: "monthlyEmi",
      className: "text-right",
      render: (s: EmployeeLoanSummary) => (
        <span className="tabular-nums">{s.monthlyEmi > 0 ? formatRs(s.monthlyEmi) : "-"}</span>
      ),
    },
    {
      header: "Repayment Progress",
      key: "progress",
      render: (s: EmployeeLoanSummary) => {
        const pct = s.totalLoaned > 0 ? Math.min(100, Math.round((s.totalRepaid / s.totalLoaned) * 100)) : 0;
        return (
          <div className="min-w-[140px] space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{s.paidInstallments} / {s.totalInstallments} installments</span>
              <span>{pct}%</span>
            </div>
            <Progress value={pct} className="h-2" />
          </div>
        );
      },
    },
    {
      header: "Status",
      key: "status",
      render: (s: EmployeeLoanSummary) => (
        <span
          className={cn(
            "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
            s.outstanding > 0
              ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
              : "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
          )}
        >
          {s.outstanding > 0 ? "Outstanding" : "Fully Repaid"}
        </span>
      ),
    },
  ];

  const renderEmployeeDetail = (s: EmployeeLoanSummary) => {
    const employeePayments = paymentsByEmployee.get(s.id) || [];
    return (
      <div className="p-4 grid gap-6 lg:grid-cols-2">
        <div>
          <h4 className="text-sm font-semibold mb-2">Loans ({s.loans.length})</h4>
          <div className="rounded-md border bg-background overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 text-left font-semibold">Date</th>
                  <th className="px-3 py-2 text-right font-semibold">Amount</th>
                  <th className="px-3 py-2 text-right font-semibold">EMI</th>
                  <th className="px-3 py-2 text-center font-semibold">Installments</th>
                  <th className="px-3 py-2 text-right font-semibold">Remaining</th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {s.loans.map((loan) => (
                  <tr key={loan.id} className="border-b last:border-b-0">
                    <td className="px-3 py-2">
                      <div>{format(new Date(loan.loan_date), "dd MMM yyyy")}</div>
                      {loan.purpose && (
                        <div className="text-xs text-muted-foreground">{loan.purpose}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatRs(Number(loan.loan_amount))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatRs(Number(loan.monthly_installment))}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{loan.paid_installments || 0} / {loan.total_installments}</td>
                    <td className={cn("px-3 py-2 text-right tabular-nums", Number(loan.remaining_amount) > 0 && "font-medium text-destructive")}>
                      {formatRs(Number(loan.remaining_amount))}
                    </td>
                    <td className="px-3 py-2 capitalize">{loan.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h4 className="text-sm font-semibold mb-2">Payment History ({employeePayments.length})</h4>
          {employeePayments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No EMI deductions recorded yet.</p>
          ) : (
            <div className="rounded-md border bg-background overflow-x-auto max-h-64 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr className="border-b text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 text-left font-semibold">Salary Month</th>
                    <th className="px-3 py-2 text-right font-semibold">Amount Deducted</th>
                  </tr>
                </thead>
                <tbody>
                  {employeePayments.map((payment) => (
                    <tr key={payment.id} className="border-b last:border-b-0">
                      <td className="px-3 py-2">{MONTHS[payment.payment_month - 1] || payment.payment_month} {payment.payment_year}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatRs(Number(payment.amount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Loan Tracking"
          description="Outstanding loan balances and repayment tracking for all employees"
        />

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Total Outstanding"
            value={formatRs(stats.totalOutstanding)}
            description="Amount yet to be recovered"
            icon={Wallet}
            iconColor="text-destructive"
          />
          <MetricCard
            title="Total Loaned"
            value={formatRs(stats.totalLoaned)}
            description="All disbursed loans"
            icon={DollarSign}
          />
          <MetricCard
            title="Total Recovered"
            value={formatRs(stats.totalRecovered)}
            description="Repaid via EMI deductions"
            icon={TrendingDown}
            iconColor="text-green-600"
          />
          <MetricCard
            title="Employees with Loans"
            value={stats.employeesWithOutstanding}
            description="Currently owing"
            icon={Users}
          />
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search employee name or code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="outstanding">Outstanding Only</SelectItem>
              <SelectItem value="completed">Fully Repaid Only</SelectItem>
              <SelectItem value="all">All Employees</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <DataTable
          columns={columns}
          data={filteredSummaries}
          expandedRowRender={renderEmployeeDetail}
          emptyMessage={isLoading ? "Loading..." : "No employee loans found"}
        />
      </div>
    </ERPLayout>
  );
};

export default LoanTrackingPage;
