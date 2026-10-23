import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { Eye, KeyRound, ListOrdered, Palette, Plus, Ruler, Tag } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { PrivateLabelJobOrderDialog } from "@/components/planning/PrivateLabelJobOrderDialog";
import { PrivateLabelSizesDialog } from "@/components/planning/PrivateLabelSizesDialog";
import { PrivateLabelColorsDialog } from "@/components/planning/PrivateLabelColorsDialog";
import { PrivateLabelFloorPinDialog } from "@/components/planning/PrivateLabelFloorPinDialog";
import { PrivateLabelFloorSequenceDialog } from "@/components/planning/PrivateLabelFloorSequenceDialog";
import {
  fetchOrders,
  isImage,
  producedPct,
  publicUrl,
  statusVariant,
  type PljoOrder,
} from "@/lib/privateLabelJobOrder";

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

export default function PrivateLabelJobOrdersPage() {
  const { hasRole, roles, hasModulePermission } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  // Floor sequence: the same people who can issue (the database checks the role too).
  const canSequence = hasModulePermission("planning", "edit");
  // Same rule as Job Orders: a production_operator may edit within 48h of creation.
  const isProductionOperator = roles.some((r) => r.role === "production_operator") && !isSuperAdmin;
  const canEdit = (o: Pick<PljoOrder, "created_at"> | null) => {
    if (!o || !isProductionOperator) return true;
    return Date.now() - new Date(o.created_at).getTime() <= PLANNING_EDIT_WINDOW_MS;
  };

  const today = new Date();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [gradeId, setGradeId] = useState("all");
  const [fromDate, setFromDate] = useState(format(startOfMonth(today), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(endOfMonth(today), "yyyy-MM-dd"));
  const [dialog, setDialog] = useState<{ id: string | null } | null>(null);
  const [sizesOpen, setSizesOpen] = useState(false);
  const [colorsOpen, setColorsOpen] = useState(false);
  const [floorPinOpen, setFloorPinOpen] = useState(false);
  const [sequenceOpen, setSequenceOpen] = useState(false);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["pljo-list", "private_label", status, fromDate, toDate],
    queryFn: () => fetchOrders({ type: "private_label", status, from: fromDate, to: toDate }),
  });

  const { data: grades = [] } = useQuery({
    queryKey: ["pljo-grades"],
    queryFn: async () => {
      const { data, error } = await supabase.from("grades").select("id, name, code").eq("is_active", true).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byGrade = gradeId === "all" ? orders : orders.filter((o) => o.grade_id === gradeId);
    if (!q) return byGrade;
    return byGrade.filter((o) =>
      [o.pl_job_order_number, o.customers?.name, o.billing_customer?.name, o.brand_name, o.customer_po_ref, o.grades?.name, o.remarks]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [orders, search, gradeId]);

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Private Label Job Orders"
          description="Job orders for private-label customers: grade, logo, sizes, packing and master packing"
          icon={Tag}
          iconColor="bg-fuchsia-600 text-white"
        >
          {isSuperAdmin && (
            <Button variant="outline" onClick={() => setFloorPinOpen(true)}>
              <KeyRound className="mr-2 h-4 w-4" />
              Floor PIN
            </Button>
          )}
          {canSequence && (
            <Button variant="outline" onClick={() => setSequenceOpen(true)}>
              <ListOrdered className="mr-2 h-4 w-4" />
              Floor sequence
            </Button>
          )}
          <Button variant="outline" onClick={() => setSizesOpen(true)}>
            <Ruler className="mr-2 h-4 w-4" />
            Sizes
          </Button>
          <Button variant="outline" onClick={() => setColorsOpen(true)}>
            <Palette className="mr-2 h-4 w-4" />
            Colors
          </Button>
          <Button onClick={() => setDialog({ id: null })}>
            <Plus className="mr-2 h-4 w-4" />
            New Private Label JO
          </Button>
        </PageHeader>

        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 py-4">
            <Input
              placeholder="Search number, customer, brand, PO, grade…"
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
            <Select value={gradeId} onValueChange={setGradeId}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Grades</SelectItem>
                {grades.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
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
                  <TableHead className="text-center" title="Floor sequence">Seq</TableHead>
                  <TableHead>PLJO #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Required By</TableHead>
                  <TableHead>Customer / Brand</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead>Logo</TableHead>
                  <TableHead className="text-right">Sizes</TableHead>
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
                    <TableCell colSpan={13} className="text-center text-muted-foreground">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={13} className="py-8 text-center text-muted-foreground">
                      No private label job orders
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((o) => {
                    const lines = o.private_label_job_order_items ?? [];
                    const total = lines.reduce((s, l) => s + Number(l.quantity || 0), 0);
                    const produced = (o.private_label_job_order_progress ?? []).reduce((s, p) => s + Number(p.dozens), 0);
                    const pctDone = producedPct(produced, total);
                    const logo = o.private_label_job_order_attachments?.find((a) => a.kind === "logo");
                    return (
                      <TableRow key={o.id} className="cursor-pointer" onClick={() => setDialog({ id: o.id })}>
                        <TableCell className="text-center">
                          {o.status === "Issued" && o.private_label_floor_sequence ? (
                            <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-muted px-1.5 font-bold">
                              {o.private_label_floor_sequence.seq}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono font-medium">{o.pl_job_order_number}</TableCell>
                        <TableCell>{o.order_date}</TableCell>
                        <TableCell>{o.required_by_date ?? "—"}</TableCell>
                        <TableCell>
                          <div className="font-medium">{o.customers?.name}</div>
                          {o.brand_name && <div className="text-xs text-muted-foreground">{o.brand_name}</div>}
                          {o.billing_customer_id !== o.customer_id && o.billing_customer?.name && (
                            <div className="text-xs text-muted-foreground">Bill to: {o.billing_customer.name}</div>
                          )}
                        </TableCell>
                        <TableCell>{o.grades?.name}</TableCell>
                        <TableCell>
                          {logo ? (
                            isImage(logo.mime_type) ? (
                              <img
                                src={publicUrl(logo.file_path)}
                                alt="logo"
                                className="h-8 w-12 rounded border bg-white object-contain"
                              />
                            ) : (
                              <span className="text-xs">File</span>
                            )
                          ) : (
                            <span className="text-xs text-amber-600">Missing</span>
                          )}
                        </TableCell>
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
        <PrivateLabelJobOrderDialog
          key={dialog.id ?? "new"}
          orderId={dialog.id}
          onOpenChange={(o) => !o && setDialog(null)}
          canEdit={canEdit}
        />
      )}
      <PrivateLabelSizesDialog open={sizesOpen} onOpenChange={setSizesOpen} />
      <PrivateLabelColorsDialog open={colorsOpen} onOpenChange={setColorsOpen} />
      {isSuperAdmin && <PrivateLabelFloorPinDialog open={floorPinOpen} onOpenChange={setFloorPinOpen} />}
      {canSequence && <PrivateLabelFloorSequenceDialog open={sequenceOpen} onOpenChange={setSequenceOpen} />}
    </ERPLayout>
  );
}
