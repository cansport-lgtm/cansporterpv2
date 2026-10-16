import { Link, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { purchaseCategoryLabel, type PurchaseCategory } from "@/lib/purchase/categories";
import { fmtMoney, prStatusMeta, type PurchaseRequestStatus } from "@/lib/purchaseRequest";

export type PurchaseRequestListRow = {
  id: string;
  pr_number: string;
  category: PurchaseCategory;
  department_id: string;
  status: PurchaseRequestStatus;
  priority: "normal" | "urgent";
  request_date: string;
  required_by: string | null;
  purpose: string;
  is_breakdown: boolean;
  estimated_total: number;
  created_by: string | null;
  created_at: string;
  submitted_at: string | null;
  reject_reason: string | null;
  cancel_reason: string | null;
  department: { name: string } | null;
  requester: { full_name: string | null } | null;
  purchase_request_items: { id: string }[];
};

/** Purchase request rows; each opens `${basePath}/:id`. */
export function PurchaseRequestTable({
  rows, basePath, isLoading, showPrices, showRequester = true, emptyText = "No purchase requests.",
}: {
  rows: PurchaseRequestListRow[];
  basePath: string;
  isLoading?: boolean;
  showPrices: boolean;
  showRequester?: boolean;
  emptyText?: string;
}) {
  const navigate = useNavigate();
  const cols = 7 + (showRequester ? 1 : 0) + (showPrices ? 1 : 0);
  return (
    <Table className="min-w-[960px]">
      <TableHeader>
        <TableRow>
          <TableHead>PR no.</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Department</TableHead>
          {showRequester && <TableHead>Requested by</TableHead>}
          <TableHead>Purpose</TableHead>
          <TableHead>Required by</TableHead>
          {showPrices && <TableHead className="text-right">Est. value</TableHead>}
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <TableRow><TableCell colSpan={cols} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
        ) : rows.length === 0 ? (
          <TableRow><TableCell colSpan={cols} className="text-center py-8 text-muted-foreground">{emptyText}</TableCell></TableRow>
        ) : rows.map((r) => {
          const s = prStatusMeta(r.status);
          const href = `${basePath}/${r.id}`;
          return (
            <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate(href)}>
              <TableCell className="font-mono text-sm font-semibold whitespace-nowrap">
                <Link to={href} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{r.pr_number}</Link>
                {r.priority === "urgent" && (
                  <div className="text-xs text-red-700 font-sans font-medium inline-flex items-center gap-1 ml-2">
                    <AlertTriangle className="h-3 w-3" />{r.is_breakdown ? "Breakdown" : "Urgent"}
                  </div>
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{format(new Date(r.request_date), "dd MMM yyyy")}</TableCell>
              <TableCell className="text-sm whitespace-nowrap">{purchaseCategoryLabel(r.category)}</TableCell>
              <TableCell className="text-sm">{r.department?.name ?? "—"}</TableCell>
              {showRequester && <TableCell className="text-sm">{r.requester?.full_name ?? "—"}</TableCell>}
              <TableCell className="text-sm max-w-[260px]">
                <div className="truncate" title={r.purpose}>{r.purpose}</div>
                <div className="text-xs text-muted-foreground">{r.purchase_request_items.length} item(s)</div>
              </TableCell>
              <TableCell className="text-sm whitespace-nowrap">{r.required_by ? format(new Date(r.required_by), "dd MMM yyyy") : "—"}</TableCell>
              {showPrices && <TableCell className="text-right tabular-nums">{fmtMoney(r.estimated_total)}</TableCell>}
              <TableCell>
                <Badge variant={s.variant}>{s.label}</Badge>
                {r.status === "rejected" && r.reject_reason && (
                  <div className="text-xs text-red-700 mt-1 max-w-[200px] truncate" title={r.reject_reason}>{r.reject_reason}</div>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
