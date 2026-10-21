import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { PackagePlus, Plus } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { fcDb, fmtDate } from "@/lib/facilities";
import { SR_LIST_SELECT, loadHeadDepartments, srStatusMeta, type SupplyRequestListRow } from "@/lib/facilitiesSupplies";

/** Supply request rows; each opens `${basePath}/:id`. */
export function SupplyRequestTable({
  rows, basePath, isLoading, showRequester = true, emptyText = "No supply requests.",
}: {
  rows: SupplyRequestListRow[];
  basePath: string;
  isLoading?: boolean;
  showRequester?: boolean;
  emptyText?: string;
}) {
  const navigate = useNavigate();
  const cols = 5 + (showRequester ? 1 : 0);
  return (
    <Table className="min-w-[720px]">
      <TableHeader>
        <TableRow>
          <TableHead>SR no.</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Department</TableHead>
          {showRequester && <TableHead>Requested by</TableHead>}
          <TableHead>Reason</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <TableRow><TableCell colSpan={cols} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
        ) : rows.length === 0 ? (
          <TableRow><TableCell colSpan={cols} className="text-center text-muted-foreground py-8">{emptyText}</TableCell></TableRow>
        ) : rows.map((r) => {
          const s = srStatusMeta(r.status);
          return (
            <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate(`${basePath}/${r.id}`)}>
              <TableCell className="font-mono text-xs">{r.request_number}</TableCell>
              <TableCell className="tabular-nums text-sm">{fmtDate(r.request_date)}</TableCell>
              <TableCell>{r.department?.name ?? "—"}</TableCell>
              {showRequester && <TableCell>{r.requester?.full_name ?? "—"}</TableCell>}
              <TableCell className="max-w-[320px] truncate">{r.reason} <span className="text-muted-foreground text-xs">· {r.lines.length} item{r.lines.length === 1 ? "" : "s"}</span></TableCell>
              <TableCell><Badge variant={s.variant}>{s.label}</Badge></TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/**
 * Self service: the supply requests the logged-in user raised, and — for
 * department heads — the ones of their departments waiting for them.
 */
export default function MySupplyRequestsPage() {
  const navigate = useNavigate();
  const { user, roles } = useAuth();
  const isSuperAdmin = roles.some((r) => r.role === "super_admin");
  const [tab, setTab] = useState<"mine" | "approve">("mine");

  const { data: headDepartments = [] } = useQuery({
    queryKey: ["purchase-request-my-head-departments", user?.id],
    enabled: Boolean(user?.id),
    queryFn: () => loadHeadDepartments(user!.id),
  });
  const isHead = isSuperAdmin || headDepartments.length > 0;

  const { data: mine = [], isLoading } = useQuery<SupplyRequestListRow[]>({
    queryKey: ["facilities-supply-requests", "mine", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await fcDb.from("facilities_supply_requests").select(SR_LIST_SELECT)
        .eq("created_by", user?.id).order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: toApprove = [], isLoading: approveLoading } = useQuery<SupplyRequestListRow[]>({
    queryKey: ["facilities-supply-requests", "hod-queue", user?.id, isSuperAdmin, headDepartments],
    enabled: isHead,
    queryFn: async () => {
      let q = fcDb.from("facilities_supply_requests").select(SR_LIST_SELECT).eq("status", "pending_hod");
      if (!isSuperAdmin) q = q.in("department_id", headDepartments);
      const { data, error } = await q.order("submitted_at");
      if (error) throw error;
      return data ?? [];
    },
  });
  const showing = tab === "approve" && isHead ? "approve" : "mine";

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader title="My Supply Requests" description="Ask the admin office for stationery, toner, tea and other office supplies" icon={PackagePlus}>
          <Button onClick={() => navigate("/my-supply-requests/new")}><Plus className="h-4 w-4 mr-1" /> New supply request</Button>
        </PageHeader>
        {isHead && (
          <Tabs value={showing} onValueChange={(v) => setTab(v as "mine" | "approve")}>
            <TabsList>
              <TabsTrigger value="mine">My requests</TabsTrigger>
              <TabsTrigger value="approve">To approve{toApprove.length > 0 ? ` (${toApprove.length})` : ""}</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            {showing === "mine" ? (
              <SupplyRequestTable rows={mine} basePath="/my-supply-requests" isLoading={isLoading} showRequester={false}
                emptyText="You have not raised a supply request yet." />
            ) : (
              <SupplyRequestTable rows={toApprove} basePath="/my-supply-requests" isLoading={approveLoading}
                emptyText="Nothing is waiting for your approval." />
            )}
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
