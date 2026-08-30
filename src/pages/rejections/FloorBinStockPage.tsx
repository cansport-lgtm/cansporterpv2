import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Boxes, List, Workflow, Loader2 } from "lucide-react";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { Link } from "react-router-dom";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";

type StockRow = {
  id: string;
  quantity: number;
  unit_cost: number;
  stock_value: number;
  first_movement_date: string | null;
  last_movement_date: string | null;
  rw_locations: { code: string; name: string; location_type: string } | null;
  products: { code: string; name: string } | null;
  rw_defect_grades: { code: string; name: string; defect_type: string; onward_route: string } | null;
};

const fmt = (n: number) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function FloorBinStockPage() {
  const [locationFilter, setLocationFilter] = useState("all");

  const { data: rows = [], isLoading } = useQuery<StockRow[]>({
    queryKey: ["rw-ball-stock"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("rw_ball_stock")
        .select(
          "id, quantity, unit_cost, stock_value, first_movement_date, last_movement_date," +
          "rw_locations(code, name, location_type)," +
          "products(code, name)," +
          "rw_defect_grades(code, name, defect_type, onward_route)"
        );
      if (error) throw error;
      return (data || []) as StockRow[];
    },
  });

  const visible = useMemo(
    () =>
      rows
        .filter((r) => Number(r.quantity) !== 0)
        .filter((r) => locationFilter === "all" || r.rw_locations?.code === locationFilter)
        .sort((a, b) => {
          const l = (a.rw_locations?.code ?? "").localeCompare(b.rw_locations?.code ?? "");
          if (l) return l;
          return (a.products?.code ?? "").localeCompare(b.products?.code ?? "");
        }),
    [rows, locationFilter],
  );

  const locations = useMemo(() => {
    const m = new Map<string, { code: string; name: string; type: string; qty: number; value: number }>();
    for (const r of rows) {
      const code = r.rw_locations?.code;
      if (!code) continue;
      const cur = m.get(code) ?? {
        code,
        name: r.rw_locations!.name,
        type: r.rw_locations!.location_type,
        qty: 0,
        value: 0,
      };
      cur.qty += Number(r.quantity || 0);
      cur.value += Number(r.stock_value || 0);
      m.set(code, cur);
    }
    return [...m.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [rows]);

  const totalValue = rows.reduce((s, r) => s + Number(r.stock_value || 0), 0);

  const ageDays = (d: string | null) =>
    d ? differenceInCalendarDays(new Date(), parseISO(d)) : null;

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title="Floor Bin & Leaker WIP Stock"
          description="What each department is physically holding right now"
          icon={Boxes}
          iconColor="bg-primary text-primary-foreground"
        >
          <Button variant="outline" asChild>
            <Link to="/rejections/ledger"><List className="h-4 w-4 mr-2" /> Ball ledger</Link>
          </Button>
        </PageHeader>

        <div className="dashboard-grid">
          {locations.map((l) => (
            <MetricCard
              key={l.code}
              title={l.name}
              value={`${fmt(l.qty)} pcs`}
              icon={l.type === "leaker_wip" ? Workflow : Boxes}
              description={
                l.type === "leaker_wip"
                  ? "Cores waiting to be covered — not sellable yet"
                  : `${l.code} · value ${fmt(l.value)}`
              }
            />
          ))}
        </div>

        <Card>
          <CardContent className="p-3 md:p-4 flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs">Bin</Label>
              <Select value={locationFilter} onValueChange={setLocationFilter}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All bins</SelectItem>
                  {locations.map((l) => (
                    <SelectItem key={l.code} value={l.code}>{l.code} — {l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="ml-auto">
              <Badge variant="secondary">Total value {fmt(totalValue)}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading
              </div>
            ) : !visible.length ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                Nothing in the bins. Counts posted from the cutover date onward show up here.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[860px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bin</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Defect grade</TableHead>
                      <TableHead className="text-right">Qty (pcs)</TableHead>
                      <TableHead className="text-right">Unit cost</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead>Oldest</TableHead>
                      <TableHead>Last movement</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((r) => {
                      const age = ageDays(r.first_movement_date);
                      const isWip = r.rw_defect_grades?.onward_route === "cover_then_store";
                      return (
                        <TableRow key={r.id}>
                          <TableCell>
                            <div className="font-semibold">{r.rw_locations?.code}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {r.rw_locations?.name}
                            </div>
                          </TableCell>
                          <TableCell className="font-display font-bold">
                            {r.products?.code}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                isWip ? "warning"
                                  : r.rw_defect_grades?.defect_type === "leakage" ? "info" : "destructive"
                              }
                            >
                              {r.rw_defect_grades?.name}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {fmt(r.quantity)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {fmt(r.unit_cost)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(r.stock_value)}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {age === null ? "—" : age === 0 ? "today" : `${age} day${age > 1 ? "s" : ""}`}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {r.last_movement_date
                              ? format(new Date(r.last_movement_date), "dd MMM HH:mm")
                              : "—"}
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
