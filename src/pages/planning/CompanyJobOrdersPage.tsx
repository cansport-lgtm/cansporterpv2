// Company Product Job Orders: job orders for our own sellable products
// (Standard / Final Ball). Same tables, status rules and floor page as
// Private Label Job Orders, with order_type = 'company' and CJO-YY-NNNN numbers.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { Eye, Factory, Plus } from "lucide-react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { CompanyJobOrderDialog } from "@/components/planning/CompanyJobOrderDialog";
import { fetchOrders, producedPct, statusVariant, type PljoOrder } from "@/lib/privateLabelJobOrder";

const PLANNING_EDIT_WINDOW_MS = 48 * 60 * 60 * 1000;

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

/** Product names and grades on an order, for the list and search. */
function summary(o: PljoOrder) {
  const lines = o.private_label_job_order_items ?? [];
  const names = lines.map((l) => l.products?.name).filter(Boolean) as string[];
  const codes = lines.map((l) => l.products?.code).filter(Boolean) as string[];
  const grades = [...new Set(lines.map((l) => l.products?.grades?.name).filter(Boolean) as string[])];
  return { names, codes, grades };
}

export default function CompanyJobOrdersPage() {
  const { hasRole, roles } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  // Same rule as Job Orders: a production_operator may edit within 48h of creation.
  const isProductionOperator = roles.some((r) => r.role === "production_operator") && !isSuperAdmin;
  const canEdit = (o: Pick<PljoOrder, "created_at"> | null) => {
    if (!o || !isProductionOperator) return true;
    return Date.now() - new Date(o.created_at).getTime() <= PLANNING_EDIT_WINDOW_MS;
  };

  const today = new Date();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [fromDate, setFromDate] = useState(format(startOfMonth(today), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(endOfMonth(today), "yyyy-MM-dd"));
  const [dialog, setDialog] = useState<{ id: string | null } | null>(null);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["pljo-list", "company", status, fromDate, toDate],
    queryFn: () => fetchOrders({ type: "company", status, from: fromDate, to: toDate }),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => {
      const s = summary(o);
      return [o.pl_job_order_number, o.remarks, ...s.names, ...s.codes, ...s.grades]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [orders, search]);

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Company Product Job Orders"
          description="Job orders for our own sellable products (Standard / Final Ball). Shown on the private label floor page too."
          icon={Factory}
          iconColor="bg-sky-600 text-white"
        >
          <Button onClick={() => setDialog({ id: null })}>
            <Plus className="mr-2 h-4 w-4" />
            New Company JO
          </Button>
        </PageHeader>

        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 py-4">
            <Input
              placeholder="Search number, product, code, grade…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-72"
            />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="Draft">Draft</SelectItem>
                <SelectItem value="Issued">Issued</SelectItem>
                <SelectItem value="Closed">Closed</SelectItem>
                <SelectItem value="Cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">From Date</Label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-40" />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">To Date</Label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-40" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>CJO #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Required By</TableHead>
                  <TableHead>Products</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead className="text-right">Total Dz</TableHead>
                  <TableHead>Produced</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-muted-foreground">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="py-8 text-center text-muted-foreground">
                      No company product job orders
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((o) => {
                    const lines = o.private_label_job_order_items ?? [];
                    const total = lines.reduce((s, l) => s + Number(l.quantity || 0), 0);
                    const produced = (o.private_label_job_order_progress ?? []).reduce((s, p) => s + Number(p.dozens), 0);
                    const pctDone = producedPct(produced, total);
                    const s = summary(o);
                    return (
                      <TableRow key={o.id} className="cursor-pointer" onClick={() => setDialog({ id: o.id })}>
                        <TableCell className="font-mono font-medium">{o.pl_job_order_number}</TableCell>
                        <TableCell>{o.order_date}</TableCell>
                        <TableCell>{o.required_by_date ?? "—"}</TableCell>
                        <TableCell className="max-w-[320px]">
                          <div className="truncate font-medium" title={s.names.join(", ")}>
                            {s.names[0] ?? "—"}
                            {s.names.length > 1 && (
                              <span className="font-normal text-muted-foreground"> +{s.names.length - 1} more</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{s.grades.join(", ") || "—"}</TableCell>
                        <TableCell className="text-right">{lines.length}</TableCell>
                        <TableCell className="text-right">{total.toLocaleString()}</TableCell>
                        <TableCell className="min-w-[130px]">
                          {o.status === "Draft" ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <div className="space-y-1">
                              <div className="text-xs">
                                {produced.toLocaleString()} Dz · {pctDone}%
                              </div>
                              <Progress
                                value={pctDone}
                                className={cn("h-2", o.production_done_at && "[&>div]:bg-green-600")}
                              />
                              {o.production_done_at && (
                                <div
                                  className="text-xs font-medium text-green-700"
                                  title={o.production_done_by_name ?? undefined}
                                >
                                  Production done
                                </div>
                              )}
                            </div>
                          )}
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
                          <Button size="icon" variant="ghost" className="h-8 w-8">
                            <Eye className="h-4 w-4" />
                          </Button>
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

      {dialog && (
        <CompanyJobOrderDialog
          key={dialog.id ?? "new"}
          orderId={dialog.id}
          onOpenChange={(o) => !o && setDialog(null)}
          canEdit={canEdit}
        />
      )}
    </ERPLayout>
  );
}
