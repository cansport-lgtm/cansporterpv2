import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth } from "date-fns";
import { List, Boxes, Loader2, Info } from "lucide-react";
import { Link } from "react-router-dom";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";

type LedgerRow = {
  id: string;
  txn_date: string;
  quantity_in: number;
  quantity_out: number;
  balance_quantity: number;
  unit_cost: number;
  source_type: string;
  reference_number: string | null;
  remarks: string | null;
  rw_locations: { code: string; name: string } | null;
  grades: { code: string; name: string } | null;
  rw_defect_grades: { code: string; name: string } | null;
  app_users: { full_name: string | null } | null;
};

// Label and tone per movement kind; the Phase 2 kinds are listed so a ledger
// written by a later release still reads correctly here.
const SOURCE: Record<string, { label: string; variant: "soft" | "info" | "warning" | "success" | "destructive" | "secondary" }> = {
  checker_entry: { label: "Checker entry", variant: "soft" },
  cover_out: { label: "Cover out", variant: "warning" },
  cover_in: { label: "Cover in", variant: "warning" },
  handover_out: { label: "Handover out", variant: "info" },
  handover_in: { label: "Handover in", variant: "info" },
  store_receipt: { label: "Store receipt", variant: "success" },
  count_adjustment: { label: "Count adj.", variant: "destructive" },
  sale_issue: { label: "Sale issue", variant: "secondary" },
  opening: { label: "Opening", variant: "secondary" },
};

const fmt = (n: number) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function BallLedgerPage() {
  const [fromDate, setFromDate] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [locationFilter, setLocationFilter] = useState("all");
  const [gradeFilter, setGradeFilter] = useState("all");

  const { data: locations = [] } = useQuery({
    queryKey: ["rw-locations-active"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("rw_locations").select("id, code, name").eq("is_active", true).order("code");
      return (data || []) as { id: string; code: string; name: string }[];
    },
  });

  const { data: grades = [] } = useQuery({
    queryKey: ["rw-defect-grades-active"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("rw_defect_grades").select("id, code, name").eq("is_active", true).order("sort_order");
      return (data || []) as { id: string; code: string; name: string }[];
    },
  });

  const { data: rows = [], isLoading } = useQuery<LedgerRow[]>({
    queryKey: ["rw-ball-ledger", fromDate, toDate, locationFilter, gradeFilter],
    queryFn: async () => {
      let q = (supabase as any)
        .from("rw_ball_ledger")
        .select(
          "id, txn_date, quantity_in, quantity_out, balance_quantity, unit_cost," +
          "source_type, reference_number, remarks," +
          "rw_locations(code, name), grades(code, name), rw_defect_grades(code, name)," +
          "app_users(full_name)"
        )
        .gte("txn_date", fromDate)
        .lte("txn_date", toDate)
        .order("txn_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(500);
      if (locationFilter !== "all") q = q.eq("location_id", locationFilter);
      if (gradeFilter !== "all") q = q.eq("defect_grade_id", gradeFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as LedgerRow[];
    },
    enabled: !!fromDate && !!toDate,
  });

  const hasCoverPair = useMemo(
    () => rows.some((r) => r.source_type === "cover_out" || r.source_type === "cover_in"),
    [rows],
  );

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title="Ball Ledger"
          description="Every movement of leaker and reject balls, with a running balance"
          icon={List}
          iconColor="bg-primary text-primary-foreground"
        >
          <Button variant="outline" asChild>
            <Link to="/rejections/bin-stock"><Boxes className="h-4 w-4 mr-2" /> Bin stock</Link>
          </Button>
        </PageHeader>

        <Card>
          <CardContent className="p-3 md:p-4 flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" className="w-40" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" className="w-40" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Location</Label>
              <Select value={locationFilter} onValueChange={setLocationFilter}>
                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All locations</SelectItem>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.code} — {l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Defect grade</Label>
              <Select value={gradeFilter} onValueChange={setGradeFilter}>
                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All grades</SelectItem>
                  {grades.map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="ml-auto">
              <Badge variant="secondary">{rows.length} movements</Badge>
            </div>
          </CardContent>
        </Card>

        {hasCoverPair && (
          <div className="flex items-start gap-2 rounded-lg bg-sky-500/[0.06] ring-1 ring-inset ring-sky-500/20 px-3 py-2 text-[12.5px] text-sky-900 dark:text-sky-200">
            <Info className="h-4 w-4 text-sky-500 shrink-0 mt-0.5" />
            <span>
              A cover transfer shows as a pair — cores out of the Jorr bin, covered balls into the
              Final bin. Any shortfall stays visible as the transfer's variance.
            </span>
          </div>
        )}

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading
              </div>
            ) : !rows.length ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No movements in this period.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[1000px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Grade</TableHead>
                      <TableHead>Defect grade</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">In</TableHead>
                      <TableHead className="text-right">Out</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead>Entered by</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const src = SOURCE[r.source_type] ?? { label: r.source_type, variant: "secondary" as const };
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="whitespace-nowrap text-muted-foreground text-sm">
                            {format(new Date(r.txn_date), "dd MMM yyyy")}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{r.reference_number ?? "—"}</TableCell>
                          <TableCell className="font-semibold">{r.rw_locations?.code}</TableCell>
                          <TableCell className="font-display font-bold">{r.grades?.name}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {r.rw_defect_grades?.name}
                          </TableCell>
                          <TableCell><Badge variant={src.variant}>{src.label}</Badge></TableCell>
                          <TableCell className="text-right tabular-nums font-semibold text-emerald-600">
                            {Number(r.quantity_in) ? `+${fmt(r.quantity_in)}` : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-semibold text-destructive">
                            {Number(r.quantity_out) ? `−${fmt(r.quantity_out)}` : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-bold">
                            {fmt(r.balance_quantity)}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                            {r.app_users?.full_name ?? "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
